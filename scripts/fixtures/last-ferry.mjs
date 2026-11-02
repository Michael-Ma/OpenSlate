// Explicit disposable fake-only seed. Static data copied from next/fixtures/last-ferry.ts;
// server tooling never imports browser code. Silent supplied WAVs demonstrate measured timing.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { compilePlan, DEFAULT_PROFILES, shotIntentDigest, digest } from '../../packages/core/dist/index.js';
import { fixtureOutputs } from '../../packages/providers/dist/index.js';
import { shotDraftId } from '../../apps/server/dist/narration/narration-scope.js';
import { assertDemoProviderProfiles } from '../../apps/server/dist/application/provider-catalog.js';
export const lastFerryRows = JSON.parse(readFileSync(new URL('./last-ferry.json', import.meta.url), 'utf8'));
export async function seedLastFerry(service, narration, director, root) {
  const { store, engine } = service;
  let project = service.createProject('The Last Ferry');
  assertDemoProviderProfiles(store.get('capability_lock', project.capabilityLockId).profiles);
  const titles = ['Closing time', 'Harbour at dawn', 'Departure'];
  const sceneId = n => `scene-${n}`, shotId = id => `shot-${id.replace('.', '-')}`;
  project = { ...project, brief: 'Mara buys the last ticket for the morning ferry and leaves her town.', story: 'Closing time at the ticket office; the harbour at dawn; the ferry departs.',
    scenes: titles.map((title, i) => ({ id: sceneId(i + 1), revisionId: randomUUID(), title, purpose: title })),
    shots: lastFerryRows.map(row => ({ id: shotId(row.id), revisionId: randomUUID(), sceneId: sceneId(row.scene), purpose: row.prompt, action: row.prompt, framing: row.framing, motion: row.motion, desiredFrames: row.seconds * 30,
      imagePrompt: row.prompt, videoPrompt: `${row.prompt} ${row.motion}.`, narration: { mode: row.narration ? (row.keyframe === 'none' ? 'generated' : 'uploaded') : 'none', text: row.narration ?? '', voice: 'stock' }, referenceArtifactIds: [], cueId: null })) };
  project = store.saveProject({ ...project, revisionId: randomUUID() }, project.headVersion);
  const actor = service.beginRequest(project.id, 'local-user', 'Seed the explicitly scripted Last Ferry fixture.', { source: 'app', concurrency: 'alongside', holdScopeIds: [], key: 'last-ferry-seed' });
  mkdirSync(join(root, 'uploads'), { recursive: true });
  for (const row of lastFerryRows.filter(r => r.narration && r.keyframe === 'ready')) {
    const samples = Math.round(row.narrationSeconds * 48000), bytes = Buffer.alloc(44 + samples * 2);
    bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
    const path = join(root, 'uploads', `${row.id}.wav`); writeFileSync(path, bytes);
    let snapshot = narration.workspaceSnapshot(project.id);
    snapshot = narration.reviseSegments(project.id, actor, snapshot.state.version, `script-${row.id}`, { add: [{ text: row.narration, textKind: 'draft', language: 'en', meaning: row.prompt, source: { kind: 'uploaded' } }] });
    const segment = snapshot.segments.at(-1), audio = await narration.importAudio(project.id, actor, { path, declaredOrigin: 'uploaded', key: `audio-${row.id}` });
    narration.bindAudio(project.id, actor, snapshot.state.version, `bind-${row.id}`, segment.entry.segmentId, audio.id);
    store.put('narration_shot_draft', shotDraftId(project.id, shotId(row.id)), project.id, { projectId: project.id, shotId: shotId(row.id), segmentId: segment.entry.segmentId, intentDigest: digest(project.shots.find(s => s.id === shotId(row.id)).narration) });
    if (row.scene === 1) {
      const artifact = { artifactId: audio.media.artifactId, sha256: audio.media.sha256, kind: 'audio' };
      project.artifacts.push(artifact);
      const cue = { id: randomUUID(), meaning: row.prompt, durationFrames: Math.ceil(row.narrationSeconds * 30), placementFrames: 0, audio: artifact, accepted: true, measured: true };
      project.cues.push(cue); const shot = project.shots.find(s => s.id === shotId(row.id)); shot.cueId = cue.id; shot.narrationTimingMode = 'within_shot';
    }
  }
  project.shots = project.shots.map(shot => ({ ...shot, promptIntent: { image: shotIntentDigest(shot, 'image', project.cues.find(c => c.id === shot.cueId)), video: shotIntentDigest(shot, 'video', project.cues.find(c => c.id === shot.cueId)) } }));
  project = store.saveProject({ ...project, revisionId: randomUUID() }, project.headVersion);
  store.insert('project_revision', project.revisionId, project.id, { project });
  let source = `definePlan({baseRevision:${JSON.stringify(project.revisionId)}},p=>{`;
  for (const [i, shot] of project.shots.slice(0, 6).entries()) {
    source += `const s${i}=p.shot(${JSON.stringify(shot.id)});const i${i}=p.image("image${i}",{intent:s${i},profile:"fake-image-v1",prompt:${JSON.stringify(shot.imagePrompt)}});`;
    if (i < 3) source += `const r${i}=p.humanReview("review${i}",{shots:[{intent:s${i},keyframe:i${i},videoProfile:"fake-video-v1",motionPrompt:${JSON.stringify(shot.videoPrompt)},seconds:${shot.desiredFrames / 30}}]});const v${i}=p.video("video${i}",{intent:s${i},profile:"fake-video-v1",firstFrame:p.approvedImage(i${i},r${i}),prompt:${JSON.stringify(shot.videoPrompt)},seconds:${shot.desiredFrames / 30}});`;
  }
  source += 'return [v0,v1,v2,i3,i4,i5];});';
  const compiled = compilePlan(source, { project, profiles: DEFAULT_PROFILES, logicalIds: {}, allocateId: randomUUID }), planId = randomUUID(), grants = {};
  for (const node of compiled.nodes.filter(n => ['image', 'video'].includes(n.kind) && project.shots.findIndex(s => s.id === n.shotId) < 6)) grants[node.id] = engine.createGrant(project.id, node.shotId, node.kind, actor.requestId, 'initial_slot').id;
  engine.installPlan(project.id, planId, compiled, grants);
  project = store.saveProject({ ...project, activePlanId: planId }, project.headVersion);
  for(let step=0;step<3;step++){await engine.runReady();await engine.reconcile();}
  // Scene 1 represents already-saved demo clips. Explicit fixture records carry no live-provider evidence.
  for (const binding of store.list('node_binding', project.id).filter(b => b.planId === planId && b.node.kind === 'video')) {
    const descriptor = fixtureOutputs({ kind: 'video', fingerprint: binding.node.specDigest })[0];
    const bytes = Buffer.from(descriptor.bytesBase64, 'base64'), id = randomUUID(), path = join(engine.artifactDir, `${id}.mp4`);
    writeFileSync(path, bytes); const artifact = { artifactId: id, sha256: createHash('sha256').update(bytes).digest('hex'), kind: 'video' };
    store.insert('artifact', id, project.id, { id, projectId: project.id, artifact, path, mimeType: 'video/mp4', fixture: true, attemptId: null, byteLength: bytes.length, physicalDurationSeconds: 1 });
    store.put('node_binding', binding.id, project.id, { ...binding, outputs: { video: artifact } });
  }
  for (const row of lastFerryRows.filter(r => r.opened)) {
    const binding = store.list('node_binding', project.id).find(b => b.node.kind === 'image' && b.node.shotId === shotId(row.id));
    const artifact = Object.values(binding.outputs)[0];
    if(!artifact)throw new Error(`Fixture frame ${row.id} did not complete: ${JSON.stringify(await engine.runReady())}`);
    const identity = { principal: 'local-user', projectId: project.id, shotId: shotId(row.id), artifactId: artifact.artifactId, sha256: artifact.sha256 };
    store.insert('frame_view', digest(identity), project.id, { ...identity, at: new Date().toISOString() });
    store.appendEvent(project.id, 'frame.viewed', identity);
  }
  const scene = project.scenes[1], shots = project.shots.filter(s => s.sceneId === scene.id);
  const reviewActor = service.beginRequest(project.id, 'local-user', 'Review Scene 2 in the scripted Last Ferry demonstration.', { source: 'app', editing: false, scopeIds: [scene.id], key: 'last-ferry-review' });
  store.insert('demo_command', reviewActor.requestId, project.id, { action: 'review', sceneId: scene.id });
  director.enqueue(project.id, reviewActor); director.tick(); await director.settle();
  return store.getProject(project.id);
}
