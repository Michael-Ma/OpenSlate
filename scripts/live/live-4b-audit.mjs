#!/usr/bin/env node
/** LIVE-4b: fixed-root, offline, allowlisted reconciliation. No application imports or provider calls. */
import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dataRoot = '/Users/michael/openslate-live-test-20261016e';
const databasePath = join(dataRoot, 'openslate.sqlite');
const evidenceRoot = join(root, 'docs/ai/live-test-20261016e');
const outputPath = join(evidenceRoot, 'evidence-audit.json');
const categories = ['native_timeout', 'native_spawn_failed', 'native_auth_required', 'native_protocol', 'native_rate_limited', 'native_unknown'];
const reasons = ['invalid_anchor', 'invalid_arguments', 'outside_scope', 'unseen_keyframe', 'missing_keep_choice', 'unavailable', 'unknown'];
const phases = ['submitting', 'preparing', 'remote_pending', 'submission_unknown', 'ingesting', 'succeeded', 'failed'];
const turnStates = ['queued', 'running', 'completed', 'waiting_user', 'interrupted', 'unknown', 'failed'];
const eventKinds = ['director.queued', 'director.claimed', 'director.dispatch_intent', 'director.finished', 'tool.started', 'tool.finished', 'attempt.state_changed'];
let omittedFields = 0;
const safe = (value, predicate) => value == null ? null : predicate(value) ? value : (omittedFields++, null);
const id = value => safe(value, v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(v));
const hash = value => safe(value, v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v));
const code = value => safe(value, v => typeof v === 'string' && /^[A-Z][A-Z0-9_]{0,119}$/.test(v));
const timestamp = value => safe(value, v => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)));
const integer = value => safe(value, v => Number.isSafeInteger(v) && v >= 0);
const choice = (value, values) => safe(value, v => values.includes(v));
const bool = value => value === 1 || value === true;
const elapsed = (start, finish) => start && finish && Date.parse(finish) >= Date.parse(start) ? Date.parse(finish) - Date.parse(start) : null;
const diagnostic = row => {
  const category = choice(row.category, categories);
  const limitMs = category === 'native_timeout' && Number.isSafeInteger(row.limitMs) && row.limitMs > 0 && row.limitMs <= 600000 ? row.limitMs : null;
  return category ? { category, ...(limitMs === null ? {} : { limitMs }) } : null;
};

function requirePlainPath(path, type) {
  if (!existsSync(path)) throw new Error('Required fixed audit path is missing.');
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || realpathSync(path) !== path || !(type === 'directory' ? stat.isDirectory() : stat.isFile())) {
    throw new Error('Audit paths must be canonical, regular and not symbolic links.');
  }
}

function audit(db) {
  // SQL projects individual scalar JSON fields. Never SELECT body, request bodies, native prose or URLs.
  const rows = (kind, fields, where = '', args = []) => db.prepare(`SELECT id, project_id AS projectId, ${Object.entries(fields).map(([alias, path]) => `json_extract(body, '${path}') AS ${alias}`).join(', ')} FROM entities WHERE kind = ? ${where} ORDER BY rowid`).all(kind, ...args);
  const count = (kind, where = '', args = []) => db.prepare(`SELECT count(*) AS n FROM entities WHERE kind = ? ${where}`).get(kind, ...args).n;
  const projectIds = db.prepare('SELECT id FROM projects ORDER BY id').all().map(row => id(row.id));
  const events = db.prepare(`SELECT project_id AS projectId, sequence, json_extract(body,'$.kind') AS kind, json_extract(body,'$.occurredAt') AS at,
    json_extract(body,'$.payload.turnId') AS turnId, json_extract(body,'$.payload.attemptId') AS attemptId,
    json_extract(body,'$.payload.invocationId') AS invocationId, json_extract(body,'$.payload.phase') AS phase
    FROM events WHERE json_extract(body,'$.kind') IN (${eventKinds.map(() => '?').join(',')}) ORDER BY project_id,sequence`).all(...eventKinds)
    .map(row => ({ projectId: id(row.projectId), sequence: integer(row.sequence), kind: choice(row.kind, eventKinds), at: timestamp(row.at), turnId: id(row.turnId), attemptId: id(row.attemptId), invocationId: id(row.invocationId), phase: choice(row.phase, phases) }));
  const firstEvent = (field, identity, kind) => events.find(row => row[field] === identity && row.kind === kind);
  const lastEvent = (field, identity, kind) => events.filter(row => row[field] === identity && row.kind === kind).at(-1);
  const starts = rows('native_model_start', { requestId: '$.requestId', epochId: '$.epochId', reservedAt: '$.reservedAt' })
    .map(row => ({ turnId: id(row.id), projectId: id(row.projectId), requestId: id(row.requestId), epochId: id(row.epochId), reservedAt: timestamp(row.reservedAt) }));
  const reviewRequests = new Set(rows('keyframe_review_request', { requestId: '$.requestId' }).map(row => id(row.requestId)));
  const turns = rows('director_turn', { requestId: '$.requestId', epochId: '$.epochId', state: '$.state', runtime: '$.runtimeId', createdAt: '$.createdAt', updatedAt: '$.updatedAt', dispatched: '$.dispatched', errorCode: '$.errorCode', nativeThread: '$.nativeThreadId', nativeTurn: '$.nativeTurnId' })
    .map(row => {
      const turnId = id(row.id), start = starts.find(item => item.turnId === turnId);
      const dispatchIntentAt = firstEvent('turnId', turnId, 'director.dispatch_intent')?.at ?? null;
      const createdAt = timestamp(row.createdAt), updatedAt = timestamp(row.updatedAt);
      return { turnId, projectId: id(row.projectId), requestId: id(row.requestId), epochId: id(row.epochId), action: reviewRequests.has(row.requestId) ? 'keyframe_review' : 'conversation',
        runtime: choice(row.runtime, ['codex-app-server', 'fake-workflow-v1']), state: choice(row.state, turnStates), errorCode: code(row.errorCode),
        dispatchIntent: bool(row.dispatched), runtimeStartedReservation: !!start, nativeThreadObserved: row.nativeThread != null, nativeTurnObserved: row.nativeTurn != null,
        createdAt, dispatchIntentAt, runtimeReservedAt: start?.reservedAt ?? null, updatedAt,
        queueToDispatchMs: elapsed(createdAt, dispatchIntentAt), dispatchToRuntimeReservedMs: elapsed(dispatchIntentAt, start?.reservedAt), totalTurnMs: elapsed(createdAt, updatedAt) };
    });
  const setupChecks = rows('director_local_check', { status: '$.status', checkedAt: '$.checkedAt', category: '$.nativeDiagnostic.category', limitMs: '$.nativeDiagnostic.limitMs', successfulAt: '$.lastSuccessfulCheck.checkedAt' })
    .map(row => ({ projectId: id(row.projectId), status: choice(row.status, ['ready', 'blocked']), checkedAt: timestamp(row.checkedAt), lastSuccessfulAt: timestamp(row.successfulAt), nativeDiagnostic: diagnostic(row) }));
  const attempts = rows('attempt', { nodeId: '$.nodeId', candidateId: '$.candidateId', ordinal: '$.ordinal', kind: '$.request.kind', adapter: '$.request.execution.adapter', phase: '$.phase', createdAt: '$.createdAt', taskId: '$.taskId', frames: '$.request.args.durationFrames', providerUse: '$.request.providerUse.kind' })
    .map(row => ({ attemptId: id(row.id), projectId: id(row.projectId), nodeId: id(row.nodeId), candidateId: id(row.candidateId), ordinal: integer(row.ordinal), kind: choice(row.kind, ['image', 'video', 'speech', 'transcription', 'render', 'timeline']), adapter: choice(row.adapter, ['codex-image', 'viggle-h3', 'minimax-h3', 'openai-image', 'openai-speech', 'openai-transcription', 'fake']), phase: choice(row.phase, phases), createdAt: timestamp(row.createdAt), hasTaskIdentity: row.taskId != null, durationFrames: integer(row.frames), configuredProviderUse: row.providerUse === 'configured' }));
  const mappings = rows('codex_image_execution_mapping', { attemptId: '$.attemptId' });
  const dispatches = rows('codex_image_execution_dispatch', { attemptId: '$.attemptId', createdAt: '$.createdAt' });
  const runs = rows('codex_image_execution_run', { attemptId: '$.attemptId' });
  const results = rows('codex_image_execution_result', { attemptId: '$.attemptId', outcome: '$.observation.kind', outcomeCode: '$.observation.code', category: '$.observation.nativeDiagnostic.category', limitMs: '$.observation.nativeDiagnostic.limitMs', outputSha256: '$.observation.output.sha256', outputBytes: '$.observation.output.byteLength', width: '$.observation.output.width', height: '$.observation.output.height' });
  const evidence = rows('execution_evidence', { attemptId: '$.attemptId', type: '$.outcome.type', recordedAt: '$.recordedAt' });
  const nodeShots = new Map(rows('node_binding', { shotId: '$.node.shotId' }).map(row => [row.id, id(row.shotId)]));
  const images = attempts.filter(row => row.adapter === 'codex-image').map(attempt => {
    const result = results.find(row => row.attemptId === attempt.attemptId), dispatch = dispatches.find(row => row.attemptId === attempt.attemptId);
    const observations = evidence.filter(row => row.attemptId === attempt.attemptId).map(row => ({ type: choice(row.type, ['accepted', 'unknown', 'rejected', 'completed']), recordedAt: timestamp(row.recordedAt) }));
    const finalAt = events.filter(row => row.attemptId === attempt.attemptId && ['succeeded', 'failed'].includes(row.phase)).at(-1)?.at ?? null;
    const dispatchAt = timestamp(dispatch?.createdAt);
    return { ...attempt, shotId: nodeShots.get(attempt.nodeId) ?? null, admissionRecorded: true,
      preparedMapping: mappings.some(row => row.attemptId === attempt.attemptId), dispatchMarker: !!dispatch, nativeTurnObserved: runs.some(row => row.attemptId === attempt.attemptId),
      result: result ? { outcome: choice(result.outcome, ['not_dispatched', 'failed', 'completed']), code: code(result.outcomeCode), nativeDiagnostic: diagnostic(result), output: result.outcome === 'completed' ? { sha256: hash(result.outputSha256), byteLength: integer(result.outputBytes), width: integer(result.width), height: integer(result.height) } : null } : null,
      dispatchAt, finalAt, admissionToDispatchMs: elapsed(attempt.createdAt, dispatchAt), admissionToFinalMs: elapsed(attempt.createdAt, finalAt), executionObservations: observations };
  });
  const toolRows = rows('tool_invocation', { requestId: '$.requestId', epochId: '$.epochId', state: '$.state', errorCode: '$.error.code', reason: '$.error.reason' }, "AND json_extract(body,'$.tool')='record_notes'");
  const receiptNotes = db.prepare(`SELECT e.id AS invocationId, e.project_id AS projectId, json_extract(e.body,'$.requestId') AS requestId,
    json_extract(n.value,'$.noteId') AS noteId, json_extract(n.value,'$.letter') AS letter FROM entities e,
    json_each(e.body,'$.receipt.notes') n WHERE e.kind='director_notes_receipt' ORDER BY e.rowid,n.key`).all()
    .map(row => ({ invocationId: id(row.invocationId), projectId: id(row.projectId), requestId: id(row.requestId), noteId: id(row.noteId), letter: safe(row.letter, v => typeof v === 'string' && /^[a-z]{1,8}$/.test(v)) }));
  const tools = toolRows.map(row => {
    const invocationId = id(row.id), started = firstEvent('invocationId', invocationId, 'tool.started'), finished = lastEvent('invocationId', invocationId, 'tool.finished');
    return { invocationId, projectId: id(row.projectId), requestId: id(row.requestId), epochId: id(row.epochId), state: choice(row.state, ['started', 'succeeded', 'failed', 'unresolved']),
      error: row.errorCode ? { code: code(row.errorCode), reason: choice(row.reason, reasons) } : null,
      startedAt: started?.at ?? null, finishedAt: finished?.at ?? null, finishedSequence: finished?.sequence ?? null,
      elapsedMs: elapsed(started?.at, finished?.at), savedNotes: receiptNotes.filter(note => note.invocationId === invocationId).map(({ noteId, letter }) => ({ noteId, letter })) };
  });
  for (const tool of tools) tool.correctedBySuccessInSameTurn = tool.state === 'failed'
    ? tools.some(later => later.state === 'succeeded' && later.projectId === tool.projectId && later.epochId === tool.epochId && later.requestId === tool.requestId && later.finishedSequence > tool.finishedSequence) : null;
  const projectionPins = db.prepare(`SELECT e.project_id AS projectId, json_extract(e.body,'$.requestId') AS requestId, json_extract(e.body,'$.epochId') AS epochId,
    json_extract(p.value,'$.shotId') AS shotId, json_extract(p.value,'$.artifactId') AS artifactId, json_extract(p.value,'$.sha256') AS sha256
    FROM entities e, json_each(e.body,'$.images') p WHERE e.kind='request_keyframe_projection' ORDER BY e.rowid,p.key`).all()
    .map(row => ({ projectId: id(row.projectId), requestId: id(row.requestId), epochId: id(row.epochId), shotId: id(row.shotId), artifactId: id(row.artifactId), sha256: hash(row.sha256) }));
  const artifacts = rows('artifact', { artifactId: '$.artifact.artifactId', sha256: '$.artifact.sha256', fixture: '$.fixture' });
  const notes = rows('director_note', { noteId: '$.noteId', requestId: '$.requestId', turnId: '$.turnId', letter: '$.letter', state: '$.state', blocking: '$.blocking', createdAt: '$.createdAt', seenShotId: '$.seenKeyframe.shotId', seenArtifactId: '$.seenKeyframe.artifactId', seenSha256: '$.seenKeyframe.sha256' });
  // Measure text at SQL level; prose is never loaded into this process or output.
  const noteLengths = new Map(db.prepare("SELECT id, length(json_extract(body,'$.text')) AS length FROM entities WHERE kind='director_note'").all().map(row => [row.id, integer(row.length)]));
  const noteSummaries = notes.map(row => {
    const seen = row.seenShotId ? { shotId: id(row.seenShotId), artifactId: id(row.seenArtifactId), sha256: hash(row.seenSha256) } : null;
    const turn = turns.find(item => item.turnId === row.turnId);
    return { noteId: id(row.noteId), projectId: id(row.projectId), requestId: id(row.requestId), turnId: id(row.turnId), letter: safe(row.letter, v => typeof v === 'string' && /^[a-z]{1,8}$/.test(v)), persistedState: choice(row.state, ['open', 'resolved', 'stale']), blocking: bool(row.blocking), createdAt: timestamp(row.createdAt), textLength: noteLengths.get(row.id) ?? null, seenKeyframe: seen,
      applicationReceiptMatches: receiptNotes.some(receipt => receipt.projectId === row.projectId && receipt.requestId === row.requestId && receipt.noteId === row.noteId && receipt.letter === row.letter),
      projectionReceiptMatches: seen ? projectionPins.some(pin => pin.projectId === row.projectId && pin.requestId === row.requestId && pin.epochId === turn?.epochId && pin.shotId === seen.shotId && pin.artifactId === seen.artifactId && pin.sha256 === seen.sha256) : null,
      realArtifactIdentityMatches: seen ? artifacts.some(artifact => artifact.projectId === row.projectId && artifact.artifactId === seen.artifactId && artifact.sha256 === seen.sha256 && artifact.fixture === 0) : null };
  });
  const videoAttempts = attempts.filter(row => row.kind === 'video');
  const viggleKinds = ['viggle_h3_execution_mapping', 'viggle_h3_execution_dispatch', 'viggle_h3_execution_submit', 'viggle_h3_execution_observation', 'viggle_h3_poll_schedule'];
  const zeroVideoCounts = {
    videoConfirmations: count('scene_confirmation', "AND json_extract(body,'$.kind')='video'"),
    videoGenerationActions: count('scene_generation_action', "AND json_extract(body,'$.kind')='video'"),
    videoAttempts: videoAttempts.length, viggleAttempts: attempts.filter(row => row.adapter === 'viggle-h3').length,
    videoVendorTaskIdentities: videoAttempts.filter(row => row.hasTaskIdentity).length,
    videoUnknownOutcomes: videoAttempts.filter(row => row.phase === 'submission_unknown').length,
    videoUnresolvedAttempts: videoAttempts.filter(row => !['succeeded', 'failed'].includes(row.phase)).length,
    videoUnknownEvidence: evidence.filter(row => videoAttempts.some(attempt => attempt.attemptId === row.attemptId) && row.type === 'unknown').length,
    approvals: count('approval'), durableReviewSnapshots: count('review_snapshot'),
    sceneConfirmCommandReceipts: db.prepare("SELECT count(*) AS n FROM commands WHERE actor_scope LIKE '%:scene-confirm'").get().n,
    ...Object.fromEntries(viggleKinds.map(kind => [kind, count(kind)])),
  };
  const zeroVideoVerified = Object.values(zeroVideoCounts).every(value => value === 0);
  return {
    checkedAt: new Date().toISOString(), sourceDatabase: databasePath, schemaVersion: db.pragma('user_version', { simple: true }), projectIds,
    director: { turns, nativeRuntimeStartReservations: starts, counts: { turns: turns.length, dispatchIntents: turns.filter(turn => turn.dispatchIntent).length, runtimeStartReservations: starts.length, observedNativeTurns: turns.filter(turn => turn.nativeTurnObserved).length },
      perProject: projectIds.map(projectId => ({ projectId, modelCallsAsComputedBySetup: starts.filter(start => start.projectId === projectId).length, nativeTurnIdentitiesObserved: turns.filter(turn => turn.projectId === projectId && turn.nativeTurnObserved).length })),
      orphanStartReservations: starts.filter(start => !turns.some(turn => turn.turnId === start.turnId && turn.projectId === start.projectId && turn.requestId === start.requestId && turn.epochId === start.epochId)).length },
    setupChecks,
    codexImages: { attempts: images, counts: { admitted: images.length, preparedMappings: mappings.length, dispatchMarkers: dispatches.length, observedNativeTurns: runs.length, results: results.length, notDispatched: results.filter(row => row.outcome === 'not_dispatched').length, failedNativeTurns: results.filter(row => row.outcome === 'failed').length, completed: results.filter(row => row.outcome === 'completed').length, unknownAttempts: images.filter(row => row.phase === 'submission_unknown').length } },
    recordNotes: { invocations: tools, counts: { succeeded: tools.filter(tool => tool.state === 'succeeded').length, refused: tools.filter(tool => tool.state === 'failed').length, uncertain: tools.filter(tool => ['started', 'unresolved'].includes(tool.state)).length, correctedInSameTurn: tools.filter(tool => tool.correctedBySuccessInSameTurn).length }, receiptNotes },
    notes: noteSummaries, keyframeProjectionPins: projectionPins,
    zeroVideo: { verified: zeroVideoVerified, counts: zeroVideoCounts, submittedSeconds: zeroVideoVerified ? 0 : null, estimatedCostUsd: zeroVideoVerified ? '0.00' : null },
    omittedNonAllowlistedScalarFields: omittedFields,
    limitations: [
      'This reads only the fixed fresh LIVE-4b application SQLite database in one read transaction; it never contacts providers, reconciles work, changes studio state, or reads media/native logs.',
      'native_model_start is the persisted runtime_started reservation and is exactly what public setup.modelCalls counts. It is not a billing counter or proof that a model turn began; nativeTurnObserved separately records the persisted native turn identity without exposing that identity.',
      'Setup records retain completed checkedAt but no start timestamp. Director native turn-start time and Codex result-record time are not independently persisted. Attempt final timings use application terminal events; execution observation times are retained separately.',
      'The stored note state is reported; public reads can additionally derive staleness. Note prose and choices are excluded. Receipt/hash matches establish attached-image identity, not image understanding or rendered UI; use screenshots and review text for those checks.',
      'A zero tally is asserted only when every listed video/confirmation/submission evidence count is zero. Provider billing and any activity outside this fresh database are not inspected.',
    ],
  };
}

function main() {
  if (process.argv.length === 3 && process.argv[2] === '--help') {
    console.log('Usage: node scripts/live/live-4b-audit.mjs\nReads ONLY /Users/michael/openslate-live-test-20261016e/openslate.sqlite (readonly, WAL-aware). Writes docs/ai/live-test-20261016e/evidence-audit.json. No network, browser or provider action. --help does not touch data.');
    return;
  }
  if (process.argv.length !== 2) throw new Error('Only --help is accepted; the audit data root cannot be overridden.');
  requirePlainPath(dataRoot, 'directory');
  requirePlainPath(databasePath, 'file');
  for (const suffix of ['-wal', '-shm']) if (existsSync(databasePath + suffix)) requirePlainPath(databasePath + suffix, 'file');
  const require = createRequire(join(root, 'apps/server/package.json'));
  const Database = require('better-sqlite3');
  const db = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5000 });
  let summary;
  try {
    db.pragma('query_only = ON');
    summary = db.transaction(() => audit(db))();
  } finally { db.close(); }
  mkdirSync(evidenceRoot, { recursive: true });
  requirePlainPath(evidenceRoot, 'directory');
  if (existsSync(outputPath)) requirePlainPath(outputPath, 'file');
  writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  console.log(`LIVE-4b audit wrote docs/ai/live-test-20261016e/evidence-audit.json. Director runtime reservations: ${summary.director.counts.runtimeStartReservations}; Codex image admissions: ${summary.codexImages.counts.admitted}; zero video evidence: ${summary.zeroVideo.verified}.`);
  if (!summary.zeroVideo.verified || summary.director.orphanStartReservations || summary.omittedNonAllowlistedScalarFields) process.exitCode = 1;
}

try { main(); }
catch {
  // Never print SQLite/JSON/native exception text: it can contain data or private paths.
  console.error('LIVE-4b audit failed safely; no raw database fields or exception text shown. Check fixed paths, compatible Node/dependencies and database availability.');
  process.exitCode = 2;
}
