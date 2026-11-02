import { narrationServiceHarness } from './narration-service-harness.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { NarrationService } from '../dist/narration/service.js';
import { NarrationCanonicalService } from '../dist/narration/canonical.js';
import { projectAudioPlacements, storyboardAudioCuts } from '../dist/narration/audio-placement.js';
import { registerNarrationRoutes } from '../dist/narration/routes.js';
import { createApp } from '../dist/app.js';
import { seedFixture } from '../dist/demo.js';
import { wave } from './speech-execution-fixture.mjs';

const execute = promisify(execFile), token = 'offline_within_shot_export_token';
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : '/usr/bin/ffmpeg');
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync('/opt/homebrew/bin/ffprobe') ? '/opt/homebrew/bin/ffprobe' : '/usr/bin/ffprobe');
function rms(bytes, start, end) {
  let energy = 0, count = 0;
  for (let sample = Math.round(start * 48000); sample < Math.round(end * 48000); sample++) { const value = bytes.readInt16LE(sample * 2); energy += value * value; count++; }
  return Math.sqrt(energy / count);
}

test('accepted one-second voice renders inside a planned six-second shot with silence or optional music afterwards', async t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-within-shot-export-'))), uploads = join(root, 'uploads'), inputs = join(root, 'inputs'); mkdirSync(uploads); mkdirSync(inputs);
  const store = new Store(join(root, 'app.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') }), production = new ProductionService(store, engine);
  const seeded = seedFixture(production, root), initial = store.saveProject({ ...seeded, revisionId: randomUUID(), shots: [seeded.shots[0]], cues: [seeded.cues[0]] }, seeded.headVersion);
  store.insert('project_revision', initial.revisionId, initial.id, { project: initial, fixture: true });
  const media = new LocalMediaService({ rootDir: join(root, 'media'), allowedInputRoots: [uploads, inputs], ffmpegPath: ffmpeg, ffprobePath: ffprobe });
  const narration = new NarrationService(production, media), canonical = new NarrationCanonicalService(narration), app = createApp({ service: production, localToken: token });
  registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory: uploads }); await app.ready();
  t.after(async () => { await app.close(); store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  const projectId = initial.id, shotId = initial.shots[0].id;
  const post = (suffix, payload, binary = false) => app.inject({ method: 'POST', url: `/api/projects/${projectId}${suffix}`, payload,
    headers: { host: '127.0.0.1', authorization: `Bearer ${token}`, 'idempotency-key': randomUUID(), 'content-type': binary ? 'application/octet-stream' : 'application/json' } });
  // Canonical audio setup uses the same workspace services as confirmation.
  const setupNarration = narrationServiceHarness({ production, store, narration, canonical, project: initial, app, testToken: token }, { uploadDirectory: uploads });
  const sessionResponse = await setupNarration(`/shots/${shotId}/sessions`, {}); assert.equal(sessionResponse.statusCode, 200, sessionResponse.body); const sessionId = sessionResponse.json().session.id;
  const saved = await setupNarration(`/shots/${shotId}/script`, { sessionId, expectedHeadVersion: store.getProject(projectId).headVersion, expectedVersion: narration.workspaceSnapshot(projectId).state.version,
    text: 'One brief voiceover line.', language: 'en', mode: 'uploaded', voice: null, profileRevisionId: null }); assert.equal(saved.statusCode, 200, saved.body);
  // This one-second tone stands in for spoken audio; no speech or video provider is called.
  const imported = await post('/audio-library/uploads?name=one-second-voice.wav', wave(24000), true); assert.equal(imported.statusCode, 200, imported.body); const recording = imported.json().recording;
  assert.equal(recording.samples, 48000); assert.equal(recording.durationSeconds, 1);
  let view = narration.workspaceSnapshot(projectId), segment = view.segments[0];
  const bound = await setupNarration('/bindings', { sessionId, expectedVersion: view.state.version, segmentId: segment.entry.segmentId, audioId: recording.id }); assert.equal(bound.statusCode, 200, bound.body);
  view = narration.workspaceSnapshot(projectId); segment = view.segments[0];
  const accepted = await setupNarration(`/shots/${shotId}/accept`, { sessionId, expectedHeadVersion: store.getProject(projectId).headVersion, expectedVersion: view.state.version,
    segmentId: segment.entry.segmentId, segmentRevisionId: segment.script.id, audioId: recording.id, sha256: recording.sha256, startSample: 0, endSample: 48000 });
  assert.equal(accepted.statusCode, 200, accepted.body);
  const project = store.getProject(projectId), frozen = canonical.workspaceCurrent(projectId), voice = frozen.segments[0];
  assert.equal(project.shots[0].desiredFrames, 180); assert.equal(project.shots[0].narrationTimingMode, 'within_shot');
  assert.equal(voice.cue.durationFrames, 30); assert.equal(voice.timingMode, 'within_shot');
  assert.equal(voice.audioPlacement.durationSamples, 48000); assert.equal(voice.audioPlacement.source.probe.audio.samples, 48000);
  const picturePath = join(inputs, 'six-seconds.mp4'), musicPath = join(inputs, 'music.wav');
  await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=160x90:r=30:d=6', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', picturePath], { timeout: 15000 });
  await execute(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=180:sample_rate=48000:duration=6', '-c:a', 'pcm_s16le', musicPath], { timeout: 15000 });
  const picture = await media.importMedia({ artifactId: randomUUID(), path: picturePath, kind: 'video' }), music = await media.importMedia({ artifactId: randomUUID(), path: musicPath, kind: 'audio' });
  const placements = projectAudioPlacements(voice, storyboardAudioCuts(project));
  assert.equal(placements.length, 1); assert.equal(placements[0].durationSamples, 48000); assert.equal(placements[0].atSample, 0);
  for (const withMusic of [false, true]) {
    const manifest = await media.freezeManifest({ projectId, targetRevisionId: `${project.revisionId}-${withMusic ? 'music' : 'silent-tail'}`, width: 160, height: 90,
      clips: [{ source: picture, startFrame: 0, durationFrames: project.shots[0].desiredFrames, fit: 'contain' }],
      audio: [...placements, ...(withMusic ? [{ source: music, startSample: 0, durationSamples: 288000, atSample: 0, gainMilliDb: -18000 }] : [])] });
    const rendered = await media.render(manifest); assert.equal(rendered.artifact.probe.video.frames, 180); assert.equal(rendered.artifact.probe.video.durationSeconds, 6);
    const decoded = await execute(ffmpeg, ['-nostdin', '-v', 'error', '-i', rendered.artifact.path, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 's16le', 'pipe:1'], { encoding: 'buffer', maxBuffer: 1024 * 1024, timeout: 15000 });
    assert.ok(Math.abs(decoded.stdout.length / 2 - 288000) <= 2048);
    assert.ok(rms(decoded.stdout, 0.25, 0.75) > 1000, 'The one-second voice is audible during its accepted source range');
    if (withMusic) assert.ok(rms(decoded.stdout, 1.5, 5.5) > 100, 'Background music continues while the voice is silent');
    else assert.ok(rms(decoded.stdout, 1.5, 5.5) < 5, 'The rest of the six-second picture has silence, without padding the source voice');
    assert.equal(store.get('narration_audio', recording.id).media.probe.audio.samples, 48000, 'Export cannot rewrite the original recording duration');
  }
  assert.equal(provider.acceptedCount(), 0); assert.equal(store.list('grant', projectId).length, 0); assert.equal(store.list('attempt', projectId).length, 0);
});
