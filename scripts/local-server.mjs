import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

export const studioOrigin = 'http://127.0.0.1:3001';
export async function inspectServer(origin = studioOrigin) {
  try {
    const response = await fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(2000), redirect: 'error' });
    const body = await response.json();
    if (!response.ok || body.name !== 'OpenSlate' || body.status !== 'ok') return 'occupied';
    return 'ready';
  } catch {
    // A timeout, invalid JSON or non-HTTP listener is not a free port.
    const url = new URL(origin);
    return new Promise(resolve => {
      const socket = createConnection({ host: url.hostname, port: Number(url.port) });
      const finish = state => { socket.destroy(); resolve(state); };
      socket.setTimeout(1500, () => finish('occupied'));
      socket.once('connect', () => finish('occupied'));
      socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? 'stopped' : 'occupied'));
    });
  }
}

export function matchesServer(command, cwd, root) {
  // Only the production Node entrypoint in this checkout; never kill a port owner blindly.
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return cwd === root && new RegExp(`^(?:[^\\s]+/)?node (?:${escaped}/)?apps/server/dist/index\\.js(?: --serve-web)?(?: --no-open)?$`).test(command.trim());
}
export function serverPid(root) {
  const run = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 });
    if (result.error || result.status !== 0) throw new Error('Cannot verify the existing server process. Stop it in its original terminal, then run ./start.sh.');
    return result.stdout.trim();
  };
  const lsof = process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof';
  const pids = [...new Set(run(lsof, ['-nP', '-iTCP:3001', '-sTCP:LISTEN', '-t']).split(/\s+/))];
  if (pids.length !== 1 || !/^[1-9]\d*$/.test(pids[0])) throw new Error('Port 3001 does not have one identifiable server owner. Stop that listener manually.');
  const pid = Number(pids[0]);
  const cwd = run(lsof, ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find(line => line.startsWith('n'))?.slice(1);
  const command = run('ps', ['-p', String(pid), '-o', 'command=']);
  if (!cwd || !matchesServer(command, realpathSync(cwd), realpathSync(root))) throw new Error('The listener is not the production server from this checkout. Stop it in its original terminal; no process was changed.');
  return pid;
}

export async function stopServer(pid, { signal = process.kill.bind(process), sleep = delay, tries = 150 } = {}) {
  signal(pid, 'SIGTERM');
  for (let index = 0; index < tries; index++) {
    try { signal(pid, 0); } catch (error) { if (error.code === 'ESRCH') return; throw error; }
    await sleep(200);
  }
  throw new Error('The server is still shutting down after 30 seconds. No force-kill was sent. Wait for it to finish, then run ./start.sh again.');
}
