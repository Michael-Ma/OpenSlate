// Explicit offline native check. All model endpoints are a disposable loopback refusal server.
// No sign-in, personal home, real inference, media, installation or production data is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, readlink, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexDirectorRuntime } from '../packages/director/dist/index.js';
import { CodexTransport } from '../packages/director/dist/runtime/transport.js';
import { ImageRpc } from '../packages/director/dist/media/image-rpc.js';
import { preparePrivateCodexHome, verifyPrivateCodexHome, untrustedCodexProjects } from '../packages/director/dist/runtime/private-home.js';
import { CODEX_DISABLED_FEATURES, CODEX_PROTOCOL_VERSION, CODEX_PROJECT_ISOLATION_CONFIG,
  CODEX_RUNTIME_LIMITS, projectIsolationMatches, supportedCodexConfig, toml } from '../packages/director/dist/runtime/policy.js';

const binary = process.argv[2];
if (!binary?.startsWith('/')) throw Error('Usage: node scripts/probe-codex-compat.mjs ABSOLUTE_CODEX_BINARY [EVIDENCE_DIRECTORY]');
const root = await realpath(await mkdtemp(join(process.argv[3] ? resolve(process.argv[3]) : tmpdir(), 'openslate-native-compat-')));
const home = join(root, 'home'), codexHome = join(root, 'codex-home'), repository = join(root, 'repository');
const sourceHome = join(home, '.codex'), privateHome = { home: codexHome, authSource: join(sourceHome, 'auth.json') };
const data = join(repository, 'data'), workspace = join(data, 'test-runs/probe/native');
await Promise.all([home, sourceHome, codexHome, workspace, join(repository, '.codex'), join(data, '.codex')].map(path => mkdir(path, { recursive: true })));
execFileSync('/usr/bin/git', ['init', '--quiet', repository], { env: { HOME: home, PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1' } });
await writeFile(join(repository, 'AGENTS.md'), 'Synthetic root instructions: must never reach an OpenSlate turn.\n');
await writeFile(join(data, 'FALLBACK.md'), 'Synthetic fallback instructions: must never reach an OpenSlate turn.\n');
await writeFile(join(repository, '.codex/config.toml'), 'project_doc_fallback_filenames = ["FALLBACK.md"]\n');
await writeFile(join(data, '.codex/config.toml'), 'model_verbosity = "low"\n');
const sourceConfig = `[projects.${JSON.stringify(repository)}]\ntrust_level = "trusted"\n`;
await writeFile(join(sourceHome, 'config.toml'), sourceConfig);
await writeFile(privateHome.authSource, 'SYNTHETIC_AUTH_NEVER_READ');
// Reproduce an already contaminated private home, without touching personal state.
await writeFile(join(codexHome, 'config.toml'), sourceConfig);
for (const folder of ['.agents', '.codex']) {
  const path = join(repository, folder, 'skills', `${folder.slice(1)}-inherited`);
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'SKILL.md'), `---\nname: ${folder.slice(1)}-inherited\ndescription: Synthetic ancestor skill that must not load.\n---\nDo not follow this skill.\n`);
}
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
const imagePermissions = { [id]: { filesystem: { ':root': 'deny', ':minimal': 'read', [workspace]: 'write', [binary]: 'read' }, network: { enabled: false } } };
const imageConfig = { model_provider: 'openai', forced_login_method: 'chatgpt', 'features.image_generation': true, permissions: imagePermissions };
const config = { default_permissions: id, permissions: { [id]: profile }, sqlite_home: join(root, 'state'), log_dir: join(root, 'logs'),
  model_provider: 'offline_probe', model_providers: { offline_probe: { name: 'Offline compatibility probe', base_url: `${endpoint}/v1`, wire_api: 'responses', requires_openai_auth: false, request_max_retries: 0, stream_max_retries: 0 } },
  chatgpt_base_url: endpoint, openai_base_url: `${endpoint}/v1`, 'features.openslate_compatibility_probe_unknown': false };
for (const name of CODEX_DISABLED_FEATURES) config[`features.${name}`] = false;
Object.assign(config, { 'features.code_mode_host': true, 'features.skip_host_skill_discovery': true,
  'features.default_mode_request_user_input': true, 'skills.bundled.enabled': false, 'analytics.enabled': false,
  'feedback.enabled': false, check_for_update_on_startup: false });
const args = config => ['app-server', '--strict-config', ...Object.entries(supportedCodexConfig(config)).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`])];
const limits = { ...CODEX_RUNTIME_LIMITS, startupTimeoutMs: 30000 };
let transport, runtime;
const evidence = { runtimeVersion: CODEX_PROTOCOL_VERSION, offline: true, requests, events, repository, workspace };
async function initialize(rpc) {
  const result = await rpc.request('initialize', { clientInfo: { name: 'openslate_compatibility', version: '1' }, capabilities: { experimentalApi: true } });
  rpc.notification('initialized'); assert.ok(result.userAgent.includes(`/${CODEX_PROTOCOL_VERSION} `));
}
async function discovery(overrides, image = false, persistent = false) {
  const rpc = new (image ? ImageRpc : CodexTransport)({ command: binary, args: args({ ...config, ...overrides }), cwd: workspace, env, secrets: [], limits, onMessage() {} });
  // These processes see only synthetic inputs; retain protocol refusals for probe diagnosis.
  let output = '';
  rpc.child.stdout.on('data', chunk => {
    output += chunk.toString('utf8');
    while (output.includes('\n')) {
      const end = output.indexOf('\n'), line = output.slice(0, end); output = output.slice(end + 1);
      try { const message = JSON.parse(line); if (message.error) evidence.discoveryRefusal = { image, error: message.error }; } catch { /* Transport validates JSON. */ }
    }
  });
  try {
    await initialize(rpc);
    const effective = await rpc.request('config/read', { cwd: workspace, includeLayers: true });
    const projectLayers = effective.layers.filter(layer => layer.name.type === 'project').map(layer => layer.name.dotCodexFolder);
    const skills = image ? undefined : (await rpc.request('skills/list', { cwds: [workspace], forceReload: true })).data;
    const opened = await rpc.request('thread/start', { cwd: workspace, model: image ? 'gpt-6-astra' : 'gpt-6.1-sol',
      ...(image ? { modelProvider: 'openai', historyMode: 'legacy', allowProviderModelFallback: false } : {}), ephemeral: !persistent,
      approvalPolicy: 'never', permissions: id, baseInstructions: 'Synthetic OpenSlate application instructions.' });
    let persistedConfig = null;
    try { persistedConfig = await readFile(join(codexHome, 'config.toml'), 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return { projectLayers, skills, instructionSources: opened.instructionSources, projects: effective.config.projects, persistedConfig,
      isolation: Object.fromEntries(Object.keys(CODEX_PROJECT_ISOLATION_CONFIG).map(key => [key, effective.config[key]])),
      modelVerbosity: effective.config.model_verbosity, activePermissionProfile: opened.activePermissionProfile?.id };
  } finally { await rpc.close(); }
}
try {
  // Both controls are thread-only: no turn/start, provider work or inherited skill execution.
  // The outer macOS sandbox cannot nest sandbox-exec for a denied ancestor read.
  // This thread-only control permits reads (no writes/network/turns); production
  // and all after checks keep the exact restricted application profile above.
  evidence.before = await discovery({ permissions: { [id]: { filesystem: { ':root': 'read' }, network: { enabled: false } } } });
  assert.ok(evidence.before.instructionSources.some(path => path.endsWith('/AGENTS.md')));
  assert.ok(evidence.before.instructionSources.some(path => path.endsWith('/FALLBACK.md')));
  assert.equal(evidence.before.projectLayers.length, 2);
  assert.ok(evidence.before.skills[0].skills.length >= 2);
  evidence.documentBudgetOnly = await discovery({ project_doc_max_bytes: 0 });
  assert.deepEqual(evidence.documentBudgetOnly.instructionSources, []);
  assert.equal(evidence.documentBudgetOnly.projectLayers.length, 2);
  assert.ok(evidence.documentBudgetOnly.skills[0].skills.length >= 2);
  // A trusted config is real, but the zero document budget also suppresses AGENTS
  // in this fixture. Keep that negative result instead of claiming V3 reproduced.
  evidence.f5TrustedPrivateHome = await discovery({ ...CODEX_PROJECT_ISOLATION_CONFIG, ...imageConfig }, true, true);
  assert.deepEqual(evidence.f5TrustedPrivateHome.instructionSources, []);
  assert.equal(evidence.f5TrustedPrivateHome.persistedConfig, sourceConfig);
  await preparePrivateCodexHome(privateHome);
  evidence.autoTrust = await discovery({ ...CODEX_PROJECT_ISOLATION_CONFIG, ...imageConfig }, true, true);
  assert.equal(evidence.autoTrust.persistedConfig, sourceConfig, 'the image workspace-write profile auto-trusts the Git root');
  await preparePrivateCodexHome(privateHome);
  evidence.sourceConfigUnchanged = await readFile(join(sourceHome, 'config.toml'), 'utf8') === sourceConfig;
  evidence.authLinkUnchanged = await readlink(join(codexHome, 'auth.json')) === privateHome.authSource;
  assert.equal(evidence.sourceConfigUnchanged, true); assert.equal(evidence.authLinkUnchanged, true);
  Object.assign(config, { projects: untrustedCodexProjects(workspace) });
  evidence.afterDirector = await discovery(CODEX_PROJECT_ISOLATION_CONFIG, false, true);
  evidence.afterImage = await discovery({ ...CODEX_PROJECT_ISOLATION_CONFIG, ...imageConfig }, true, true);
  for (const result of [evidence.afterDirector, evidence.afterImage]) {
    assert.deepEqual(result.instructionSources, []); assert.deepEqual(result.projectLayers, []);
    assert.ok(projectIsolationMatches(result.isolation)); assert.notEqual(result.modelVerbosity, 'low');
    assert.equal(result.activePermissionProfile, id);
    assert.deepEqual(result.projects, untrustedCodexProjects(workspace));
    assert.equal(result.persistedConfig, null, 'persistent threads must not write project trust');
  }
  await verifyPrivateCodexHome(codexHome);
  assert.deepEqual(evidence.afterDirector.skills[0].skills, []);
  assert.equal(requests.length, 0, 'discovery/thread preflight must not contact even the refusal endpoint');
  // Application-owned snapshots under cwd must still be discoverable and usable.
  const pinnedDirectory = join(workspace, '.agents/skills/pinned');
  await mkdir(pinnedDirectory, { recursive: true });
  const pinnedSkill = { name: 'pinned', path: join(pinnedDirectory, 'SKILL.md') };
  await writeFile(pinnedSkill.path, '---\nname: pinned\ndescription: Synthetic pinned application skill.\n---\nUse only the supplied application context.\n');
  Object.assign(config, CODEX_PROJECT_ISOLATION_CONFIG);
  transport = new CodexTransport({ command: binary, args: args(config), cwd: workspace, env, secrets: [], limits, onMessage() {} });
  await initialize(transport); evidence.initialized = true;
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
    privateCodexHome: privateHome, model: 'gpt-6.1-sol', runtimeVersion: CODEX_PROTOCOL_VERSION, policy: { mode: 'local', id, runtimeVersion: CODEX_PROTOCOL_VERSION, config },
    limits: { startupTimeoutMs: 30000, runTimeoutMs: 30000 } });
  evidence.result = await runtime.start({ projectId: 'compat-project', requestId: 'compat-request', epochId: 'compat-epoch', turnId: 'compat-turn',
    text: 'Reply OK. Do not call tools.', context: '{}', skills: [pinnedSkill], bridge: { endpoint, projectId: 'compat-project', credential: 'offline-compatibility-credential',
      entrypoint: fileURLToPath(new URL('../packages/director/dist/tools/mcp.js', import.meta.url)) } }, { onEvent(event) { events.push(event); } });
  evidence.threadAndMcpReady = events.some(event => event.kind === 'runtime_started');
  evidence.turnStarted = events.some(event => event.kind === 'turn_started');
  assert.equal(evidence.threadAndMcpReady, true, JSON.stringify(evidence.result));
  assert.equal(evidence.turnStarted, true, JSON.stringify(evidence.result));
  assert.equal(requests.length, 1); assert.equal(evidence.result.status, 'failed');
  await verifyPrivateCodexHome(codexHome);
  evidence.setup = { status: 'unverified', reason: 'No ChatGPT sign-in in the disposable home; real providers were not contacted. Image config/thread preflight only, no authenticated readiness or image turn.' };
} catch (error) {
  evidence.failure = { code: error.code, message: error.message, diagnostic: transport?.diagnostics() };
  throw error;
} finally {
  await transport?.close(); await runtime?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  await writeFile(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ directory: root, initialized: evidence.initialized, disabledFeatures: evidence.disabledFeatures,
    unknownFeatureSkipped: evidence.unknownFeatureSkipped, threadAndMcpReady: evidence.threadAndMcpReady, turnStarted: evidence.turnStarted,
    projectInstructionsBefore: evidence.before?.instructionSources, directorInstructionsAfter: evidence.afterDirector?.instructionSources,
    f5TrustedInstructions: evidence.f5TrustedPrivateHome?.instructionSources, autoTrustBefore: evidence.autoTrust?.persistedConfig,
    directorPersistedConfigAfter: evidence.afterDirector?.persistedConfig, imagePersistedConfigAfter: evidence.afterImage?.persistedConfig,
    imageInstructionsAfter: evidence.afterImage?.instructionSources, outcome: evidence.result?.status,
    setupIssue: evidence.setup?.reason, loopbackRequests: requests.length, realProviderCalls: 0 }));
}
