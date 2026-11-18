import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { codePlanFixture, exampleSource } from './code-plan-e2e-fixture.mjs';

const skillRoot = new URL('../../../skills/code-plan/', import.meta.url);
test('2.1.0 ships five guidance files including templates within the 9,500-word budget', () => {
  const manifest = JSON.parse(readFileSync(new URL('openslate.skill.json', skillRoot), 'utf8'));
  assert.equal(manifest.version, '2.1.0');
  assert.deepEqual(manifest.files, ['SKILL.md', 'references/film-craft.md', 'references/templates.md', 'references/studio.d.ts', 'references/example-plan.ts']);
  const words = manifest.files.reduce((total, path) => total + readFileSync(new URL(path, skillRoot), 'utf8').trim().split(/\s+/u).length, 0);
  assert.ok(words < 9500, `${words} words must stay under 9,500`);
});

test('2.1.0 example dry-runs cleanly through confirmation, review, reused ranges and a held keyframe', async t => {
  const f = await codePlanFixture(); t.after(() => f.close());
  const id = (await f.create()).id;
  // Complete the application review using an offline Director, without rewriting the submitted source.
  f.director.fake.runtime.start = async input => ({ ...Object.fromEntries(['projectId', 'requestId', 'epochId', 'turnId'].map(key => [key, input[key]])), status: 'completed', text: 'Fixture reviewed', dispatched: true });
  const clean = diff => assert.deepEqual(diff.findings.filter(row => /^(CUTS_|ZOOM_SOFT$|SUGGEST_UNAVAILABLE$)/.test(row.code)), []);
  const before = f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all();
  clean(await f.runtime.dryRun(id, exampleSource));
  assert.deepEqual(f.store.db.prepare('SELECT * FROM entities ORDER BY rowid').all(), before);
  assert.equal(f.calls.submit.length, 0, 'dry run must dispatch nothing');
  clean((await f.runtime.submit(id, { source: exampleSource, basedOnVersion: null, author: 'user', invocationId: randomUUID() })).diff);
  let view = await f.until(id, view => view.choices.some(choice => choice.answer === undefined), 'example confirmation');
  for (let answered = 0; view.state !== 'done' && answered < 2; answered++) {
    const choice = view.choices.find(choice => !choice.stale && choice.answer === undefined);
    assert.ok(choice);
    f.runtime.answer(id, { choiceId: choice.choiceId, optionsDigest: choice.optionsDigest, answer: choice.options.find(option => option.keyframeInput === 'first_frame') });
    view = await f.until(id, view => view.state === 'done' || view.choices.some(choice => !choice.stale && choice.answer === undefined), 'next confirmation or render');
  }
  assert.equal(view.state, 'done');
  clean(await f.runtime.dryRun(id, exampleSource)); // Now reaches the saved render, not just the first pending frame.
  const { scenes, shots } = view.declarations, cuts = scenes[0].cuts;
  assert.ok(['fixed', 'takes', 'reading', 'rule', 'cuts'].every(key => Object.hasOwn(scenes[0], key)));
  assert.equal(scenes[0].takes.length, 3);
  assert.equal(scenes[0].takes.filter(take => take.chosen).length, 1);
  assert.ok(scenes[0].takes.every(take => typeof take.basis === 'string' && take.basis.length));
  assert.ok(scenes[0].takes.some(take => take.basis === 'own'));
  assert.ok(cuts.every(cut => shots.some(shot => shot.id === cut.clip)));
  assert.ok(new Set(cuts.map(cut => cut.seconds)).size > 1);
  const timeline = f.calls.submit.find(call => call.kind === 'render').args.timeline;
  const still = timeline.find(row => row.artifact.kind === 'image');
  assert.equal(still.durationFrames, 45);
  const confirmed = view.choices.find(choice => choice.choiceId === 'shot-2-keyframe');
  assert.ok(confirmed.answer);
  const frame = view.steps.find(step => step.kind === 'image' && step.shotId === 'shot-2').artifact;
  assert.deepEqual(still.artifact, { kind: frame.kind, sha256: frame.sha256 });
  assert.equal(confirmed.answer.sha256, frame.sha256);
  assert.deepEqual(timeline.filter(row => row.artifact.kind === 'video').map(row => [row.startFrame, row.durationFrames]), [[0, 90], [90, 60], [0, 90]]);
  assert.deepEqual(timeline[0].artifact, timeline[2].artifact);
  assert.equal(cuts.reduce((sum, cut) => sum + cut.seconds, 0) * 30, timeline.reduce((sum, row) => sum + row.durationFrames, 0));
  assert.equal(view.choices.find(choice => choice.choiceId === 'shot-1-keyframe').suggest.input, 'first_frame');
  assert.equal(f.calls.submit.filter(call => call.kind === 'video').length, 2);
});
