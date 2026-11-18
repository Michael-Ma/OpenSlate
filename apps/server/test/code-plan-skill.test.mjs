import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readSkillPackageFiles } from '@openslate/director';
import { codePlanFixture, exampleSource } from './code-plan-e2e-fixture.mjs';

const skillRoot = new URL('../../../skills/code-plan/', import.meta.url);
test('2.2.0 ships six guidance files under 14,500 words and four application-turn files under 7,500', () => {
  const manifest = JSON.parse(readFileSync(new URL('openslate.skill.json', skillRoot), 'utf8'));
  assert.equal(manifest.version, '2.2.0');
  assert.deepEqual(manifest.files, ['SKILL.md', 'references/film-craft.md', 'references/formats.md', 'references/aims.md', 'references/studio.d.ts', 'references/example-plan.ts']);
  assert.deepEqual(manifest.personTurnFiles, ['references/formats.md', 'references/aims.md']);
  const count = paths => paths.reduce((total, path) => total + readFileSync(new URL(path, skillRoot), 'utf8').trim().split(/\s+/u).length, 0);
  const words = count(manifest.files), applicationFiles = manifest.files.filter(path => !manifest.personTurnFiles.includes(path));
  assert.equal(applicationFiles.length, 4);
  assert.ok(words < 14500, `${words} words must stay under 14,500`);
  assert.ok(count(applicationFiles) < 7500, `${count(applicationFiles)} words must stay under 7,500`);
});

test('2.2.0 has no templates links and every relative link resolves inside the manifest', () => {
  // The real package validator checks all relative links, declarations and files without publishing a snapshot.
  const files = readSkillPackageFiles(fileURLToPath(skillRoot));
  for (const [path, content] of Object.entries(files)) assert.doesNotMatch(content, /templates\.md/, path);
});

test('2.2.0 example dry-runs cleanly through confirmation, review, reused ranges and a held keyframe', async t => {
  const f = await codePlanFixture(); t.after(() => f.close());
  const id = (await f.create()).id;
  // Complete the application review using an offline Director, without rewriting the submitted source.
  f.director.fake.runtime.start = async input => ({ ...Object.fromEntries(['projectId', 'requestId', 'epochId', 'turnId'].map(key => [key, input[key]])), status: 'completed', text: 'Fixture reviewed', dispatched: true });
  const clean = diff => assert.deepEqual(diff.findings, []);
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
  assert.ok(['format', 'aim', 'fixed', 'takes', 'reading', 'rule', 'cuts'].every(key => Object.hasOwn(scenes[0], key)));
  assert.equal(scenes[0].format, 'Short film'); assert.equal(scenes[0].aim, 'Calm');
  assert.equal(scenes[0].takes.length, 3);
  assert.equal(scenes[0].takes.filter(take => take.chosen).length, 1);
  assert.ok(scenes[0].takes.every(take => typeof take.basis === 'string' && take.basis.length));
  assert.ok(scenes[0].takes.some(take => take.basis === 'own'));
  const names = new Set(['references/formats.md', 'references/aims.md'].flatMap(path =>
    [...readFileSync(new URL(path, skillRoot), 'utf8').matchAll(/^- \*\*([^*]+)\*\*/gm)].map(match => match[1].replace(/\.$/, ''))));
  for (const take of scenes[0].takes) {
    if (take.basis === 'own') continue;
    assert.match(take.basis, /^(template|bent): /);
    assert.ok(names.has(take.basis.replace(/^(template|bent): /, '')), `Unknown structure or shape: ${take.basis}`);
  }
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
