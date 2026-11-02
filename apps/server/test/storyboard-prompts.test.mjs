import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ProductionService } from '../dist/application/service.js';
import { editStoryboard } from '../dist/storyboard.js';
import { setup } from './execution-fixture.mjs';

const header = 'OpenSlate current direction:\n';
const separator = '\nReference details (retain only where consistent):\n';

for (const kind of ['shot', 'shotFields']) test(`${kind} composes exact picture and video direction without doubled stops`, t => {
  const f = setup(t), service = new ProductionService(f.store, f.engine);
  const project = f.store.getProject(f.projectId), shot = project.shots[0];
  Object.assign(shot, { purpose: ' One lamp on. ', action: 'The clerk pulls the shutter!', framing: ' Low-angle wide。 ', motion: 'Static？' });
  f.store.saveProject(project, project.headVersion);
  const fields = { purpose: 'One lamp on.' };
  const edit = { expectedHeadVersion: f.store.getProject(f.projectId).headVersion, kind, id: shot.id,
    ...(kind === 'shot' ? { field: 'purpose', value: fields.purpose } : { fields }) };
  const key = randomUUID();
  const receipt = editStoryboard(service, f.projectId, edit, key);
  const saved = f.store.getProject(f.projectId).shots[0];
  assert.equal(saved.imagePrompt, `${header}One lamp on. The clerk pulls the shutter! Low-angle wide。${separator}${shot.imagePrompt}`);
  assert.equal(saved.videoPrompt, `${header}One lamp on. The clerk pulls the shutter! Low-angle wide。 Camera movement: Static？${separator}${shot.videoPrompt}`);
  assert.deepEqual(editStoryboard(service, f.projectId, edit, key), receipt, 'same request replays without rewriting');
  editStoryboard(service, f.projectId, { expectedHeadVersion: receipt.headVersion, kind: 'shot', id: shot.id, field: 'motion', value: 'Slow pan…' }, randomUUID());
  const again = f.store.getProject(f.projectId).shots[0];
  assert.equal(again.imagePrompt, saved.imagePrompt);
  assert.equal(again.videoPrompt, `${header}One lamp on. The clerk pulls the shutter! Low-angle wide。 Camera movement: Slow pan…${separator}${shot.videoPrompt}`);
});

test('composed direction skips blank legacy parts and preserves an unchanged prompt', t => {
  const f = setup(t), service = new ProductionService(f.store, f.engine);
  const project = f.store.getProject(f.projectId), shot = project.shots[0];
  Object.assign(shot, { purpose: 'Mara pays', action: ' \n ', framing: 'Medium', motion: 'Static' });
  f.store.saveProject(project, project.headVersion);
  editStoryboard(service, f.projectId, { expectedHeadVersion: f.store.getProject(f.projectId).headVersion, kind: 'shot', id: shot.id, field: 'framing', value: 'Medium' }, randomUUID());
  const saved = f.store.getProject(f.projectId).shots[0];
  assert.equal(saved.imagePrompt, `${header}Mara pays. Medium${separator}${shot.imagePrompt}`);
  assert.equal(saved.videoPrompt, `${header}Mara pays. Medium. Camera movement: Static${separator}${shot.videoPrompt}`);
});
