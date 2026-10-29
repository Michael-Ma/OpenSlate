import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { toolCatalog } from '@openslate/core';
import { loadSkillCatalog } from '../dist/index.js';

for (const [label, version, directory, pins] of [
  ['V1', '1.0.0', '', { production: 'a0ee6a6b355eb340ea18de2e4adcdeb9ab1cb5102d7cda6eac0209442c2197b2', 'plan-authoring': 'f0284e141496a4b2ee6e19be5903e78c03c412df1614958ba3257f295347378a' }],
  ['current V7', '6.0.0', 'v7', { production: '6d86d6772bbaeadbf967f3d7d73b2e8531e56501096c8703acd226b339b439f5', 'plan-authoring': '16cb63a6398eaa11c2b474f05fe0cd52f12e46d603a6544e3aa2076b954d16cf' }],
]) test(`${label} source package pins are checked for the whole catalog before publishing any snapshot`, t => {
  const root = mkdtempSync(join(tmpdir(), 'openslate-skill-source-pins-')), snapshotRoot = join(root, 'snapshots'), skills = fileURLToPath(new URL('../../../skills/', import.meta.url));
  const writable = path => { chmodSync(path, 0o700); for (const row of readdirSync(path, { withFileTypes: true })) if (row.isDirectory()) writable(join(path, row.name)); };
  t.after(() => { writable(root); rmSync(root, { recursive: true, force: true }); });
  const options = { snapshotRoot, compatibility: { toolContract: version, planLanguage: '1.0.0', workflowContract: '1.0.0' }, availableToolIds: toolCatalog(version).names,
    packageRoots: [join(skills, directory, 'production'), join(skills, directory, 'plan-authoring')] };
  for (const expectedPackageDigests of [{ ...pins, 'plan-authoring': '0'.repeat(64) }, { production: pins.production }]) {
    assert.throws(() => loadSkillCatalog({ ...options, expectedPackageDigests }), { code: 'SKILL_PACKAGE_MISMATCH' });
    assert.equal(existsSync(snapshotRoot), false, 'a catalog mismatch publishes neither its matching nor its mismatching package');
  }
  assert.deepEqual(loadSkillCatalog({ ...options, expectedPackageDigests: pins }).skills.map(skill => skill.packageDigest).sort(), Object.values(pins).sort());
});
