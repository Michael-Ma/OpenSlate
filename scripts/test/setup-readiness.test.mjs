import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, copyFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectSetup, formatSetup } from '../setup-readiness.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-setup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10.33.0' }));
  const calls = [];
  const probe = (command, args) => { calls.push({ command, args }); return { status: 0, stdout: command === 'pnpm' ? '10.33.0\n' : command === '/codex' ? 'codex-cli 0.153.4\n' : 'local tool\n' }; };
  return { root, probe, calls, environment: { PATH: '/local/bin' }, nodeVersion: '24.15.0' };
}

test('demo readiness is local, does not expose credentials and does not claim provider access', t => {
  const input = fixture(t);
  input.environment.OPENSLATE_OPENAI_API_KEY = 'private-fixture-key';
  const report = inspectSetup(input);
  assert.equal(report.ready, true); assert.equal(report.networkCalls, 0); assert.equal(report.providerAccessVerified, false);
  assert.equal(JSON.stringify(report).includes('private-fixture-key'), false);
  assert.equal(report.checks.find(check => check.id === 'openai-media').state, 'ready');
  assert.deepEqual(input.calls.map(call => call.args), [['--version'], ['-version'], ['-version']]);
});

test('reports all missing keys, output hosts and tools together rather than stopping on first error', t => {
  const input = fixture(t);
  Object.assign(input.environment, { OPENSLATE_ENABLE_H3_GENERATION: '1', OPENSLATE_ENABLE_VIGGLE_H3_GENERATION: '1', OPENSLATE_ENABLE_SPEECH_GENERATION: '1' });
  input.probe = command => command === 'pnpm' ? { status: 0, stdout: '10.33.0' } : { status: 1, stdout: '' };
  const report = inspectSetup(input);
  assert.equal(report.ready, false);
  assert.deepEqual(report.checks.filter(check => check.state === 'blocked').map(check => check.id), ['openai-media', 'minimax-video', 'viggle-video', 'ffmpeg', 'ffprobe', 'OPENSLATE_H3_DOWNLOAD_HOSTS', 'OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS']);
  assert.match(formatSetup(report), /OPENSLATE_MINIMAX_API_KEY/); assert.match(formatSetup(report), /brew install ffmpeg/);
});

test('disabled generation keeps missing media tools optional but makes their import/export purpose clear', t => {
  const input = fixture(t);
  input.probe = command => command === 'pnpm' ? { status: 0, stdout: '10.33.0' } : { status: 1, stdout: '' };
  const report = inspectSetup(input);
  assert.equal(report.ready, true); assert.equal(report.checks.find(check => check.id === 'ffmpeg').state, 'warning');
  assert.match(formatSetup(report), /import, preview and export/);
});

test('explicit invalid executable does not silently fall back and enabled Codex validates absolute pinned binary', t => {
  const input = fixture(t);
  Object.assign(input.environment, { OPENSLATE_ENABLE_CODEX_IMAGE_GENERATION: '1', OPENSLATE_CODEX_IMAGE_BINARY: 'codex', OPENSLATE_FFMPEG: '/missing' });
  input.probe = (command, args) => command === '/missing' ? { status: 1, stdout: '' } : fixtureProbe(command);
  const fixtureProbe = command => ({ status: 0, stdout: command === 'pnpm' ? '10.33.0' : 'tool' });
  const report = inspectSetup(input);
  assert.equal(report.ready, false); assert.equal(report.tools.ffmpeg, null);
  assert.equal(report.checks.find(check => check.id === 'codex-image').state, 'blocked');
  input.environment.OPENSLATE_CODEX_IMAGE_BINARY = '/codex';
  input.environment.OPENSLATE_FFMPEG = '/local/bin/ffmpeg';
  input.probe = command => ({ status: 0, stdout: command === 'pnpm' ? '10.33.0' : command === '/codex' ? 'codex-cli 0.153.4' : 'tool' });
  assert.equal(inspectSetup(input).ready, true);
});

test('invalid flags, malformed catalogs and malformed output host lists receive concrete fixes', t => {
  const input = fixture(t);
  Object.assign(input.environment, { OPENSLATE_ENABLE_IMAGE_GENERATION: 'yes', OPENSLATE_ENABLE_VIGGLE_H3_GENERATION: '1', OPENSLATE_VIGGLE_API_KEY: 'valid-key', OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS: 'https://cdn.example.com/*', OPENSLATE_PROVIDER_CONFIG: 'catalog.json' });
  writeFileSync(join(input.root, 'catalog.json'), '{bad-json}');
  const report = inspectSetup(input);
  for (const id of ['OPENSLATE_ENABLE_IMAGE_GENERATION', 'OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS', 'catalog']) assert.equal(report.checks.find(check => check.id === id).state, 'blocked');
  assert.equal(JSON.stringify(report).includes('valid-key'), false);
  writeFileSync(join(input.root, 'catalog.json'), JSON.stringify({ version: 1, profiles: [{ label: 'fixture', profile: { id: 'demo' } }] }));
  input.environment.OPENSLATE_ENABLE_IMAGE_GENERATION = '0'; input.environment.OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS = 'media.example.com';
  assert.equal(inspectSetup(input).ready, true);
});

test('an existing file cannot be used as project storage and wrong Node blocks readiness', t => {
  const input = fixture(t); input.nodeVersion = '22.0.0'; input.environment.OPENSLATE_DATA_DIR = 'package.json';
  const report = inspectSetup(input);
  assert.equal(report.checks.find(check => check.id === 'storage').state, 'blocked');
  assert.equal(report.checks.find(check => check.id === 'node').state, 'blocked');
});

test('relative media tool overrides and PATH entries resolve to the checked installation root', t => {
  const input = fixture(t); input.environment.PATH = 'tools'; input.environment.OPENSLATE_FFMPEG = 'custom/ffmpeg';
  const report = inspectSetup(input);
  assert.equal(report.tools.ffmpeg, join(input.root, 'custom/ffmpeg'));
  assert.equal(report.tools.ffprobe, join(input.root, 'tools/ffprobe'));
  assert.ok(input.calls.filter(call => call.args[0] === '-version').every(call => call.command.startsWith(input.root)));
});

test('config initialization writes a private disabled template once and preserves existing settings exactly', t => {
  const input = fixture(t), scripts = join(input.root, 'scripts'); mkdirSync(scripts);
  for (const file of ['start-local.mjs', 'setup-readiness.mjs', 'local-server.mjs']) copyFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), join(scripts, file));
  const template = '# Disabled fixture configuration\nOPENSLATE_ENABLE_SPEECH_GENERATION=0\nOPENSLATE_OPENAI_API_KEY=\n';
  writeFileSync(join(input.root, '.env.example'), template);
  const invoke = () => spawnSync(process.execPath, [join(scripts, 'start-local.mjs'), '--init-config'], { encoding: 'utf8' });
  const created = invoke(); assert.equal(created.status, 0, created.stderr);
  assert.equal(readFileSync(join(input.root, '.env.live.local'), 'utf8'), template);
  assert.equal(statSync(join(input.root, '.env.live.local')).mode & 0o777, 0o600);
  const existing = '# User settings\nOPENSLATE_OPENAI_API_KEY=private-config-fixture\n';
  writeFileSync(join(input.root, '.env.live.local'), existing);
  const retained = invoke(); assert.equal(retained.status, 0, retained.stderr); assert.match(retained.stdout, /preserved/);
  assert.equal(readFileSync(join(input.root, '.env.live.local'), 'utf8'), existing);
  assert.equal(retained.stdout.includes('private-config-fixture'), false); assert.equal(retained.stderr.includes('private-config-fixture'), false);
});
