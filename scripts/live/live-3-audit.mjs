#!/usr/bin/env node
/** Offline LIVE-3 evidence reconciliation. Never contacts the studio or a provider. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = join(root, 'docs/ai/live-test-20261016c');
const beforeName = 'diagnostic-before-restart.json';
const afterName = 'diagnostic-after-restart.json';
const finalName = 'diagnostic-final.json';
const setupBeforeName = 'setup-before-restart.json';
const setupAfterName = 'setup-after-restart.json';
const remainingCapSeconds = 88;
const ratePerSecond = 0.01;
const terminal = new Set(['succeeded', 'failed']);
const round = value => Math.round(value * 1e6) / 1e6;
const load = name => JSON.parse(readFileSync(join(evidence, name), 'utf8'));
const same = (a, b) => a !== undefined && b !== undefined && isDeepStrictEqual(a, b);
const ordered = values => [...values].sort((a, b) => String(a.id).localeCompare(String(b.id)));
const integer = value => Number.isInteger(value) && value >= 0;
const slots = value => Object.fromEntries(Object.entries(value.generation.shots).map(([id, shot]) => [id, {
  shotId: shot.shotId, sceneId: shot.sceneId, durationFrames: shot.durationFrames,
  keyframe: shot.keyframe, video: shot.video, narration: shot.narration,
}]));
const exportIdentities = value => ({ current: value.exports.current, history: value.exports.history });
const ids = value => value.attempts.map(attempt => attempt.id).sort();
const countModels = value => value.setup?.modelCalls;

function validateDiagnostic(value, name) {
  const invalid = [];
  if (!value?.project?.id) invalid.push('project.id');
  if (!value?.plan?.id || !Array.isArray(value.plan.nodes)) invalid.push('plan.id/nodes');
  if (!Array.isArray(value?.attempts)) invalid.push('attempts');
  if (!value?.generation?.shots || !Number.isFinite(value.generation.fps) || value.generation.fps <= 0) invalid.push('generation.shots/fps');
  if (!value?.exports?.current?.exportId || !Array.isArray(value.exports.history)) invalid.push('exports.current/history');
  if (!integer(countModels(value))) invalid.push('setup.modelCalls');
  if (invalid.length) throw new Error(`${name} lacks required evidence fields: ${invalid.join(', ')}`);
}

function main() {
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/live/live-3-audit.mjs\nReads only docs/ai/live-test-20261016c/ offline diagnostic and takes evidence. Writes verification.json and paid-tally.json. No studio/provider actions. Missing inputs exit 2 without writing outputs.');
    return;
  }
  if (process.argv.length > 2) throw new Error('No arguments are accepted; use --help.');
  const names = existsSync(evidence) ? readdirSync(evidence) : [];
  const required = [beforeName, afterName, 'takes-1-before-restart.json', 'takes-1-after-restart.json', 'takes-2-before-restart.json', 'takes-2-after-restart.json'];
  const missing = required.filter(name => !names.includes(name));
  if (missing.length) {
    console.error(`LIVE-3 audit waiting for evidence: ${missing.join(', ')}. No outputs written.`);
    process.exitCode = 2;
    return;
  }
  const before = load(beforeName), after = load(afterName);
  const final = names.includes(finalName) ? load(finalName) : null;
  validateDiagnostic(before, beforeName); validateDiagnostic(after, afterName);
  if (final) validateDiagnostic(final, finalName);
  const setupBefore = names.includes(setupBeforeName) ? load(setupBeforeName) : before.setup;
  const setupAfter = names.includes(setupAfterName) ? load(setupAfterName) : after.setup;
  const checkEvidenceAvailable = names.includes(setupBeforeName) || names.includes(setupAfterName)
    || Object.hasOwn(before.setup, 'lastSuccessfulCheck') || Object.hasOwn(after.setup, 'lastSuccessfulCheck');
  const savedCheckBefore = setupBefore?.lastSuccessfulCheck;
  const savedCheckAfter = setupAfter?.lastSuccessfulCheck;
  const latest = final ?? after;
  const takeNumbers = [...new Set(names.map(name => /^takes-(\d+)-(?:before|after)-restart\.json$/.exec(name)?.[1]).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
  const takes = takeNumbers.map(number => {
    const left = `takes-${number}-before-restart.json`, right = `takes-${number}-after-restart.json`;
    return { number: Number(number), before: left, after: right, complete: names.includes(left) && names.includes(right),
      preserved: names.includes(left) && names.includes(right) && same(load(left), load(right)) };
  });
  const nodes = new Map(latest.plan.nodes.map(node => [node.id, node]));
  const videos = ordered(latest.attempts.filter(attempt => attempt.kind === 'video'));
  const videoRows = videos.map(attempt => {
    const shotId = nodes.get(attempt.nodeId)?.shotId ?? null;
    const frames = attempt.durationFrames;
    const seconds = Number.isFinite(frames) && frames > 0 ? round(frames / latest.generation.fps) : null;
    return {
      shotId, shot: latest.generation.shots[shotId]?.label ?? null, attemptId: attempt.id,
      ordinal: attempt.ordinal, seconds, durationFrames: frames ?? null,
      vendorJobId: attempt.taskId ?? null, outcome: attempt.phase,
      estimatedCostAtCardRate: seconds === null ? null : round(seconds * ratePerSecond),
      submissionEvidence: attempt.taskId ? 'persisted vendor job ID' : 'no vendor job ID; conservatively reserved, reconcile before another submission',
    };
  });
  const known = videoRows.filter(row => row.vendorJobId);
  const uncertain = videoRows.filter(row => !row.vendorJobId || !terminal.has(row.outcome));
  const initial = videoRows.filter(row => row.ordinal === 1);
  const byShot = new Map();
  for (const row of videoRows) byShot.set(row.shotId, [...(byShot.get(row.shotId) ?? []), row]);
  const durationEvidenceComplete = videoRows.every(row => row.shotId && row.seconds !== null && integer(row.ordinal) && row.ordinal >= 1);
  const conservativeSeconds = durationEvidenceComplete ? round(videoRows.reduce((sum, row) => sum + row.seconds, 0)) : null;
  const totalSubmittedSeconds = known.every(row => row.seconds !== null) ? round(known.reduce((sum, row) => sum + row.seconds, 0)) : null;
  const perShot = [...byShot].map(([shotId, attempts]) => ({ shotId, attempts: attempts.length, paidRetries: Math.max(0, attempts.length - 1) }));
  const capChecks = {
    durationEvidenceComplete,
    withinRemaining88Seconds: conservativeSeconds !== null && conservativeSeconds <= remainingCapSeconds,
    initialSubmissionsAtMostTwo: initial.length <= 2,
    atMostOneRetryPerShot: perShot.every(shot => shot.paidRetries <= 1),
    noDuplicateVendorJobIds: new Set(known.map(row => row.vendorJobId)).size === known.length,
    noUnresolvedOutcomes: uncertain.length === 0,
  };
  const tally = {
    checkedAt: new Date().toISOString(), source: final ? finalName : afterName,
    submissions: known, uncertainOrUnconfirmedAttempts: uncertain,
    totalSubmittedSeconds, conservativelyReservedSeconds: conservativeSeconds,
    estimatedTotalAtCardRate: totalSubmittedSeconds === null ? null : round(totalSubmittedSeconds * ratePerSecond),
    conservativeEstimatedCostAtCardRate: conservativeSeconds === null ? null : round(conservativeSeconds * ratePerSecond),
    remainingCapAtStart: 0.88, remainingSecondsAtStart: remainingCapSeconds, ratePerSecond,
    remainingSecondsAfterConservativeTally: conservativeSeconds === null ? null : round(remainingCapSeconds - conservativeSeconds),
    initialVideoAttempts: initial.length, paidRetries: perShot.reduce((sum, shot) => sum + shot.paidRetries, 0), perShot,
    keyframeRegenerations: latest.attempts.filter(attempt => attempt.kind === 'image' && attempt.ordinal > 1).length,
    actualBillVerified: false, checks: capChecks,
    limitation: 'Offline snapshots reconcile persisted attempts; they cannot establish historical retry authorization or the provider bill. This audit never authorizes or performs a retry. Any unconfirmed outcome must be reconciled through the studio.',
  };
  const checks = {
    projectPreserved: same(before.project, after.project),
    planPreserved: same(before.plan, after.plan),
    attemptsPreserved: same(ordered(before.attempts), ordered(after.attempts)),
    noNewAttemptIdsOnRestart: same(ids(before), ids(after)),
    attemptCountPreserved: before.attempts.length === after.attempts.length,
    mediaSlotsPreserved: same(slots(before), slots(after)),
    exportPreserved: same(exportIdentities(before), exportIdentities(after)),
    takesPreserved: takes.every(take => take.preserved),
    modelCallCountPreserved: countModels(before) === countModels(after),
    directorTurnsPreserved: Array.isArray(before.turns) && Array.isArray(after.turns) && same(ordered(before.turns), ordered(after.turns)),
    noSubmissionsDuringAssetsSettings: final ? same(ordered(after.attempts), ordered(final.attempts)) : null,
    noModelCallsDuringAssetsSettings: final ? countModels(after) === countModels(final) : null,
    finalMediaSlotsPreserved: final ? same(slots(after), slots(final)) : null,
    finalExportPreserved: final ? same(exportIdentities(after), exportIdentities(final)) : null,
    directorSuccessfulCheckPresentBefore: checkEvidenceAvailable ? !!savedCheckBefore : null,
    directorSuccessfulCheckPresentAfter: checkEvidenceAvailable ? !!savedCheckAfter : null,
    directorSuccessfulCheckPreserved: checkEvidenceAvailable ? !!savedCheckBefore && !!savedCheckAfter && same(savedCheckBefore, savedCheckAfter) : null,
    ...capChecks,
  };
  const verification = {
    checkedAt: tally.checkedAt,
    sources: { before: beforeName, after: afterName, final: final ? finalName : null,
      setupBefore: names.includes(setupBeforeName) ? setupBeforeName : null,
      setupAfter: names.includes(setupAfterName) ? setupAfterName : null },
    checks, allRequiredChecksPassed: Object.values(checks).every(value => value !== false),
    optionalChecksNotExercised: Object.entries(checks).filter(([, value]) => value === null).map(([name]) => name),
    counts: { before: { attempts: before.attempts.length, modelCalls: countModels(before) }, after: { attempts: after.attempts.length, modelCalls: countModels(after) },
      final: final ? { attempts: final.attempts.length, modelCalls: countModels(final) } : null },
    takes,
    directorSuccessfulCheck: { presentBefore: !!savedCheckBefore, presentAfter: !!savedCheckAfter,
      preserved: checkEvidenceAvailable ? !!savedCheckBefore && !!savedCheckAfter && same(savedCheckBefore, savedCheckAfter) : null,
      checkedAtBefore: savedCheckBefore?.checkedAt ?? null, checkedAtAfter: savedCheckAfter?.checkedAt ?? null },
    exportIdentity: { exportId: after.exports.current.exportId, artifact: after.exports.current.artifact ?? null },
  };
  writeFileSync(join(evidence, 'paid-tally.json'), `${JSON.stringify(tally, null, 2)}\n`);
  writeFileSync(join(evidence, 'verification.json'), `${JSON.stringify(verification, null, 2)}\n`);
  const failed = Object.entries(checks).filter(([, value]) => value === false).map(([name]) => name);
  console.log(`LIVE-3 offline audit wrote verification.json and paid-tally.json: ${failed.length ? `failed checks: ${failed.join(', ')}` : 'all available required checks passed'}.`);
  console.log(`Persisted video jobs: ${known.length}; submitted seconds: ${totalSubmittedSeconds ?? 'unknown'}; conservative cap seconds: ${conservativeSeconds ?? 'unknown'}/88. No provider action performed.`);
  if (failed.length) process.exitCode = 1;
}

try { main(); }
catch (error) {
  // JSON parse errors can include input snippets; never print raw exception text.
  const message = error instanceof SyntaxError ? 'Malformed evidence JSON; no raw input shown.' : error?.message ?? 'Evidence audit failed.';
  console.error(`LIVE-3 audit: ${message}`);
  process.exitCode = 2;
}
