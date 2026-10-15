import { ExecutionIngestionRouter } from "../../dist/execution/ingestion-router.js";
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_PROFILES, shotIntentDigest } from '@openslate/core';
import { FakeProvider, ExecutionRegistry, OPENAI_SPEECH_MODEL } from '@openslate/providers';
import { Store } from '../../dist/persistence/store.js';
import { Engine } from '../../dist/execution/engine.js';
import { ProductionService } from '../../dist/application/service.js';
import { ExecutionOutputStore } from '../../dist/execution/output-store.js';
import { OpenAISpeechExecution } from '../../dist/execution/openai-speech-execution.js';
import { SpoolAudioIngestor } from '../../dist/execution/spool-audio-ingester.js';
import { EnvironmentMediaCredentials } from '../../dist/application/provider-credentials.js';
import { LocalMediaService } from '../../dist/media/local-media.js';
import { NarrationService, NarrationCanonicalService } from '../../dist/narration/index.js';
import { NarrationSpeechService } from '../../dist/narration/narration-speech-service.js';
import { SceneConfirmationRunner } from '../../dist/scene-confirmations.js';
import { createApp } from '../../dist/app.js';
import { projectFixture } from '../execution-fixture.mjs';
import { wave } from '../speech-execution-fixture.mjs';

export async function confirmationFixture(t, { seconds = 1, modes = ['generated', 'none'], speechRetries = 0, fetch: reply } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-confirm-'))), calls = { speech: 0 };
  const profiles = [...DEFAULT_PROFILES, { id: 'offline-speech', revision: 'fixture-1', kind: 'speech', adapter: 'openai-speech', executionVersion: '1',
    configuration: { model: OPENAI_SPEECH_MODEL, settings: {} }, maxConcurrency: 1, unitCostMicros: '100', maxRetries: speechRetries }];
  const provider = new FakeProvider(join(root, 'fake.sqlite')), stores = [], apps = [];
  const f = { root, calls, profiles, provider };
  f.open = () => {
    const store = new Store(join(root, 'store.sqlite')); stores.push(store);
    const outputs = new ExecutionOutputStore(store, { rootDir: join(root, 'output') });
    const media = new LocalMediaService({ rootDir: join(root, 'media'), allowedInputRoots: [root], ffmpegPath: process.env.OPENSLATE_FFMPEG_PATH ?? '/opt/homebrew/bin/ffmpeg', ffprobePath: process.env.OPENSLATE_FFPROBE_PATH ?? '/opt/homebrew/bin/ffprobe' });
    const speech = new OpenAISpeechExecution({ store, outputStore: outputs, credentials: new EnvironmentMediaCredentials(() => 'synthetic-fixture-only'),
      fetch: async (...args) => { calls.speech++; return reply ? reply(...args) : new Response(wave(Math.round(seconds * 24000)), { headers: { 'content-type': 'audio/wav' } }); } });
    const engine = new Engine(store, new ExecutionRegistry([provider, speech]), { profiles, artifactDir: join(root, 'artifacts'), outputStore: outputs,
      outputIngestor: new ExecutionIngestionRouter({ audio: new SpoolAudioIngestor(outputs, media, { rootDir: join(root, 'derivations') }) }), externalAdmission: { authorize: () => ({}) } });
    const production = new ProductionService(store, engine, profiles), narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration), narrationSpeech = new NarrationSpeechService(narration);
    const runner = new SceneConfirmationRunner(production, { narration, canonical, narrationSpeech }), token = 'synthetic-local-token-for-confirmation';
    const app = createApp({ service: production, sceneCommands: runner, localToken: token, logger: false,
      narrationRoutes: { production, narration, canonical, narrationSpeech, uploadDirectory: join(root, 'uploads') } }); apps.push(app);
    Object.assign(f, { store, engine, production, narration, canonical, narrationSpeech, runner, app, media });
    f.call = (method, path, payload, key = randomUUID()) => app.inject({ method, url: `/api/projects/${f.project.id}${path}`,
      headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, ...(key === null ? {} : { 'idempotency-key': key }) }, ...(payload === undefined ? {} : { payload }) });
  };
  f.open();
  let project = f.production.createProject('Durable scene confirmation');
  const shape = projectFixture(project.id, modes.length);
  shape.scenes = [shape.scenes[0]];
  shape.shots = shape.shots.map((s, i) => { const shot = { ...s, sceneId: shape.scenes[0].id, narration: { mode: modes[i], text: modes[i] === 'none' ? '' : `Voice line ${i}`, voice: 'stock' }, narrationPending: modes[i] !== 'none' };
    shot.promptIntent = { image: shotIntentDigest(shot, 'image'), video: shotIntentDigest(shot, 'video') }; return shot; });
  project = f.store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId }, project.headVersion);
  f.store.put('project_revision', project.revisionId, project.id, { project }); f.project = project;
  f.ok = async r => { assert.equal(r.statusCode, 200, r.body); return r.json(); };
  f.overview = () => f.call('GET', '/generation').then(f.ok);
  f.make = async (extra = {}, key) => { const view = await f.call('GET', '/scenes/scene-0/generation').then(f.ok);
    const body = { headVersion: view.headVersion, revisionId: view.revisionId, kind: 'image', reviewedFrames: [], reviewedHoldDigest: view.reviewedHoldDigest,
      reviewedControlAuthorityId: view.reviewedControlAuthorityId, ...extra };
    return { receipt: await f.call('POST', '/scenes/scene-0/generate', body, key).then(f.ok), body }; };
  f.tick = async (count = 1) => { for (let i = 0; i < count; i++) { await f.engine.reconcile(); await f.engine.runReady(); await f.runner.advance(); } };
  f.openFrames = async () => { const view = await f.overview(); for (const s of Object.values(view.shots)) if (s.keyframe.artifact) await f.call('POST', `/shots/${s.shotId}/frame-views`, { artifactId: s.keyframe.artifact.artifactId, sha256: s.keyframe.artifact.sha256 }).then(f.ok); };
  f.confirmBody = async () => { const view = await f.overview(); return { confirmationDigest: view.scenes[0].confirmationDigest,
    reviewedFrames: view.scenes[0].videoTargets.map(id => ({ shotId: id, artifactId: view.shots[id].keyframe.artifact.artifactId, sha256: view.shots[id].keyframe.artifact.sha256 })), expectedEstimateMicros: view.scenes[0].quotes.confirmVideo.micros }; };
  f.restart = async () => { await f.app.close(); f.store.close(); f.open(); };
  t.after(async () => { for (const app of apps) await app.close(); for (const store of stores) if (store.db.open) store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  return f;
}
