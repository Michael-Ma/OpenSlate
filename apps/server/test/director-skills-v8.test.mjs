import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, FILM_KIND_KINDS, newId, parseToolArguments, toolCatalog } from '@openslate/core';
import { FakeProvider } from '@openslate/providers';
import { loadSkillRelease, routeSkills, skillReleaseBudget } from '@openslate/director';
import { Store } from '../dist/persistence/store.js';
import { Engine } from '../dist/execution/engine.js';
import { ProductionService } from '../dist/application/service.js';
import { createDirectorInput } from '../dist/application/director-input.js';
import { createDirectorSkillLock } from '../dist/application/director-capabilities.js';
import { DirectorContextService } from '../dist/application/director-context.js';
import { DirectorToolSettings } from '../dist/application/director-tools-upgrade.js';
import { ToolInvocationService } from '../dist/application/tool-invocations.js';
import { SHIPPED_DIRECTOR_RELEASES, currentShippedToolContract, isCurrentShippedDirectorGuidance, isShippedDirectorRelease } from '../dist/application/director-shipped-guidance.js';
import { projectFixture } from './execution-fixture.mjs';
import { packageDigest } from '../../../packages/director/test/skill-release-fixture.mjs';

/** The shipped skills/v8 release, exercised offline: no provider, no Codex, only the application's own turn input. */
const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const shipped = join(repositoryRoot, 'skills/v8');
const releaseJson = () => JSON.parse(readFileSync(join(shipped, 'release.json'), 'utf8'));
const words = text => text.split(/\s+/).filter(Boolean).length;
function writable(path) { chmodSync(path, 0o700); for (const entry of readdirSync(path, { withFileTypes: true })) if (entry.isDirectory()) writable(join(path, entry.name)); }

/** A new film with no Director lock yet, as a person creates it. */
function freshFilm(t) {
  const root = mkdtempSync(join(tmpdir(), 'openslate-skills-v8-'));
  const store = new Store(join(root, 'state.sqlite')), provider = new FakeProvider(join(root, 'fake.sqlite'));
  const service = new ProductionService(store, new Engine(store, provider, { artifactDir: join(root, 'artifacts') }));
  let project = service.createProject('A funny Reel');
  const shape = projectFixture(project.id, 2);
  project = store.saveProject({ ...project, ...shape, capabilityLockId: project.capabilityLockId, shots: shape.shots.map(shot => ({ ...shot, narration: { mode: 'none', text: '', voice: 'stock' } })) }, 0);
  store.put('project_revision', project.revisionId, project.id, { project });
  t.after(() => { provider.close(); store.close(); writable(root); rmSync(root, { recursive: true, force: true }); });
  const configuration = { repositoryRoot, snapshotRoot: join(root, 'skills'), endpoint: 'http://127.0.0.1:3101' };
  const f = { root, store, service, project, configuration, tools: new ToolInvocationService(service) };
  f.saved = () => store.getProject(project.id);
  f.turn = (text = 'Plan the film.') => {
    for (const prior of store.list('director_turn', project.id).filter(turn => turn.state === 'running')) store.put('director_turn', prior.id, project.id, { ...prior, state: 'completed' });
    const human = service.beginRequest(project.id, 'local-user', text, { editing: true });
    const bridge = service.openEpoch(project.id, human);
    const turn = { id: newId(), projectId: project.id, requestId: human.requestId, epochId: bridge.actor.epochId, runtimeId: 'offline-skills-v8', state: 'running', dispatched: false,
      nativeThreadId: null, nativeTurnId: null, owner: null, leaseExpiresAt: 0, errorCode: null, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' };
    store.insert('director_turn', turn.id, project.id, turn);
    const input = createDirectorInput(service, configuration)(turn, human, bridge);
    return { input, context: JSON.parse(input.context), call: (tool, args) => f.tools.invoke(project.id, bridge.actor, randomUUID(), tool, args) };
  };
  return f;
}
const injected = context => context.references.reduce((sum, ref) => sum + words(ref.content), 0);
const ref = (context, id, path = 'SKILL.md') => context.references.find(item => item.skillId === id && item.path === path)?.content ?? '';

test('v8 (8.0.0) stays pinned: release, handler and package digests match the checkout; 8.0.1 succeeds it', t => {
  const row = SHIPPED_DIRECTOR_RELEASES.find(item => item.guidanceVersion === '8.0.0'), release = releaseJson();
  assert.equal(SHIPPED_DIRECTOR_RELEASES.indexOf(row), 0, 'the first release row is never replaced');
  assert.deepEqual({ toolContract: row.toolContract, guidanceVersion: row.guidanceVersion }, { toolContract: '7.0.0', guidanceVersion: '8.0.0' });
  assert.equal(row.releaseDigest, digest(release), 'skills/v8/release.json is the pinned release');
  assert.equal(row.handlerDigest, toolCatalog('7.0.0').digest, 'the 7.0.0 catalog is frozen at its shipped digest');
  for (const pin of release.packages) assert.equal(packageDigest(join(shipped, pin.id)), pin.packageDigest, `${pin.id} matches its release pin`);
  assert.equal(currentShippedToolContract(), SHIPPED_DIRECTOR_RELEASES.at(-1).toolContract);
  const root = mkdtempSync(join(tmpdir(), 'openslate-v8-pin-')); t.after(() => { writable(root); rmSync(root, { recursive: true, force: true }); });
  const { lock } = createDirectorSkillLock({ repositoryRoot, snapshotRoot: join(root, 'skills') }, '7.0.0');
  assert.equal(lock.schemaVersion, 2); assert.deepEqual(lock.release, { version: '8.0.0', releaseDigest: row.releaseDigest });
  assert.equal(lock.skills.length, release.packages.length);
  assert.ok(isShippedDirectorRelease(lock)); assert.ok(!isCurrentShippedDirectorGuidance(lock), 'a saved 8.0.0 lock upgrades to the latest release');
  // Every application film kind is routed; only undecided and other fall back.
  assert.deepEqual(Object.keys(release.routes).sort(), ['general', ...FILM_KIND_KINDS].sort());
  assert.deepEqual(Object.entries(release.routes).filter(([, owner]) => owner === 'fallback').map(([kind]) => kind).sort(), ['general', 'other', 'undecided']);
});

test('a new film locks the latest release and routes the IG skit to type-social, comedy and the vertical format', async t => {
  const f = freshFilm(t);
  f.store.saveProject({ ...f.saved(), filmKind: { version: 'film-kind@1', kind: 'social', subtype: 'skit', tones: ['comedy'],
    format: { platform: 'ig_reels', aspect: '9:16', targetSeconds: 20, lengthBand: 'up_to_30s' }, audience: 'general', source: 'generated',
    basis: { kind: 'stated', subtype: 'inferred', tones: 'stated', platform: 'inferred', aspect: 'default', lengthBand: 'stated', audience: 'default', source: 'default' } } }, f.saved().headVersion);
  const turn = f.turn('a 20 s funny social video to post on IG, to make people laugh');
  assert.equal(turn.input.bridge.toolContractVersion, SHIPPED_DIRECTOR_RELEASES.at(-1).toolContract);
  const lock = f.store.list('director_skill_lock', f.project.id).at(-1).lock;
  assert.equal(lock.schemaVersion, 2); assert.equal(lock.release.version, SHIPPED_DIRECTOR_RELEASES.at(-1).guidanceVersion);
  assert.deepEqual(turn.context.guidance.routing.selected, ['production', 'plan-authoring', 'type-social', 'format-social-vertical', 'craft-story', 'craft-comedy', 'craft-visual-style', 'craft-shot-prompting']);
  assert.equal(turn.context.guidance.routing.reasons['type-social'], 'route:type');
  assert.equal(turn.context.guidance.routing.reasons['format-social-vertical'], 'route:format');
  assert.equal(turn.context.guidance.routing.reasons['craft-comedy'], 'requires:type-social');
  assert.deepEqual(turn.input.skills.map(skill => skill.name).sort(), [...turn.context.guidance.routing.selected].sort(), 'Codex enables exactly the routed packages');
  // The injected path names each step of the P0 flow and when to read the comedy references.
  const social = ref(turn.context, 'type-social'), comedy = ref(turn.context, 'craft-comedy');
  for (const step of ['premises-and-beats.md', 'propose_visual_style', 'review-checklist.md', 'confirm_video', 'start_export', 'Clip sound is kept'])
    assert.ok(social.includes(step), `type-social names ${step}`);
  assert.match(comedy, /references\/premises-and-beats\.md/); assert.match(comedy, /read_guidance/);
  assert.match(ref(turn.context, 'format-social-vertical'), /bottom 35 %/);
  // Intake needs nothing more: kind and aspect are settled, so the Director plans without a question.
  const overview = await turn.call('read_context', {});
  assert.deepEqual(overview.project.filmKindIntake.ask, []);
  // The comedy method is one free read away and leaves a skill_read.
  const premises = await turn.call('read_guidance', { package: 'craft-comedy', path: 'references/premises-and-beats.md' });
  assert.match(premises.content, /Score and pick/);
  assert.equal(f.store.list('skill_read', f.project.id).filter(row => row.via === 'read_guidance').at(-1).evidence.path, 'references/premises-and-beats.md');
  assert.ok(injected(turn.context) <= releaseJson().budget.injectedWords, `injected ${injected(turn.context)} words`);
});

test('an under-specified "make a funny video" asks one compact question: undecided routes core plus fallback and intake asks kind and aspect', async t => {
  const f = freshFilm(t);
  const turn = f.turn('make a funny video');
  assert.deepEqual(turn.context.guidance.routing.selected, ['production', 'plan-authoring', 'craft-story', 'craft-visual-style', 'craft-shot-prompting']);
  // The injected core entry carries the question rule itself, without any read.
  const production = ref(turn.context, 'production');
  assert.match(production, /one compact question with 2–4 options per missing field and the default you will use/);
  assert.match(production, /save kind `undecided` meanwhile/); assert.match(production, /basis: "asked"/);
  // Saving the known part applies directly; intake then lists exactly what to ask.
  const prepared = await turn.call('prepare_change', { variant: 'project', expectedHeadVersion: f.saved().headVersion,
    creative: { project: { filmKind: { kind: 'undecided', tones: ['comedy'], basis: { tones: 'stated' } } } } });
  await turn.call('apply_change', { preparedId: prepared.preparedId });
  const overview = await turn.call('read_context', {});
  assert.deepEqual(overview.project.filmKindIntake.ask, ['kind', 'aspect']);
  // The routing reference holds the bilingual question with options and defaults.
  const routing = (await turn.call('read_guidance', { package: 'production', path: 'references/routing.md' })).content;
  for (const line of ['What kind of funny video? A. A social skit for a feed B. A funny ad for a product C. A short comic story — default A',
    'Where will it go? A. TikTok / Reels / Shorts, vertical 9:16 B. YouTube, horizontal 16:9 C. A square feed post — default A', '开始之前确认两点（不回复我就按默认做）'])
    assert.ok(routing.includes(line), line);
  // The answer, saved with basis asked, routes the type package on the next turn.
  const answer = await f.turn('A, and A').call('prepare_change', { variant: 'project', expectedHeadVersion: f.saved().headVersion, creative: { project: { filmKind: {
    kind: 'social', subtype: 'skit', tones: ['comedy'], format: { platform: 'ig_reels' }, basis: { kind: 'asked', subtype: 'asked', tones: 'stated', platform: 'asked' } } } } });
  assert.ok(answer.preparedId);
});

test('a saved V7 film moves to the shipped v8 release on its next fresh native turn; the V7 lock row stays', t => {
  const f = freshFilm(t), configuration = { repositoryRoot, snapshotRoot: join(f.root, 'native-skills'), runtimeId: 'codex-app-server' };
  const v7 = createDirectorSkillLock(configuration, '6.0.0');
  new DirectorContextService(f.service, v7.environment).bootstrapLock(f.project.id, v7.lock);
  const settings = new DirectorToolSettings(f.service, () => configuration);
  assert.equal(settings.status(f.project.id).upgradeAvailable, true); assert.equal(settings.status(f.project.id).availableVersion, SHIPPED_DIRECTOR_RELEASES.at(-1).toolContract);
  const human = f.service.beginRequest(f.project.id, 'local-user', 'Continue the film.', { editing: true }), bridge = f.service.openEpoch(f.project.id, human);
  const turn = { id: newId(), projectId: f.project.id, requestId: human.requestId, epochId: bridge.actor.epochId, runtimeId: 'codex-app-server', state: 'running', dispatched: false,
    nativeThreadId: null, nativeTurnId: null, owner: null, leaseExpiresAt: 0, errorCode: null, createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z' };
  f.store.insert('director_turn', turn.id, f.project.id, turn);
  const input = createDirectorInput(f.service, { ...configuration, endpoint: 'http://127.0.0.1:3101', freshTurnGuidance: settings })(turn, human, bridge);
  assert.equal(input.bridge.toolContractVersion, SHIPPED_DIRECTOR_RELEASES.at(-1).toolContract);
  const locks = f.store.list('director_skill_lock', f.project.id);
  assert.equal(locks.length, 2); assert.equal(locks.at(-1).lock.release.releaseDigest, SHIPPED_DIRECTOR_RELEASES.at(-1).releaseDigest);
  assert.deepEqual(f.store.get('director_skill_lock', v7.lock.id).lock, v7.lock);
  assert.equal(settings.status(f.project.id).upgradeAvailable, false);
});

test('every kind stays inside the injected word budget, with every routing fact and the vertical format', t => {
  const root = mkdtempSync(join(tmpdir(), 'openslate-v8-budget-')); t.after(() => { writable(root); rmSync(root, { recursive: true, force: true }); });
  const release = loadSkillRelease({ snapshotRoot: join(root, 'skills'), compatibility: { toolContract: '7.0.0', planLanguage: '1.0.0', workflowContract: '1.0.0' },
    availableToolIds: [...toolCatalog('7.0.0').names], releaseRoot: shipped, routeKinds: FILM_KIND_KINDS });
  const budget = skillReleaseBudget(release), limit = release.release.budget.injectedWords;
  assert.deepEqual(budget.violations, []);
  const facts = ['has_characters', 'has_soundtrack', 'narration_planned', 'has_visual_style', 'audience:kids'];
  const rows = [];
  for (const kind of FILM_KIND_KINDS) for (const aspect of ['16:9', '9:16']) {
    const decision = routeSkills({ version: 'film-kind@1', kind, format: { aspect } }, release, facts);
    rows.push(`${kind} ${aspect}: ${budget.injectedWords(decision)}`);
    assert.ok(budget.injectedWords(decision) <= limit, `${kind} ${aspect} injects ${budget.injectedWords(decision)} of ${limit} words`);
  }
  console.log(`v8 injection (words, all facts): ${rows.join('; ')}; worst ${budget.worstCaseInjectedWords} of ${limit}`);
  assert.ok(budget.worstCaseInjectedWords <= limit);
});

test('the style record example in craft-visual-style is a valid propose_visual_style option', () => {
  const record = readFileSync(join(shipped, 'craft-visual-style/references/record.md'), 'utf8');
  const option = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(record)[1]);
  const second = { ...option, tier: 'distinct', style: { ...option.style, styleId: 'documentary-handheld', label: 'Documentary handheld' } };
  assert.doesNotThrow(() => parseToolArguments('propose_visual_style', { options: [option, second] }, '7.0.0'));
  // Every styleId the library names has a family file in craft-style-prompting.
  const library = readFileSync(join(shipped, 'craft-visual-style/references/library.md'), 'utf8');
  for (const [, id, family] of library.matchAll(/^\| `([a-z0-9-]+)` \| [^|]+ \| ([a-z0-9-]+) \|/gm))
    assert.match(readFileSync(join(shipped, `craft-style-prompting/references/${family}.md`), 'utf8'), new RegExp(`^## ${id}$`, 'm'), `${id} in ${family}.md`);
});
