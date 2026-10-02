import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { inspectServer, serverPid, stopServer, studioOrigin } from './local-server.mjs';
import { inspectSetup, formatSetup } from './setup-readiness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: ./start.sh [--check | --doctor | --status | --restart | --init-config] [--no-open] [--json]\nLoads .env.live.local, installs locked dependencies, builds and runs the local studio.\n--check / --doctor reports all local setup issues without installation, build, server or API calls. Add --json for a redacted machine-readable report.\n--init-config creates a private .env.live.local template only when missing; never overwrites an existing file.\n--status checks the local server and this installation credential, without starting anything.\n--restart gracefully stops the verified server for this checkout, rebuilds and starts it with current configuration.\nDefault: start if stopped, or reopen an existing studio without changing it.');
  process.exit(0);
}
if (args.some(arg => !['--check', '--doctor', '--json', '--no-open', '--status', '--restart', '--init-config'].includes(arg))) {
  console.error('Unknown option. Use ./start.sh --help.'); process.exit(1);
}
if (args.filter(arg => ['--check', '--doctor', '--status', '--restart', '--init-config'].includes(arg)).length > 1) { console.error('Choose one startup action. Use ./start.sh --help.'); process.exit(1); }
if (args.includes('--json') && !args.some(arg => ['--check', '--doctor'].includes(arg))) { console.error('--json requires --check or --doctor.'); process.exit(1); }
const fail = message => { console.error(`OpenSlate: ${message}`); process.exit(1); };
if (process.versions.node.split('.')[0] !== '24') fail('Node 24 is required. Run ./start.sh.');
if (args.includes('--init-config')) {
  if (existsSync('.env.live.local')) console.log('Existing .env.live.local preserved. Edit it locally, then run ./start.sh --check.');
  else {
    writeFileSync('.env.live.local', readFileSync('.env.example'), { flag: 'wx', mode: 0o600 });
    console.log('Created private .env.live.local. Add only the providers you want, then run ./start.sh --check. No provider, server or installation action was performed.');
  }
  process.exit(0);
}
if (existsSync('.env.live.local')) { try { loadEnvFile('.env.live.local'); } catch { fail('Could not read .env.live.local. Check its permissions and syntax.'); } }
else if (!args.includes('--json')) console.log('No .env.live.local found; using shell configuration or demo defaults. Use ./start.sh --init-config to create a private template.');
process.env.OPENSLATE_DATA_DIR = resolve(process.env.OPENSLATE_DATA_DIR ?? '.openslate');
let pnpm;
if (!args.includes('--status')) {
  const report = inspectSetup({ root });
  const checking = args.some(arg => ['--check', '--doctor'].includes(arg));
  if (checking) { console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : formatSetup(report)); process.exit(report.ready ? 0 : 1); }
  if (!report.ready) fail(`${formatSetup(report)}\nFix the reported settings, then retry. For a redacted report run ./start.sh --doctor --json.`);
  for (const tool of ['ffmpeg', 'ffprobe']) if (report.tools[tool]) process.env[`OPENSLATE_${tool.toUpperCase()}`] = report.tools[tool];
  pnpm = report.checks.find(check => check.id === 'pnpm').state === 'ready' ? ['pnpm', []] : ['npx', ['--yes', `pnpm@${report.packageManager}`]];
  console.log(`Prerequisites ready. Node ${process.versions.node}; pnpm ${report.packageManager}. Provider settings preserved.`);
  for (const check of report.checks.filter(item => item.state === 'warning')) console.log(`${check.label}: ${check.detail}`);
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
