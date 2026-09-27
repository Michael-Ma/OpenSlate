import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { inspectServer, serverPid, stopServer, studioOrigin } from './local-server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: ./start.sh [--check | --status | --restart] [--no-open]\nLoads .env.live.local, installs locked dependencies, builds and runs the local studio.\n--check checks prerequisites without installation, build, server or API calls.\n--status checks the local server and this installation credential, without starting anything.\n--restart gracefully stops the verified server for this checkout, rebuilds and starts it with current configuration.\nDefault: start if stopped, or reopen an existing studio without changing it.');
  process.exit(0);
}
if (args.some(arg => !['--check', '--no-open', '--status', '--restart'].includes(arg))) {
  console.error('Unknown option. Use ./start.sh --help.'); process.exit(1);
}
if (args.filter(arg => ['--check', '--status', '--restart'].includes(arg)).length > 1) { console.error('Choose only one of --check, --status or --restart.'); process.exit(1); }
const fail = message => { console.error(`OpenSlate: ${message}`); process.exit(1); };
if (process.versions.node.split('.')[0] !== '24') fail('Node 24 is required. Run ./start.sh.');
if (existsSync('.env.live.local')) { try { loadEnvFile('.env.live.local'); } catch { fail('Could not read .env.live.local. Check its permissions and syntax.'); } }
else console.log('No .env.live.local found; using shell configuration or demo defaults.');
process.env.OPENSLATE_DATA_DIR = resolve(process.env.OPENSLATE_DATA_DIR ?? '.openslate');
let pnpm;
if (!args.includes('--status')) {
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
  pnpm = installed.status === 0 && installed.stdout.trim() === version ? ['pnpm', []] : ['npx', ['--yes', `pnpm@${version}`]];
  console.log(`Prerequisites ready. Node ${process.versions.node}; pnpm ${version}. Provider settings preserved.`);
  if (args.includes('--check')) process.exit(0);
}
const run = (command, commandArgs) => new Promise((resolveRun, reject) => {
  const child = spawn(command, commandArgs, { cwd: root, env: process.env, stdio: 'inherit' });
  let interrupted = false;
  const forward = signal => { interrupted = true; child.kill(signal); };
  const interrupt = () => forward('SIGINT'), terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  const cleanup = () => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); };
  child.once('error', () => { cleanup(); reject(new Error(`Could not start ${command}.`)); });
  child.once('exit', (code, signal) => { cleanup(); interrupted ? reject(Object.assign(new Error('Stopped. Saved projects are preserved.'), { exitCode: 130 })) : code === 0 ? resolveRun() : reject(new Error(signal ? `Stopped (${signal}).` : `${command} exited with code ${code}.`)); });
});
try {
  const state = await inspectServer();
  if (state === 'occupied') fail('Port 3001 is occupied or unhealthy, but is not a verified OpenSlate server. Stop that listener manually; no process was changed.');
  let existing = state === 'ready';
  if (existing) {
    if (!existsSync('apps/server/dist/studio-launcher.js')) fail('An OpenSlate server is running but this checkout has no launcher build. Stop it in its original terminal before building.');
    const { requestStudioLaunch } = await import('../apps/server/dist/studio-launcher.js');
    try { await requestStudioLaunch(process.env.OPENSLATE_DATA_DIR, process.env.OPENSLATE_LOCAL_TOKEN); }
    catch { fail('The running server does not accept this installation credential. Check OPENSLATE_DATA_DIR / OPENSLATE_LOCAL_TOKEN, or stop it in its original terminal. No process was changed.'); }
  }
  if (args.includes('--status')) {
    console.log(existing ? `OpenSlate is running and this installation can connect: ${studioOrigin}\nUse ./start.sh to open it, or ./start.sh --restart to load changed code and settings.` : 'OpenSlate is stopped. Run ./start.sh to start it.');
    process.exit(0);
  }
  if (existing && args.includes('--restart')) {
    const pid = serverPid(root);
    console.log(`Restarting OpenSlate (PID ${pid}). Waiting for graceful shutdown; saved projects and credentials are preserved…`);
    await stopServer(pid);
    if (await inspectServer() !== 'stopped') fail('Port 3001 is still occupied after shutdown. No replacement server was started.');
    existing = false;
  }
  if (existing) {
    console.log(`OpenSlate is already running at ${studioOrigin}. This is a successful reconnect, not a new start.\nTo load changed code, API keys or settings, run: ./start.sh --restart`);
    await run(process.execPath, ['apps/server/dist/studio-cli.js', ...args.filter(arg => arg === '--no-open')]);
    console.log('The existing server continues in its original terminal/process.');
  } else {
    console.log('Installing locked dependencies…');
    await run(pnpm[0], [...pnpm[1], 'install', '--frozen-lockfile']);
    console.log('Building OpenSlate…');
    await run(pnpm[0], [...pnpm[1], 'build']);
    console.log(`Starting the complete studio at ${studioOrigin}. Keep this terminal open; Ctrl+C stops it.`);
    await run(process.execPath, ['apps/server/dist/index.js', '--serve-web', ...args.filter(arg => arg === '--no-open')]);
    console.log('OpenSlate stopped. Saved projects are preserved.');
  }
} catch (error) { if (error.exitCode === 130) { console.log(error.message); process.exitCode = 130; } else fail(error.message); }
