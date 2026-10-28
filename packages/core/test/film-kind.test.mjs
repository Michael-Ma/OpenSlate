import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FILM_KIND_KINDS, FILM_KIND_SUBTYPES, FILM_KIND_VERSION, FILM_KIND_TYPE_PACKAGES, LEGACY_FILM_KIND_VALUES, PLATFORM_DEFAULT_ASPECT,
  filmKindInputSchema, filmKindProblems, parseFilmKind, normalizeFilmKind, normalizeStoredFilmKind, decidedKind, filmKindIntake,
  filmKindRouteKey, lengthBandFor, parseToolArguments, toolCatalog, applyCreativePatch, parseChangeProposal,
} from '../dist/index.js';

/** Schema check through the 7.0.0 catalog itself. */
const validate = (filmKind) => { try { parseToolArguments('prepare_change', { variant: 'project', expectedHeadVersion: 0, creative: { project: { filmKind } } }, '7.0.0'); return true; } catch { return false; } };
/** The owner's worked example: "a 20 s funny social video to post on IG, to make people laugh". */
const IG_SKIT = {
  kind: 'social', subtype: 'skit', tones: ['comedy'],
  format: { platform: 'ig_reels', aspect: '9:16', lengthBand: 'up_to_30s', targetSeconds: 20 },
  audience: 'general', source: 'generated',
  basis: { kind: 'stated', subtype: 'inferred', tones: 'stated', platform: 'inferred', aspect: 'default', lengthBand: 'stated', audience: 'default', source: 'default' },
};

test('the IG funny-video example maps cleanly and routes to the social type with the vertical format', () => {
  assert.ok(validate(IG_SKIT));
  assert.equal(filmKindInputSchema.required[0], 'kind');
  assert.deepEqual(filmKindProblems(IG_SKIT), []);
  const saved = parseFilmKind(IG_SKIT);
  assert.equal(saved.version, FILM_KIND_VERSION);
  assert.deepEqual(filmKindRouteKey(saved), { typePackage: 'type-social', formatPackages: ['format-social-vertical'], toneTags: ['comedy'] });
  assert.deepEqual(filmKindIntake(saved).ask, [], 'nothing left to ask');
  assert.equal(lengthBandFor(20), 'up_to_30s');
});

test('every kind routes to a package or the fallback; subtypes are closed per kind', () => {
  for (const kind of FILM_KIND_KINDS) {
    assert.ok(kind in FILM_KIND_SUBTYPES && kind in FILM_KIND_TYPE_PACKAGES, kind);
    assert.equal(filmKindRouteKey({ kind }).typePackage, FILM_KIND_TYPE_PACKAGES[kind]);
    for (const subtype of FILM_KIND_SUBTYPES[kind]) assert.deepEqual(filmKindProblems({ kind, subtype, ...(subtype === 'other' ? { labels: { subtype: 'x' } } : {}) }), [], `${kind}/${subtype}`);
  }
  assert.equal(filmKindRouteKey({ kind: 'undecided' }).typePackage, null);
  assert.equal(filmKindRouteKey({ kind: 'other', labels: { kind: 'wedding vow film' } }).typePackage, null);
  assert.deepEqual(filmKindRouteKey(undefined), { typePackage: null, formatPackages: [], toneTags: [] });
  assert.match(filmKindProblems({ kind: 'commercial', subtype: 'skit' }).join(), /not a commercial subtype/);
  assert.match(filmKindProblems({ kind: 'undecided', subtype: 'skit' }).join(), /not a undecided subtype/);
  assert.equal(validate({ kind: 'opera' }), false, 'kind is a closed enum');
  assert.equal(validate({ kind: 'social', tones: ['comedy', 'playful', 'energetic', 'calm'] }), false, 'at most three tones');
  assert.equal(validate({ kind: 'social', extra: true }), false);
});

test('other needs a label, and a label needs other', () => {
  assert.match(filmKindProblems({ kind: 'other' }).join(), /labels.kind is required/);
  assert.match(filmKindProblems({ kind: 'social', tones: ['other'] }).join(), /labels.tone is required/);
  assert.match(filmKindProblems({ kind: 'social', format: { platform: 'other' } }).join(), /labels.platform/);
  assert.match(filmKindProblems({ kind: 'social', labels: { kind: 'x' } }).join(), /only for an other kind/);
  assert.deepEqual(filmKindProblems({ kind: 'social', format: { aspect: 'other' }, labels: { aspect: '3:4' } }), []);
  assert.deepEqual(filmKindRouteKey({ kind: 'social', tones: ['other', 'comedy'], labels: { tone: 'cringe' } }).toneTags, ['comedy']);
});

test('basis describes set fields only; an undecided kind is never stated', () => {
  assert.match(filmKindProblems({ kind: 'social', basis: { platform: 'asked' } }).join(), /basis.platform/);
  assert.match(filmKindProblems({ kind: 'undecided', basis: { kind: 'stated' } }).join(), /undecided/);
  assert.deepEqual(filmKindProblems({ kind: 'undecided', format: { platform: 'tiktok' }, basis: { platform: 'stated' } }), []);
  assert.match(filmKindProblems({ kind: 'social', format: { targetSeconds: 45, lengthBand: 'up_to_30s' } }).join(), /outside/);
  assert.equal(parseFilmKind({ kind: 'social', format: { targetSeconds: 45 } }).format.lengthBand, 'up_to_60s', 'band derived from seconds');
  assert.throws(() => parseFilmKind({ kind: 'other' }), /Invalid filmKind/);
});

test('intake asks for kind and aspect only, and defaults the rest', () => {
  assert.deepEqual(filmKindIntake(undefined), { ask: ['kind', 'aspect'], defaults: { audience: 'general', source: 'generated' } });
  assert.deepEqual(filmKindIntake({ kind: 'undecided', format: { platform: 'tiktok' } }).ask, ['kind'], 'a platform settles the aspect');
  assert.deepEqual(filmKindIntake({ kind: 'commercial' }), { ask: ['aspect'], defaults: { lengthBand: 'up_to_30s', audience: 'general', source: 'generated' } });
  assert.deepEqual(filmKindIntake({ kind: 'commercial', format: { platform: 'youtube' } }).defaults, { aspect: '16:9', lengthBand: 'up_to_30s', audience: 'general', source: 'generated' });
  assert.deepEqual(filmKindIntake({ kind: 'social', format: { platform: 'other' }, labels: { platform: 'Lemon8' } }).ask, ['aspect'], 'an unknown platform has no default aspect');
  assert.deepEqual(filmKindIntake({ kind: 'social', format: { platform: 'ig_stories' } }).defaults.lengthBand, 'up_to_15s');
  for (const [platform, aspect] of Object.entries(PLATFORM_DEFAULT_ASPECT)) if (aspect) assert.ok(validate({ kind: 'social', format: { platform, aspect } }), platform);
});

test('vertical routing follows the aspect first, then a vertical-first platform', () => {
  assert.deepEqual(filmKindRouteKey({ kind: 'commercial', subtype: 'ad', format: { platform: 'tiktok' } }).formatPackages, ['format-social-vertical']);
  assert.deepEqual(filmKindRouteKey({ kind: 'commercial', format: { platform: 'tiktok', aspect: '1:1' } }).formatPackages, []);
  assert.deepEqual(filmKindRouteKey({ kind: 'music_video', subtype: 'performance', format: { aspect: '9:16' } }), { typePackage: 'type-music-video', formatPackages: ['format-social-vertical'], toneTags: [] });
  assert.deepEqual(filmKindRouteKey({ kind: 'narrative', format: { platform: 'youtube' } }).formatPackages, []);
});

test('pre-structure 7.0.0 strings normalize to the structured record', () => {
  for (const legacy of LEGACY_FILM_KIND_VALUES) {
    const record = normalizeFilmKind(legacy);
    assert.equal(record.version, FILM_KIND_VERSION, legacy);
    assert.deepEqual(filmKindProblems(record), [], legacy);
    assert.equal(record.basis.kind, 'inferred');
  }
  assert.deepEqual(normalizeFilmKind('kids_animated_story'), { version: FILM_KIND_VERSION, kind: 'narrative', subtype: 'kids_story', audience: 'kids', basis: { kind: 'inferred' } });
  assert.deepEqual(normalizeFilmKind('social_vertical').format, { aspect: '9:16' });
  assert.equal(normalizeFilmKind('opera'), undefined);
  assert.equal(decidedKind('music_video'), 'music_video');
  assert.equal(decidedKind({ kind: 'undecided' }), undefined);
  const project = { id: 'p', filmKind: 'brand_film' };
  assert.deepEqual(normalizeStoredFilmKind(project).filmKind.subtype, 'brand_film');
  assert.equal(project.filmKind, 'brand_film', 'the stored body is not mutated');
  const current = { id: 'p', filmKind: parseFilmKind(IG_SKIT) };
  assert.equal(normalizeStoredFilmKind(current), current, 'a current record is returned as is');
  assert.equal('filmKind' in normalizeStoredFilmKind({ id: 'p', filmKind: 42 }), false, 'an unreadable value is dropped');
});

test('7.0.0 prepare_change takes the structured record; 6.0.0 and flat strings are refused by the catalog', () => {
  const args = (filmKind) => ({ variant: 'project', expectedHeadVersion: 0, creative: { project: { filmKind } } });
  assert.deepEqual(parseToolArguments('prepare_change', args(IG_SKIT), '7.0.0').arguments.creative.project.filmKind, IG_SKIT);
  assert.throws(() => parseToolArguments('prepare_change', args('music_video'), '7.0.0'));
  assert.throws(() => parseToolArguments('prepare_change', args(IG_SKIT), '6.0.0'));
  assert.match(toolCatalog('7.0.0').descriptors.find(tool => tool.name === 'prepare_change').description, /film-kind@1/);
});

test('applying a patch stores the record; a held legacy string is normalized', () => {
  const project = { id: 'p', revisionId: 'r', headVersion: 0, name: 'n', brief: '', story: '', scenes: [], shots: [], cues: [], artifacts: [],
    narration: { script: '', source: 'undecided' }, maxFrames: 1800, capabilityLockId: 'c', activePlanId: null };
  const bind = (shot) => shot;
  const saved = applyCreativePatch(project, { project: { filmKind: IG_SKIT } }, bind);
  assert.deepEqual(saved.filmKind, { version: FILM_KIND_VERSION, ...IG_SKIT });
  const held = parseChangeProposal({ variant: 'project', expectedHeadVersion: 0, creative: { project: { filmKind: 'music_video' } } });
  assert.deepEqual(applyCreativePatch(project, held.creative, bind).filmKind, { version: FILM_KIND_VERSION, kind: 'music_video', basis: { kind: 'inferred' } });
  assert.throws(() => applyCreativePatch(project, { project: { filmKind: { kind: 'social', subtype: 'ad' } } }, bind), /not a social subtype/);
});
