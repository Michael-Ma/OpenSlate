// Small loopback client. Provider waits use public studio state and never record an idle browser.
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const command = async input => {
  const r = await fetch('http://127.0.0.1:3198/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const v = await r.json(); if (!v.ok) throw new Error(v.error); return v.result;
};
if (process.argv[2] === 'wait') {
  await command({ op: 'endPhase' });
  const kind = process.argv[3]; const seconds = Math.min(Number(process.argv[4] ?? 55), 55);
  const deadline = Date.now() + seconds * 1000; let d, done = false, previous;
  do {
    d = await command({ op: 'diagnostic' });
    const slots = Object.values(d.generation.shots).map(s => s[kind]);
    const states = { at: d.at, kind, director: { status: d.director.status, state: d.director.turn?.state, requestId: d.director.turn?.requestId },
      shots: Object.values(d.generation.shots).map(s => ({ id: s.shotId, keyframe: s.keyframe.state, video: s.video.state })), attempts: d.attempts };
    const signature = JSON.stringify({ ...states, at: undefined });
    if (signature !== previous) appendFileSync(resolve('docs/ai/live-test-20261016e/state-changes.jsonl'), JSON.stringify(states) + '\n');
    previous = signature;
    done = kind === 'director' ? d.director.status !== 'running' && !['queued', 'running', 'starting'].includes(d.director.turn?.state) && d.generation.director.state !== 'working'
      : slots.length > 0 && slots.every(s => !['running', 'queued'].includes(s?.state));
    if (done) break;
    await new Promise(r => setTimeout(r, 1500));
  } while (Date.now() < deadline);
  if (process.argv[5]) writeFileSync(resolve('docs/ai/live-test-20261016e', process.argv[5]), JSON.stringify(d, null, 2) + '\n');
  console.log(JSON.stringify({ done, projectId: d.project.id, director: d.director, turns: d.turns, attempts: d.attempts, shots: Object.values(d.generation.shots).map(s => ({ id: s.shotId, keyframe: s.keyframe, video: s.video })) }, null, 2));
} else {
  for (const arg of process.argv.slice(2)) {
    const input = JSON.parse(arg); const result = await command(input);
    if (input.op === "geometry" && input.name) writeFileSync(resolve("docs/ai/live-test-20261016e", input.name), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(input.op === 'diagnostic' ? {
      saved: input.name, projectId: result.project.id, head: result.project.headVersion,
      attempts: result.attempts, director: result.director.status,
      scenes: result.generation.scenes, shots: Object.values(result.generation.shots).map(s => ({ id: s.shotId, keyframe: s.keyframe, video: s.video })),
    } : result, null, 2));
  }
}
