import { narrationServiceHarness } from './narration-service-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { renameSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, digest } from '@openslate/core';
import { createApp } from '../dist/app.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { MediaApplicationService, registerMediaRoutes } from '../dist/media/index.js';
import { ManagedUploadStore } from '../dist/narration/managed-upload.js';
import { projectDirectorContext, DIRECTOR_PROJECTION_LIMITS } from '../dist/application/context-projection.js';
import { generatedNarrationFixture } from './generated-narration-fixture.mjs';
import { resolveGeneratedNarrationAudio, summarizeGeneratedNarrationAudio, assertGeneratedCanonicalNarrationSegment } from '../dist/narration/generated-audio.js';
import { createInstallationBackup, inspectInstallationBackup } from '../dist/persistence/installation-backup.js';
import { restoreInstallationBackup } from '../dist/persistence/installation-restore.js';

const token = 'offline_generated_narration_http_token';
async function setup(t) {
  const f = await generatedNarrationFixture(t);
  f.app = createApp({ service: f.production, localToken: token });
  registerNarrationRoutes(f.app, { production: f.production, narration: f.narration, canonical: f.canonical, uploadDirectory: join(f.root, 'uploads') });
  registerMediaRoutes(f.app, { production: f.production, media: new MediaApplicationService(f.production, f.media), uploads: new ManagedUploadStore({ rootDir: join(f.root, 'video-uploads') }) });
  await f.app.ready(); t.after(() => f.app.close());
  f.base = `/api/projects/${f.project.id}/narration`;
  f.testToken = token; f.request = narrationServiceHarness(f, { uploadDirectory: f.uploadDirectory ?? join(f.root ?? f.dir, 'uploads'), speech: f.speechService ?? (f.profile?.kind === 'speech' ? f.service : undefined) });
  const activeSession=f.session;
  f.session = async () => activeSession;
  f.selection = async session => {
    const selected=resolveGeneratedNarrationAudio(f.store,f.project.id,f.artifact.id),row=f.narration.workspaceSnapshot(f.project.id).segments[0];
    return {sessionId:session.id,expectedVersion:f.narration.workspaceSnapshot(f.project.id).state.version,segmentId:row.entry.segmentId,segmentRevisionId:row.script.id,
      artifactId:f.artifact.id,artifactDigest:selected.artifactDigest,generationEvidenceDigest:selected.generationEvidenceDigest};
  };
  return f;
}

test('generated recording summary and saved WAV preview expose exact provenance without creating authority', async t => {
  const f = await setup(t), before = f.store.db.prepare('SELECT total_changes() AS n').get().n;
  const audio=summarizeGeneratedNarrationAudio(resolveGeneratedNarrationAudio(f.store,f.project.id,f.artifact.id).audio),response={body:canonical(audio)};
  assert.equal(audio.id, f.artifact.id); assert.equal(audio.originEvidence, 'verified_generated_audio');
  assert.equal(audio.selection.artifactDigest, digest(f.artifact.artifact)); assert.match(audio.selection.generationEvidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(audio.generation.voice, 'coral'); assert.equal('requestId' in audio, false); assert.equal('declaredOrigin' in audio, false);
  assert.ok(!response.body.includes(f.root)); assert.ok(!response.body.includes('synthetic-generated-narration-key'));
  const preview = await f.app.inject({ url: `/api/projects/${f.project.id}/artifacts/${audio.id}/content`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  assert.equal(preview.statusCode, 200); assert.match(preview.headers['content-type'], /audio\/wav/);
  assert.equal(createHash('sha256').update(preview.rawPayload).digest('hex'), audio.media.sha256);
  const clipLibrary = await f.app.inject({ url: `/api/projects/${f.project.id}/media`, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  assert.equal(clipLibrary.statusCode, 200); assert.deepEqual(clipLibrary.json().sources, [], 'actual generated audio belongs to narration, not the video clip library');
  assert.equal(f.store.list('media_source', f.project.id).length, 1, 'the generated audio source remains retained');
  assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get().n, before); assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  assert.deepEqual(f.calls, f.initialCalls);
});

test('human service attaches exact generated evidence, replays after later edits and blocks the legacy binding bypass', async t => {
  const f = await setup(t), session = await f.session(), input = await f.selection(session);
  const original = f.narration.workspaceSnapshot(f.project.id), project = canonical(f.store.getProject(f.project.id)), artifact = canonical(f.store.get('artifact', f.artifact.id));
  const counts = Object.fromEntries(['grant', 'attempt', 'reservation', 'external_allowance_consumption', 'hold'].map(kind => [kind, f.store.list(kind, f.project.id).length]));
  const response = await f.request('/generated-audio-bindings', input, { headers: { 'idempotency-key': 'attach-once' } });
  assert.equal(response.statusCode, 200, response.body); const attached = response.json();
  assert.equal(attached.segments[0].audio.id, f.artifact.id); assert.deepEqual(attached.segments[0].accepted, { script: false, audio: false, timing: false });
  assert.deepEqual(attached.segments[1], original.segments[1]);
  const view = (await f.request()).json(), selected = view.snapshot.segments[0].audio;
  assert.deepEqual(selected.selection, { artifactDigest: input.artifactDigest, generationEvidenceDigest: input.generationEvidenceDigest });
  assert.equal(selected.originEvidence, 'verified_generated_audio'); assert.equal('mappingDigest' in selected.generation, false);
  const bypass = await f.request('/bindings', { sessionId: session.id, expectedVersion: attached.state.version, segmentId: input.segmentId, audioId: f.artifact.id });
  assert.equal(bypass.json().error.code, 'NARRATION_GENERATED_ATTACHMENT_REQUIRED');
  f.narration.reviseSegments(f.project.id,f.human,attached.state.version,randomUUID(),{update:[{segmentId:input.segmentId,draft:{...original.segments[0].script,text:'Later wording.',meaning:'Later wording.'}}]});
  const replay = await f.request('/generated-audio-bindings', input, { headers: { 'idempotency-key': 'attach-once' } });
  assert.equal(replay.statusCode, 200, replay.body); assert.deepEqual(replay.json(), attached);
  const conflict = await f.request('/generated-audio-bindings', { ...input, generationEvidenceDigest: 'f'.repeat(64) }, { headers: { 'idempotency-key': 'attach-once' } });
  assert.equal(conflict.json().error.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal(canonical(f.store.getProject(f.project.id)), project); assert.equal(canonical(f.store.get('artifact', f.artifact.id)), artifact);
  for (const [kind, count] of Object.entries(counts)) assert.equal(f.store.list(kind, f.project.id).length, count, kind);
  assert.equal(f.store.list('narration_acceptance', f.project.id).length, 0); assert.deepEqual(f.calls, f.initialCalls);
});

test('generated attachment service rejects stale and foreign human selections without adopting anything', async t => {
  const f = await setup(t), session = await f.session(), input = await f.selection(session);
  const before = canonical(f.narration.workspaceSnapshot(f.project.id));
  for (const extra of [{ sessionId: randomUUID() }, { segmentRevisionId: randomUUID() }, { artifactDigest: 'f'.repeat(64) }, { generationEvidenceDigest: 'f'.repeat(64) }, { artifactId: randomUUID() }, { expectedVersion: input.expectedVersion + 1 }]) {
    assert.notEqual((await f.request('/generated-audio-bindings', { ...input, ...extra })).statusCode, 200);
  }
  const other = f.production.createProject('Other project');
  const cross = await f.request('/generated-audio-bindings', input, { url: `/api/projects/${other.id}/narration/generated-audio-bindings` });
  assert.equal(cross.json().error.code, 'NARRATION_SESSION_STALE');
  f.production.beginRequest(f.project.id, 'local-user', 'New independent edit');
  assert.equal((await f.request('/generated-audio-bindings', input)).json().error.code, 'NARRATION_SESSION_STALE');
  assert.equal(canonical(f.narration.workspaceSnapshot(f.project.id)), before); assert.equal(f.store.list('narration_audio', f.project.id).length, 0);
  assert.deepEqual(f.calls, f.initialCalls);
});

test('context distinguishes generated evidence from human labels while preserving byte bounds and detached reads', async t => {
  const f = await setup(t), session = await f.session(), input = await f.selection(session);
  assert.equal((await f.request('/generated-audio-bindings', input)).statusCode, 200);
  const actor = { kind: 'human', principalId: 'local-user', requestId: session.requestId };
  const before = f.store.db.prepare('SELECT total_changes() AS n').get().n;
  const page = projectDirectorContext(f.production, f.project.id, actor, { section: 'narration' }), summary = page.audioLibrary[0];
  assert.equal(summary.originEvidence, 'verified_generated_audio'); assert.equal('declaredOrigin' in summary, false); assert.equal('requestId' in summary, false);
  assert.equal(summary.selection.generationEvidenceDigest, input.generationEvidenceDigest); assert.equal(summary.generation.voice, 'coral');
  assert.ok(!canonical(page).includes(f.root)); assert.ok(Buffer.byteLength(canonical(page)) <= DIRECTOR_PROJECTION_LIMITS.bytes);
  const expected = structuredClone(summary), guard = page.guard.dataDigest; summary.generation.voice = 'invented'; summary.selection.artifactDigest = 'changed';
  const next = projectDirectorContext(f.production, f.project.id, actor, { section: 'narration' });
  assert.deepEqual(next.audioLibrary[0], expected); assert.equal(next.guard.dataDigest, guard);
  assert.equal(next.applicationCapabilities.narration.generatedRecordingAttachment.toolAvailable, false);
  assert.equal(next.applicationCapabilities.narration.speechSynthesis.available, false); assert.equal(next.applicationCapabilities.narration.transcription.available, false);
  assert.equal(f.store.db.prepare('SELECT total_changes() AS n').get().n, before); assert.deepEqual(f.calls, f.initialCalls);
});

async function scopedGeneratedShot(t,options={}) {
  const f=await generatedNarrationFixture(t,options),session=f.session;
  f.app=createApp({service:f.production,localToken:token});registerNarrationRoutes(f.app,{production:f.production,narration:f.narration,canonical:f.canonical,uploadDirectory:join(f.root,'uploads')});await f.app.ready();t.after(()=>f.app.close());
  f.testToken=token;const invoke=narrationServiceHarness(f,{uploadDirectory:join(f.root,'uploads')});f.request=(suffix,body,commandKey=randomUUID())=>invoke(suffix,body,{headers:{'idempotency-key':commandKey}});
  const selected=resolveGeneratedNarrationAudio(f.store,f.project.id,f.artifact.id),detail=f.workspace.detail(f.project.id,'shot-0');
  const result=await f.request('/generated-audio-bindings',{sessionId:session.id,expectedVersion:f.view().state.version,segmentId:detail.segment.entry.segmentId,segmentRevisionId:detail.segment.script.id,artifactId:f.artifact.id,artifactDigest:selected.artifactDigest,generationEvidenceDigest:selected.generationEvidenceDigest});
  assert.equal(result.statusCode,200,result.body);
  const row=f.workspace.detail(f.project.id,'shot-0').segment;
  f.acceptBody={sessionId:session.id,expectedHeadVersion:f.store.getProject(f.project.id).headVersion,expectedVersion:f.view().state.version,segmentId:row.entry.segmentId,segmentRevisionId:row.script.id,audioId:row.audio.id,sha256:row.audio.media.sha256,startSample:0,endSample:row.audio.media.probe.audio.samples,durationMode:'keep'};
  return f;
}
test('a verified generated take accepts through the existing narrow shot workspace and retains full within-shot provenance',async t=>{
  const f=await scopedGeneratedShot(t,{samples:24001}),before=f.store.getProject(f.project.id),response=await f.request('/shots/shot-0/accept',f.acceptBody,'verified-within-shot');
  assert.equal(response.statusCode,200,response.body);
  const current=f.store.getProject(f.project.id),saved=f.canonical.workspaceCurrent(f.project.id),segment=saved.segments[0];
  assert.equal(current.shots[0].desiredFrames,180);assert.deepEqual(current.shots[1],before.shots[1]);
  assert.equal(segment.placementMode,'shot');assert.equal(segment.timingMode,'within_shot');
  assert.equal(segment.cue.durationFrames,Math.ceil(f.acceptBody.endSample/1600));assert.equal(segment.audioPlacement.durationSamples,f.acceptBody.endSample);
  assert.equal(segment.provenance.originEvidence,'verified_generated_audio');assert.equal(segment.provenance.generation.attemptId,f.attempt.id);
  assert.equal(f.store.list('narration_acceptance',f.project.id).length,3);assert.deepEqual(f.calls,f.initialCalls);
  const replay=await f.request('/shots/shot-0/accept',f.acceptBody,'verified-within-shot');assert.equal(replay.statusCode,200,replay.body);assert.deepEqual(replay.json(),response.json());
  assert.equal(f.store.list('narration_acceptance',f.project.id).length,3);assert.deepEqual(f.calls,f.initialCalls);
});
test('existing generated shot acceptance refuses overlong ranges before saving decisions or changing planned duration',async t=>{
  const f=await scopedGeneratedShot(t,{samples:168001}),before=canonical(f.store.getProject(f.project.id)),state=canonical(f.narration.workspaceSnapshot(f.project.id));
  const response=await f.request('/shots/shot-0/accept',f.acceptBody,'overlong-verified-voice');
  assert.equal(response.json().error.code,'NARRATION_CUE_OUT_OF_RANGE');assert.equal(canonical(f.store.getProject(f.project.id)),before);assert.equal(canonical(f.narration.workspaceSnapshot(f.project.id)),state);
  assert.equal(f.store.list('narration_acceptance',f.project.id).length,0);assert.deepEqual(f.calls,f.initialCalls);
});
test('the existing narrow narration helper proves the genuine shot pin and rejects unrelated sections',async t=>{
  const f=await scopedGeneratedShot(t),{narrationAuthorScope,narrationScopeTarget}=await import('../dist/narration/narration-scope.js');
  const session=f.store.get('narration_session',f.acceptBody.sessionId),request=f.store.get('message',session.requestId),scope=narrationAuthorScope(f.store,f.project.id,request.id,request.principalId,f.acceptBody.segmentId);
  assert.equal(request.principalId,'local-user');assert.deepEqual(request.scopeIds,['shot-0']);assert.equal(scope.shotId,'shot-0');
  assert.equal(narrationScopeTarget(f.store,scope).segmentId,f.acceptBody.segmentId);
  const unrelated=f.narration.workspaceSnapshot(f.project.id).segments.find(row=>row.entry.segmentId!==f.acceptBody.segmentId);
  assert.throws(()=>narrationAuthorScope(f.store,f.project.id,request.id,request.principalId,unrelated.entry.segmentId),{code:'SCOPE_DENIED'});
  assert.deepEqual(f.calls,f.initialCalls);
});

test('historical generated shot provenance rejects a different shot, section, project, principal or multiple scopes',async t=>{
  const f=await scopedGeneratedShot(t),response=await f.request('/shots/shot-0/accept',f.acceptBody,'scope-bound-accept');
  assert.equal(response.statusCode,200,response.body);
  const saved=f.canonical.workspaceCurrent(f.project.id),segment=saved.segments[0],selection={narrationRevisionId:saved.narrationRevisionId,narrationVersion:saved.narrationVersion};
  const session=f.store.get('narration_session',f.acceptBody.sessionId),otherSection=f.narration.workspaceSnapshot(f.project.id).segments.find(row=>row.entry.segmentId!==f.acceptBody.segmentId);
  const verify=()=>assertGeneratedCanonicalNarrationSegment(f.store,f.project.id,segment,selection);
  verify();
  const damage=(name,kind,id,edit,expectedCode)=>{
    const row=f.store.db.prepare('SELECT body,project_id FROM entities WHERE kind=? AND id=?').get(kind,id);
    assert.ok(row,`${name} evidence exists`);
    const changed=edit(JSON.parse(row.body),row.project_id);
    f.store.db.prepare('UPDATE entities SET body=?,project_id=? WHERE kind=? AND id=?').run(canonical(changed.body),changed.projectId??row.project_id,kind,id);
    try { assert.throws(verify,{code:expectedCode},name); }
    finally { f.store.db.prepare('UPDATE entities SET body=?,project_id=? WHERE kind=? AND id=?').run(row.body,row.project_id,kind,id); }
    verify();
  };
  damage('project-wide scope','message',session.requestId,body=>({body:{...body,scopeIds:[f.project.id]}}),'GENERATED_NARRATION_CONFLICT');
  damage('other shot','message',session.requestId,body=>({body:{...body,scopeIds:['shot-1']}}),'SCOPE_DENIED');
  damage('multiple shot scopes','message',session.requestId,body=>({body:{...body,scopeIds:['shot-0','shot-1']}}),'SCOPE_DENIED');
  damage('other principal','message',session.requestId,body=>({body:{...body,principalId:'other-human'}}),'GENERATED_NARRATION_CONFLICT');
  damage('other section','narration_shot_scope_target',session.requestId,body=>({body:{...body,segmentId:otherSection.entry.segmentId}}),'SCOPE_DENIED');
  const otherProject=f.production.createProject('Foreign provenance project');
  damage('other project','narration_shot_scope_target',session.requestId,(body)=>({body,projectId:otherProject.id}),'SCOPE_DENIED');
  assert.deepEqual(f.calls,f.initialCalls);
});

test('accepted generated shot provenance survives independent backup inspection and same-root restore',async t=>{
  const f=await scopedGeneratedShot(t),response=await f.request('/shots/shot-0/accept',f.acceptBody,'backup-shot-accept');
  assert.equal(response.statusCode,200,response.body);
  const saved=f.canonical.workspaceCurrent(f.project.id),selection={narrationRevisionId:saved.narrationRevisionId,narrationVersion:saved.narrationVersion};
  assertGeneratedCanonicalNarrationSegment(f.store,f.project.id,saved.segments[0],selection);
  const backup=await createInstallationBackup({sourceRoot:f.root,destination:join(f.parent,'shot-backup')});
  assert.deepEqual(await inspectInstallationBackup({directory:backup.directory}),backup);
  f.store.close();renameSync(f.root,join(f.parent,'original-installation'));
  const restored=await restoreInstallationBackup({directory:backup.directory,destination:f.root});
  assert.equal(restored.status,'restored');f.open(true);
  const historical=f.canonical.workspaceCurrent(f.project.id);
  assert.equal(canonical(historical),canonical(saved));
  assertGeneratedCanonicalNarrationSegment(f.store,f.project.id,historical.segments[0],selection);
  assert.deepEqual(f.calls,f.initialCalls);
});
