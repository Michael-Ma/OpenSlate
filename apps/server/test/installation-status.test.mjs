import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODEX_PROTOCOL_VERSION } from '@openslate/director';
import { OPENAI_SPEECH_MODEL, FakeProvider } from '@openslate/providers';
import { createApp } from '../dist/app.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { LocalDirectorController } from '../dist/application/local-director.js';
import { InstalledProviderCatalog } from '../dist/application/provider-catalog.js';
import { EnvironmentMediaCredentials } from '../dist/application/provider-credentials.js';
import { LocalMediaService } from '../dist/media/local-media.js';

const token = 'synthetic_installation_status_token', secret = 'synthetic-secret-must-not-escape';
function fixture(t, { version = CODEX_PROTOCOL_VERSION, configured = false, broken = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-install-status-')), log = join(root, 'calls.jsonl');
  const binary = (name, output, exit = 0) => {
    const path = join(root, name);
    writeFileSync(path, `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)])+'\\n');\nconsole.log(${JSON.stringify(output)});\nprocess.exit(${exit});\n`, { mode: 0o700 });
    return path;
  };
  const codex = binary('codex', broken ? `${root}/${secret}` : `codex-cli ${version}`);
  const ffmpeg = binary('ffmpeg', broken ? `ffmpeg version 8.1.1 ${secret}` : 'ffmpeg version 8.1.1 local build', broken ? 1 : 0);
  const ffprobe = broken ? join(root, 'missing') : binary('ffprobe', 'ffprobe version 8.1.1 local build');
  const store = new Store(join(root, 'db.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  const director = new LocalDirectorController(service, { repositoryRoot: fileURLToPath(new URL('../../../', import.meta.url)), dataDirectory: root,
    endpoint: 'http://127.0.0.1:3199', defaults: { binaryPath: codex, model: 'fixture-model' }, setup: async () => { throw Error('A status read must never start setup'); } });
  const providerCatalog = new InstalledProviderCatalog({ credentials: new EnvironmentMediaCredentials(() => configured ? secret : undefined),
    enabledExecutions: configured ? [{ adapter: 'openai-speech', version: '1' }] : [],
    configuration: { version: 1, profiles: configured ? [{ label: 'Speech', profile: { id: 'speech-installed', revision: 'v1', kind: 'speech', adapter: 'openai-speech', executionVersion: '1',
      configuration: { model: OPENAI_SPEECH_MODEL, settings: {} }, maxConcurrency: 1, maxRetries: 0, unitCostMicros: '100' } }] : [] } });
  const app = createApp({ service, runtimeSettings: director, providerCatalog, localToken: token, mediaToolPaths: { ffmpeg, ffprobe } });
  t.after(async () => { await app.close(); await director.close(); store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  const get = url => app.inject({ url, headers: { host: '127.0.0.1', authorization: `Bearer ${token}` } });
  return { root, log, store, service, director, app, get, ffmpeg, ffprobe };
}

test('installation status works before any film, is authenticated, read only and contains only safe version/configuration fields', async t => {
  const f = fixture(t, { configured: true });
  assert.equal((await f.app.inject({ url: '/api/installation/status', headers: { host: '127.0.0.1' } })).statusCode, 403);
  const before = f.store.db.prepare('SELECT * FROM entities').all();
  const response = await f.get('/api/installation/status'); assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { codex: { found: true, version: CODEX_PROTOCOL_VERSION, pinnedVersion: CODEX_PROTOCOL_VERSION, signedIn: null },
    mediaTools: { ffmpeg: { available: true, version: '8.1.1' }, ffprobe: { available: true, version: '8.1.1' } }, providersConfigured: true });
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.doesNotMatch(response.body, new RegExp(`${secret}|${f.root}|/Users/|/private/|binaryPath|codexHome|apiKey|Bearer`));
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities').all(), before); assert.equal(f.store.listProjects().length, 0);
  assert.deepEqual(readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse).sort(), [['codex', '--version'], ['ffmpeg', '-version'], ['ffprobe', '-version']]);
  const media = new LocalMediaService({ rootDir: join(f.root, 'media'), allowedInputRoots: [f.root], ffmpegPath: f.ffmpeg, ffprobePath: f.ffprobe });
  assert.deepEqual(await media.toolStatus(), response.json().mediaTools);
});

test('installation status sanitizes failed/malformed/missing tools and reports demo-only configuration', async t => {
  const f = fixture(t, { broken: true });
  const response = await f.get('/api/installation/status'); assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.json(), { codex: { found: false, version: null, pinnedVersion: CODEX_PROTOCOL_VERSION, signedIn: null },
    mediaTools: { ffmpeg: { available: false, version: null }, ffprobe: { available: false, version: null } }, providersConfigured: false });
  assert.doesNotMatch(response.body, new RegExp(`${secret}|${f.root}|missing|ENOENT`));
});

test('setup includes the detected mismatched Codex version without changing selection or making model calls', async t => {
  const f = fixture(t, { version: '0.100.0' }), project = f.service.createProject('Version inspection');
  const before = f.store.getProject(project.id), cursor = f.store.cursor(project.id);
  const response = await f.get(`/api/projects/${project.id}/director/setup`); assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().codexVersion, '0.100.0'); assert.equal(response.json().selection.mode, 'fake');
  const status = (await f.get('/api/installation/status')).json();
  assert.deepEqual(status.codex, { found: true, version: '0.100.0', pinnedVersion: CODEX_PROTOCOL_VERSION, signedIn: null });
  assert.deepEqual(f.store.getProject(project.id), before); assert.equal(f.store.cursor(project.id), cursor);
  assert.equal(f.store.list('native_model_start', project.id).length, 0);
});
