import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { digest, STAGE_CONTRACTS } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { ProductionService } from '../dist/application/service.js';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';

function fixture(t, { foreignHold = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-prepared-publication-'));
  const store = new Store(join(root, 'openslate.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const engine = new Engine(store, provider, { artifactDir: join(root, 'artifacts') });
  const service = new ProductionService(store, engine), project = service.createProject('Narration preparation');
  const prior = foreignHold ? service.beginRequest(project.id, 'human', 'A separate unfinished edit') : null;
  const human = service.beginRequest(project.id, 'human', 'Prepare two narration takes'), actor = service.openEpoch(project.id, human).actor;
  t.after(() => { store.close(); provider.close(); rmSync(root, { recursive: true, force: true }); });
  const f = { root, store, provider, engine, service, project, human, actor, prior };
  f.authorize = count => service.authorize(project.id, human, Array.from({ length: count }, () => ({ scopeId: project.id, kind: 'speech' })), randomUUID());
  f.proposal = () => {
    const current = store.getProject(project.id);
    return { variant: 'plan', expectedHeadVersion: current.headVersion, source: `definePlan({baseRevision:${JSON.stringify(current.revisionId)}},p=>{
      const first=p.speech("first",{profile:"fake-speech-v1",text:"Leather boots",voice:"demo"});
      const second=p.speech("second",{profile:"fake-speech-v1",text:"Made to last",voice:"demo"});
      return [first,second];});` };
  };
  f.prepare = () => service.prepare(project.id, actor, f.proposal());
  return f;
}
function state(store) {
  return {
    projects: store.db.prepare('SELECT * FROM projects ORDER BY id').all(),
    entities: store.db.prepare('SELECT * FROM entities ORDER BY kind,id').all(),
    events: store.db.prepare('SELECT * FROM events ORDER BY project_id,sequence').all(),
    commands: store.db.prepare('SELECT * FROM commands ORDER BY actor_scope,key').all(),
  };
}
function noExecution(f) {
  assert.equal(f.store.list('attempt', f.project.id).length, 0);
  assert.equal(f.store.list('reservation', f.project.id).length, 0);
  assert.equal(f.provider.acceptedCount(), 0);
}

test('public preparation and application retain their legacy records, grant binding, event order and replay', async t => {
  const f = fixture(t), grants = f.authorize(2), cursor = f.store.cursor(f.project.id), proposal = f.proposal();
  const prepared = await f.service.prepare(f.project.id, f.actor, proposal);
  assert.deepEqual(Object.keys(prepared).sort(), ['id','projectId','requestId','principalId','epochId','proposal','proposalDigest','baseVersion','next',
    'compiled','logicalIds','impact','stages','stageVersions','grantBindings','semanticChange','capabilityDigest'].sort());
  assert.equal(prepared.proposalDigest, digest(proposal));
  assert.equal(prepared.capabilityDigest, digest(f.store.get('capability_lock', f.project.capabilityLockId)));
  assert.equal(prepared.epochId, f.actor.epochId); assert.equal(prepared.semanticChange, false);
  assert.deepEqual(prepared.next, f.project);
  assert.deepEqual(new Set(Object.values(prepared.grantBindings)), new Set(grants.map(grant => grant.id)));
  assert.equal(f.store.list('grant', f.project.id).length, 2); assert.equal(f.store.list('candidate', f.project.id).length, 0);
  assert.deepEqual(await f.service.prepare(f.project.id, f.actor, proposal), prepared);
  const receipt = f.service.apply(f.project.id, f.actor, prepared.id);
  assert.deepEqual(Object.keys(receipt).sort(), ['preparedId','projectId','revisionId','headVersion','activePlanId','cursor'].sort());
  assert.equal(receipt.preparedId, prepared.id); assert.equal(receipt.headVersion, 1);
  assert.deepEqual(f.store.get('plan', receipt.activePlanId).compiled, prepared.compiled);
  assert.deepEqual(f.store.get('logical_ids', f.project.id).aliases, prepared.logicalIds);
  const candidates = f.store.list('candidate', f.project.id);
  assert.equal(candidates.length, 2);
  for (const candidate of candidates) assert.equal(candidate.grantId, prepared.grantBindings[candidate.nodeId]);
  assert.deepEqual(f.store.readEvents(f.project.id, cursor).map(event => event.kind),
    ['change.prepared','execution.plan_installed','hold.changed','change.applied']);
  const saved = state(f.store); assert.deepEqual(f.service.apply(f.project.id, f.actor, prepared.id), receipt);
  assert.deepEqual(state(f.store), saved); noExecution(f);
});

test('missing existing grants cannot save an assessment or mint authority for the remaining operation', async t => {
  const f = fixture(t); f.authorize(1); const before = state(f.store);
  await assert.rejects(f.prepare(), { code: 'ORIGIN_NOT_AUTHORIZED' });
  assert.deepEqual(state(f.store), before); noExecution(f);
});

test('a failed preparation event rolls back the prepared record without consuming the existing grants', async t => {
  const f = fixture(t); f.authorize(2); const before = state(f.store), append = f.store.appendEvent.bind(f.store);
  const failure = Error('injected prepared event failure'); let hits = 0;
  f.store.appendEvent = (...args) => { const result = append(...args); if (args[1] === 'change.prepared') { hits++; throw failure; } return result; };
  try { await assert.rejects(f.prepare(), error => error === failure); } finally { f.store.appendEvent = append; }
  assert.equal(hits, 1); assert.deepEqual(state(f.store), before);
  const prepared = await f.prepare(); assert.equal(Object.keys(prepared.grantBindings).length, 2);
  assert.equal(f.store.list('grant', f.project.id).length, 2); assert.equal(f.store.list('candidate', f.project.id).length, 0); noExecution(f);
});

for (const boundary of ['second candidate', 'plan record', 'stage revision', 'applied event', 'command receipt']) {
  test(`failure after ${boundary} rolls back all publication and retries the same exact prepared change`, async t => {
    const f = fixture(t, { foreignHold: true }); f.authorize(2); const prepared = await f.prepare(), before = state(f.store);
    const failure = Error(`injected ${boundary} failure`); let hits = 0, candidateCount = 0;
    const insert = f.store.insert.bind(f.store), append = f.store.appendEvent.bind(f.store), sql = f.store.db.prepare.bind(f.store.db);
    f.store.insert = (...args) => {
      const result = insert(...args);
      if (args[0] === 'candidate') candidateCount++;
      if ((boundary === 'second candidate' && args[0] === 'candidate' && candidateCount === 2)
        || (boundary === 'plan record' && args[0] === 'plan') || (boundary === 'stage revision' && args[0] === 'stage_revision')) { hits++; throw failure; }
      return result;
    };
    f.store.appendEvent = (...args) => { const result = append(...args); if (boundary === 'applied event' && args[1] === 'change.applied') { hits++; throw failure; } return result; };
    f.store.db.prepare = statement => {
      const compiled = sql(statement);
      if (boundary === 'command receipt' && statement.startsWith('INSERT INTO commands(')) return {
        run: (...args) => { compiled.run(...args); hits++; throw failure; },
      };
      return compiled;
    };
    try { assert.throws(() => f.service.apply(f.project.id, f.actor, prepared.id), error => error === failure); }
    finally { f.store.insert = insert; f.store.appendEvent = append; f.store.db.prepare = sql; }
    assert.equal(hits, 1); assert.equal(candidateCount, 2); assert.deepEqual(state(f.store), before);
    assert.equal(f.store.list('grant', f.project.id).length, 2); assert.equal(f.store.list('candidate', f.project.id).length, 0);
    const receipt = f.service.apply(f.project.id, f.actor, prepared.id), saved = state(f.store);
    assert.equal(receipt.headVersion, 1); assert.equal(f.store.list('candidate', f.project.id).length, 2);
    assert.deepEqual(new Set(f.store.list('candidate', f.project.id).map(candidate => candidate.grantId)), new Set(Object.values(prepared.grantBindings)));
    assert.ok(f.store.list('hold', f.project.id).some(hold => hold.ownerId === f.prior.requestId && hold.active));
    assert.ok(f.store.list('hold', f.project.id).filter(hold => hold.ownerId === f.human.requestId).every(hold => !hold.active));
    assert.deepEqual(f.service.apply(f.project.id, f.actor, prepared.id), receipt); assert.deepEqual(state(f.store), saved); noExecution(f);
  });
}

test('preparation still rechecks its original epoch after asynchronous compilation', async t => {
  const f = fixture(t); f.authorize(2); const pending = f.prepare();
  f.service.beginRequest(f.project.id, 'human', 'Replace this request');
  const before = state(f.store);
  await assert.rejects(pending, { code: 'EPOCH_REVOKED' }); assert.deepEqual(state(f.store), before);
  assert.equal(f.store.list('prepared', f.project.id).length, 0); assert.equal(f.store.list('candidate', f.project.id).length, 0); noExecution(f);
});

test('a project mutation during compilation wins without leaving a stale prepared change or consumed grant', async t => {
  const f = fixture(t); f.authorize(2); const pending = f.prepare();
  const update = await f.service.prepare(f.project.id, f.actor, { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'A revised brief' } });
  f.service.apply(f.project.id, f.actor, update.id); const before = state(f.store);
  await assert.rejects(pending, { code: 'REVISION_CONFLICT' }); assert.deepEqual(state(f.store), before);
  assert.deepEqual(f.store.list('prepared', f.project.id).map(row => row.id), [update.id]);
  assert.equal(f.store.list('candidate', f.project.id).length, 0); noExecution(f);
});

test('same-principal human and another director epoch cannot borrow a prepared change', async t => {
  const f = fixture(t); f.authorize(2); const prepared = await f.prepare(), other = f.service.openEpoch(f.project.id, f.human).actor;
  const before = state(f.store);
  for (const actor of [f.human, other]) assert.throws(() => f.service.apply(f.project.id, actor, prepared.id), { code: 'ACTOR_DENIED' });
  assert.deepEqual(state(f.store), before);
  const receipt = f.service.apply(f.project.id, f.actor, prepared.id);
  f.service.beginRequest(f.project.id, 'human', 'A fresh edit'); const after = state(f.store);
  assert.throws(() => f.service.apply(f.project.id, f.actor, prepared.id), { code: 'EPOCH_REVOKED' });
  assert.deepEqual(state(f.store), after); assert.equal(receipt.headVersion, 1); noExecution(f);
});

for (const conflict of ['head', 'capability lock', 'stage binding']) {
  test(`application preserves the ${conflict} check before publishing any plan`, async t => {
    const f = fixture(t); f.authorize(2); const prepared = await f.prepare();
    if (conflict === 'head') {
      const update = await f.service.prepare(f.project.id, f.actor, { variant: 'project', expectedHeadVersion: 0, creative: { brief: 'Concurrent brief' } });
      f.service.apply(f.project.id, f.actor, update.id);
    } else if (conflict === 'capability lock') {
      const id = randomUUID(), current = f.store.getProject(f.project.id);
      f.store.insert('capability_lock', id, f.project.id, { ...f.store.get('capability_lock', current.capabilityLockId), id });
      f.store.saveProject({ ...current, capabilityLockId: id }, current.headVersion);
    } else {
      const id = Object.keys(prepared.stageVersions)[0];
      f.store.put('stage', id, f.project.id, { stageId: 'narration', scopeId: f.project.id, bindingVersion: 1, progressVersion: 0,
        inputDigest: digest('concurrent stage'), outputDigest: digest('concurrent output'), contractDigest: digest(STAGE_CONTRACTS.narration) });
    }
    const before = state(f.store), code = { head: 'REVISION_CONFLICT', 'capability lock': 'CAPABILITY_MISMATCH', 'stage binding': 'STAGE_BINDING_CONFLICT' }[conflict];
    assert.throws(() => f.service.apply(f.project.id, f.actor, prepared.id), { code });
    assert.deepEqual(state(f.store), before); assert.equal(f.store.list('candidate', f.project.id).length, 0); noExecution(f);
  });
}

test('progress-only changes remain compatible and exact apply replay survives a later creative head', async t => {
  const f = fixture(t); f.authorize(2); const prepared = await f.prepare(), first = f.service.apply(f.project.id, f.actor, prepared.id);
  const current = f.store.getProject(f.project.id), stage = f.store.list('stage', f.project.id)[0];
  const patch = await f.service.prepare(f.project.id, f.actor, { variant: 'project', expectedHeadVersion: current.headVersion, creative: { narrationScript: 'A reviewed script draft' } });
  f.service.recordProgress(f.project.id, stage, 'fixture-progress');
  const second = f.service.apply(f.project.id, f.actor, patch.id);
  assert.equal(second.headVersion, first.headVersion + 1);
  assert.equal(f.store.get('stage', stage.id).progressVersion, 1);
  const before = state(f.store);
  assert.deepEqual(f.service.apply(f.project.id, f.actor, prepared.id), first); assert.deepEqual(state(f.store), before);
  assert.ok(f.store.list('hold', f.project.id).some(hold => hold.active && hold.ownerId === f.human.requestId));
  assert.equal(f.store.list('candidate', f.project.id).length, 2); noExecution(f);
});
