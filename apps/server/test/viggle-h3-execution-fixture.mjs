import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePlan, digest, providerProfileArguments } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ViggleH3Execution } from '../dist/execution/viggle-h3-execution.js';
import { ExecutionOutputStore } from '../dist/execution/output-store.js';
import { DurableExternalAdmission } from '../dist/execution/durable-external-admission.js';
import { ProtectedVideoDownloader } from '../dist/execution/video-download.js';
import { SpoolVideoIngestor } from '../dist/execution/spool-video-ingester.js';
import { LocalMediaService } from '../dist/media/local-media.js';
import { LocalImageStore } from '../dist/media/local-images.js';
import { ImageApplicationService } from '../dist/media/image-application.js';
import { ProductionService } from '../dist/application/service.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { ExternalAllowanceService, allowanceIssueContextDigest } from '../dist/application/external-allowances.js';
import { projectFixture, refreshIntent } from './execution-fixture.mjs';

export const key = 'offline-viggle-h3-fixture-key', taskId = 'vid_offline_h3';
export const hash = value => createHash('sha256').update(value).digest('hex');
export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status,
  headers: { 'content-type': 'application/json', 'x-request-id': 'req_offline_viggle', ...headers } });
export const accepted = () => json({ id: taskId, status: 'queued', progress: null, created_at: '2026-09-13T00:00:00Z' });
export const pending = (status = 'processing') => json({ id: taskId, status, stage: null, progress: null, video_url: null, alpha_url: null,
  created_at: '2026-09-13T00:00:00Z', completed_at: null, error: null, seed: 1 });
export const completed = (suffix = 'one') => json({ id: taskId, status: 'ready', stage: null, progress: 100,
  video_url: `https://media.example.test/output.mp4?signature=${suffix}`, alpha_url: null,
  created_at: '2026-09-13T00:00:00Z', completed_at: '2026-09-13T00:00:30Z', error: null, seed: 1 });
export const rows = (f, kind) => f.store.list(kind, f.project.id);
export const context = f => ({ expectedLease: { owner: f.attempt.leaseOwner, epoch: f.attempt.leaseEpoch } });
export function due(f) { const schedule = f.store.get('viggle_h3_poll_schedule', f.attempt.id); assert.ok(schedule); f.clock.value = schedule.nextPollAt; return schedule; }
export const tool = name => process.env[`OPENSLATE_${name.toUpperCase()}_PATH`] ?? (existsSync(`/opt/homebrew/bin/${name}`) ? `/opt/homebrew/bin/${name}` : `/usr/bin/${name}`);
function crc(bytes) { let n = 0xffffffff; for (const byte of bytes) { n ^= byte; for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0); } return (n ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc(bytes.subarray(4, -4)), bytes.length - 4); return bytes; }
/** Synthetic complete RGB PNG. The fixture imports/decodes it with the actual managed image service. */
export function pngBytes() {
  const width = 320, height = 180, ihdr = Buffer.alloc(13), pixels = Buffer.alloc((width * 3 + 1) * height);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const i = y * (width * 3 + 1) + 1 + x * 3; pixels[i] = x % 256; pixels[i + 1] = y; pixels[i + 2] = 90; }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const videos = new Map();
async function videoBytes(seconds) {
  if (!videos.has(seconds)) videos.set(seconds, (async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openslate-viggle-video-bytes-'));
    try {
      const path = join(directory, 'raw.mp4');
      await promisify(execFile)(tool('ffmpeg'), ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=24', '-t', String(seconds),
        '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', path], { timeout: 30000 });
      return await readFile(path);
    } finally { await rm(directory, { recursive: true, force: true }); }
  })());
  return Buffer.from(await videos.get(seconds));
}

/** Actual owned PNG import, human frame review, finite allowance and durable admission.
 * The legacy-compatible project has no narrated-production lock; HTTP/download bytes and estimates are synthetic.
 * `ingest:true` enables the real video normalizer. No provider keys or live calls are read.
 */
export async function fixture(t, options = {}) {
  const seconds = options.seconds ?? 6; assert.ok(seconds === 3 || seconds === 6);
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-viggle-execution-'))), directory = join(parent, 'installation'); mkdirSync(directory);
  const path = join(directory, 'openslate.sqlite'), providerPath = join(directory, 'fake-provider.sqlite');
  const store = new Store(path), stores = [store], fake = new FakeProvider(providerPath); fake.close();
  t.after(() => { for (const saved of stores) if (saved.db.open) saved.close(); rmSync(parent, { recursive: true, force: true }); });
  const artifactRoot = join(directory, 'artifacts'); mkdirSync(artifactRoot);
  const profile = { id: 'offline-viggle-video', revision: 'fixture-estimate-1', kind: 'video', adapter: 'viggle-h3', executionVersion: '1',
    configuration: { model: options.model ?? 'MiniMax-H3', settings: { quality: 'low', resolution: '480p', aspectRatio: '16:9', ...options.profileSettings } },
    minFrames: 90, maxFrames: 450, maxConcurrency: 2, unitCostMicros: '150000', maxRetries: 0 };
  const outputs = new ExecutionOutputStore(store, { rootDir: join(directory, 'execution-output') });
  const clock = { value: Date.now() }, calls = { post: 0, query: 0, download: 0, credentials: 0, normalization: 0 };
  const credentials = new EnvironmentMediaCredentials(name => { calls.credentials++; assert.equal(name, 'OPENSLATE_VIGGLE_API_KEY'); return options.credential ? options.credential() : key; });
  const fetch = async (url, init) => { calls[init.method === 'POST' ? 'post' : 'query']++; return options.fetch ? options.fetch(url, init) : init.method === 'POST' ? accepted() : pending(); };
  const video = options.downloadBytes ? Buffer.from(options.downloadBytes) : await videoBytes(seconds);
  const downloader = new ProtectedVideoDownloader({ allowedHosts: ['media.example.test'], lookup: async () => [{ address: '8.8.8.8', family: 4 }],
    request: (args, callback) => {
      calls.download++; const client = new EventEmitter(); let body, destroyed = false;
      client.destroy = () => { if (!destroyed) { destroyed = true; args.signal.removeEventListener('abort', abort); body?.destroy(); queueMicrotask(() => client.emit('close')); } return client; };
      const abort = () => { body?.destroy(Error('cancelled')); client.emit('error', Error('cancelled')); client.destroy(); };
      args.signal.addEventListener('abort', abort, { once: true });
      client.end = () => queueMicrotask(() => { if (destroyed) return; const pieces = []; for (let offset = 0; offset < video.length; offset += 1024 * 1024) pieces.push(video.subarray(offset, offset + 1024 * 1024));
        body = Readable.from(pieces); body.on('error', () => {}); body.statusCode = options.downloadStatus?.() ?? 200;
        body.headers = { 'content-type': 'video/mp4', 'content-length': String(video.length) }; callback(body); }); return client;
    } });
  const bridgeOptions = { store, outputStore: outputs, artifactRoot, credentials, downloader, fetch, timeoutMs: 1000, now: () => clock.value, ...options.bridgeOptions };
  const bridge = new ViggleH3Execution(bridgeOptions);
  const media = options.ingest ? new LocalMediaService({ rootDir: join(directory, 'media'), allowedInputRoots: [outputs.rootDir], ffmpegPath: tool('ffmpeg'), ffprobePath: tool('ffprobe') }) : undefined;
  if (media) { const original = media.importMedia.bind(media); media.importMedia = async (...args) => { calls.normalization++; return original(...args); }; }
  const ingester = media ? new SpoolVideoIngestor(outputs, media, { rootDir: join(directory, 'video-derivations') }) : undefined;
  const engineOptions = { artifactDir: artifactRoot, profiles: [profile], outputStore: outputs,
    ...(ingester ? { outputIngestor: ingester } : {}), externalAdmission: new DurableExternalAdmission(store, () => {}) };
  const engine = new Engine(store, bridge, engineOptions), production = new ProductionService(store, engine, [profile]), allowances = new ExternalAllowanceService(store);
  let project = projectFixture(randomUUID(), 1); project.name = 'Offline Viggle bridge'; project.shots[0].desiredFrames = seconds * 30; refreshIntent(project.shots[0]);
  store.createProject(project); store.insert('capability_lock', project.capabilityLockId, project.id, { profiles: [profile] });
  store.insert('project_revision', project.revisionId, project.id, { project });
  const human = production.beginRequest(project.id, 'offline-human', 'Import and approve this exact synthetic first frame', { scopeIds: [project.id], editing: true });
  const images = new LocalImageStore({ rootDir: join(artifactRoot, 'images'), ffmpegPath: tool('ffmpeg'), ffprobePath: tool('ffprobe') });
  const png = pngBytes(), imageService = new ImageApplicationService(production, images);
  const imported = await imageService.importImage(project.id, human, { expectedHeadVersion: project.headVersion, key: randomUUID(), bytes: png, sha256: hash(png) });
  project = store.getProject(project.id); const reference = imported.artifact, image = store.get('artifact', reference.artifactId), imagePath = image.path;
  const q = JSON.stringify, shot = project.shots[0], settings = options.shotSettings ? `,settings:${q(options.shotSettings)}` : '';
  const source = `definePlan({baseRevision:${q(project.revisionId)}},p=>{const shot=p.shot(${q(shot.id)});const frame=p.asset(${q(reference.artifactId)});const review=p.humanReview("review",{shots:[{intent:shot,keyframe:frame,videoProfile:${q(profile.id)},motionPrompt:${q(shot.videoPrompt)},seconds:${seconds}${settings}}]});return p.video("video",{intent:shot,profile:${q(profile.id)},firstFrame:p.approvedImage(frame,review),prompt:${q(shot.videoPrompt)},seconds:${seconds}${settings}});});`;
  const plan = compilePlan(source, { project, profiles: [profile], logicalIds: {}, allocateId: randomUUID }), node = plan.nodes.find(value => value.kind === 'video');
  const grant = engine.createGrant(project.id, shot.id, 'video', human.requestId, 'initial_slot'), planId = randomUUID();
  store.transaction(() => { engine.installPlan(project.id, planId, plan, { [node.id]: grant.id }); project = store.saveProject({ ...project, activePlanId: planId }, project.headVersion); });
  const review = engine.reviewSnapshot(project.id), approval = production.approve(project.id, human, review.id, [node.id])[0];
  for (const hold of store.list('hold', project.id)) if (hold.active && hold.ownerId === human.requestId) engine.releaseHold(project.id, hold.id, human.requestId);
  const binding = store.get('node_binding', node.id), allowanceInput = { profileDigest: String(providerProfileArguments(profile).profileDigest), profileDefinitionDigest: digest(profile),
    selections: [{ candidateId: binding.candidateId, nodeId: node.id, specDigest: node.specDigest }], maxAttempts: 1, maxEstimatedMicros: profile.unitCostMicros,
    expiresAt: new Date(Date.now() + 3600000).toISOString() };
  const spender = production.beginRequest(project.id, 'offline-human', 'Approve this exact synthetic video estimate', { editing: false, scopeIds: [project.id], contextDigest: allowanceIssueContextDigest(project.id, allowanceInput) });
  const allowance = allowances.issue(project.id, spender, allowanceInput);
  const f = { parent, root: directory, directory, path, providerPath, store, stores, project, artifactRoot, reference, image, imagePath, png, video,
    profile, outputs, clock, calls, credentials, fetch, downloader, bridgeOptions, bridge, engineOptions, engine, production, allowances, allowance,
    media, ingester, node, plan, grant, review, approval, human, spender, seconds, attempt: undefined, request: undefined };
  f.admit = () => { f.attempt = engine.admit(project.id, node.id, engine.resolveInputs(project.id, node).fingerprint); f.request = f.attempt.request; return f.attempt; };
  if (!options.deferAdmission) f.admit();
  return f;
}
