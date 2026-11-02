// One-off maintenance: remove replayed duplicate `attempt.state_changed` events.
//
// Before the unknown-outcome fix, reconciliation appended an identical
// state_changed event on every observation. For each attempt, a run of
// consecutive identical state_changed events (no other event for that attempt in
// between) carries no more information than its first and last entries. This
// keeps both ends of every run, never deletes a sequence any saved record
// points at, never renumbers, and leaves projects.event_sequence unchanged.
//
//   node scripts/compact-attempt-events.mjs --data-dir <dir>            # dry run
//   node scripts/compact-attempt-events.mjs --data-dir <dir> --apply    # backup, delete, VACUUM
//
// --apply takes the application's installation lock, so it refuses to run while
// a server owns the directory. Live clients resync once across the gaps.
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "apps/server");
const Database = createRequire(join(server, "package.json"))("better-sqlite3");
const KIND = "attempt.state_changed";
const REFERENCE_KEY = /cursor|sequence/i;

/** Every integer saved under a cursor/sequence-like key anywhere in project state. */
function referencedSequences(db) {
  const found = new Set();
  const walk = value => {
    if (Array.isArray(value)) { for (const item of value) walk(item); return; }
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      if (REFERENCE_KEY.test(key) && Number.isSafeInteger(item)) found.add(item);
      else walk(item);
    }
  };
  for (const sql of ["SELECT body AS json FROM entities", "SELECT body AS json FROM projects", "SELECT result AS json FROM commands"])
    for (const row of db.prepare(sql).iterate()) walk(JSON.parse(row.json));
  return found;
}

/** Pure read: which (project, sequence) rows are interior duplicates. */
export function planCompaction(db) {
  const protectedSequences = referencedSequences(db);
  const runs = new Map(), deletions = [], perAttempt = new Map();
  let total = 0, kept = 0;
  for (const row of db.prepare("SELECT project_id, sequence, body FROM events ORDER BY project_id, sequence").iterate()) {
    total++;
    const event = JSON.parse(row.body), attemptId = event.payload?.attemptId;
    if (typeof attemptId !== "string") continue;
    const key = `${row.project_id}\u0000${attemptId}`, previous = runs.get(key);
    const payload = event.kind === KIND ? JSON.stringify(event.payload) : null;
    if (payload !== null && previous?.payload === payload) {
      // The previous run end becomes interior; the current event is the new end.
      if (previous.last !== previous.first) {
        if (protectedSequences.has(previous.last)) kept++;
        else { deletions.push({ projectId: row.project_id, sequence: previous.last }); perAttempt.set(attemptId, (perAttempt.get(attemptId) ?? 0) + 1); }
      }
      previous.last = row.sequence;
    } else runs.set(key, { payload, first: row.sequence, last: row.sequence });
  }
  const largest = [...perAttempt].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([attemptId, count]) => ({ attemptId, count }));
  return { totalEvents: total, deletions, protectedKept: kept, largest };
}

function projectBounds(db) {
  return db.prepare(`SELECT p.id, p.event_sequence AS cursor, (SELECT max(sequence) FROM events e WHERE e.project_id=p.id) AS latest,
    (SELECT max(sequence) FROM events e WHERE e.project_id=p.id AND json_extract(e.body,'$.kind') NOT IN ('tool.started','tool.finished','director.context_captured')) AS domain
    FROM projects p ORDER BY p.id`).all();
}

/** Lock, back up, delete and verify. Throws before committing if any invariant moves. */
export async function applyCompaction(dataDir, { backupPath, now = new Date() } = {}) {
  const { acquireInstallationOwner } = await import(pathToFileURL(join(server, "dist/persistence/installation-owner.js")).href);
  const { verifySchema } = await import(pathToFileURL(join(server, "dist/persistence/schema.js")).href);
  const directory = resolve(dataDir), path = join(directory, "openslate.sqlite");
  if (!existsSync(path)) throw new Error(`No OpenSlate database at ${path}`);
  const owner = acquireInstallationOwner(directory);
  try {
    const db = new Database(path, { timeout: 0 });
    try {
      db.pragma("foreign_keys = ON"); db.pragma("synchronous = FULL");
      verifySchema(db, { integrity: true });
      db.pragma("wal_checkpoint(TRUNCATE)");
      const beforeBytes = statSync(path).size;
      const backup = backupPath ?? join(dirname(directory), `${basename(directory)}.event-compaction-backup-${now.toISOString().replace(/[:.]/g, "-")}.sqlite`);
      if (existsSync(backup)) throw new Error(`Backup target already exists: ${backup}`);
      db.prepare("VACUUM INTO ?").run(backup);
      const before = projectBounds(db), protectedSequences = referencedSequences(db);
      const plan = planCompaction(db);
      const remove = db.prepare("DELETE FROM events WHERE project_id=? AND sequence=? AND json_extract(body,'$.kind')=?");
      db.transaction(() => {
        let deleted = 0;
        for (const item of plan.deletions) {
          if (protectedSequences.has(item.sequence)) throw new Error(`Referenced sequence ${item.sequence} was planned for deletion`);
          deleted += remove.run(item.projectId, item.sequence, KIND).changes;
        }
        if (deleted !== plan.deletions.length) throw new Error(`Deleted ${deleted} rows, planned ${plan.deletions.length}`);
        if (JSON.stringify(projectBounds(db)) !== JSON.stringify(before)) throw new Error("Project cursors or latest event sequences changed; rolled back");
      })();
      db.exec("VACUUM");
      db.pragma("wal_checkpoint(TRUNCATE)");
      verifySchema(db, { integrity: true });
      return { ...plan, deleted: plan.deletions.length, backup, beforeBytes, afterBytes: statSync(path).size };
    } finally { db.close(); }
  } finally { owner.close(); }
}

function report(plan, mode) {
  const lines = [`${mode}: ${plan.totalEvents} events, ${plan.deletions.length} interior duplicates to remove` +
    `${plan.protectedKept ? `, ${plan.protectedKept} kept because a saved record references them` : ""}`];
  for (const { attemptId, count } of plan.largest) lines.push(`  ${attemptId}  ${count}`);
  return lines.join("\n");
}

async function main(argv) {
  const at = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined; };
  const dataDir = at("--data-dir"), apply = argv.includes("--apply");
  if (!dataDir || argv.includes("--help")) {
    console.log("Usage: node scripts/compact-attempt-events.mjs --data-dir <dir> [--apply] [--backup <file>]"); process.exitCode = dataDir ? 0 : 1; return;
  }
  if (!apply) {
    const path = join(resolve(dataDir), "openslate.sqlite");
    if (!existsSync(path)) throw new Error(`No OpenSlate database at ${path}`);
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try { console.log(report(planCompaction(db), "Dry run")); console.log("Nothing was changed. Stop the server and add --apply to compact."); }
    finally { db.close(); }
    return;
  }
  const result = await applyCompaction(dataDir, { backupPath: at("--backup") });
  console.log(report(result, "Applied"));
  console.log(`Backup: ${result.backup}`);
  console.log(`Database: ${(result.beforeBytes / 1e6).toFixed(1)} MB -> ${(result.afterBytes / 1e6).toFixed(1)} MB`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
