import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { CodexDirectorRuntime } from '../dist/index.js';
import { CODEX_IMAGE_RUNTIME_VERSION } from '@openslate/providers';
import { CODEX_PROTOCOL_VERSION, supportedCodexConfig } from '../dist/runtime/policy.js';
import { PROTOCOL_FIXTURE_LIMITS } from './fixture-timing.mjs';

const fixture = JSON.parse(await readFile(new URL('./fixtures/codex-protocol-0.162.1.json', import.meta.url), 'utf8'));
// Structural assertions against the binary-generated draft-07 shapes. No production validation is replaced here.
function matches(schema, value) {
  if (schema.$ref) return matches(fixture.definitions[schema.$ref.replace('#/definitions/', '')], value);
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.oneOf && schema.oneOf.filter(part => matches(part, value)).length !== 1) return false;
  if (schema.anyOf && !schema.anyOf.some(part => matches(part, value))) return false;
  if (schema.allOf && !schema.allOf.every(part => matches(part, value))) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value)
    : type === 'integer' ? Number.isSafeInteger(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === type)) return false;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (schema.required?.some(key => !Object.hasOwn(value, key))) return false;
    if (Object.entries(schema.properties ?? {}).some(([key, shape]) => Object.hasOwn(value, key) && !matches(shape, value[key]))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties ?? {}, key))) return false;
  }
  if (Array.isArray(value) && schema.items && !value.every(item => matches(schema.items, item))) return false;
  return true;
}
const valid = (name, value) => assert.equal(matches(fixture.schemas[name] ?? fixture.definitions[name], value), true, name);
const rpcSchemas = { initialize: 'v1/InitializeParams', 'config/read': 'v2/ConfigReadParams', 'skills/list': 'v2/SkillsListParams',
  'thread/start': 'v2/ThreadStartParams', 'thread/resume': 'v2/ThreadResumeParams', 'mcpServerStatus/list': 'v2/ListMcpServerStatusParams',
  'turn/start': 'v2/TurnStartParams', 'turn/interrupt': 'v2/TurnInterruptParams' };

test('adapter start/resume requests and consumed notifications retain the real 0.162.1 shapes', async t => {
  assert.equal(fixture.runtimeVersion, '0.162.1'); assert.equal(CODEX_IMAGE_RUNTIME_VERSION, CODEX_PROTOCOL_VERSION); assert.equal(fixture.experimental, true); assert.equal(Object.keys(fixture.sources).length, 30);
  const root = await mkdtemp(join(tmpdir(), 'openslate-protocol-shapes-')), log = join(root, 'requests.jsonl');
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = new CodexDirectorRuntime({ command: { file: process.execPath, args: [fileURLToPath(new URL('./runtime-fixture.mjs', import.meta.url))] },
    cwd: root, env: { FIXTURE_LOG: log }, model: 'gpt-6.1-sol', runtimeVersion: '0.162.1',
    policy: { mode: 'local', id: 'fixture', runtimeVersion: '0.162.1', config: { default_permissions: 'fixture',
      permissions: { fixture: { filesystem: { ':root': 'deny' }, network: { enabled: false } } }, 'features.unknown_disabled_reduction': false } }, limits: PROTOCOL_FIXTURE_LIMITS });
  t.after(() => runtime.close());
  const input = { projectId: 'project', requestId: 'request', epochId: 'epoch', turnId: 'turn', text: 'Reply OK', context: '{}', skills: [],
    bridge: { projectId: 'project', endpoint: 'http://127.0.0.1:12345', credential: 'fixture-opaque-credential', entrypoint: join(root, 'bridge.mjs') } };
  assert.equal((await runtime.start(input)).status, 'completed');
  assert.equal((await runtime.start({ ...input, resumeThreadId: 'native-thread-1' })).status, 'completed');
  const rows = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
  for (const row of rows) if (rpcSchemas[row.method]) valid(rpcSchemas[row.method], row.params);
  assert.ok(rows.some(row => row.method === 'thread/resume'));
  assert.ok(rows.filter(row => row.kind === 'launch').every(row => row.codeProfile.unknownReductionPresent === false));
  valid('v2/ModelListParams', { limit: 100, includeHidden: true, cursor: 'next-page' });
  valid('v2/GetAccountParams', { refreshToken: false });
  valid('v2/ThreadReadParams', { threadId: 'thread', includeTurns: true });
  valid('v2/ModelProviderCapabilitiesReadParams', {});
  valid('v2/ModelProviderCapabilitiesReadResponse', { imageGeneration: true, webSearch: true });
  valid('v2/TurnInterruptParams', { threadId: 'thread', turnId: 'turn' });
  valid('v2/ThreadStartParams', { model: 'gpt-6-astra', modelProvider: 'openai', cwd: '/tmp/image-worker', approvalPolicy: 'never', permissions: 'openslate_local', historyMode: 'legacy', ephemeral: false, allowProviderModelFallback: false, baseInstructions: 'Generate one image' });
  valid('v2/TurnStartParams', { threadId: 'thread', model: 'gpt-6-astra', effort: 'low', permissions: 'openslate_local', approvalPolicy: 'never', input: [{ type: 'text', text: 'One image', text_elements: [] }, { type: 'localImage', path: '/tmp/image-worker/reference.png' }] });
  for (const status of ['inProgress', 'completed', 'failed', 'interrupted']) {
    const value = { threadId: 'thread', turn: { id: 'turn', items: [], status, rootTurnId: 'turn' } };
    valid(status === 'inProgress' ? 'v2/TurnStartedNotification' : 'v2/TurnCompletedNotification', value);
  }
  valid('v2/ItemStartedNotification', { startedAtMs: 0, threadId: 'thread', turnId: 'turn', item: { type: 'reasoning', id: 'reasoning' } });
  for (const phase of ['commentary', 'partial_answer', 'final_answer']) valid('v2/ItemCompletedNotification', {
    completedAtMs: 1, threadId: 'thread', turnId: 'turn', item: { type: 'agentMessage', id: 'message', text: 'OK', phase } });
  for (const status of ['inProgress', 'completed', 'failed']) valid('v2/ItemCompletedNotification', {
    completedAtMs: 1, threadId: 'thread', turnId: 'turn', item: { type: 'imageGeneration', id: 'image', status, result: '', savedPath: null, revisedPrompt: null, failure: null } });
  valid('ToolRequestUserInputParams', { threadId: 'thread', turnId: 'turn', itemId: 'item', isBlocking: true, questions: [
    { id: 'tone', header: 'Tone', question: 'Choose', isOther: true, isSecret: false, options: [{ label: 'Warm', description: 'Friendly' }] }] });
});

test('the new image source union preserves URL inputs and refuses a source-less image', () => {
  const request = input => ({ threadId: 'thread', input });
  valid('v2/TurnStartParams', request([{ type: 'image', url: 'data:image/png;base64,fixture' }]));
  valid('v2/TurnStartParams', request([{ type: 'image', fileId: 'file-fixture' }, { type: 'localImage', path: '/fixture/image.png' }]));
  assert.equal(matches(fixture.schemas['v2/TurnStartParams'], request([{ type: 'image' }])), false);
  assert.deepEqual(supportedCodexConfig({ 'features.future_reduction': false, 'features.image_generation': false }), { 'features.image_generation': false });
  assert.throws(() => supportedCodexConfig({ 'features.future_capability': true }), { code: 'RUNTIME_CONFIG_INVALID' });
});
