import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { digest } from '@openslate/core';
import { describeCodexImageInput } from '@openslate/providers';
import { realCodeFixture, imageSource } from './code-plan-providers-fixture.mjs';
import { assertCodexImageRecords } from '../dist/execution/codex-image-lineage.js';
import { assertCodexImageOperationOptions } from '../dist/execution/codex-image-receipts.js';
import { profilePolicy } from '../dist/application/provider-catalog.js';

// Frozen synthetic old film, including its original plan keys, full profile lock and native/output receipts.
// JSON records and tiny generated PNG bytes only; no database or customer media.
const history = readFileSync(new URL('./codex-image-0.153.4-film.json', import.meta.url), 'utf8');

test('a completed 0.153.4 image film reopens and replays under 0.162.1 with identical keys/receipts and no attempt or charge', async t => {
  const f = await realCodeFixture(t), saved = JSON.parse(history.replaceAll('@ROOT@', f.root));
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
  // A saved profile is valid history, but cannot authorize a fresh turn on the retired runtime.
  assert.throws(() => profilePolicy(mapping.profileDefinition), { code: 'PROVIDER_CATALOG_INVALID' });
  assert.doesNotThrow(() => profilePolicy(mapping.profileDefinition, { historical: true }));
  assert.throws(() => assertCodexImageOperationOptions(mapping.profileDefinition, attempt.request.args), { code: 'CODEX_IMAGE_PREFLIGHT_INVALID' });
  await f.submit(source.replace('A window at dawn', 'Changed historical input')); await f.tick();
  assert.equal(f.plans.getRun(f.project.id).state, 'error');
  assert.equal(f.execution.attempts(f.project.id).length, count); assert.deepEqual(f.calls, calls);
});

test('new Codex image work records 0.162.1 and retains gpt-6-astra', async t => {
  const f = await realCodeFixture(t); await f.submit(imageSource); await f.finish();
  const mapping = f.store.list('codex_image_execution_mapping', f.project.id)[0];
  assert.equal(mapping.native.runtime.runtimeVersion, '0.162.1'); assert.equal(mapping.transport.runtimeVersion, '0.162.1');
  assert.equal(mapping.native.runtime.model, 'gpt-6-astra'); assert.equal(mapping.transport.model, 'gpt-6-astra');
  assert.equal(mapping.profileDefinition.configuration.settings.runtimeVersion, '0.162.1');
});
