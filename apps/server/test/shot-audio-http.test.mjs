import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../dist/persistence/index.js';
import { Engine } from '../dist/execution/index.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalMediaService } from '../dist/media/index.js';
import { NarrationService, NarrationCanonicalService } from '../dist/narration/index.js';
import { createApp } from '../dist/app.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { seedFixture } from '../dist/demo.js';
import { FakeProvider } from '@openslate/providers';
import { digest } from '@openslate/core';
import { DEFAULT_PROFILES } from '@openslate/core';
import { speechProfile } from './narration-speech-fixture.mjs';
import { NarrationSpeechService } from '../dist/narration/narration-speech-service.js';
import { PersonalVoiceService } from '../dist/narration/personal-voices.js';
import { editStoryboard } from '../dist/storyboard.js';
const token = 'local_shot_audio_test_token_0000000';
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg');
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe');
let inputDir, wave;
before(async () => { inputDir = await mkdtemp(join(tmpdir(), 'openslate-shot-audio-input-')); const path = join(inputDir, 'wave.wav'); await promisify(execFile)(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=730:sample_rate=48000:duration=7', '-c:a', 'pcm_s16le', path], { timeout: 15000 }); wave = await readFile(path); });
after(async () => rm(inputDir, { recursive: true, force: true }));
async function fixture(t,options={}) {
  const dir = await mkdtemp(join(tmpdir(), 'openslate-shot-audio-http-')), uploadDirectory = join(dir, 'uploads'); await mkdir(uploadDirectory);
  const store = new Store(join(dir, 'db.sqlite')), provider = new FakeProvider(join(dir, 'fake.sqlite'));
  const profiles=options.speech?[...DEFAULT_PROFILES,speechProfile]:DEFAULT_PROFILES;
  const engine = new Engine(store, provider, { artifactDir: join(dir, 'artifacts'), profiles }), production = new ProductionService(store, engine, profiles), project = seedFixture(production, dir);
  const media = new LocalMediaService({ rootDir: join(dir, 'media'), allowedInputRoots: [uploadDirectory], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration), app = createApp({ service: production, localToken: token });
  const speechService=options.speech?new NarrationSpeechService(narration):undefined;
  registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory, ...(speechService?{narrationSpeech:speechService}:{}) }); await app.ready();
  const f = { dir, project, store, provider, engine, production, narration, canonical, app, session: null, speechService };
  f.request = (suffix = '', body, extras = {}) => app.inject({ method: body === undefined ? 'GET' : 'POST', url: `/api/projects/${project.id}/narration${suffix}`, ...(body === undefined ? {} : { payload: body }), ...extras,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID(), ...extras.headers } });
  f.view = () => narration.workspaceSnapshot(project.id);
  f.start = async () => { const response = await f.request(`/shots/${project.shots[0].id}/sessions`, {}); assert.equal(response.statusCode, 200, response.body); f.session = response.json().session; };
  f.script = async () => f.request(`/shots/${project.shots[0].id}/script`, { sessionId: f.session.id, expectedHeadVersion: store.getProject(project.id).headVersion, expectedVersion: f.view().state.version, text: 'Made with care.', language: 'en', mode: 'uploaded', voice: null, profileRevisionId: null });
  f.edit = (suffix, fields) => f.request(suffix, { sessionId: f.session.id, expectedVersion: f.view().state.version, ...fields });
  f.ready = async () => {
    await f.start(); const saved = await f.script(); assert.equal(saved.statusCode, 200, saved.body);
    const upload = await f.request(`/audio?sessionId=${f.session.id}&declaredOrigin=uploaded`, wave, { headers: { 'content-type': 'application/octet-stream' } }); assert.equal(upload.statusCode, 200, upload.body);
    const audio = upload.json(), segment = f.view().segments[0];
    assert.equal((await f.edit('/bindings', { segmentId: segment.entry.segmentId, audioId: audio.id })).statusCode, 200);
    return { audio, segment: f.view().segments[0] };
  };
  f.acceptBody = (audio, segment) => ({ sessionId: f.session.id, expectedHeadVersion: store.getProject(project.id).headVersion, expectedVersion: f.view().state.version,
    segmentId: segment.entry.segmentId, segmentRevisionId: segment.script.id, audioId: audio.id, sha256: audio.media.sha256, startSample: 0, endSample: 288000 });
  t.after(async () => { await app.close(); if (store.db.open) store.close(); provider.close(); await rm(dir, { recursive: true, force: true }); }); return f;
}
async function settleVisualFrames(f) {
  let last;
  for (let cycle = 0; cycle < 16; cycle++) {
    last = await f.engine.runReady(); await f.engine.reconcile();
    const project = f.store.getProject(f.project.id), images = f.store.list('node_binding', project.id).filter(binding => binding.state === 'active' && binding.planId === project.activePlanId && binding.node.kind === 'image');
    if (images.length > 0 && images.every(binding => binding.outputs.image)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Frame preparation did not settle within 16 bounded fixture cycles: ${JSON.stringify({ blocked: last?.blocked, attempts: f.engine.attempts(f.project.id).map(attempt => ({ nodeId: attempt.nodeId, phase: attempt.phase })) })}`);
}

async function installVisualPlan(f, { assembly = false } = {}) {
 const p=f.store.getProject(f.project.id),human=f.production.beginRequest(p.id,'local-user','Install this authorized offline visual fixture',{...(f.session?{continuationRequestId:f.session.requestId}:f.production.pendingEditContinuation(p.id,'local-user',[p.id])?{continueEdits:f.production.pendingEditContinuation(p.id,'local-user',[p.id])}:{})}),actor=f.production.openEpoch(p.id,human).actor;
 const stamp=await f.production.prepare(p.id,actor,{variant:'project',expectedHeadVersion:p.headVersion,creative:{updateShots:p.shots.map(shot=>({id:shot.id,reauthorPrompts:true}))}});f.production.apply(p.id,actor,stamp.id);
 const project=f.store.getProject(p.id),q=JSON.stringify;f.production.authorize(project.id,human,project.shots.flatMap(shot=>[{scopeId:shot.id,kind:'image'},{scopeId:shot.id,kind:'video'}]),randomUUID());
 let source=`definePlan({baseRevision:${q(project.revisionId)}},p=>{`;
 for(const[i,shot]of project.shots.entries())source+=`const s${i}=p.shot(${q(shot.id)});const ref${i}=p.asset(${q(shot.referenceArtifactIds[0])});const i${i}=p.image("frame${i}",{intent:s${i},profile:"fake-image-v1",references:[ref${i}],prompt:${q(shot.imagePrompt)}});const r${i}=p.humanReview("review${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:${q(shot.videoPrompt)},seconds:6}]});const v${i}=p.video("take${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:${q(shot.videoPrompt)},seconds:6});`;
 source+=assembly?'const cut=p.timeline("movie-cut",{takes:[v0,v1],transition:"cut"});return p.render("movie-export",{timeline:cut,width:160,height:90,format:"mp4"});});':'return [v0,v1];});';const prepared=await f.production.prepare(project.id,actor,{variant:'plan',expectedHeadVersion:project.headVersion,source});f.production.apply(project.id,actor,prepared.id);
 await settleVisualFrames(f);const review=f.engine.reviewSnapshot(project.id);f.production.approve(project.id,human,review.id,review.members.map(row=>row.videoNodeId));
 return f.store.getProject(project.id);
}
test('shot audio workspace reads do not create authority; writes require authenticated current human session', async t => {
  const f = await fixture(t), before = f.store.cursor(f.project.id);
  const detail = await f.request(`/shots/${f.project.shots[0].id}`); assert.equal(detail.statusCode, 200); assert.equal(detail.json().segment, null);
  const playback = await f.request('/playback'); assert.equal(playback.statusCode, 200); assert.deepEqual(playback.json().placements, []);
  assert.equal(f.store.cursor(f.project.id), before);
  assert.equal((await f.request('/playback', undefined, { headers: { authorization: '' } })).statusCode, 403);
  await f.start(); assert.equal((await f.script()).statusCode, 200);
  f.production.beginRequest(f.project.id, 'local-user', 'An unrelated newer edit');
  assert.equal((await f.script()).json().error.code, 'NARRATION_SESSION_STALE');
  assert.equal(f.store.list('grant', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
});
test('one explicit shot acceptance installs measured canonical audio, preserves other shot and replays without duplicate decisions', async t => {
  const f = await fixture(t), { audio, segment } = await f.ready(), before = f.store.getProject(f.project.id), body = f.acceptBody(audio, segment);
  const path = `/shots/${before.shots[0].id}/accept`, extras = { headers: { 'idempotency-key': 'accept-exact-take' } };
  const accepted = await f.request(path, body, extras); assert.equal(accepted.statusCode, 200, accepted.body);
  const current = f.store.getProject(f.project.id); assert.deepEqual(current.shots[1], before.shots[1]);
  assert.equal(current.shots[0].desiredFrames, 180); assert.notEqual(current.shots[0].cueId, before.shots[0].cueId);
  assert.equal(f.store.list('narration_acceptance', f.project.id).length, 3);
  const replay = await f.request(path, body, extras); assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), accepted.json());
  assert.equal(f.store.list('narration_acceptance', f.project.id).length, 3);
  const playback = (await f.request('/playback')).json(); assert.equal(playback.placements.length, 1); assert.equal(playback.placements[0].sha256, audio.media.sha256);
  assert.deepEqual(playback.placements[0].shotIds, [before.shots[0].id]); assert.equal(playback.placements[0].durationSamples, 288000);
  assert.equal(f.store.list('grant', f.project.id).length, 0); assert.equal(f.provider.acceptedCount(), 0);
  const changed = structuredClone(current); changed.cues.find(cue => cue.id === current.shots[0].cueId).accepted = false; f.store.saveProject(changed, current.headVersion);
  assert.deepEqual((await f.request('/playback')).json().placements, [], 'withdrawn acceptance cannot be auditioned as current narration');
});
test('shot acceptance rejects stale bytes, range and script identities with complete transactional rollback', async t => {
  const f = await fixture(t), { audio, segment } = await f.ready(), body = f.acceptBody(audio, segment), path = `/shots/${f.project.shots[0].id}/accept`, before = f.view();
  for (const patch of [{ sha256: 'f'.repeat(64) }, { segmentRevisionId: randomUUID() }, { endSample: 0 }, { endSample: 720001 }]) {
    const response = await f.request(path, { ...body, ...patch }); assert.notEqual(response.statusCode, 200, response.body); assert.deepEqual(f.view(), before);
  }
  assert.equal(f.store.list('narration_acceptance', f.project.id).length, 0);
  const invalid = await f.request(path, { ...body, approved: true }); assert.equal(invalid.statusCode, 400);
});


test('compact accepted narration follows shot/scene order and covers an exact range ending between video frames', async t => {
  const f = await fixture(t), { audio, segment } = await f.ready(), body = { ...f.acceptBody(audio, segment), endSample: 288001, durationMode: 'match_audio' }, shotId = f.project.shots[0].id;
  const accepted = await f.request(`/shots/${shotId}/accept`, body); assert.equal(accepted.statusCode, 200, accepted.body);
  let project = f.store.getProject(f.project.id), cue = project.cues.find(cue => cue.id === project.shots[0].cueId);
  assert.equal(project.shots[0].desiredFrames, 181); assert.equal(cue.durationFrames, 181);
  assert.equal(f.canonical.workspaceCurrent(project.id).segments[0].placementMode, 'shot');
  const playback = async () => (await f.request('/playback')).json().placements[0];
  assert.equal((await playback()).atSample, 0); assert.equal((await playback()).durationSamples, 288001);
  project.shots.reverse(); project = f.store.saveProject(project, project.headVersion);
  assert.equal((await playback()).atSample, 180 * 1600, 'dragging the voiced shot to second moves its audition placement');
  project.shots[0].desiredFrames = 210; project = f.store.saveProject(project, project.headVersion);
  assert.equal((await playback()).atSample, 210 * 1600, 'earlier duration edits shift the voice with its shot');
  const later = { ...project.scenes[0], id: randomUUID(), revisionId: randomUUID(), purpose: 'Another scene' };
  project.shots.find(shot => shot.id === shotId).sceneId = later.id; project.scenes = [later, ...project.scenes]; project = f.store.saveProject(project, project.headVersion);
  assert.equal((await playback()).atSample, 0, 'scene order also owns the compact voice position');
  project.scenes.reverse(); project = f.store.saveProject(project, project.headVersion);
  assert.equal((await playback()).atSample, 210 * 1600);
  assert.equal(f.canonical.workspaceCurrent(project.id).segments[0].audioPlacement.atSample, 0, 'accepted historical source placement remains immutable');
});

test('editing and accepting one shot leaves another reviewed video eligible and preserves its uncertain attempt and cue',async t=>{
 const f=await fixture(t),project=f.store.getProject(f.project.id),q=JSON.stringify;
 const human=f.production.beginRequest(project.id,'local-user','Authorize these offline fixture slots'),actor=f.production.openEpoch(project.id,human).actor;
 f.production.authorize(project.id,human,project.shots.flatMap(shot=>[{scopeId:shot.id,kind:'image'},{scopeId:shot.id,kind:'video'}]),randomUUID());
 let source=`definePlan({baseRevision:${q(project.revisionId)}},p=>{`;
 for(const[i,shot]of project.shots.entries())source+=`const s${i}=p.shot(${q(shot.id)});const ref${i}=p.asset(${q(shot.referenceArtifactIds[0])});const i${i}=p.image("frame${i}",{intent:s${i},profile:"fake-image-v1",references:[ref${i}],prompt:${q(shot.imagePrompt)}});const r${i}=p.humanReview("review${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:${q(shot.videoPrompt)},seconds:6}]});const v${i}=p.video("take${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:${q(shot.videoPrompt)},seconds:6});`;
 source+='return [v0,v1];});';const prepared=await f.production.prepare(project.id,actor,{variant:'plan',expectedHeadVersion:project.headVersion,source});f.production.apply(project.id,actor,prepared.id);
 await settleVisualFrames(f);const review=f.engine.reviewSnapshot(project.id);f.production.approve(project.id,human,review.id,review.members.map(row=>row.videoNodeId));
 const otherVideo=f.store.list('node_binding',project.id).find(binding=>binding.node.kind==='video'&&binding.node.shotId===project.shots[1].id);f.provider.setMode(otherVideo.id,'unknown_after_accept');
 const before=f.store.getProject(project.id),oldCue=structuredClone(before.cues.find(cue=>cue.id===before.shots[1].cueId)),{audio,segment}=await f.ready();
 assert.ok(f.store.list('hold',project.id).filter(hold=>hold.active).every(hold=>hold.scopeId===project.shots[0].id));
 assert.equal((await f.engine.runReady()).dispatched,1);const attempt=f.engine.attempts(project.id).find(attempt=>attempt.nodeId===otherVideo.id);assert.equal(attempt.phase,'submission_unknown');
 const response=await f.request(`/shots/${project.shots[0].id}/accept`,f.acceptBody(audio,segment));assert.equal(response.statusCode,200,response.body);
 const accepted=f.store.getProject(project.id);assert.deepEqual(accepted.shots[1],before.shots[1]);assert.deepEqual(accepted.cues.find(cue=>cue.id===oldCue.id),oldCue);
 assert.ok(f.store.list('hold',project.id).filter(hold=>hold.active).every(hold=>hold.scopeId===project.shots[0].id));
 await f.engine.reconcile();assert.equal(f.engine.attempts(project.id).find(row=>row.id===attempt.id).phase,'succeeded');assert.equal(f.provider.acceptedCount(),3);
 assert.ok(f.engine.outputs(project.id).some(output=>output.nodeId===otherVideo.id&&output.artifact.kind==='video'));assert.equal(f.engine.attempts(project.id).filter(row=>row.nodeId===otherVideo.id).length,1);
});

test('compact session cannot borrow another shot path or escalate its immutable scope through session input',async t=>{
 const f=await fixture(t),{audio,segment}=await f.ready(),before=f.store.cursor(f.project.id),scope=f.store.get('narration_shot_scope',f.session.requestId),pin=f.store.get('narration_shot_scope_target',f.session.requestId);
 const wrongPath=await f.request(`/shots/${f.project.shots[1].id}/script`,{sessionId:f.session.id,expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedVersion:f.view().state.version,text:'Other shot',language:'en',mode:'uploaded',voice:null,profileRevisionId:null});assert.notEqual(wrongPath.statusCode,200);
 const escaped=await f.request(`/shots/${f.project.shots[0].id}/sessions`,{continuationSessionId:f.session.id,scopeIds:[f.project.id],shotId:f.project.shots[1].id});assert.equal(escaped.statusCode,400);
 assert.equal(f.store.cursor(f.project.id),before);assert.deepEqual(f.store.get('narration_shot_scope',f.session.requestId),scope);assert.deepEqual(f.store.get('narration_shot_scope_target',f.session.requestId),pin);
  assert.equal(pin.segmentId,segment.entry.segmentId);assert.equal(pin.scopeDigest,digest(scope));assert.equal(scope.shotId,f.project.shots[0].id);assert.equal(f.store.list('grant',f.project.id).length,0);assert.equal(f.provider.acceptedCount(),0);
});

test('uploaded-to-generated writing updates the card and preserves visual revisions while blocking old video until acceptance',async t=>{
 const f=await fixture(t,{speech:true}),{audio,segment}=await f.ready();let response=await f.request(`/shots/${f.project.shots[0].id}/accept`,f.acceptBody(audio,segment));assert.equal(response.statusCode,200,response.body);
 await installVisualPlan(f);
 const session=await f.request(`/shots/${f.project.shots[0].id}/sessions`,{continuationSessionId:f.session.id});assert.equal(session.statusCode,200,session.body);f.session=session.json().session;
 const frames=f.engine.outputs(f.project.id).filter(output=>output.artifact.kind==='image');assert.equal(frames.length,2);
 const saved=f.store.getProject(f.project.id),originalRevision=saved.shots[0].revisionId,oldCue=structuredClone(saved.cues.find(cue=>cue.id===saved.shots[0].cueId));
 response=await f.request(`/shots/${saved.shots[0].id}/script`,{sessionId:f.session.id,expectedHeadVersion:saved.headVersion,expectedVersion:f.view().state.version,text:'A newly generated line.',language:'en',mode:'generated',voice:'coral',profileRevisionId:speechProfile.revision});assert.equal(response.statusCode,200,response.body);
 const changed=f.store.getProject(f.project.id);assert.equal(changed.shots[0].narration.mode,'generated');assert.equal(changed.shots[0].narration.text,'A newly generated line.');assert.equal(changed.shots[0].narrationPending,true);assert.equal(changed.shots[0].revisionId,originalRevision);assert.deepEqual(changed.cues.find(cue=>cue.id===oldCue.id),oldCue);assert.deepEqual(changed.shots[1],saved.shots[1]);
 const row=f.view().segments[0];response=await f.request('/speech-proposals',{sessionId:f.session.id,expectedHeadVersion:changed.headVersion,segmentId:row.entry.segmentId,segmentRevisionId:row.script.id,profileId:speechProfile.id,voice:'coral',instructions:''});assert.equal(response.statusCode,200,response.body);
 const proposal=f.store.get('narration_speech_proposal',response.json().proposal.id);response=await f.request('/speech-reviews',{sessionId:f.session.id,proposalId:proposal.id,proposalDigest:digest(proposal)});assert.equal(response.statusCode,200,response.body);
 const binding=f.store.get('node_binding',f.store.get('candidate',response.json().receipt.candidateId).nodeId),current=f.store.getProject(f.project.id);
 assert.equal(f.engine.held(current,binding.id),false,'only the exact reviewed speech job ignores its own writing hold');
 assert.ok(f.store.list('hold',current.id).some(h=>h.active&&h.ownerId===f.session.requestId&&h.scopeId===saved.shots[0].id));
 assert.equal(current.shots[0].narrationPending,true);for(const frame of frames)assert.equal(f.engine.outputs(current.id).find(output=>output.nodeId===frame.nodeId).artifact.artifactId,frame.artifact.artifactId);
 const oldVideo=f.store.list('node_binding',current.id).find(binding=>binding.node.kind==='video'&&binding.node.shotId===saved.shots[0].id);assert.equal(f.engine.held(current,oldVideo.id),true);
 for(const hold of f.store.list('hold',current.id).filter(h=>h.active&&h.ownerId===f.session.requestId))f.engine.releaseHold(current.id,hold.id,f.session.requestId);
 const starts=await f.engine.runReady();assert.equal(starts.dispatched,1,'only the other reviewed video is eligible');assert.equal(f.provider.acceptedCount(),3);assert.equal(f.engine.attempts(current.id).filter(attempt=>attempt.request.kind==='image').length,2,'speech planning must not resubmit frames');
 assert.ok(starts.blocked.some(blocked=>blocked.nodeId===oldVideo.id&&blocked.code==='TIMING_REQUIRED'),'pending writing blocks old video even if another resolved operation releases the request hold');
 assert.ok(!f.engine.attempts(current.id).some(attempt=>attempt.nodeId===oldVideo.id));
});

test('personal-voice writing needs no generation approval while synthesis still requires the chosen registered voice',async t=>{
 const f=await fixture(t,{speech:true});await f.start();const project=f.store.getProject(f.project.id),shotId=project.shots[0].id,visualRevision=project.shots[0].revisionId;
 let response=await f.request(`/shots/${shotId}/script`,{sessionId:f.session.id,expectedHeadVersion:project.headVersion,expectedVersion:f.view().state.version,text:'First words.',language:'en',mode:'generated',voice:'coral',profileRevisionId:speechProfile.revision});assert.equal(response.statusCode,200,response.body);
 let changed=f.store.getProject(f.project.id);editStoryboard(f.production,f.project.id,{kind:'narration',id:shotId,field:'voice',value:'personal',expectedHeadVersion:changed.headVersion},randomUUID());
 response=await f.request(`/shots/${shotId}/sessions`,{continuationSessionId:f.session.id});assert.equal(response.statusCode,200,response.body);f.session=response.json().session;
 changed=f.store.getProject(f.project.id);const writing=await f.request(`/shots/${shotId}/script`,{sessionId:f.session.id,expectedHeadVersion:changed.headVersion,expectedVersion:f.view().state.version,text:'Second words.',language:'en',mode:'generated',voice:'coral',profileRevisionId:speechProfile.revision});assert.equal(writing.statusCode,200,writing.body);
 changed=f.store.getProject(f.project.id);const before=f.view(),stale=await f.request(`/shots/${shotId}/generate`,{sessionId:f.session.id,expectedHeadVersion:changed.headVersion,expectedNarrationVersion:before.state.version,text:'Second words.',voice:'coral',profileId:speechProfile.id});assert.equal(stale.json().error.code,'PERSONAL_VOICE_REQUIRED');assert.deepEqual(f.view(),before);
 const human=f.production.beginRequest(f.project.id,'local-user','Register my existing voice',{editing:false}),voices=new PersonalVoiceService(f.production);voices.register(f.project.id,human,{key:randomUUID(),expectedHeadVersion:changed.headVersion,label:'My recorded voice',provider:'openai',providerVoiceId:'voice_scope_demo',ownVoice:true,permitSynthesis:true});
 response=await f.request(`/shots/${shotId}/script`,{sessionId:f.session.id,expectedHeadVersion:changed.headVersion,expectedVersion:f.view().state.version,text:'Second words.',language:'en',mode:'generated',voice:'openai-custom:voice_scope_demo',profileRevisionId:speechProfile.revision});assert.equal(response.statusCode,200,response.body);
 changed=f.store.getProject(f.project.id);assert.equal(changed.shots[0].revisionId,visualRevision);assert.equal(changed.shots[0].narration.voice,'personal');assert.equal(changed.shots[0].narration.text,'Second words.');assert.equal(changed.shots[0].narrationPending,true);assert.deepEqual(changed.shots[1],project.shots[1]);assert.equal(f.store.list('narration_acceptance',f.project.id).length,0);assert.equal(f.store.list('grant',f.project.id).length,0);assert.equal(f.provider.acceptedCount(),0);
});


test('one second of truthful voiceover preserves a six-second planned shot without claiming six seconds of audio', async t => {
  const f = await fixture(t), { audio, segment } = await f.ready(), before = f.store.getProject(f.project.id), shotId = before.shots[0].id;
  const body = { ...f.acceptBody(audio, segment), endSample: 48000 };
  const accepted = await f.request(`/shots/${shotId}/accept`, body); assert.equal(accepted.statusCode, 200, accepted.body);
  const project = f.store.getProject(f.project.id), shot = project.shots.find(shot => shot.id === shotId), cue = project.cues.find(cue => cue.id === shot.cueId);
  assert.equal(shot.desiredFrames, 180); assert.equal(shot.narrationTimingMode, 'within_shot'); assert.equal(cue.durationFrames, 30);
  assert.equal(cue.accepted, true); assert.equal(cue.measured, true); assert.deepEqual(project.shots[1], before.shots[1]);
  const canonical = f.canonical.workspaceCurrent(project.id), placement = canonical.segments.find(segment => segment.cue.id === cue.id);
  assert.equal(placement.timingMode, 'within_shot'); assert.equal(placement.audioPlacement.durationSamples, 48000); assert.equal(placement.audioPlacement.source.probe.audio.samples, audio.media.probe.audio.samples);
  assert.equal((await f.request('/playback')).json().placements[0].durationSamples, 48000);
  assert.equal(f.provider.acceptedCount(), 0);
});

test('overlong voice rejects without changing accepted state unless video duration matching is explicit', async t => {
  const f = await fixture(t), { audio, segment } = await f.ready(), body = { ...f.acceptBody(audio, segment), endSample: 336000 }, path = `/shots/${f.project.shots[0].id}/accept`, before = f.view();
  const rejected = await f.request(path, body); assert.equal(rejected.json().error.code, 'NARRATION_CUE_OUT_OF_RANGE'); assert.deepEqual(f.view(), before); assert.equal(f.store.list('narration_acceptance', f.project.id).length, 0);
  const accepted = await f.request(path, { ...body, durationMode: 'match_audio' }); assert.equal(accepted.statusCode, 200, accepted.body); assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames, 210);
});


test('two successive compact voices preserve existing picture work and automatically refresh timeline/render before another speech proposal', async t => {
  const f = await fixture(t, { speech: true });
  for (const shot of f.project.shots) { const p = f.store.getProject(f.project.id); editStoryboard(f.production, p.id, { expectedHeadVersion: p.headVersion, kind: 'narration', id: shot.id, field: 'mode', value: 'none' }, randomUUID()); }
  await installVisualPlan(f, { assembly: true });
  const original = f.store.get('plan', f.store.getProject(f.project.id).activePlanId).compiled;
  const picture = original.nodes.filter(node => ['image','video'].includes(node.kind)).map(node => ({ id: node.id, spec: node.specDigest, candidateId: f.store.get('node_binding', node.id).candidateId }));
  const grants = f.store.list('grant', f.project.id), attempts = f.engine.attempts(f.project.id), providerCalls = f.provider.acceptedCount();
  const accept = async (index, mode) => {
    const shotId = f.project.shots[index].id;
    const session = await f.request(`/shots/${shotId}/sessions`, {}); assert.equal(session.statusCode, 200, session.body); f.session = session.json().session;
    let project = f.store.getProject(f.project.id);
    const script = await f.request(`/shots/${shotId}/script`, { sessionId: f.session.id, expectedHeadVersion: project.headVersion, expectedVersion: f.view().state.version, text: `A short line for shot ${index + 1}.`, language: 'en', mode,
      voice: mode === 'generated' ? 'coral' : null, profileRevisionId: mode === 'generated' ? speechProfile.revision : null }); assert.equal(script.statusCode, 200, script.body);
    const row = script.json().segment;
    if (mode === 'generated') {
      project = f.store.getProject(f.project.id);
      const proposal = await f.request('/speech-proposals', { sessionId: f.session.id, expectedHeadVersion: project.headVersion, segmentId: row.entry.segmentId, segmentRevisionId: row.script.id, profileId: speechProfile.id, voice: 'coral', instructions: '' }); assert.equal(proposal.statusCode, 200, proposal.body);
      assert.ok(proposal.json().proposal.plan.preservedOperations >= original.nodes.length);
    }
    const upload = await f.request(`/audio?sessionId=${f.session.id}&declaredOrigin=${mode === 'generated' ? 'generated' : 'uploaded'}`, wave, { headers: { 'content-type': 'application/octet-stream' } }); assert.equal(upload.statusCode, 200, upload.body); const audio = upload.json();
    const binding = await f.edit('/bindings', { segmentId: row.entry.segmentId, audioId: audio.id }); assert.equal(binding.statusCode, 200, binding.body);
    const selected = f.view().segments.find(segment => segment.entry.segmentId === row.entry.segmentId), body = { ...f.acceptBody(audio, selected), endSample: (index + 1) * 48000 };
    const accepted = await f.request(`/shots/${shotId}/accept`, body); assert.equal(accepted.statusCode, 200, accepted.body); assert.equal(accepted.json().receipt.planRebase.status, 'rebased', accepted.body);
    return accepted.json();
  };
  const first = await accept(0, 'uploaded');
  assert.equal(f.store.getProject(f.project.id).shots[0].desiredFrames, 180);
  const firstPlan = f.store.get('plan', first.receipt.activePlanId).compiled; assert.equal(firstPlan.nodes.find(node => node.kind === 'timeline').args.cues.length, 1);
  const firstShot = f.store.getProject(f.project.id).shots[0];
  await accept(1, 'generated');
  const current = f.store.getProject(f.project.id), plan = f.store.get('plan', current.activePlanId).compiled;
  assert.deepEqual(current.shots[0], firstShot); assert.deepEqual(current.shots.map(shot => shot.desiredFrames), [180, 180]);
  assert.equal(plan.nodes.find(node => node.kind === 'timeline').args.cues.length, 2); assert.deepEqual(plan.nodes.find(node => node.kind === 'render').args, original.nodes.find(node => node.kind === 'render').args);
  for (const expected of picture) { const node = plan.nodes.find(node => node.id === expected.id); assert.equal(node.specDigest, expected.spec); assert.equal(f.store.get('node_binding', node.id).candidateId, expected.candidateId); }
  assert.deepEqual(f.store.list('grant', f.project.id), grants); assert.deepEqual(f.engine.attempts(f.project.id), attempts); assert.equal(f.provider.acceptedCount(), providerCalls);
  assert.equal(f.store.list('hold', f.project.id).filter(hold => hold.active).length, 0);
});

test('Generate narration creates its shot section and exact application in one request with no manual review or allowance', async t => {
  const f=await fixture(t,{speech:true}),shotId=f.project.shots[0].id,unrelated=f.store.getProject(f.project.id).shots[1];
  const body={expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedNarrationVersion:f.view().state.version,text:'Made with care.',profileId:speechProfile.id,voice:'cedar'};
  const headers={'idempotency-key':'one-shot-narration-request'},path=`/shots/${shotId}/generate`,first=await f.request(path,body,{headers});
  assert.equal(first.statusCode,200,first.body);const result=first.json();assert.ok(result.receipt.candidateId);assert.equal(result.proposal.segment.text,body.text);
  assert.equal(f.view().segments.length,1);assert.equal(f.view().segments[0].accepted.audio,false);assert.equal(f.view().segments[0].accepted.timing,false);
  assert.equal(f.store.list('external_allowance',f.project.id).length,0);assert.equal(f.store.list('narration_speech_application',f.project.id).length,1);
  assert.deepEqual((await f.request(path,body,{headers})).json(),result);assert.equal(f.store.list('narration_speech_application',f.project.id).length,1);
  assert.deepEqual(f.store.getProject(f.project.id).shots[1],unrelated);assert.equal(f.provider.acceptedCount(),0);
});

test('lost one-step speech response reuses its saved phase intent and application without creating a second candidate', async t => {
  const f=await fixture(t,{speech:true}),shotId=f.project.shots[0].id,original=f.speechService.request.bind(f.speechService);let calls=0;
  f.speechService.request=async(...args)=>{const result=await original(...args);if(++calls===1)throw Error('lost published speech response');return result;};
  const body={expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedNarrationVersion:f.view().state.version,text:'One saved request.',profileId:speechProfile.id,voice:'cedar'},headers={'idempotency-key':'recover-one-shot-speech'},path=`/shots/${shotId}/generate`;
  const first=await f.request(path,body,{headers});assert.equal(first.statusCode,500,first.body);const saved=f.store.list('narration_speech_application',f.project.id)[0];assert.ok(saved);
  const recovered=await f.request(path,body,{headers});assert.equal(recovered.statusCode,200,recovered.body);assert.equal(recovered.json().receipt.candidateId,saved.id);
  assert.equal(f.view().segments.length,1);assert.equal(f.store.list('narration_speech_application',f.project.id).length,1);assert.equal(f.provider.acceptedCount(),0);
});

test('uploaded recording setup creates a scoped draft automatically and stale writing fails before a session is minted', async t => {
  const f=await fixture(t),shotId=f.project.shots[0].id,body={expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedNarrationVersion:f.view().state.version,mode:'uploaded'};
  const stale=await f.request(`/shots/${shotId}/initialize`,{...body,expectedNarrationVersion:body.expectedNarrationVersion+1});assert.equal(stale.statusCode,409,stale.body);
  assert.equal(f.store.list('narration_session',f.project.id).length,0);
  const saved=await f.request(`/shots/${shotId}/initialize`,body);assert.equal(saved.statusCode,200,saved.body);assert.equal(saved.json().segment.script.source.kind,'uploaded');
  assert.ok(saved.json().session.id);assert.equal(f.view().segments.length,1);assert.equal(f.store.list('narration_acceptance',f.project.id).length,0);
});
