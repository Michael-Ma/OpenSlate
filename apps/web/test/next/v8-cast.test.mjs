import test from 'node:test';
import assert from 'node:assert/strict';
import { fixtureRoute } from '../../src/next/fixtures/routes/index.ts';
import { DECLINE } from '../../src/next/fixtures/routes/types.ts';
import { fixtureCommand } from '../../src/next/fixtures/fixture-commands.ts';
import { applyCastPresets } from '../../src/next/fixtures/routes/cast.ts';
import { lastFerryOverview, lastFerrySnapshot, lastFerryDirector, lastFerryProposals, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import {
  appearanceMsg, approvalImpact, approvalOutcome, castChecks, castChips, draftIssue, sheetStateMsg, wardrobeGrid, withCasting, withCharacter, withOutfit,
} from '../../src/next/model/cast.ts';
import { translateMsg } from '../../src/next/i18n/translate.ts';

// Plan › Cast (v8 step 5) on the sample film: the read model, the wardrobe grid, approval's effect on keyframes, and
// the Keyframes cast check, all against the simulated character routes (apps/server/src/characters.ts).

function world(presets = ['on']) {
  const timers = [];
  const w = {
    overview: lastFerryOverview(), snapshot: lastFerrySnapshot(), director: { ...lastFerryDirector }, proposals: lastFerryProposals(),
    update(change) { change(w); const cursor = w.overview.cursor + 1; w.overview = { ...w.overview, cursor }; w.snapshot = { ...w.snapshot, cursor }; },
    later(_ms, change) { timers.push(change); },
    flush() { while (timers.length) w.update(timers.shift()); },
  };
  applyCastPresets(w, presets);
  return w;
}
function call(w, method, path, body) {
  const answer = fixtureRoute(w, method, path, body);
  return answer === DECLINE ? fixtureCommand(w, method, path, body) : answer;
}
const read = (w) => call(w, 'GET', '/characters');
const en = (m) => translateMsg('en', m), zh = (m) => translateMsg('zh-CN', m);

test('the cast read names each character, their sheet state and where they appear', () => {
  const w = world(), cast = read(w);
  const [mara, tomas] = cast.characters;
  assert.equal(mara.name, 'Mara'); assert.equal(mara.sheetState, 'review'); assert.equal(mara.needsSheet, true);
  assert.equal(tomas.sheetState, 'none'); assert.equal(en(sheetStateMsg(tomas)), 'Needs a sheet');
  assert.equal(zh(sheetStateMsg(mara)), '待审');
  assert.equal(en(appearanceMsg(mara, w.overview)), '4 shots · Scenes 1, 2, 3');
  assert.equal(en(appearanceMsg(tomas, w.overview)), '2 shots · Scene 1');
  assert.equal(zh(appearanceMsg(tomas, w.overview)), '2 个镜头 · 第 1 场');
  assert.deepEqual(castChips(cast, shotId('1.2')).map((c) => c.name), ['Mara', 'Tomas']);
  assert.ok(castChips(cast, shotId('1.2')).every((c) => !c.approved && c.picture === null), 'no face before a sheet is approved');
  assert.deepEqual(castChips(cast, shotId('2.1')), []);
  assert.equal(cast.sheetQuote.subscription, 'codex');
});

test('the wardrobe grid shows each scene: an outfit, the base outfit, a missing outfit, or not in the scene', () => {
  const w = world(), grid = wardrobeGrid(read(w), w.overview);
  assert.deepEqual(grid.scenes.map((s) => s.ordinal), [1, 2, 3]);
  const [mara, tomas] = grid.rows;
  assert.match(mara.cells[0].outfit, /Red wool coat/);
  assert.equal(mara.cells[0].notes, 'Hair damp from the rain');
  assert.equal(mara.cells[2].outfit, ''); assert.match(mara.cells[2].fallback, /grey knit jumper/); assert.equal(mara.cells[2].missing, false);
  assert.equal(tomas.cells[1].appears, false);
  // Tomas has no base outfit: cast him in Scene 2 and the cell is a blocking check.
  const cast = read(w);
  call(w, 'PUT', '/characters', withCasting(cast, shotId('2.1'), ['char-clerk']));
  const after = wardrobeGrid(read(w), w.overview).rows[1];
  assert.equal(after.cells[1].appears, true); assert.equal(after.cells[1].missing, true);
  assert.ok(read(w).issues.some((i) => i.code === 'WARDROBE_MISSING' && i.characterId === 'char-clerk' && i.sceneId === sceneId(2)));
});

test('approving a sheet rebinds every cast shot and outdates their keyframes without making anything', () => {
  const w = world(), cast = read(w), mara = cast.characters[0];
  const impact = approvalImpact(mara, w.overview, 'en');
  assert.deepEqual(impact.shots, ['1.2', '2.2', '2.3', '3.2']);
  assert.deepEqual(impact.keyframes, ['1.2', '2.2', '2.3'], '3.2 has no keyframe yet');
  assert.deepEqual(impact.clips, ['1.2']);
  assert.equal(en(impact.remake), 'about $0.12');
  const before = w.overview;
  const receipt = call(w, 'POST', '/characters/char-mara/sheet/approve', { expectedHeadVersion: cast.headVersion, takeId: mara.takes[0].takeId });
  assert.deepEqual(approvalOutcome(receipt, before).outdated, ['1.2', '2.2', '2.3']);
  for (const label of ['1.2', '2.2', '2.3']) {
    const shot = w.overview.shots[shotId(label)];
    assert.equal(shot.keyframe.state, 'outdated', `${label}'s keyframe waits for Make keyframes`);
    assert.ok(shot.keyframe.previous, 'the earlier keyframe stays visible');
  }
  assert.equal(w.overview.shots[shotId('1.2')].video.state, 'outdated');
  assert.equal(w.overview.shots[shotId('3.2')].keyframe.state, 'none', 'nothing is started');
  const after = read(w);
  assert.equal(after.characters[0].sheetState, 'approved');
  assert.ok(castChips(after, shotId('2.2'))[0].approved && castChips(after, shotId('2.2'))[0].picture);
  assert.throws(() => call(w, 'POST', '/characters/char-mara/sheet/approve', { expectedHeadVersion: after.headVersion, takeId: mara.takes[0].takeId }), (e) => e.code === 'CHARACTER_SHEET_ALREADY_APPROVED');
  assert.throws(() => call(w, 'POST', '/characters/char-clerk/sheet/approve', { expectedHeadVersion: cast.headVersion, takeId: 'x' }), (e) => e.code === 'REVISION_CONFLICT');
});

test('the Keyframes cast check names a recurring character without an approved sheet, and leaves once approved', () => {
  const w = world(), cast = read(w);
  const checks = castChecks(cast, w.overview, sceneId(3), 'en');
  assert.equal(checks.length, 1);
  assert.equal(en(checks[0].title), 'Mara appears in 4 shots and has no approved character sheet');
  assert.match(en(checks[0].body), /waiting for your review/);
  assert.equal(zh(checks[0].title), 'Mara出现在 4 个镜头里，还没有已批准的角色设定图');
  const scene1 = castChecks(cast, w.overview, sceneId(1), 'en');
  assert.deepEqual(scene1.map((c) => c.name), ['Mara', 'Tomas']);
  assert.match(en(scene1[1].body), /Make a sheet first \(uses your Codex plan\)/);
  call(w, 'POST', '/characters/char-mara/sheet/approve', { expectedHeadVersion: cast.headVersion, takeId: cast.characters[0].takes[0].takeId });
  assert.deepEqual(castChecks(read(w), w.overview, sceneId(3), 'en'), []);
  assert.equal(castChecks(null, w.overview, sceneId(3), 'en').length, 0, 'a studio without characters has no check');
});

test('making a sheet shows it being made, then as a take to review; a price change is refused', () => {
  const w = world(), cast = read(w);
  assert.throws(() => call(w, 'POST', '/characters/char-clerk/sheet/generate', { expectedHeadVersion: cast.headVersion, expectedEstimateMicros: '1000' }), (e) => e.code === 'ESTIMATE_CHANGED');
  const receipt = call(w, 'POST', '/characters/char-clerk/sheet/generate', { expectedHeadVersion: cast.headVersion, expectedEstimateMicros: '0' });
  assert.equal(receipt.started[0].characterId, 'char-clerk');
  assert.equal(read(w).characters[1].sheetState, 'pending');
  assert.throws(() => call(w, 'POST', '/characters/char-clerk/sheet/generate', { expectedHeadVersion: cast.headVersion, expectedEstimateMicros: '0', regenerate: true }), (e) => e.code === 'ATTEMPT_EXISTS');
  w.flush();
  const tomas = read(w).characters[1];
  assert.equal(tomas.sheetState, 'review'); assert.equal(tomas.takes.length, 1);
  assert.throws(() => call(w, 'POST', '/characters/char-clerk/sheet/generate', { expectedHeadVersion: read(w).headVersion, expectedEstimateMicros: '0' }), (e) => e.code === 'CHARACTER_SHEET_EXISTS');
});

test('an uploaded picture becomes a take; changing the looks makes an approved sheet out of date', () => {
  const w = world(['approved']), cast = read(w);
  assert.equal(cast.characters[0].sheetState, 'approved');
  const take = call(w, 'POST', '/characters/char-clerk/sheet/import', { artifactId: 'art-ref', sha256: fixtureRefSha(w) });
  assert.ok(take.takeId);
  assert.equal(read(w).characters[1].takes.at(-1).source, 'imported');
  const mara = read(w).characters[0];
  call(w, 'PUT', '/characters', withCharacter(read(w), { name: 'Mara', identity: `${mara.identity} Short fringe.`, baseOutfit: mara.baseOutfit }, mara.id));
  assert.equal(read(w).characters[0].sheetState, 'outdated');
  assert.equal(en(castChecks(read(w), w.overview, sceneId(2), 'en')[0].title), "Mara's approved sheet may be out of date");
});

test('an outfit edit only touches that scene; names stay unique', () => {
  const w = world(), cast = read(w);
  const receipt = call(w, 'PUT', '/characters', withOutfit(cast, 'char-mara', sceneId(3), 'Red coat, hood up against the spray', ''));
  assert.deepEqual(receipt.changedShotIds, [shotId('3.2')]);
  assert.match(read(w).characters[0].wardrobe.find((x) => x.sceneId === sceneId(3)).outfit, /hood up/);
  assert.equal(en(draftIssue(read(w), { name: 'mara', identity: 'x', baseOutfit: '' })), 'Another character already has this name.');
  assert.equal(draftIssue(read(w), { name: 'Mara', identity: 'x', baseOutfit: '' }, 'char-mara'), null);
  // Emptying an outfit falls back to the base outfit.
  call(w, 'PUT', '/characters', withOutfit(read(w), 'char-mara', sceneId(3), '  ', ''));
  assert.equal(read(w).characters[0].wardrobe.some((x) => x.sceneId === sceneId(3)), false);
});

/** The sample upload's exact sha256 (Assets › the timetable and Mara references). */
function fixtureRefSha(w) {
  return call(w, 'GET', '/assets?role=upload').assets.find((a) => a.artifact.artifactId === 'art-ref').artifact.sha256;
}
