import test from 'node:test';
import assert from 'node:assert/strict';
import { lastFerryOverview, lastFerrySnapshot, sceneId, shotId } from '../../src/next/fixtures/last-ferry.ts';
import { catalog } from '../../src/next/i18n/messages.ts';
import { dropLost, dropLostAt, keptText, placeOf, placeView, putLost, sayLost } from '../../src/next/model/plan-drafts.ts';
import { planOutline } from '../../src/next/model/plan.ts';

const outline = () => planOutline(lastFerrySnapshot(), lastFerryOverview());

test('an open editor keeps its draft and says a lost reply by place', () => {
  assert.equal(placeOf(null), null);
  assert.equal(placeOf({ kind: 'brief' }), 'brief');
  assert.equal(placeOf({ kind: 'title', sceneId: sceneId(2) }), `title:${sceneId(2)}`);
  assert.equal(placeOf({ kind: 'direction', sceneId: sceneId(2) }), `direction:${sceneId(2)}`);
  // A shot's place does not change when it moves (its label does): the draft follows it to another scene.
  assert.equal(placeOf({ kind: 'shot', shotId: shotId('1.2'), openedAs: '1.2' }), placeOf({ kind: 'shot', shotId: shotId('1.2'), openedAs: '2.1' }));
});

test("an editor's subject is named as the outline shows it now, and is gone once deleted", () => {
  const now = outline();
  assert.deepEqual(placeView({ kind: 'shot', shotId: shotId('2.2'), openedAs: '1.2' }, now), {
    name: { id: 'plan.place.shot', values: { shot: '2.2' } }, gone: { id: 'plan.kept.shot', values: { shot: '2.2' } },
  });
  assert.deepEqual(placeView({ kind: 'direction', sceneId: sceneId(3) }, now).name, { id: 'plan.place.direction', values: { scene: 3 } });
  assert.deepEqual(placeView({ kind: 'story' }, now).name, { id: 'plan.place.story' });
  assert.equal(placeView({ kind: 'shot', shotId: 'no-such-shot', openedAs: '1.2' }, now), null);
  assert.equal(placeView({ kind: 'title', sceneId: 'no-such-scene' }, now), null);
  for (const id of ['plan.place.brief', 'plan.place.story', 'plan.place.title', 'plan.place.direction', 'plan.place.shot', 'plan.kept.shot', 'plan.kept.scene'])
    assert.ok(catalog[id]?.en && catalog[id]?.zh, id);
});

test("a lost reply's notice is its own: another press's outcome never clears it", () => {
  const move = { pressId: 'plan:moveScene:s3', place: 'view', still: false };
  const brief = { pressId: 'plan:treatment:brief', place: 'brief', still: false };
  let list = putLost(putLost([], move), brief);
  assert.deepEqual(list.map((note) => note.pressId), [move.pressId, brief.pressId]);
  // The same press unanswered again replaces its notice in place.
  list = putLost(list, { ...move, still: true });
  assert.deepEqual(list.map((note) => [note.pressId, note.still]), [[move.pressId, true], [brief.pressId, false]]);
  // Only its own answer (or a dismiss) takes a notice away; cancelling an editor takes the notices said in it.
  assert.deepEqual(dropLost(list, brief.pressId).map((note) => note.pressId), [move.pressId]);
  assert.deepEqual(dropLostAt(list, 'brief').map((note) => note.pressId), [move.pressId]);
  assert.equal(dropLost(list, 'plan:other').length, 2);
});

test('a notice is said in its editor when that is on screen, otherwise in the strip: never nowhere', () => {
  const notes = [
    { pressId: 'a', place: 'shot:x' },
    { pressId: 'b', place: 'view' },
    { pressId: 'c', place: 'brief' },
    { pressId: 'd', place: 'shot:x' },
  ];
  const open = sayLost(notes, new Set(['shot:x']));
  assert.deepEqual([...open.byPlace.keys()], ['shot:x']);
  assert.equal(open.byPlace.get('shot:x').pressId, 'a');
  assert.deepEqual(open.strip.map((note) => note.pressId), ['b', 'c', 'd']);
  // The shot's editor went (its shot was deleted): its notice moves to the strip.
  assert.deepEqual(sayLost(notes, new Set()).strip.map((note) => note.pressId), ['a', 'b', 'c', 'd']);
  assert.equal(sayLost(notes, new Set(['import'])).byPlace.size, 0);
});

test('kept text copies as it is for one field, with labels for several', () => {
  assert.equal(keptText([{ key: 'text', label: 'Scene direction', value: 'Fog over the water.' }]), 'Fog over the water.');
  assert.equal(
    keptText([{ key: 'purpose', label: 'Purpose', value: 'Mara pays.' }, { key: 'action', label: 'Action', value: 'Coins slide.' }]),
    'Purpose: Mara pays.\n\nAction: Coins slide.',
  );
});
