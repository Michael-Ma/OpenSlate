import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: ./start.sh [--check] [--no-open]\nLoads .env.live.local, installs locked dependencies, builds and runs the local studio.\n--check checks prerequisites without installation, build, server or API calls.');
  process.exit(0);
}
if (args.some(arg => !['--check', '--no-open'].includes(arg))) {
  console.error('Unknown option. Use ./start.sh --help.'); process.exit(1);
}
const fail = message => { console.error(`OpenSlate: ${message}`); process.exit(1); };
if (process.versions.node.split('.')[0] !== '24') fail('Node 24 is required. Run ./start.sh.');
if (existsSync('.env.live.local')) loadEnvFile('.env.live.local');
else console.log('No .env.live.local found; starting with default demo settings.');
process.env.OPENSLATE_DATA_DIR = resolve(process.env.OPENSLATE_DATA_DIR ?? '.openslate');
const probe = (command, options = ['--version']) => spawnSync(command, options, { encoding: 'utf8', timeout: 15000 });
const enabled = name => process.env[name] === '1';
const switches = ['IMAGE_GENERATION', 'H3_GENERATION', 'VIGGLE_H3_GENERATION', 'CODEX_IMAGE_GENERATION', 'SPEECH_GENERATION', 'TRANSCRIPTION'];
for (const kind of switches) {
  const key = `OPENSLATE_ENABLE_${kind}`;
  if (process.env[key] && !['0', '1'].includes(process.env[key])) fail(`${key} must be 0 or 1.`);
}
if (['IMAGE_GENERATION', 'SPEECH_GENERATION', 'TRANSCRIPTION'].some(kind => enabled(`OPENSLATE_ENABLE_${kind}`)) && !process.env.OPENSLATE_OPENAI_API_KEY?.trim()) fail('Enabled OpenAI media needs OPENSLATE_OPENAI_API_KEY in .env.live.local.');
if (enabled('OPENSLATE_ENABLE_VIGGLE_H3_GENERATION') && !process.env.OPENSLATE_VIGGLE_API_KEY?.trim()) fail('Enabled Viggle video needs OPENSLATE_VIGGLE_API_KEY in .env.live.local.');
if (process.env.OPENSLATE_PROVIDER_CONFIG) {
  try { JSON.parse(readFileSync(resolve(process.env.OPENSLATE_PROVIDER_CONFIG), 'utf8')); }
  catch { fail('OPENSLATE_PROVIDER_CONFIG must point to a readable JSON provider catalog.'); }
}
if (switches.some(kind => enabled(`OPENSLATE_ENABLE_${kind}`))) {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const variable = `OPENSLATE_${tool.toUpperCase()}`;
    const candidates = process.env[variable] ? [process.env[variable]] : [...(process.env.PATH ?? '').split(':').filter(Boolean).map(directory => join(directory, tool)), `/opt/homebrew/bin/${tool}`, `/usr/local/bin/${tool}`];
    const found = candidates.find(candidate => probe(candidate, ['-version']).status === 0);
    if (!found) fail(`${tool} is missing. On macOS install FFmpeg with: brew install ffmpeg`);
    process.env[variable] = found;
  }
}
if (enabled('OPENSLATE_ENABLE_CODEX_IMAGE_GENERATION')) {
  const binary = process.env.OPENSLATE_CODEX_IMAGE_BINARY;
  if (!binary || probe(binary).stdout?.trim() !== 'codex-cli 0.153.4') fail('Codex images need the pinned Codex 0.153.4 binary. See docs/implementation/MANUAL-LIVE-PRODUCTION.md for installation and sign-in.');
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).packageManager.split('@')[1];
const installed = probe('pnpm');
const pnpm = installed.status === 0 && installed.stdout.trim() === version ? ['pnpm', []] : ['npx', ['--yes', `pnpm@${version}`]];
console.log(`Prerequisites ready. Node ${process.versions.node}; pnpm ${version}. Provider settings preserved.`);
if (args.includes('--check')) process.exit(0);

// Never replace or rebuild underneath a running server. Its launcher verifies the installation credential.
let listening = false;
try { await fetch('http://127.0.0.1:3001/api/health', { signal: AbortSignal.timeout(1500), redirect: 'error' }); listening = true; } catch {}
const run = (command, commandArgs) => new Promise((resolveRun, reject) => {
  const child = spawn(command, commandArgs, { cwd: root, env: process.env, stdio: 'inherit' });
  const forward = signal => child.kill(signal);
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
  child.once('error', () => { cleanup(); reject(new Error(`Could not start ${command}.`)); });
  child.once('exit', (code, signal) => { cleanup(); code === 0 ? resolveRun() : reject(new Error(signal ? `Stopped (${signal}).` : `${command} exited with code ${code}.`)); });
});
try {
  if (listening) {
    if (!existsSync('apps/server/dist/studio-cli.js')) fail('Port 3001 is occupied. Stop that server before first-time setup.');
    console.log('A server is already listening. Reconnecting; restart it to load changed keys, settings or code.');
    await run(process.execPath, ['apps/server/dist/studio-cli.js', ...args.filter(arg => arg === '--no-open')]);
  } else {
    console.log('Installing locked dependencies…');
    await run(pnpm[0], [...pnpm[1], 'install', '--frozen-lockfile']);
    console.log('Building OpenSlate…');
    await run(pnpm[0], [...pnpm[1], 'build']);
    console.log('Starting the complete studio at http://127.0.0.1:3001. Press Ctrl+C to stop.');
    await run(process.execPath, ['apps/server/dist/index.js', '--serve-web', ...args.filter(arg => arg === '--no-open')]);
  }
} catch (error) { fail(error.message); }
