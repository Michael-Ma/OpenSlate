import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setup } from './execution-fixture.mjs';
import { ProductionService } from '../dist/application/service.js';
import { editStoryboard } from '../dist/storyboard.js';

for (const kind of ['treatment:brief', 'treatment:story', 'moveShot']) {
  test(`Undo of ${kind} preserves every paid frame and clip without outdating bindings`, async t => {
    const f = setup(t), service = new ProductionService(f.store, f.engine);
    const edit = input => editStoryboard(service, f.projectId, {
      expectedHeadVersion: f.store.getProject(f.projectId).headVersion, ...input,
    }, randomUUID());
    await f.engine.runReady(); await f.engine.reconcile();
    const review = f.engine.reviewSnapshot(f.projectId);
    f.engine.approve(f.projectId, review.id, review.members.map(row => row.videoNodeId), 'undo-media-review');
    await f.engine.runReady(); await f.engine.reconcile();

    const before = f.store.getProject(f.projectId), outputs = f.engine.outputs(f.projectId);
    const bindings = f.store.list('node_binding', f.projectId);
    const attempts = f.engine.attempts(f.projectId), grants = f.store.list('grant', f.projectId);
    assert.equal(outputs.length, 4, 'both shots have a paid frame and clip');
    // Assembly is invalidated separately; it must not cause paid media to detach.
    const video = bindings.find(binding => binding.node.kind === 'video');
    for (const nodeKind of ['timeline', 'render']) {
      const id = `undo-media-${nodeKind}`;
      f.store.insert('node_binding', id, f.projectId, { ...video, id,
        node: { ...video.node, id, kind: nodeKind, shotId: null, inputs: [], requires: [] } });
    }
    const [command, field] = kind.split(':');
    const receipt = edit(command === 'treatment'
      ? { kind: command, field, value: 'New wording with the same shot intent' }
      : { kind: command, id: 'shot-0', sceneId: 'scene-1', beforeId: 'shot-1' });
    assert.deepEqual(f.engine.outputs(f.projectId), outputs, 'the forward edit preserves paid media');
    if (command === 'moveShot') assert.equal(f.store.getProject(f.projectId).shots[0].sceneId, 'scene-1');
    else assert.notEqual(f.store.getProject(f.projectId)[field], before[field]);

    const undone = edit({ kind: 'undo', commandId: receipt.commandId });
    const after = f.store.getProject(f.projectId);
    assert.deepEqual(after.shots, before.shots);
    assert.equal(after.brief, before.brief); assert.equal(after.story, before.story);
    assert.deepEqual(f.engine.outputs(f.projectId), outputs, 'Undo preserves the exact paid output identities');
    for (const binding of bindings) assert.deepEqual(f.store.get('node_binding', binding.id), binding);
    const savedUndo = f.store.get('storyboard_edit', undone.commandId).undo;
    assert.ok(savedUndo.bindings.every(binding => ['timeline', 'render'].includes(binding.node.kind)));
    assert.ok(!f.store.list('node_binding', f.projectId).some(binding =>
      ['image', 'video'].includes(binding.node.kind) && binding.outdated?.fields.includes('undo')));
    for (const nodeKind of ['timeline', 'render']) {
      const assembly = f.store.get('node_binding', `undo-media-${nodeKind}`);
      assert.equal(assembly.candidateId, null); assert.deepEqual(assembly.outputs, {});
    }
    await f.engine.runReady(); await f.engine.reconcile();
    assert.deepEqual(f.engine.attempts(f.projectId).filter(attempt =>
      ['image', 'video'].includes(attempt.request.kind)), attempts, 'Undo never buys replacement media');
    assert.deepEqual(f.store.list('grant', f.projectId), grants);
    assert.ok(!f.store.list('hold', f.projectId).some(hold => hold.active));
  });
}
