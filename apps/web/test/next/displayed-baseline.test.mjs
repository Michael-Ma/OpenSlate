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
