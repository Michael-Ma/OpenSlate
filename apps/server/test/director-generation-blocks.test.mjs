import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './request-fixture.mjs';
import { directorGenerationBlocks, recordDirectorGenerationBlock } from '../dist/application/director-generation-blocks.js';
import { GENERATION_BLOCKER_LIMIT } from '../dist/application/generation-blockers.js';

test('turn blocks allowlist every field and cap both scenes and attempt summaries across calls', () => {
  const attempts = Array.from({ length: 3 }, (_, index) => ({ attemptId: `attempt-${index}`, shotId: `shot-${index}`,
    kind: 'video', phase: 'submission_unknown', action: 'human_release', nodeId: 'private-node',
    path: '/private/release', body: { acknowledgeDoubleCharge: true }, providerData: { secret: 'private-provider-data' } }));
  const records = Array.from({ length: 30 }, (_, index) => ({ requestId: 'request', epochId: 'epoch', key: `call-${index}`,
    block: { kind: 'keyframes', sceneId: `scene-${index}`, code: 'ATTEMPT_EXISTS', shotIds: ['shot-0', 'shot-1', 'shot-2'],
      attempts, at: `2026-10-27T12:00:${String(index).padStart(2, '0')}.000Z`, path: '/private', recovery: { attempts }, body: 'private-body' } }));
  const before = structuredClone(records), view = directorGenerationBlocks(records);
  assert.equal(view.length, GENERATION_BLOCKER_LIMIT);
  assert.equal(view.reduce((count, block) => count + block.attempts.length, 0), GENERATION_BLOCKER_LIMIT);
  assert.deepEqual(view[0], { kind: 'keyframes', sceneId: 'scene-0', code: 'ATTEMPT_EXISTS', shotIds: ['shot-0', 'shot-1', 'shot-2'],
    attempts: attempts.map(({ attemptId, shotId, kind, phase, action }) => ({ attemptId, shotId, kind, phase, action })), at: records[0].block.at });
  assert.doesNotMatch(JSON.stringify(view), /private|path|body|nodeId|providerData|recovery|acknowledgeDoubleCharge/);
  assert.deepEqual(records, before);
  view[0].shotIds.push('changed'); view[0].attempts[0].phase = 'changed';
  assert.deepEqual(records, before, 'the public projection cannot mutate saved history');
  assert.deepEqual(directorGenerationBlocks([]), []);
});

test('a refusal operation keeps one immutable identity even after the originating epoch is fenced', t => {
  const f = fixture(t), human = f.service.beginRequest(f.project.id, 'local-user', 'Make the keyframes.');
  const actor = f.service.openEpoch(f.project.id, human).actor;
  const block = { kind: 'keyframes', sceneId: 'scene-0', code: 'STALE_PROMPT_INTENT', shotIds: ['shot-0'], at: '2026-10-27T12:00:00.000Z' };
  f.service.beginRequest(f.project.id, 'local-user', 'New direction.');
  recordDirectorGenerationBlock(f.service, f.project.id, actor, 'original-operation', block);
  recordDirectorGenerationBlock(f.service, f.project.id, actor, 'original-operation', { ...block, at: '2026-10-27T12:00:01.000Z' });
  const saved = f.store.list('director_generation_block', f.project.id);
  assert.equal(saved.length, 1); assert.deepEqual(saved[0].block, block);
  assert.equal(saved[0].requestId, actor.requestId); assert.equal(saved[0].epochId, actor.epochId);
  assert.throws(() => recordDirectorGenerationBlock(f.service, f.project.id, actor, 'original-operation', { ...block, shotIds: ['shot-1'] }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.deepEqual(f.store.list('director_generation_block', f.project.id), saved);
});
