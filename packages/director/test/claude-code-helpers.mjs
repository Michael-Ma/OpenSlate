import { chmodSync, mkdirSync, mkdtempSync, realpathSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ClaudeCodeDirectorRuntime } from '../dist/index.js';

export function fakeClaude(t, overrides = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-claude-'))), home = join(root, 'home'), cwd = join(root, 'workspace');
  mkdirSync(home); mkdirSync(cwd);
  const configPath = join(root, 'fixture.json'), log = join(root, 'calls.jsonl'), binaryPath = join(root, 'claude');
  writeFileSync(log, ''); writeFileSync(configPath, JSON.stringify({ log, ...overrides }));
  writeFileSync(binaryPath, `#!${process.execPath}\nimport {runFakeClaude} from ${JSON.stringify(new URL('./claude-code-fixture.mjs', import.meta.url).href)};\nawait runFakeClaude(${JSON.stringify(configPath)});\n`);
  chmodSync(binaryPath, 0o700);
  const env = { HOME: home, PATH: `${join(process.execPath, '..')}:/usr/bin:/bin`, USER: 'fixture', LANG: 'en_US.UTF-8', TMPDIR: root,
    ANTHROPIC_API_KEY: 'DO-NOT-INHERIT-API-KEY', ANTHROPIC_AUTH_TOKEN: 'DO-NOT-INHERIT-TOKEN', ANTHROPIC_BASE_URL: 'https://forbidden.invalid',
    CLAUDE_CODE_USE_BEDROCK: '1', CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_CODE_OAUTH_TOKEN: 'DO-NOT-INHERIT-OAUTH',
    OPENSLATE_SECRET: 'DO-NOT-INHERIT-SECRET', OPENSLATE_BRIDGE_CREDENTIAL: 'DO-NOT-INHERIT-CREDENTIAL', TERM: 'xterm', NODE_OPTIONS: '--bad-option' };
  const options = { command: { file: binaryPath }, cwd, env, runTimeoutMs: 10000, startupTimeoutMs: 5000, shutdownGraceMs: 1000 };
  const runtime = new ClaudeCodeDirectorRuntime(options);
  t.after(async () => { await runtime.close(); rmSync(root, { recursive: true, force: true }); });
  const skill = join(cwd, 'SKILL.md'); writeFileSync(skill, 'IMMUTABLE SKILL TEXT');
  const input = { projectId: 'project', requestId: 'request', epochId: 'epoch', turnId: 'turn', text: 'PERSON MESSAGE', context: 'CANONICAL APPLICATION CONTEXT',
    skills: [{ name: 'code-plan', path: skill }], bridge: { endpoint: 'http://127.0.0.1:3199', projectId: 'project', credential: 'a'.repeat(43),
      toolContractVersion: '0.3.0', entrypoint: new URL('../dist/tools/mcp.js', import.meta.url).pathname } };
  const records = () => readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  return { root, home, cwd, binaryPath, options, runtime, input, env, records, update: changes => writeFileSync(configPath, JSON.stringify({ log, ...overrides, ...changes })) };
}
