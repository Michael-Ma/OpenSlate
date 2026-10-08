import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const switches = ['IMAGE_GENERATION', 'H3_GENERATION', 'VIGGLE_H3_GENERATION', 'CODEX_IMAGE_GENERATION', 'SPEECH_GENERATION', 'TRANSCRIPTION'];
const credentials = [
  { id: 'openai-media', variable: 'OPENSLATE_OPENAI_API_KEY', routes: ['IMAGE_GENERATION', 'SPEECH_GENERATION', 'TRANSCRIPTION'] },
  { id: 'minimax-video', variable: 'OPENSLATE_MINIMAX_API_KEY', routes: ['H3_GENERATION'] },
  { id: 'viggle-video', variable: 'OPENSLATE_VIGGLE_API_KEY', routes: ['VIGGLE_H3_GENERATION'] },
];
const validKey = value => typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\s\x00-\x1f\x7f]/.test(value);
const runProbe = (command, args) => spawnSync(command, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 65536 });

/** Read-only local diagnostics. Never installs, writes credentials, starts a service or calls a provider. */
export function inspectSetup({ root, environment = process.env, nodeVersion = process.versions.node, probe = runProbe } = {}) {
  root = resolve(root ?? process.cwd());
  const checks = [], tools = {};
  const add = (id, label, state, detail, action = null) => checks.push({ id, label, state, detail, action });
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).packageManager.split('@')[1];
  add('node', 'Node.js', nodeVersion.split('.')[0] === '24' ? 'ready' : 'blocked', `Version ${nodeVersion}`, 'Install Node 24, or run nvm install 24 and nvm use 24.');
  const pnpm = probe('pnpm', ['--version']);
  const pinnedPnpm = pnpm.status === 0 && pnpm.stdout?.trim() === version;
  const npx = pinnedPnpm ? null : probe('npx', ['--version']);
  add('pnpm', 'Package manager', pinnedPnpm ? 'ready' : npx?.status === 0 ? 'warning' : 'blocked',
    pinnedPnpm ? `pnpm ${version}` : npx?.status === 0 ? `Startup can use npx pnpm@${version}; its first run may download that version.` : `pnpm ${version} and npx are unavailable.`,
    `Install pnpm ${version} with npm install --global pnpm@${version}.`);
  for (const kind of switches) {
    const variable = `OPENSLATE_ENABLE_${kind}`, value = environment[variable];
    if (value !== undefined && !['', '0', '1'].includes(value)) add(variable, 'Generation switch', 'blocked', `${variable} must be 0 or 1.`, 'Edit .env.live.local, then run ./start.sh --check.');
  }
  for (const credential of credentials) {
    const required = credential.routes.some(route => environment[`OPENSLATE_ENABLE_${route}`] === '1');
    const configured = validKey(environment[credential.variable]);
    add(credential.id, credential.variable, required && !configured ? 'blocked' : 'ready',
      configured ? 'Configured locally; provider access and quota have not been checked.' : required ? 'An enabled route needs this server credential.' : 'Not configured; related real generation routes are disabled.',
      `Set ${credential.variable} in .env.live.local, or disable its real generation routes. Never put the key in browser code.`);
  }
  const realEnabled = switches.some(kind => environment[`OPENSLATE_ENABLE_${kind}`] === '1');
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const variable = `OPENSLATE_${tool.toUpperCase()}`, override = environment[variable];
    // Relative PATH entries/explicit overrides are resolved against this checkout, matching server startup.
    const candidates = (override ? [override] : [...(environment.PATH ?? '').split(':').filter(Boolean).map(directory => join(directory, tool)), `/opt/homebrew/bin/${tool}`, `/usr/local/bin/${tool}`]).map(candidate => resolve(root, candidate));
    const path = candidates.find(candidate => probe(candidate, ['-version']).status === 0);
    tools[tool] = path ?? null;
    add(tool, tool, path ? 'ready' : realEnabled ? 'blocked' : 'warning', path ? 'Executable available.' : 'Needed to import, preview and export media.', 'Use the verified FFmpeg/ffprobe 8.1.1 pair. Run pnpm setup:test-media for an isolated pinned pair, then set OPENSLATE_FFMPEG / OPENSLATE_FFPROBE to its printed absolute paths.');
  }
  for (const provider of [{ switch: 'H3_GENERATION', variable: 'OPENSLATE_H3_DOWNLOAD_HOSTS' }, { switch: 'VIGGLE_H3_GENERATION', variable: 'OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS' }]) {
    if (environment[`OPENSLATE_ENABLE_${provider.switch}`] !== '1') continue;
    const hosts = (environment[provider.variable] ?? '').split(',').map(host => host.trim()).filter(Boolean);
    const valid = hosts.length > 0 && hosts.length <= 128 && new Set(hosts).size === hosts.length
      && hosts.every(host => /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) && !host.includes('..') && !/^\d+(?:\.\d+){3}$/.test(host) && host.includes('.') && !/(?:^|\.)localhost$/.test(host));
    add(provider.variable, 'Video output hosts', valid ? 'ready' : 'blocked', valid ? 'Explicit output hosts configured; not contacted.' : `${provider.variable} needs the documented HTTPS output host names.`, `Set ${provider.variable} to the provider's comma-separated output host names; do not include schemes, paths or wildcards.`);
  }
  if (environment.OPENSLATE_ENABLE_CODEX_IMAGE_GENERATION === '1') {
    const binary = environment.OPENSLATE_CODEX_IMAGE_BINARY;
    const versionProbe = binary && isAbsolute(binary) ? probe(binary, ['--version']) : null;
    const valid = versionProbe?.status === 0 && versionProbe.stdout?.trim() === 'codex-cli 0.153.4';
    add('codex-image', 'Codex image runtime', valid ? 'ready' : 'blocked', valid ? 'Pinned runtime found; sign-in and quota are checked before dispatch.' : 'An absolute path to the pinned Codex 0.153.4 executable is required.', 'Set OPENSLATE_CODEX_IMAGE_BINARY. Follow docs/implementation/MANUAL-LIVE-PRODUCTION.md for installation and sign-in.');
  }
  if (environment.OPENSLATE_PROVIDER_CONFIG) {
    try {
      const file = resolve(root, environment.OPENSLATE_PROVIDER_CONFIG), stat = statSync(file);
      if (!stat.isFile() || stat.size > 65536) throw new Error();
      const catalog = JSON.parse(readFileSync(file, 'utf8'));
      if (catalog?.version !== 1 || !Array.isArray(catalog.profiles) || catalog.profiles.length > 64) throw new Error();
      add('catalog', 'Provider catalog', realEnabled && !catalog.profiles.length ? 'warning' : 'ready', catalog.profiles.length
        ? 'Readable JSON catalog. The server validates exact model/profile contracts during startup.'
        : 'This catalog has no real model profiles. Enabled routes still need an installed profile and project model selection.',
      'Add supported profiles using examples/live-provider-profiles.example.json, then choose the models in Project settings.');
    } catch { add('catalog', 'Provider catalog', 'blocked', 'OPENSLATE_PROVIDER_CONFIG is not a readable bounded v1 provider catalog.', 'Start with examples/live-provider-profiles.example.json or examples/viggle-provider-profiles.example.json and set OPENSLATE_PROVIDER_CONFIG to your catalog.'); }
  } else add('catalog', 'Provider catalog', realEnabled ? 'warning' : 'ready', 'Built-in demo profiles selected. Choose an explicit catalog to use real models.',
    'Set OPENSLATE_PROVIDER_CONFIG to a supported catalog such as examples/live-provider-profiles.example.json, then choose its models in Project settings.');
  const dataDirectory = resolve(root, environment.OPENSLATE_DATA_DIR ?? '.openslate');
  let parent = dataDirectory;
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  try { if (!statSync(parent).isDirectory()) throw new Error(); accessSync(parent, constants.W_OK | constants.X_OK); add('storage', 'Local project storage', 'ready', 'The data directory or its parent is writable. Existing data is preserved.'); }
  catch { add('storage', 'Local project storage', 'blocked', 'The configured data location cannot be created or written.', 'Choose a writable OPENSLATE_DATA_DIR. Do not select apps/web/dist or any public web directory.'); }
  const ready = !checks.some(check => check.state === 'blocked');
  return { version: 1, ready, checks, tools, packageManager: version, networkCalls: 0, providerAccessVerified: false, notice: 'These are local setup checks. Human generation permission and a separate usage or spending allowance are still required.' };
}

export function formatSetup(report) {
  const lines = report.checks.filter(check => check.state !== 'ready').flatMap(check => [`${check.state === 'blocked' ? 'Needs attention' : 'Optional setup'}: ${check.label}. ${check.detail}`, ...(check.action ? [`  ${check.action}`] : [])]);
  return [report.ready ? 'Local setup checks passed.' : 'Local setup needs attention.', ...lines, report.notice].join('\n');
}
