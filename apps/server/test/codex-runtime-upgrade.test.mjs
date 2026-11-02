import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { digest } from '@openslate/core';
import { describeCodexImageInput } from '@openslate/providers';
import { realCodeFixture, imageSource, videoProfile } from './code-plan-providers-fixture.mjs';
import { codexImageProfile } from './codex-image-execution-fixture.mjs';
import { assertCodexImageRecords } from '../dist/execution/codex-image-lineage.js';
import { assertCodexImageOperationOptions, assertCodexImageExecutionMapping } from '../dist/execution/codex-image-receipts.js';
import { profilePolicy } from '../dist/application/provider-catalog.js';

// Frozen synthetic old film, including its original plan keys, full profile lock and native/output receipts.
// JSON records and tiny generated PNG bytes only; no database or customer media.
const history = readFileSync(new URL('./codex-image-0.153.4-film.json', import.meta.url), 'utf8');

async function oldFilm(t, changes) {
  const f = await realCodeFixture(t, changes), saved = JSON.parse(history.replaceAll('@ROOT@', f.root));
  f.store.transaction(() => {
    for (const table of ['events', 'entities', 'commands', 'projects']) f.store.db.prepare(`DELETE FROM ${table}`).run();
    for (const table of ['projects', 'entities', 'events']) for (const row of saved.tables[table] ?? []) {
      const keys = Object.keys(row);
      f.store.db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map(key => row[key]));
    }
  });
  for (const [name, bytes] of Object.entries(saved.files)) {
    const path = join(f.root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, Buffer.from(bytes, 'base64'));
  }
  f.project = f.store.getProject(saved.projectId);
  await f.restart();
  return f;
}

test('a completed 0.153.4 film replays without work and a changed prompt dispatches only one current-runtime image without Settings', async t => {
  const f = await oldFilm(t);
  const steps = f.plans.steps(f.project.id), attempt = f.store.get('attempt', steps[0].attemptId);
  const mapping = f.store.get('codex_image_execution_mapping', attempt.id);
  assert.equal(mapping.native.runtime.runtimeVersion, '0.153.4');
  assert.equal(mapping.transport.runtimeVersion, '0.153.4');
  assert.equal(mapping.transport.turnInputDigest, describeCodexImageInput(mapping.transport).turnInputDigest);
  assertCodexImageRecords(f.store, attempt);
  const immutable = ['capability_lock', 'attempt', 'code_plan_step', 'code_plan_execution', 'codex_image_execution_mapping',
    'codex_image_execution_dispatch', 'codex_image_execution_run', 'codex_image_execution_result', 'execution_output_receipt', 'execution_output_spool', 'execution_output_slot'];
  const records = () => Object.fromEntries(immutable.map(kind => [kind, f.store.list(kind, f.project.id)]));
  const before = records(), calls = { ...f.calls }, view = f.plans.view(f.project.id), count = f.execution.attempts(f.project.id).length;
  const recovered = await f.mediaRuntime.registry.forProfile(mapping.profileDefinition).lookup(attempt.id, attempt.request);
  assert.equal(recovered.type, 'completed');
  await f.plans.replay(f.project.id); await f.tick();
  const source = f.store.list('code_plan_version', f.project.id)[0].source;
  const receipt = await f.submit(source); await f.finish();
  assert.equal(receipt.diff.reusedSteps, 1); assert.equal(receipt.diff.newSteps.length, 0);
  assert.deepEqual(f.plans.steps(f.project.id).map(step => step.key), steps.map(step => step.key));
  assert.equal(f.execution.attempts(f.project.id).length, count);
  assert.equal(f.plans.view(f.project.id).spentMicros, view.spentMicros);
  assert.equal(f.plans.view(f.project.id).reservedMicros, view.reservedMicros);
  assert.equal(f.fake.acceptedCount(), 0); assert.deepEqual(f.calls, calls);
  assert.equal(digest(records()), digest(before), 'replay never rewrites the old lock, inputs, price or receipt lineage');
  // Pure validation still distinguishes a recorded profile from the current native runtime.
  assert.throws(() => profilePolicy(mapping.profileDefinition), { code: 'PROVIDER_CATALOG_INVALID' });
  assert.doesNotThrow(() => profilePolicy(mapping.profileDefinition, { historical: true }));
  assert.throws(() => assertCodexImageOperationOptions(mapping.profileDefinition, attempt.request.args), { code: 'CODEX_IMAGE_PREFLIGHT_INVALID' });
  await f.submit(source.replace('A window at dawn', 'Changed historical input')); await f.finish();
  assert.equal(f.execution.attempts(f.project.id).length, count + 1);
  assert.equal(f.calls.prepare, calls.prepare + 1); assert.equal(f.calls.start, calls.start + 1);
  const fresh = f.store.list('codex_image_execution_mapping', f.project.id).find(row => row.id !== mapping.id);
  assert.equal(fresh.native.runtime.runtimeVersion, '0.162.1'); assert.equal(fresh.transport.runtimeVersion, '0.162.1');
  assert.equal(fresh.native.runtime.model, 'gpt-6-astra'); assert.equal(fresh.transport.model, 'gpt-6-astra');
  assert.deepEqual(fresh.profileDefinition, mapping.profileDefinition, 'new intent retains the locked profile');
  assertCodexImageRecords(f.store, f.store.get('attempt', fresh.id));
  for (const [kind, rows] of Object.entries(before)) for (const row of rows)
    assert.deepEqual(f.store.get(kind, row.id), row, `no saved ${kind} is rewritten`);
  assert.equal(f.plans.view(f.project.id).spentMicros, view.spentMicros);
  await f.restart();
  const finished = records(), finishedCalls = { ...f.calls };
  await f.plans.replay(f.project.id); await f.finish();
  assert.equal(digest(records()), digest(finished)); assert.deepEqual(f.calls, finishedCalls);
  assert.equal(f.fake.acceptedCount(), 0);
});

test('an old keyframe card reuses its saved image and choice across restart; only a changed prompt makes one new picture', async t => {
  const f = await oldFilm(t), source = prompt => `export default async function(ctx) {
    await ctx.shot({id:'opening',title:'Opening'});
    await ctx.keyframe('opening',{model:'${codexImageProfile.id}',prompt:${JSON.stringify(prompt)},video:{model:'${videoProfile.id}',durationSeconds:6}});
  }`;
  const waitForCard = async () => {
    for (let i = 0; i < 16; i++) {
      await f.tick(); const view = f.plans.view(f.project.id);
      assert.notEqual(view.state, 'error', JSON.stringify(view.error));
      if (view.choices.some(choice => !choice.stale)) return view;
    }
    assert.fail(JSON.stringify(f.plans.view(f.project.id)));
  };
  const calls = { ...f.calls }, attempts = f.execution.attempts(f.project.id).length;
  const receipt = await f.submit(source('A window at dawn')), waiting = await waitForCard();
  assert.equal(receipt.diff.reusedSteps, 1); assert.equal(receipt.diff.newSteps.length, 0);
  assert.deepEqual(f.calls, calls); assert.equal(f.execution.attempts(f.project.id).length, attempts);
  const choice = waiting.choices.find(row => !row.stale), key = waiting.steps[0].key, lock = f.store.get('capability_lock', f.project.capabilityLockId);
  await f.restart(); await f.plans.replay(f.project.id); await waitForCard();
  const unchanged = await f.submit(source('A window at dawn')); await waitForCard();
  assert.equal(unchanged.diff.reusedSteps, 1); assert.equal(unchanged.diff.newSteps.length, 0);
  assert.equal(f.plans.view(f.project.id).choices.find(row => !row.stale).choiceId, choice.choiceId);
  assert.equal(f.plans.steps(f.project.id)[0].key, key); assert.deepEqual(f.calls, calls);
  await f.submit(source('A different opening picture')); const changed = await waitForCard();
  assert.equal(f.execution.attempts(f.project.id).length, attempts + 1);
  assert.equal(f.calls.start, calls.start + 1); assert.equal(f.calls.prepare, calls.prepare + 1);
  assert.equal(changed.choices.find(row => !row.stale).options[0].sha256, changed.steps.find(step => step.key !== key).artifact.sha256);
  assert.equal(changed.choices.find(row => row.choiceId === choice.choiceId).stale, true);
  const fresh = f.store.list('codex_image_execution_mapping', f.project.id).find(row => row.native.runtime.runtimeVersion === '0.162.1');
  assert.ok(fresh); assertCodexImageRecords(f.store, f.store.get('attempt', fresh.id));
  assert.deepEqual(f.store.get('capability_lock', lock.id), lock);
});

for (const difference of ['revision', 'id', 'missing']) test(`an old film stays retired when the installed image profile differs by ${difference}`, async t => {
  const profile = structuredClone(codexImageProfile);
  if (difference !== 'missing') profile[difference] += '-changed';
  const f = await oldFilm(t, { profiles: difference === 'missing' ? [videoProfile] : [profile, videoProfile] });
  const calls = { ...f.calls }, before = f.execution.attempts(f.project.id), lock = f.store.get('capability_lock', f.project.capabilityLockId);
  const row = f.mediaRuntime.providerCatalog.projectView(lock.profiles, undefined, lock.localExecution).profiles.find(row => row.id === codexImageProfile.id);
  assert.equal(row.installedDefinition, false); assert.equal(row.readiness.realExecutionEnabled, false);
  const source = f.store.list('code_plan_version', f.project.id)[0].source;
  const receipt = await f.submit(source); await f.finish();
  assert.equal(receipt.diff.reusedSteps, 1); assert.equal(receipt.diff.newSteps.length, 0);
  await f.submit(source.replace('A window at dawn', 'A new retired image')); await f.tick();
  assert.equal(f.plans.getRun(f.project.id).state, 'error');
  assert.deepEqual(f.execution.attempts(f.project.id), before); assert.deepEqual(f.calls, calls);
  assert.deepEqual(f.store.get('capability_lock', lock.id), lock);
});

test('new Codex image work records 0.162.1 and retains gpt-6-astra', async t => {
  const f = await realCodeFixture(t); await f.submit(imageSource); await f.finish();
  const mapping = f.store.list('codex_image_execution_mapping', f.project.id)[0];
  assert.equal(mapping.native.runtime.runtimeVersion, '0.162.1'); assert.equal(mapping.transport.runtimeVersion, '0.162.1');
  assert.equal(mapping.native.runtime.model, 'gpt-6-astra'); assert.equal(mapping.transport.model, 'gpt-6-astra');
  assert.equal(mapping.profileDefinition.configuration.settings.runtimeVersion, '0.162.1');
  const downgraded = structuredClone(mapping);
  downgraded.native.runtime.runtimeVersion = '0.153.4';
  downgraded.transport = describeCodexImageInput({ ...mapping.transport, runtimeVersion: '0.153.4' });
  downgraded.native.session.turnInputDigest = downgraded.transport.turnInputDigest;
  assert.throws(() => assertCodexImageExecutionMapping(f.store.get('attempt', mapping.id), downgraded), { code: 'CODEX_IMAGE_EXECUTION_CONFLICT' });
});

test('an upgraded old-film turn with an unknown outcome reconciles across restart without another prepare or start', async t => {
  const f = await oldFilm(t); f.controls.lostStart = true; f.controls.pending = true;
  const source = f.store.list('code_plan_version', f.project.id)[0].source.replace('A window at dawn', 'An uncertain new picture');
  await f.submit(source); await f.tick();
  const mapping = f.store.list('codex_image_execution_mapping', f.project.id).find(row => row.native.runtime.runtimeVersion === '0.162.1');
  assert.ok(mapping); assert.equal(f.calls.start, 1); assert.equal(f.calls.prepare, 1);
  const intent = f.store.get('code_plan_execution', mapping.id), marker = f.store.get('codex_image_execution_dispatch', mapping.id);
  assert.equal(f.store.get('attempt', mapping.id).phase, 'submission_unknown');
  await f.restart(); await f.tick(); await f.tick();
  assert.equal(f.calls.start, 1); assert.equal(f.calls.prepare, 1);
  assert.equal(f.store.get('attempt', mapping.id).phase, 'submission_unknown');
  assert.deepEqual(f.store.get('codex_image_execution_mapping', mapping.id), mapping);
  assert.deepEqual(f.store.get('codex_image_execution_dispatch', mapping.id), marker);
  assert.equal(f.store.get('code_plan_execution', mapping.id).requestDigest, intent.requestDigest);
  f.controls.pending = false; await f.tick();
  assert.equal(f.store.get('attempt', mapping.id).phase, 'succeeded');
  assertCodexImageRecords(f.store, f.store.get('attempt', mapping.id));
  assert.equal(f.calls.start, 1); assert.equal(f.calls.prepare, 1); assert.equal(f.fake.acceptedCount(), 0);
});
