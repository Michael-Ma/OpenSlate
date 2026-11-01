import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { digest, newId } from '@openslate/core';
import { describeCodexImageInput, FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { createMediaExecutionRuntime } from '../dist/application/media-execution-runtime.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { ProductionService } from '../dist/application/service.js';
import { CodePlanRuntime } from '../dist/code-plan/index.js';
import { CodePlanExecution } from '../dist/code-plan/execution.js';
import { codexImageProfile, codexApiProfile, codexRuntimeConfiguration } from './codex-image-execution-fixture.mjs';
import { pngBytes, tool, accepted, completed } from './viggle-h3-execution-fixture.mjs';

export const videoProfile = { id: 'code-viggle', revision: 'p4a', kind: 'video', adapter: 'viggle-h3', executionVersion: '1',
  configuration: { model: 'MiniMax-H3', settings: { quality: 'low', resolution: '480p', aspectRatio: '16:9' } },
  minFrames: 90, maxFrames: 450, maxConcurrency: 2, unitCostMicros: '100000', maxRetries: 0 };
export const speechProfile = { id: 'code-speech', revision: 'p4a', kind: 'speech', adapter: 'openai-speech', executionVersion: '1',
  configuration: { model: 'gpt-4o-mini-tts', settings: {} }, maxConcurrency: 1, unitCostMicros: '10000', maxRetries: 0 };
export const miniMaxProfile = { ...videoProfile, id: 'code-minimax', adapter: 'minimax-h3',
  configuration: { model: 'MiniMax-H3', settings: { resolution: '768P' } }, minFrames: 180, maxFrames: 180 };
export const imageSource = `export default async function(ctx) { await ctx.image({model:'${codexImageProfile.id}',prompt:'A window at dawn'}); }`;

/** Test transports consume synthetic bytes in memory. No real sockets, native runtime or personal configuration. */
export async function realCodeFixture(t, changes = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-p4a-'));
  const f = { root, calls: { prepare: 0, start: 0, lookup: 0, video: 0, poll: 0, download: 0, render: 0 }, controls: { lostStart: false, pending: false, credential: 'offline-fixture-key' } };
  f.png = pngBytes(320, 320);
  const raw = join(root, 'raw.mp4');
  await promisify(execFile)(tool('ffmpeg'), ['-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=160x90:r=24','-t',String(changes.videoSeconds ?? 3),
    '-an','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',raw], { timeout: 15000 });
  f.video = readFileSync(raw);
  const download = { lookup: async () => [{address:'8.8.8.8',family:4}], request: (args, callback) => {
    f.calls.download++; const client = new EventEmitter(); let response;
    let destroyed = false;
    client.destroy = () => { if (!destroyed) { destroyed = true; response?.destroy(); queueMicrotask(() => client.emit("close")); } return client; };
    client.end = () => queueMicrotask(() => { response = Readable.from([f.video]); response.statusCode = 200;
      response.headers = {'content-type':'video/mp4','content-length':String(f.video.length)}; callback(response); });
    return client;
  } };
  f.transport = {
    async prepare(input) { f.calls.prepare++; return { runtime:{version:1,runtimeVersion:'0.153.4',runtimeDigest:'a'.repeat(64),configurationDigest:'b'.repeat(64),model:'gpt-6-astra',authMode:'chatgpt'},
      session:{threadId:`thread-${input.attemptId}`,turnInputDigest:describeCodexImageInput(input).turnInputDigest} }; },
    async start(prepared) { f.calls.start++; assert.equal(f.store.list('codex_image_execution_dispatch', f.project.id).length, f.calls.start);
      if (f.controls.lostStart) throw Error('lost native reply after turn start');
      return {kind:'pending',threadId:prepared.session.threadId,turnId:'turn-fixture'}; },
    async lookup(prepared) { f.calls.lookup++; return f.controls.pending ? {kind:'unknown',code:'UNAVAILABLE'}
      : {kind:'completed',threadId:prepared.session.threadId,turnId:'turn-fixture',itemId:'image-fixture',bytes:f.png,revisedPrompt:'fixture'}; },
    async release() {},
  };
  f.viggleFetch = async (url, init) => {
    if (init.method === 'POST') {
      f.calls.video++;
      const dispatch = f.store.list('viggle_h3_execution_dispatch', f.project.id).at(-1);
      assert.ok(dispatch); const attempt = f.store.get('attempt', dispatch.id);
      assert.equal(f.store.get('code_plan_execution', attempt.id).requestDigest, digest(attempt.request));
      assert.ok(f.plans.steps(f.project.id).some(step => step.attemptId === attempt.id));
      const form = await new Request(url, {method:'POST',headers:init.headers,body:init.body}).formData();
      f.form = form;
      if(form.has('first_frame_image')) f.firstFrame = Buffer.from(await form.get('first_frame_image').arrayBuffer());
      return accepted();
    }
    f.calls.poll++; return completed();
  };
  f.open = () => {
    f.store = new Store(join(root, 'app.sqlite')); f.fake = new FakeProvider(join(root, 'fake.sqlite'));
    f.mediaRuntime = createMediaExecutionRuntime({store:f.store,fakeProvider:f.fake,dataDirectory:root,ffmpegPath:tool('ffmpeg'),ffprobePath:tool('ffprobe'),
      configuration:{...codexRuntimeConfiguration(),viggleH3:true,viggleH3DownloadHosts:['media.example.test'],...changes.configuration},
      credentials:new EnvironmentMediaCredentials(() => f.controls.credential),
      providerConfiguration:{version:1,profiles:(changes.profiles ?? [codexImageProfile,videoProfile]).map(profile => ({label:profile.id,profile}))},
      transport:{codexImage:f.transport,viggleFetch:(...args) => f.viggleFetch(...args),viggleDownload:download,download,...changes.transport} });
    f.execution = new CodePlanExecution(f.store, {provider:f.fake,registry:f.mediaRuntime.registry,catalog:f.mediaRuntime.providerCatalog,
      outputStore:f.mediaRuntime.outputStore,outputIngestor:f.mediaRuntime.outputIngestor,localExecutor:f.mediaRuntime.localExecutor,
      artifactDir:join(root,'artifacts'),providerTimeoutMs:1000});
    f.plans = new CodePlanRuntime(f.store, {execution:f.execution});
    f.service = new ProductionService(f.store,f.mediaRuntime.engine,undefined,f.mediaRuntime.productionOptions);
    const render = f.mediaRuntime.localMedia.render.bind(f.mediaRuntime.localMedia);
    f.mediaRuntime.localMedia.render = (...args) => { f.calls.render++; return render(...args); };
  };
  const close = async () => { await f.plans.close(); await f.mediaRuntime.close(); f.fake.close(); f.store.close(); };
  f.restart = async () => { await close(); f.open(); };
  t.after(async () => { await close(); rmSync(root,{recursive:true,force:true}); });
  f.open();
  const catalog = f.mediaRuntime.providerCatalog;
  f.project = f.service.createProject('Offline code providers', catalog.select(catalog.digest, changes.selected ?? (changes.profiles ?? [codexImageProfile,videoProfile]).map(profile => profile.id)), 'code');
  f.submit = source => f.plans.submit(f.project.id,{source,author:'user',basedOnVersion:f.plans.getRun(f.project.id)?.planVersion ?? null,invocationId:newId()});
  f.due = () => { for (const kind of ['viggle_h3_poll_schedule','h3_poll_schedule']) for (const row of f.store.list(kind,f.project.id))
    f.store.put(kind,row.id,f.project.id,{...row,nextPollAt:0}); };
  f.tick = async () => { f.due(); await f.plans.tick(); };
  f.finish = async () => { for (let count=0;count<16;count++) { await f.tick(); const run=f.plans.getRun(f.project.id);
    if (run?.state === 'error') assert.fail(JSON.stringify(run.error));
    if (run?.state === 'done' || run?.state === 'done_with_failures') return run; }
    assert.fail(JSON.stringify(f.plans.getRun(f.project.id))); };
  f.noGraph = () => { for (const kind of ['node_binding','candidate','grant','reservation','approval','review_snapshot'])
    assert.equal(f.store.list(kind,f.project.id).length,0,`Unexpected graph ${kind}`); };
  return f;
}
