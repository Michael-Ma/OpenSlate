import test from 'node:test';
import assert from 'node:assert/strict';
import { FixturePort } from '../../src/next/fixtures/fixture-port.ts';
import { displayedHead } from '../../src/next/model/displayed-baseline.ts';
test('B17 #4 Film commands wait for the exact displayed overview baseline',()=>{
  const {snapshot,overview}=new FixturePort().world;
  assert.equal(displayedHead(snapshot.project.id,snapshot,overview),12);
  assert.equal(displayedHead(snapshot.project.id,{...snapshot,project:{...snapshot.project,headVersion:13}},overview),null);
  assert.equal(displayedHead('other',snapshot,overview),null);
  assert.equal(displayedHead(snapshot.project.id,snapshot,{...overview,revisionId:'new'}),null);
});

test('B18 Film writes remain enabled across cursor-only refreshes and a matching new head', () => {
  const { snapshot, overview } = new FixturePort().world;
  assert.equal(displayedHead(snapshot.project.id, { ...snapshot, cursor: snapshot.cursor + 1 }, overview), 12);
  assert.equal(displayedHead(snapshot.project.id,
    { ...snapshot, project: { ...snapshot.project, headVersion: 13 } }, { ...overview, headVersion: 13 }), 13);
});

test('B18 music reads only a consistent displayed soundtrack baseline', async () => {
  const { displayedGain } = await import('../../src/next/model/film-gain.ts');
  const { snapshot, overview } = new FixturePort().world;
  snapshot.project.soundtrack = { audioId: 'music-a', gainMilliDb: -12000 };
  const expected = { projectId: snapshot.project.id, headVersion: 12, audioId: 'music-a', gainDb: -12 };
  assert.deepEqual(displayedGain(snapshot.project.id, snapshot, overview), expected);
  assert.equal(displayedGain(snapshot.project.id, { ...snapshot, project: { ...snapshot.project, headVersion: 13 } }, overview), null);
  assert.equal(displayedGain('another-film', snapshot, overview), null);
});
