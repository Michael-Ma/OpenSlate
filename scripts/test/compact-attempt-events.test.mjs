import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCompaction, planCompaction } from '../compact-attempt-events.mjs';
import { Store } from '../../apps/server/dist/persistence/store.js';
import { acquireInstallationOwner } from '../../apps/server/dist/persistence/installation-owner.js';
import { verifySchema } from '../../apps/server/dist/persistence/schema.js';
import { projectFixture } from '../../apps/server/test/execution-fixture.mjs';

const script = fileURLToPath(new URL('../compact-attempt-events.mjs', import.meta.url));
const Database = createRequire(resolve(script, '../../apps/server/package.json'))('better-sqlite3');
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Real schema via Store; the event shapes match what the pre-fix Engine appended. */
function installation(t) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'openslate-compact-'))), dir = join(parent, 'data'); mkdirSync(dir);
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const store = new Store(join(dir, 'openslate.sqlite')), project = projectFixture(randomUUID(), 1); store.createProject(project);
  const lost = randomUUID(), polling = randomUUID(), moving = randomUUID(), p = project.id;
  const changed = (attemptId, phase, extra = {}) => store.appendEvent(p, 'attempt.state_changed', { attemptId, phase, ...extra }).sequence;
  const seq = { lostFirst: changed(lost, 'submitting', { nodeId: 'n1' }) };
  seq.unknownFirst = changed(lost, 'submission_unknown');
  changed(polling, 'submitting', { nodeId: 'n2' }); seq.pollingFirst = changed(polling, 'remote_pending');
  let referenced;
  for (let i = 0; i < 2000; i++) {
    const s = changed(lost, 'submission_unknown'); if (i === 700) referenced = s;
    if (i % 10 === 0) changed(polling, 'remote_pending');
    if (i % 400 === 0) { changed(moving, 'remote_pending'); changed(moving, 'ingesting'); }
    if (i % 250 === 0) store.appendEvent(p, 'hold.changed', { holdId: 'h1', active: i % 500 === 0 });
  }
  store.insert('director_turn_receipt', randomUUID(), p, { requestedAtCursor: referenced, nested: { history: [{ attachmentCursor: seq.unknownFirst }] } });
  seq.runOneLast = changed(lost, 'submission_unknown');
  seq.released = store.appendEvent(p, 'attempt.released', { attemptId: lost, by: 'human', at: '2026-10-27T00:00:00.000Z', acknowledgeDoubleCharge: true }).sequence;
  seq.runTwoFirst = changed(lost, 'submission_unknown');
  for (let i = 0; i < 499; i++) changed(lost, 'submission_unknown');
  seq.final = changed(lost, 'submission_unknown');
  store.close();
  // Run one: 2002 identical unknown events keep both ends and the referenced one -> 1999 interior.
  // Run two after release: 501 -> 499 interior. Polling: 201 identical -> 199 interior. `moving` alternates.
  return { dir, path: join(dir, 'openslate.sqlite'), project: p, lost, polling, referenced, seq, expected: 1999 + 499 + 199 };
}
const events = (path, where = '1=1', ...args) => {
  const db = new Database(path, { readonly: true });
  try { return db.prepare(`SELECT sequence, body FROM events WHERE ${where} ORDER BY sequence`).all(...args).map(row => ({ sequence: row.sequence, ...JSON.parse(row.body) })); }
  finally { db.close(); }
};

test('dry run plans only interior identical attempt events and changes nothing', async t => {
  const f = installation(t), before = sha(f.path);
  const output = execFileSync(process.execPath, [script, '--data-dir', f.dir], { encoding: 'utf8' });
  assert.match(output, new RegExp(`${f.expected} interior duplicates`)); assert.match(output, /1 kept because a saved record references them/);
  assert.equal(sha(f.path), before);
  const db = new Database(f.path, { readonly: true }); t.after(() => db.close());
  const plan = planCompaction(db), planned = new Set(plan.deletions.map(item => item.sequence));
  assert.equal(plan.deletions.length, f.expected); assert.equal(plan.largest[0].attemptId, f.lost);
  for (const sequence of Object.values(f.seq)) assert.equal(planned.has(sequence), false);
  assert.equal(planned.has(f.referenced), false);
});

test('apply backs up, removes interior duplicates and preserves cursors, references and run ends', async t => {
  const f = installation(t), all = events(f.path), cursorBefore = new Database(f.path, { readonly: true });
  const { event_sequence: cursor } = cursorBefore.prepare('SELECT event_sequence FROM projects WHERE id=?').get(f.project); cursorBefore.close();
  const result = await applyCompaction(f.dir, { now: new Date('2026-10-27T12:00:00.000Z') });
  assert.equal(result.deleted, f.expected); assert.ok(existsSync(result.backup)); assert.ok(!result.backup.startsWith(f.dir + '/'), 'backup stays outside the data directory');
  assert.equal(events(result.backup).length, all.length, 'backup is the untouched original');
  const after = events(f.path), kept = new Set(after.map(event => event.sequence));
  assert.equal(after.length, all.length - f.expected);
  for (const sequence of [...Object.values(f.seq), f.referenced]) assert.ok(kept.has(sequence), `sequence ${sequence} survives`);
  assert.deepEqual(after.filter(event => event.kind !== 'attempt.state_changed'), all.filter(event => event.kind !== 'attempt.state_changed'));
  assert.deepEqual(after.filter(event => event.payload.attemptId === f.lost).map(event => event.kind + ':' + (event.payload.phase ?? '')),
    ['attempt.state_changed:submitting', 'attempt.state_changed:submission_unknown', 'attempt.state_changed:submission_unknown',
      'attempt.state_changed:submission_unknown', 'attempt.released:', 'attempt.state_changed:submission_unknown', 'attempt.state_changed:submission_unknown']);
  const store = new Store(f.path); t.after(() => store.close());
  assert.equal(store.cursor(f.project), cursor); assert.equal(store.readEvents(f.project).at(-1).sequence, f.seq.final);
  verifySchema(store.db, { integrity: true });
  assert.equal((await applyCompaction(f.dir, { backupPath: join(f.dir, '..', 'second.sqlite') })).deleted, 0, 'compaction is idempotent');
});

test('apply refuses while a server owns the installation and leaves the database untouched', async t => {
  const f = installation(t), before = sha(f.path), owner = acquireInstallationOwner(f.dir);
  try { await assert.rejects(applyCompaction(f.dir), { code: 'INSTALLATION_IN_USE' }); }
  finally { owner.close(); }
  assert.equal(sha(f.path), before);
});
