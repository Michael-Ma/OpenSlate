// Explicit offline native check. All model endpoints are a disposable loopback refusal server.
// No sign-in, personal home, real inference, media, installation or production data is used.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexDirectorRuntime } from '../packages/director/dist/index.js';
import { CodexTransport } from '../packages/director/dist/runtime/transport.js';
import { CODEX_DISABLED_FEATURES, CODEX_PROTOCOL_VERSION, CODEX_RUNTIME_LIMITS, supportedCodexConfig, toml } from '../packages/director/dist/runtime/policy.js';

const binary = process.argv[2];
if (!binary?.startsWith('/')) throw Error('Usage: node scripts/probe-codex-compat.mjs ABSOLUTE_CODEX_BINARY [EVIDENCE_DIRECTORY]');
const root = await realpath(await mkdtemp(join(process.argv[3] ? resolve(process.argv[3]) : tmpdir(), 'openslate-native-compat-')));
const home = join(root, 'home'), codexHome = join(root, 'codex-home'), workspace = join(root, 'workspace');
await Promise.all([home, codexHome, workspace].map(path => mkdir(path, { recursive: true })));
const requests = [], events = [];
const server = createServer((req, res) => {
  requests.push({ method: req.method, path: req.url }); req.resume();
  res.writeHead(401, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Offline compatibility probe: real inference is disabled', type: 'authentication_error', code: 'invalid_api_key' } }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const env = { HOME: home, CODEX_HOME: codexHome, PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, CI: '1', NO_COLOR: '1' };
const id = 'openslate_local', profile = { filesystem: { ':root': 'deny', ':minimal': 'read', [workspace]: 'read', [await realpath(process.execPath)]: 'read' }, network: { enabled: false } };
const config = { default_permissions: id, permissions: { [id]: profile }, sqlite_home: join(root, 'state'), log_dir: join(root, 'logs'),
  model_provider: 'offline_probe', model_providers: { offline_probe: { name: 'Offline compatibility probe', base_url: `${endpoint}/v1`, wire_api: 'responses', requires_openai_auth: false, request_max_retries: 0, stream_max_retries: 0 } },
  chatgpt_base_url: endpoint, 'features.openslate_compatibility_probe_unknown': false };
for (const name of CODEX_DISABLED_FEATURES) config[`features.${name}`] = false;
Object.assign(config, { 'features.code_mode_host': true, 'features.skip_host_skill_discovery': true,
  'features.default_mode_request_user_input': true, 'skills.bundled.enabled': false, 'analytics.enabled': false,
  'feedback.enabled': false, check_for_update_on_startup: false });
let transport, runtime;
const evidence = { runtimeVersion: CODEX_PROTOCOL_VERSION, offline: true, requests, events };
try {
  transport = new CodexTransport({ command: binary, args: ['app-server', '--strict-config', ...Object.entries(supportedCodexConfig(config)).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`])],
    cwd: workspace, env, secrets: [], limits: { ...CODEX_RUNTIME_LIMITS, startupTimeoutMs: 30000 }, onMessage() {} });
  const initialized = await transport.request('initialize', { clientInfo: { name: 'openslate_compatibility', version: '1' }, capabilities: { experimentalApi: true } });
  transport.notification('initialized'); evidence.initialized = initialized.userAgent.includes(`/${CODEX_PROTOCOL_VERSION} `);
  evidence.account = await transport.request('account/read', { refreshToken: false });
  assert.equal(evidence.account.account, null);
  const models = await transport.request('model/list', { limit: 100, includeHidden: true });
  evidence.models = models.data.map(model => ({ id: model.model, hidden: model.hidden }));
  assert.ok(evidence.models.some(model => model.id === 'gpt-6.1-sol'));
  assert.ok(evidence.models.some(model => model.id === 'gpt-6-astra'));
  const effective = (await transport.request('config/read', { cwd: workspace, includeLayers: false })).config;
  evidence.disabledFeatures = CODEX_DISABLED_FEATURES.every(name => effective.features[name] === false);
  evidence.unknownFeatureSkipped = effective.features.openslate_compatibility_probe_unknown === undefined;
  assert.equal(evidence.disabledFeatures, true); assert.equal(evidence.unknownFeatureSkipped, true);
  await transport.close(); transport = undefined;
  runtime = new CodexDirectorRuntime({ command: { file: binary }, cwd: workspace, env,
    model: 'gpt-6.1-sol', runtimeVersion: CODEX_PROTOCOL_VERSION, policy: { mode: 'local', id, runtimeVersion: CODEX_PROTOCOL_VERSION, config },
    limits: { startupTimeoutMs: 30000, runTimeoutMs: 30000 } });
  evidence.result = await runtime.start({ projectId: 'compat-project', requestId: 'compat-request', epochId: 'compat-epoch', turnId: 'compat-turn',
    text: 'Reply OK. Do not call tools.', context: '{}', skills: [], bridge: { endpoint, projectId: 'compat-project', credential: 'offline-compatibility-credential',
      entrypoint: fileURLToPath(new URL('../packages/director/dist/tools/mcp.js', import.meta.url)) } }, { onEvent(event) { events.push(event); } });
  evidence.threadAndMcpReady = events.some(event => event.kind === 'runtime_started');
  evidence.turnStarted = events.some(event => event.kind === 'turn_started');
  assert.equal(evidence.threadAndMcpReady, true, JSON.stringify(evidence.result));
  assert.equal(evidence.turnStarted, true, JSON.stringify(evidence.result));
  evidence.setup = { status: 'unverified', reason: 'No ChatGPT sign-in in the disposable home; real providers were not contacted.' };
} catch (error) {
  evidence.failure = { code: error.code, message: error.message, diagnostic: transport?.diagnostics() };
  throw error;
} finally {
  await transport?.close(); await runtime?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ directory: root, initialized: evidence.initialized, disabledFeatures: evidence.disabledFeatures,
    unknownFeatureSkipped: evidence.unknownFeatureSkipped, threadAndMcpReady: evidence.threadAndMcpReady, turnStarted: evidence.turnStarted,
    outcome: evidence.result?.status, setupIssue: evidence.setup?.reason, loopbackRequests: requests.length, realProviderCalls: 0 }));
}
