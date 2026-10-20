import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toolCatalog } from '@openslate/core';
import { loadSkillCatalog } from '../dist/index.js';

test('expected source package pins are checked for the whole catalog before publishing any snapshot', t => {
  const root = mkdtempSync(join(tmpdir(), 'openslate-skill-source-pins-')), snapshotRoot = join(root, 'snapshots'), skills = fileURLToPath(new URL('../../../skills/', import.meta.url));
  const writable = path => { chmodSync(path, 0o700); for (const row of readdirSync(path, { withFileTypes: true })) if (row.isDirectory()) writable(join(path, row.name)); };
  t.after(() => { writable(root); rmSync(root, { recursive: true, force: true }); });
  const options = { snapshotRoot, compatibility: { toolContract: '1.0.0', planLanguage: '1.0.0', workflowContract: '1.0.0' }, availableToolIds: toolCatalog('1.0.0').names,
    packageRoots: [join(skills, 'production'), join(skills, 'plan-authoring')] };
  const pins = { production: 'a0ee6a6b355eb340ea18de2e4adcdeb9ab1cb5102d7cda6eac0209442c2197b2', 'plan-authoring': 'f0284e141496a4b2ee6e19be5903e78c03c412df1614958ba3257f295347378a' };
  for (const expectedPackageDigests of [{ ...pins, 'plan-authoring': '0'.repeat(64) }, { production: pins.production }]) {
    assert.throws(() => loadSkillCatalog({ ...options, expectedPackageDigests }), { code: 'SKILL_PACKAGE_MISMATCH' });
    assert.equal(existsSync(snapshotRoot), false, 'a catalog mismatch publishes neither its matching nor its mismatching package');
  }
  assert.deepEqual(loadSkillCatalog({ ...options, expectedPackageDigests: pins }).skills.map(skill => skill.packageDigest).sort(), Object.values(pins).sort());
});
