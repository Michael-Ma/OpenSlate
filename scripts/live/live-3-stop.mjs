// Test the single-interrupt shutdown with the browser/SSE still open.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createConnection } from 'node:net';
const folder = 'docs/ai/live-test-20261016c';
const events = readFileSync(`${folder}/events.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
const start = events.filter(e => e.kind === 'owned-studio-start').at(-1);
if (!start || events.some(e => e.kind === 'owned-studio-exit' && e.at > start.at)) throw new Error('No live owned launcher');
const command = execFileSync('ps', ['-p', String(start.pid), '-o', 'command='], { encoding: 'utf8' }).trim();
if (!command.includes('scripts/start-local.mjs --no-open') || !command.includes('--env-file=')) throw new Error('Owned process identity mismatch; no signal sent');
const began = Date.now();
process.kill(start.pid, 'SIGINT'); // exactly one interrupt, to our recorded launcher only
let exited = false;
for (let i = 0; i < 150; i++) {
  try { process.kill(start.pid, 0); } catch { exited = true; break; }
  await new Promise(r => setTimeout(r, 100));
}
const elapsedMs = Date.now() - began;
const portFree = await new Promise(resolve => { const socket = createConnection({ host:'127.0.0.1', port:3001 }); socket.once('connect',()=>{socket.destroy();resolve(false);}); socket.once('error',()=>resolve(true)); });
const result = { at:new Date().toISOString(), pid:start.pid, interrupts:1, browserContextKeptOpen:true, exited, elapsedMs, withinAbout10Seconds:exited && elapsedMs<=10000, portFree };
writeFileSync(`${folder}/shutdown.json`, JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
if (!exited) process.exitCode = 1;
