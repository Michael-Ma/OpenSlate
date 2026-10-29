import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { digest, STAGES, toolCatalog } from '../../packages/core/dist/index.js';
import { checkSkillReleaseAlignment, parseShippedSkillReleases, planSkillRelease, skillPackageContentDigest, skillPackageDigest, skillPackageWithToolContract, skillPackageWithVersion, skillReleaseDirectory } from '../../packages/director/dist/index.js';
import { createDirectorReleaseLock, releaseDirectory } from '../../apps/server/dist/application/director-capabilities.js';
import { verifyShippedDirectorGuidance } from '../../apps/server/dist/application/director-shipped-guidance.js';
import { appendShippedRelease, checkSkillReleases, draftSkillRelease, readReleaseSource, releaseSkills, removeTemporary } from '../lib/skill-releases.mjs';
import { parseSkillArguments, runSkills } from '../skills.mjs';

const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
const rows = parseShippedSkillReleases(readFileSync(join(repositoryRoot, 'skills/shipped-releases.json'), 'utf8'));
const history = rows.map(row => readReleaseSource(join(repositoryRoot, skillReleaseDirectory(row.guidanceVersion))));
const latest = rows.at(-1), base = history.at(-1);
const [major, minor, patch] = latest.guidanceVersion.split('.').map(Number);
const next = { patch: `${major}.${minor}.${patch + 1}`, minor: `${major}.${minor + 1}.0`, major: `${major + 1}.0.0` };
const nextDirectory = skillReleaseDirectory(next.patch);
const changedDraft = () => {
  const draft = structuredClone(base);
  draft.packages.production['SKILL.md'] += '\nRelease automation test guidance.\n';
  return draft;
};
const plan = (extra = {}) => planSkillRelease({ rows, history, draft: changedDraft(), ...extra });
function fixture(t, count = rows.length) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-f2-'));
  t.after(() => removeTemporary(root));
  mkdirSync(join(root, 'skills'));
  for (const row of rows.slice(0, count)) cpSync(join(repositoryRoot, skillReleaseDirectory(row.guidanceVersion)), join(root, skillReleaseDirectory(row.guidanceVersion)), { recursive: true });
  writeFileSync(join(root, 'skills/shipped-releases.json'), JSON.stringify(rows.slice(0, count), null, 2) + '\n');
  return root;
}
function writeSource(root, source) {
  for (const [id, files] of Object.entries(source.packages)) for (const [path, content] of Object.entries(files)) writeFileSync(join(root, id, path), content);
  source.release.packages = source.release.packages.map(pin => ({ ...pin, version: JSON.parse(source.packages[pin.id]['openslate.skill.json']).version, packageDigest: skillPackageDigest(source.packages[pin.id]) }));
  writeFileSync(join(root, 'release.json'), JSON.stringify(source.release, null, 2) + '\n');
}
function repin(root, row, source) {
  const target = join(root, skillReleaseDirectory(row.guidanceVersion));
  writeSource(target, source);
  const data = JSON.parse(readFileSync(join(root, 'skills/shipped-releases.json'), 'utf8'));
  data[data.length - 1] = { ...row, releaseDigest: digest(source.release) };
  writeFileSync(join(root, 'skills/shipped-releases.json'), JSON.stringify(data, null, 2) + '\n');
}

test('skills:check validates every shipped row and the actual server releaseDirectory mapping', () => {
  const result = checkSkillReleases(repositoryRoot, { resolveDirectory: releaseDirectory });
  console.log(result.message);
  assert.equal(result.rows.length, rows.length);
  assert.match(result.message, /Verified/);
  for (const row of rows) assert.equal(row.handlerDigest, toolCatalog(row.toolContract).digest);
});

for (const [bump, version] of Object.entries(next)) {
  test(`pure planner computes ${bump}, changes only one package and preserves all other digests/bytes`, () => {
    const result = plan({ bump });
    assert.equal(result.row.guidanceVersion, version);
    assert.deepEqual(result.changed, ['production']);
    for (const pin of result.release.packages) {
      assert.equal(pin.packageDigest, skillPackageDigest(result.packages[pin.id]));
      if (pin.id === 'production') assert.equal(pin.version, version);
      else {
        assert.deepEqual(result.packages[pin.id], base.packages[pin.id]);
        assert.deepEqual(pin, base.release.packages.find(old => old.id === pin.id));
      }
    }
    assert.equal(result.row.releaseDigest, digest(result.release));
  });
}

test('planner ignores only manifest version bytes, refuses no change and version-only authoring, and counts formatting changes', () => {
  assert.throws(() => plan({ draft: base }), { code: 'SKILL_RELEASE_NO_CHANGE' });
  const draft = structuredClone(base);
  draft.packages.production = skillPackageWithVersion(draft.packages.production, '99.0.0');
  assert.throws(() => plan({ draft }), { code: 'SKILL_RELEASE_NO_CHANGE' });
  draft.packages.production['openslate.skill.json'] += '\n';
  assert.deepEqual(plan({ draft }).changed, ['production']);
});

test('unchanged authored versions are discarded and exact previous manifests survive', () => {
  const draft = changedDraft();
  draft.packages['craft-story'] = skillPackageWithVersion(draft.packages['craft-story'], '99.0.0');
  assert.deepEqual(plan({ draft }).packages['craft-story'], base.packages['craft-story']);
});

test('planner accepts release metadata-only changes without bumping package versions', () => {
  const draft = structuredClone(base); draft.release.budget.injectedWords++;
  const result = plan({ draft });
  assert.deepEqual(result.changed, []); assert.deepEqual(result.release.packages, base.release.packages);
});

test('planner refuses target-directory and shipped-version collisions', () => {
  assert.throws(() => plan({ existingDirectories: [nextDirectory] }), { code: 'SKILL_RELEASE_EXISTS' });
  assert.throws(() => plan({ rows: [...rows, latest] }), { code: 'SKILL_RELEASE_COLLISION' });
});

test('contract option validates release support and compatibility changes count as package content', () => {
  assert.throws(() => plan({ contract: '6.0.0' }), { code: 'SKILL_RELEASE_INVALID' });
  assert.throws(() => plan({ contract: '999.0.0' }), { code: 'SKILL_RELEASE_INVALID' });
  const draft = changedDraft();
  // Exercise selection without inventing a new catalog; restore a valid selected value across every package.
  for (const [id, files] of Object.entries(draft.packages)) draft.packages[id] = skillPackageWithToolContract(files, '6.0.0');
  const result = plan({ draft, contract: latest.toolContract });
  for (const files of Object.values(result.packages)) assert.equal(JSON.parse(files['openslate.skill.json']).compatibility.toolContract, latest.toolContract);
  assert.deepEqual(result.changed, ['production']);
});

test('one-time 8.0.2 realignment derives exactly four 8.0.1 versions and retains eighteen historical digests', () => {
  const result = planSkillRelease({ rows: rows.slice(0, 2), history: history.slice(0, 2), draft: history[1], realign: true });
  assert.equal(result.row.guidanceVersion, '8.0.2'); assert.equal(result.row.realign, true);
  assert.deepEqual(result.changed, []);
  assert.deepEqual(result.release.packages.filter(pin => pin.version === '8.0.1').map(pin => pin.id).sort(), ['craft-shot-prompting', 'craft-visual-style', 'plan-authoring', 'production']);
  assert.equal(result.release.packages.filter(pin => pin.version === '8.0.0').length, 18);
  assert.deepEqual(result.release, history[2].release);
  for (const pin of result.release.packages) assert.equal(skillPackageContentDigest(result.packages[pin.id]), skillPackageContentDigest(history[1].packages[pin.id]));
  assert.throws(() => plan({ realign: true }), /Realignment|realign/);
  const changed = structuredClone(history[1]); changed.packages.production['SKILL.md'] += '\nChanged.\n';
  assert.throws(() => planSkillRelease({ rows: rows.slice(0, 2), history: history.slice(0, 2), draft: changed, realign: true }), /cannot change package content/);
  assert.throws(() => planSkillRelease({ rows: rows.slice(0, 2), history: history.slice(0, 2), draft: history[1], realign: true, bump: 'minor' }), /realign/);
});

test('row schema fails closed for malformed, unsupported, duplicate-key and unordered data and freezes rows', () => {
  assert.ok(Object.isFrozen(rows)); for (const row of rows) assert.ok(Object.isFrozen(row));
  for (const bad of [[], [{ ...latest, toolContract: '99.0.0' }], [{ ...latest, extra: true }], [{ ...latest, releaseDigest: 'oops' }], [{ ...latest, guidanceVersion: '8.00.2' }], [...rows].reverse(), [{ ...latest, realign: true }]])
    assert.throws(() => parseShippedSkillReleases(JSON.stringify(bad)));
  assert.throws(() => parseShippedSkillReleases('[{"toolContract":"7.0.0","toolContract":"7.0.0"}]'), /Duplicate/);
  assert.throws(() => parseShippedSkillReleases('{broken'));
});

test('appending data keeps every historical row byte-for-byte', () => {
  const source = readFileSync(join(repositoryRoot, 'skills/shipped-releases.json'), 'utf8');
  const appended = appendShippedRelease(source, plan().row);
  assert.ok(appended.startsWith(source.slice(0, source.lastIndexOf(']')).trimEnd()));
  assert.deepEqual(parseShippedSkillReleases(appended).slice(0, -1), rows);
});

for (const bump of ['patch', 'minor', 'major']) test(`draft → edit → ${bump} release in a temporary tree is accepted by loader and Director lock`, t => {
  const root = fixture(t), historicalBytes = rows.map(row => readFileSync(join(root, skillReleaseDirectory(row.guidanceVersion), 'release.json')));
  assert.match(runSkills(['draft'], root), /Drafted/);
  assert.throws(() => runSkills(['draft'], root), { code: 'SKILL_RELEASE_DRAFT' });
  const file = join(root, 'skills/next/production/SKILL.md'); writeFileSync(file, readFileSync(file, 'utf8') + '\nOffline test release.\n');
  if (bump === 'patch') {
    const manifest = join(root, 'skills/next/production/openslate.skill.json');
    writeFileSync(manifest, '\ufeff' + readFileSync(manifest, 'utf8'));
    writeFileSync(file, '\ufeff' + readFileSync(file, 'utf8'));
  }
  const args = ['release', ...(bump === 'patch' ? [] : [`--${bump}`]), '--note', 'Offline release test', '--contract', latest.toolContract];
  assert.match(runSkills(args, root), /Released/);
  assert.equal(existsSync(join(root, 'skills/next')), false);
  const result = checkSkillReleases(root, { resolveDirectory: releaseDirectory }), row = result.rows.at(-1);
  const configuration = { repositoryRoot: root, snapshotRoot: join(root, 'snapshots') };
  const current = createDirectorReleaseLock(configuration, row.toolContract, row.guidanceVersion, row.releaseDigest);
  verifyShippedDirectorGuidance(current.lock, configuration, result.rows);
  assert.deepEqual(current.lock.release, { version: row.guidanceVersion, releaseDigest: row.releaseDigest });
  for (const [index, old] of rows.entries()) assert.deepEqual(readFileSync(join(root, skillReleaseDirectory(old.guidanceVersion), 'release.json')), historicalBytes[index]);
});

test('realignment command succeeds in a temp copy and cannot run again', t => {
  const root = fixture(t, 2);
  draftSkillRelease(root); const result = releaseSkills(root, { realign: true });
  assert.equal(result.row.guidanceVersion, '8.0.2'); checkSkillReleases(root);
  draftSkillRelease(root); assert.throws(() => releaseSkills(root, { realign: true }));
  assert.ok(existsSync(join(root, 'skills/next')));
});

test('failed no-change or invalid draft releases preserve draft, rows and historical directories', t => {
  const root = fixture(t), data = readFileSync(join(root, 'skills/shipped-releases.json'));
  draftSkillRelease(root);
  assert.throws(() => releaseSkills(root), { code: 'SKILL_RELEASE_NO_CHANGE' });
  const path = join(root, 'skills/next/production/SKILL.md');
  writeFileSync(path, readFileSync(path, 'utf8') + '\n[Missing](references/absent.md)\n');
  assert.throws(() => releaseSkills(root), /Undeclared Markdown reference/);
  assert.deepEqual(readFileSync(join(root, 'skills/shipped-releases.json')), data);
  assert.ok(existsSync(path)); assert.equal(existsSync(join(root, nextDirectory)), false);
  assert.equal(existsSync(join(root, 'skills/.release-lock')), false);
});

test('CLI rejects unknown, conflicting and missing options; an exclusive lock refuses parallel writers', t => {
  for (const args of [[], ['release', '--major', '--minor'], ['release', '--note'], ['release', '--contract'], ['release', '--unknown'], ['draft', '--realign'], ['check', '--major'], ['release', '--realign', '--realign'], ['release', '--note', 'x', '--note', 'y']]) assert.throws(() => parseSkillArguments(args));
  const root = fixture(t); mkdirSync(join(root, 'skills/.release-lock'));
  assert.throws(() => draftSkillRelease(root), /Another skills command/);
});

test('checker rejects raw shipped package byte drift and changed release digests', t => {
  const root = fixture(t), target = join(root, 'skills/v8/production/SKILL.md');
  writeFileSync(target, readFileSync(target, 'utf8') + '\nDrift.\n');
  assert.throws(() => checkSkillReleases(root), { code: 'SKILL_PACKAGE_MISMATCH' });
  const other = fixture(t), path = join(other, 'skills/v8/release.json'), release = JSON.parse(readFileSync(path, 'utf8')); release.budget.injectedWords++;
  writeFileSync(path, JSON.stringify(release)); assert.throws(() => checkSkillReleases(other), { code: 'SKILL_PACKAGE_MISMATCH' });
});

test('checker rejects content changes without aligned versions, even with recomputed package/release digests', t => {
  const root = fixture(t); draftSkillRelease(root);
  const file = join(root, 'skills/next/production/SKILL.md'); writeFileSync(file, readFileSync(file, 'utf8') + '\nChanged.\n');
  const released = releaseSkills(root), source = readReleaseSource(join(root, released.directory));
  source.packages.production = skillPackageWithVersion(source.packages.production, '8.0.1'); repin(root, released.row, source);
  assert.throws(() => checkSkillReleases(root), { code: 'SKILL_RELEASE_ALIGNMENT' });
});

test('checker rejects version moves without content changes outside the recorded realignment', t => {
  const root = fixture(t); draftSkillRelease(root);
  const file = join(root, 'skills/next/production/SKILL.md'); writeFileSync(file, readFileSync(file, 'utf8') + '\nChanged.\n');
  const released = releaseSkills(root), source = readReleaseSource(join(root, released.directory));
  source.packages['craft-story'] = skillPackageWithVersion(source.packages['craft-story'], released.row.guidanceVersion); repin(root, released.row, source);
  assert.throws(() => checkSkillReleases(root), { code: 'SKILL_RELEASE_ALIGNMENT' });
});

test('checker rejects duplicate rows, missing/misresolved/unregistered directories and handler drift', t => {
  const root = fixture(t), path = join(root, 'skills/shipped-releases.json');
  writeFileSync(path, JSON.stringify([...rows, latest])); assert.throws(() => checkSkillReleases(root), { code: 'SKILL_RELEASE_COLLISION' });
  writeFileSync(path, JSON.stringify(rows));
  assert.throws(() => checkSkillReleases(root, { resolveDirectory: () => 'skills/v8' }), /releaseDirectory/);
  renameSync(join(root, 'skills/v8.0.2'), join(root, 'missing'));
  assert.throws(() => checkSkillReleases(root), /ENOENT/);
  renameSync(join(root, 'missing'), join(root, 'skills/v8.0.2')); mkdirSync(join(root, nextDirectory));
  assert.throws(() => checkSkillReleases(root), /Unregistered/); removeTemporary(join(root, nextDirectory));
  writeFileSync(path, JSON.stringify(rows.map((row, index) => index ? row : { ...row, handlerDigest: 'a'.repeat(64) })));
  assert.throws(() => checkSkillReleases(root), /Handler digest/);
});

test('checker refuses leftover drafts and names the local environment override', t => {
  const root = fixture(t); draftSkillRelease(root);
  assert.throws(() => checkSkillReleases(root, { allowDraft: false }), /OPENSLATE_SKILLS_DRAFT=1/);
  assert.match(checkSkillReleases(root, { allowDraft: true }).message, /skills\/next\/ allowed locally by OPENSLATE_SKILLS_DRAFT=1/);
});

test('recorded realignment must have identical content and the correct historical last-change versions', () => {
  const corrupted = structuredClone(history); corrupted[2].packages.production['SKILL.md'] += '\nChanged.\n';
  assert.throws(() => checkSkillReleaseAlignment(rows, corrupted), /Realignment changed production content/);
  const wrong = structuredClone(history); wrong[2].release.packages.find(pin => pin.id === 'production').version = '8.0.2';
  assert.throws(() => checkSkillReleaseAlignment(rows, wrong), { code: 'SKILL_RELEASE_ALIGNMENT' });
});


test('escaped manifest keys/values and UTF-8 BOMs retain all bytes outside the selected value', () => {
  const files = structuredClone(base.packages.production);
  files['openslate.skill.json'] = '\ufeff' + files['openslate.skill.json'].replace('"version"', '"ver\\u0073ion"').replace(/("ver\\u0073ion"\s*:\s*)"[^"]*"/, '$1"8\\u002e0.1"');
  files['SKILL.md'] = '\ufeff' + files['SKILL.md'];
  const updated = skillPackageWithVersion(files, next.patch);
  assert.equal(updated['SKILL.md'], files['SKILL.md']);
  assert.ok(updated['openslate.skill.json'].startsWith('\ufeff'));
  assert.ok(updated['openslate.skill.json'].includes('"ver\\u0073ion"'));
  assert.equal(JSON.parse(updated['openslate.skill.json'].slice(1)).version, next.patch);
  assert.equal(skillPackageContentDigest(updated), skillPackageContentDigest(files));
});

for (const failure of ['directory', 'rows']) test(`publication ${failure} failure restores the exact draft and row data`, t => {
  const root = fixture(t); draftSkillRelease(root);
  const path = join(root, 'skills/next/production/SKILL.md'); writeFileSync(path, readFileSync(path, 'utf8') + '\nRollback test.\n');
  const before = readReleaseSource(join(root, 'skills/next')), data = readFileSync(join(root, 'skills/shipped-releases.json'));
  const originalRename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if ((failure === 'rows' && to === join(root, 'skills/shipped-releases.json')) || (failure === 'directory' && to === join(root, nextDirectory)))
      throw Object.assign(new Error('Injected publication failure'), { code: 'EIO' });
    return originalRename(from, to);
  });
  syncBuiltinESMExports();
  try { assert.throws(() => releaseSkills(root), /Injected publication failure/); }
  finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
  assert.deepEqual(readReleaseSource(join(root, 'skills/next')), before);
  assert.deepEqual(readFileSync(join(root, 'skills/shipped-releases.json')), data);
  assert.equal(existsSync(join(root, nextDirectory)), false);
  assert.equal(existsSync(join(root, 'skills/.release-lock')), false);
  assert.ok(readdirSync(join(root, 'skills')).every(name => !name.startsWith('.release-')));
});


function withoutDirectorRequirement(source, requirement) {
  if (requirement === 'production') {
    source.release.core = source.release.core.filter(id => id !== 'production');
    source.release.inject = source.release.inject.filter(entry => entry.package !== 'production');
    source.release.packages = source.release.packages.filter(pin => pin.id !== 'production');
    delete source.packages.production;
  } else if (requirement === 'extra stage') {
    const files = source.packages.production, path = 'references/stages/extra.md';
    files[path] = '# Extra stage\n';
    const manifest = JSON.parse(files['openslate.skill.json']); manifest.files.push(path);
    files['openslate.skill.json'] = JSON.stringify(manifest, null, 2) + '\n';
  } else {
    const from = `references/stages/${STAGES[0]}.md`, to = 'references/stages/renamed.md';
    const files = source.packages.production;
    files[to] = files[from]; delete files[from];
    for (const [path, content] of Object.entries(files)) files[path] = content.replaceAll(from, to);
  }
  return source;
}
for (const requirement of ['production', 'stage prompt', 'extra stage']) test(`release and checker refuse an invalid Director ${requirement} even when the generic package graph is valid`, t => {
  const root = fixture(t); draftSkillRelease(root);
  const draftRoot = join(root, 'skills/next'), draft = withoutDirectorRequirement(readReleaseSource(draftRoot), requirement);
  if (requirement === 'production') removeTemporary(join(draftRoot, 'production'));
  else if (requirement === 'stage prompt') renameSync(join(draftRoot, `production/references/stages/${STAGES[0]}.md`), join(draftRoot, 'production/references/stages/renamed.md'));
  writeSource(draftRoot, draft);
  const before = readFileSync(join(root, 'skills/shipped-releases.json'));
  assert.throws(() => releaseSkills(root), /production core package|Task prompt must be a declared instruction file|stage prompt inventory/);
  assert.deepEqual(readFileSync(join(root, 'skills/shipped-releases.json')), before);
  assert.equal(existsSync(join(root, nextDirectory)), false);
  assert.deepEqual(readReleaseSource(draftRoot), draft);
  const shippedRoot = join(root, skillReleaseDirectory(latest.guidanceVersion));
  const shipped = withoutDirectorRequirement(readReleaseSource(shippedRoot), requirement);
  if (requirement === 'production') removeTemporary(join(shippedRoot, 'production'));
  else if (requirement === 'stage prompt') renameSync(join(shippedRoot, `production/references/stages/${STAGES[0]}.md`), join(shippedRoot, 'production/references/stages/renamed.md'));
  repin(root, latest, shipped);
  assert.throws(() => checkSkillReleases(root, { allowDraft: true }), /production core package|Task prompt must be a declared instruction file|stage prompt inventory/);
});


for (const violation of ['budget', 'non-core policy']) test(`release and checker enforce ${violation} on every successor`, t => {
  const root = fixture(t); draftSkillRelease(root);
  const draftRoot = join(root, 'skills/next'), draft = readReleaseSource(draftRoot);
  if (violation === 'budget') draft.release.budget.injectedWords = 1;
  else draft.packages['craft-story']['SKILL.md'] += '\naccept_proposal is a core decision.\n';
  writeSource(draftRoot, draft);
  const expected = { code: violation === 'budget' ? 'SKILL_RELEASE_BUDGET' : 'SKILL_RELEASE_POLICY' };
  assert.throws(() => releaseSkills(root), expected);
  assert.equal(existsSync(join(root, nextDirectory)), false);
  const shipped = readReleaseSource(join(root, skillReleaseDirectory(latest.guidanceVersion)));
  if (violation === 'budget') shipped.release.budget.injectedWords = 1;
  else shipped.packages['craft-story']['SKILL.md'] += '\naccept_proposal is a core decision.\n';
  repin(root, latest, shipped);
  assert.throws(() => checkSkillReleases(root, { allowDraft: true }), expected);
});
