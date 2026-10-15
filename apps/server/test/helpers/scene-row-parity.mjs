import assert from 'node:assert/strict';
import { legacySceneView } from './b2-scene-reference.ts';
import { sceneView } from '../../dist/scene-generation.js';

export function assertSceneRowParity(service, projectId) {
  for (const scene of service.store.getProject(projectId).scenes) {
    let original;
    try { original = legacySceneView(service, projectId, scene.id); }
    catch (error) {
      assert.throws(() => sceneView(service, projectId, scene.id), { code: error.code });
      continue;
    }
    const actual = sceneView(service, projectId, scene.id);
    // GR-12 deliberately fixes the old held-candidate pending flags after extraction parity.
    const holds = service.store.list('hold', projectId).filter(h => h.active &&
      [projectId, scene.id, ...original.view.rows.map(r => r.shotId)].includes(h.scopeId));
    const expected = structuredClone(original.view.rows);
    if (holds.length) for (const row of expected) {
      const current = actual.view.rows.find(r => r.shotId === row.shotId);
      row.imagePending = current.imagePending;
      row.videoPending = current.videoPending;
    }
    assert.deepEqual(actual.view.rows, expected);
  }
}
