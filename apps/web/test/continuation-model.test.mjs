import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { coveredPendingEdits, makeEditContinuation } from '../src/legacy/continuation-model.ts';

const snapshot = () => ({ project: { id: 'project', headVersion: 7, shots: [{ id: 'shot-a', sceneId: 'scene-a' }, { id: 'shot-b', sceneId: 'scene-b' }] }, pendingEditContinuations: [
 { requestId: 'request-z', scopeIds: ['shot-a'], holdsDigest: 'a'.repeat(64) },
 { requestId: 'request-a', scopeIds: ['shot-a'], holdsDigest: 'b'.repeat(64) },
 { requestId: 'request-b', scopeIds: ['shot-b'], holdsDigest: 'c'.repeat(64) },
 { requestId: 'request-global', scopeIds: ['project'], holdsDigest: 'd'.repeat(64) },
] });
test('covering review selects only complete owners within the visible shot or scene scope', () => {
 const view = snapshot(); assert.deepEqual(coveredPendingEdits(view, ['shot-a']).map(x=>x.requestId), ['request-a','request-z']);
 assert.deepEqual(coveredPendingEdits(view, ['scene-a']).map(x=>x.requestId), ['request-a','request-z']);
 view.pendingEditContinuations[0].scopeIds.push('shot-b'); assert.deepEqual(coveredPendingEdits(view, ['shot-a']).map(x=>x.requestId), ['request-a']);
 assert.equal(coveredPendingEdits(view, ['project']).length, 4);
});
test('browser aggregate exactly matches canonical SHA256 tuple digest and preserves captured revision', async () => {
 const view=snapshot(), selected=coveredPendingEdits(view,['shot-a']), expected=createHash('sha256').update(JSON.stringify(selected.map(group=>[group.requestId,group.holdsDigest]))).digest('hex');
 const review=await makeEditContinuation(view,['shot-a']);assert.deepEqual(review,{headVersion:7,requestIds:['request-a','request-z'],holdsDigest:expected});
 assert.equal(await makeEditContinuation(view,['missing']),null);assert.equal(await makeEditContinuation({project:view.project},['project']),null);
});
