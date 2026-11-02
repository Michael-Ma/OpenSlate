import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { canonical, FILM_KIND_KINDS, invariant, STAGES, toolCatalog } from '../../packages/core/dist/index.js';
import { checkSkillReleaseAlignment, createSkillReleaseLock, loadSkillRelease, parseShippedSkillReleases, parseSkillRelease, planSkillRelease, readSkillPackageFiles, skillReleaseDirectory, skillReleaseBudget, skillStagePrompts } from '../../packages/director/dist/index.js';

export function removeTemporary(root) {
  if (!existsSync(root)) return;
  if (lstatSync(root).isDirectory()) {
    chmodSync(root, 0o700);
    for (const name of readdirSync(root)) removeTemporary(join(root, name));
  }
  rmSync(root, { recursive: true, force: true });
}
const rowsPath = root => join(root, 'skills/shipped-releases.json');
const readRows = root => parseShippedSkillReleases(readFileSync(rowsPath(root), 'utf8'));
export function readReleaseSource(root) {
  const release = parseSkillRelease(readFileSync(join(root, 'release.json'), 'utf8'));
  const entries = readdirSync(root).sort();
  invariant(canonical(entries) === canonical(['release.json', ...release.packages.map(pin => pin.id)].sort()), 'SKILL_RELEASE_INVALID', 'Release has missing or unlisted packages');
  const packages = Object.fromEntries(release.packages.map(pin => [pin.id, readSkillPackageFiles(join(root, pin.id))]));
  return { release, packages };
}
function verifySource(sourceRoot, row, snapshotRoot) {
  const catalog = toolCatalog(row.toolContract);
  invariant(row.handlerDigest === catalog.digest, 'SKILL_RELEASE_INVALID', `Handler digest changed for ${row.guidanceVersion}`);
  const loaded = loadSkillRelease({ releaseRoot: sourceRoot, snapshotRoot, expectedReleaseDigest: row.releaseDigest,
    compatibility: { toolContract: row.toolContract, planLanguage: '1.0.0', workflowContract: '1.0.0' }, availableToolIds: catalog.names, routeKinds: FILM_KIND_KINDS });
  invariant(loaded.release.release === row.guidanceVersion, 'SKILL_RELEASE_INVALID', `Release directory resolves another version: ${row.guidanceVersion}`);
  invariant(loaded.release.core.includes('production'), 'DIRECTOR_GUIDANCE_UNSUPPORTED', 'A guidance release needs the production core package');
  // Generic package graphs are broader than Director guidance. Exercise its exact lock prompt requirements too.
  const lock = createSkillReleaseLock(loaded, { bindings: [], prompts: STAGES.map(stage => ({ id: `production/${stage}@1`, skillId: 'production', path: `references/stages/${stage}.md` })) });
  const production = loaded.catalog.skills.find(skill => skill.id === 'production');
  invariant(canonical(lock.prompts) === canonical(skillStagePrompts(production)), 'DIRECTOR_GUIDANCE_UNSUPPORTED', 'Director stage prompt inventory differs from the runtime lock');
  const budget = skillReleaseBudget(loaded);
  invariant(budget.violations.length === 0, 'SKILL_RELEASE_BUDGET', budget.violations.join('; '));
  for (const skill of loaded.catalog.skills.filter(item => item.manifest.role !== 'core')) for (const file of skill.manifest.files)
    invariant(!/regenerate:\s*true|accept_proposal|reject_proposal/.test(readFileSync(join(skill.immutableRoot, file), 'utf8')),
      'SKILL_RELEASE_POLICY', `${skill.id}/${file} must leave permissions and decisions to core`);
}
/** Uses disposable snapshots. Never repairs a shipped source or writes into application state. */
export function checkSkillReleases(root, { allowDraft = process.env.OPENSLATE_SKILLS_DRAFT === '1', resolveDirectory = skillReleaseDirectory, skillReleaseBudget, skillStagePrompts } = {}) {
  const rows = readRows(root), draftExists = existsSync(join(root, 'skills/next'));
  invariant(!draftExists || allowDraft, 'SKILL_RELEASE_DRAFT', 'skills/next/ exists. Finish the draft, or set OPENSLATE_SKILLS_DRAFT=1 for local checks.');
  const known = new Set(rows.map(row => skillReleaseDirectory(row.guidanceVersion)));
  for (const name of readdirSync(join(root, 'skills'))) {
    if (/^v\d+(?:\.\d+\.\d+)?$/.test(name) && Number(name.slice(1).split('.')[0]) >= 8)
      invariant(known.has(`skills/${name}`), 'SKILL_RELEASE_INVALID', `Unregistered release directory: skills/${name}`);
  }
  const temporary = mkdtempSync(join(tmpdir(), 'openslate-skills-check-'));
  try {
    const history = rows.map(row => {
      const directory = resolveDirectory(row.guidanceVersion);
      invariant(directory === skillReleaseDirectory(row.guidanceVersion), 'SKILL_RELEASE_INVALID', `releaseDirectory() does not resolve ${row.guidanceVersion}`);
      const sourceRoot = join(root, directory);
      verifySource(sourceRoot, row, join(temporary, 'snapshots'));
      return readReleaseSource(sourceRoot);
    });
    checkSkillReleaseAlignment(rows, history);
    return { rows, history, message: `Verified ${rows.length} shipped releases.${draftExists ? ' skills/next/ allowed locally by OPENSLATE_SKILLS_DRAFT=1.' : ''}` };
  } finally { removeTemporary(temporary); }
}
function withReleaseLock(root, action) {
  const lock = join(root, 'skills/.release-lock');
  try { mkdirSync(lock); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Another skills command holds skills/.release-lock. After an interrupted command, inspect drafts/releases before removing the stale lock.'); throw error; }
  try { return action(); } finally { rmSync(lock, { recursive: true, force: true }); }
}
export function draftSkillRelease(root) {
  return withReleaseLock(root, () => {
    const draft = join(root, 'skills/next');
    invariant(!existsSync(draft), 'SKILL_RELEASE_DRAFT', 'skills/next/ already exists; finish or remove your draft first.');
    const { rows } = checkSkillReleases(root);
    // Copy to a private sibling first; a failed copy must not leave a half-authored next directory.
    const temporary = mkdtempSync(join(root, 'skills/.draft-'));
    try {
      cpSync(join(root, skillReleaseDirectory(rows.at(-1).guidanceVersion)), join(temporary, 'next'), { recursive: true });
      renameSync(join(temporary, 'next'), draft);
      return `Drafted ${rows.at(-1).guidanceVersion} into skills/next/.`;
    } finally { removeTemporary(temporary); }
  });
}
/** Append without serializing any existing row: historical row text remains exactly as shipped. */
export function appendShippedRelease(source, row) {
  const previous = parseShippedSkillReleases(source);
  const closing = source.lastIndexOf(']');
  const result = `${source.slice(0, closing).trimEnd()},\n${JSON.stringify(row, null, 2).split('\n').map(line => `  ${line}`).join('\n')}\n${source.slice(closing)}`;
  parseShippedSkillReleases(result);
  invariant(canonical(parseShippedSkillReleases(result).slice(0, -1)) === canonical(previous), 'SKILL_RELEASE_INVALID', 'Appending changed historical release rows');
  return result;
}
export function releaseSkills(root, options = {}) {
  return withReleaseLock(root, () => {
    const { rows, history } = checkSkillReleases(root, { allowDraft: true });
    const draftRoot = join(root, 'skills/next');
    invariant(existsSync(draftRoot), 'SKILL_RELEASE_DRAFT', 'No skills/next/ draft. Run pnpm skills:draft first.');
    const rowsSource = readFileSync(rowsPath(root), 'utf8');
    const draft = readReleaseSource(draftRoot);
    const plan = planSkillRelease({ ...options, rows, history, draft, existingDirectories: readdirSync(join(root, 'skills')).map(name => `skills/${name}`) });
    const temporary = mkdtempSync(join(root, 'skills/.release-'));
    const stage = join(temporary, 'release'), savedDraft = join(temporary, 'draft'), target = join(root, plan.directory);
    let published = false, movedDraft = false;
    try {
      mkdirSync(stage);
      for (const [id, files] of Object.entries(plan.packages)) for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(stage, id, path)), { recursive: true }); writeFileSync(join(stage, id, path), content);
      }
      writeFileSync(join(stage, 'release.json'), JSON.stringify(plan.release, null, 2) + '\n');
      verifySource(stage, plan.row, join(temporary, 'snapshots'));
      checkSkillReleaseAlignment([...rows, plan.row], [...history, readReleaseSource(stage)]);
      const appended = appendShippedRelease(rowsSource, plan.row), stagedRows = join(temporary, 'shipped-releases.json');
      writeFileSync(stagedRows, appended);
      invariant(readFileSync(rowsPath(root), 'utf8') === rowsSource, 'SKILL_RELEASE_COLLISION', 'Shipped rows changed during release; retry on the merged history');
      invariant(canonical(readReleaseSource(draftRoot)) === canonical(draft), 'SKILL_RELEASE_COLLISION', 'Draft changed during release; retry with stable authoring bytes');
      invariant(!existsSync(target), 'SKILL_RELEASE_EXISTS', `Release directory already exists: ${plan.directory}`);
      renameSync(draftRoot, savedDraft); movedDraft = true;
      renameSync(stage, target); published = true;
      renameSync(stagedRows, rowsPath(root));
      return plan;
    } catch (error) {
      if (published) removeTemporary(target);
      if (movedDraft) renameSync(savedDraft, draftRoot);
      throw error;
    } finally { removeTemporary(temporary); }
  });
}
