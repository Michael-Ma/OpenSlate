/**
 * Structured film kind, taxonomy `film-kind@1` (docs/ai/film-kind/2026-10-28-film-kind-taxonomy.md).
 *
 * Separate closed axes instead of one flat list: the creative spine (`kind`) with a per-kind `subtype`, `tones`,
 * `format` (platform, aspect, length band), `audience` and media `source`. Every open-ended axis has `other`, which
 * requires a free-text entry in `labels`. `basis` records, per field, whether the person stated it, answered an
 * intake question, or the Director inferred or defaulted it, so routing and the UI can tell a guess from a decision.
 * Everything here is pure; the application validates, normalizes and stores the record.
 */
import { invariant } from "./common.js";

export const FILM_KIND_VERSION = "film-kind@1";

/** The creative spine. `undecided` is the explicit "not decided yet" state: the Director must ask before planning. */
export const FILM_KIND_KINDS = Object.freeze(["undecided", "narrative", "music_video", "commercial", "social", "explainer",
  "documentary", "showcase", "trailer", "narrated_story", "other"] as const);
export type FilmKindKind = typeof FILM_KIND_KINDS[number];

/** Closed subtype list per kind. `undecided` and `other` kinds take no subtype. */
export const FILM_KIND_SUBTYPES = Object.freeze({
  undecided: [],
  narrative: ["short", "micro_drama", "kids_story", "visual_poem", "other"],
  music_video: ["performance", "narrative", "concept", "lyric", "dance", "other"],
  commercial: ["ad", "brand_film", "app_promo", "ugc_ad", "other"],
  social: ["skit", "pov", "meme", "trend", "day_in_the_life", "storytime", "tips", "before_after", "other"],
  explainer: ["concept", "tutorial", "training", "other"],
  documentary: ["mini_doc", "testimonial", "event_recap", "tribute", "other"],
  showcase: ["product", "fashion", "place", "food", "other"],
  trailer: ["trailer", "teaser", "other"],
  narrated_story: ["history", "list", "legend", "other"],
  other: [],
} as const satisfies Record<FilmKindKind, readonly string[]>);
export type FilmKindSubtype = typeof FILM_KIND_SUBTYPES[FilmKindKind][number];
export const FILM_KIND_ALL_SUBTYPES = Object.freeze([...new Set(Object.values(FILM_KIND_SUBTYPES).flat())]) as readonly FilmKindSubtype[];

/** Tone and genre share one axis (at most three). Genres first, then moods. */
export const FILM_KIND_TONES = Object.freeze(["comedy", "drama", "horror", "thriller", "romance", "action", "sci_fi", "fantasy", "mystery",
  "wholesome", "inspirational", "heartfelt", "nostalgic", "epic", "calm", "energetic", "luxurious", "playful", "serious", "satirical", "dark", "other"] as const);
export type FilmKindTone = typeof FILM_KIND_TONES[number];

export const FILM_KIND_PLATFORMS = Object.freeze(["tiktok", "ig_reels", "ig_stories", "ig_feed", "yt_shorts", "youtube", "facebook", "linkedin", "x",
  "douyin", "xiaohongshu", "wechat_channels", "bilibili", "web", "tv", "cinema", "presentation", "other"] as const);
export type FilmKindPlatform = typeof FILM_KIND_PLATFORMS[number];

export const FILM_KIND_ASPECTS = Object.freeze(["9:16", "16:9", "1:1", "4:5", "21:9", "other"] as const);
export type FilmKindAspect = typeof FILM_KIND_ASPECTS[number];

/** Upper bounds in seconds; a band holds lengths above the previous band's bound. */
export const FILM_KIND_LENGTH_BANDS = Object.freeze(["up_to_6s", "up_to_15s", "up_to_30s", "up_to_60s", "up_to_3min", "up_to_10min", "over_10min"] as const);
export type FilmKindLengthBand = typeof FILM_KIND_LENGTH_BANDS[number];
const BAND_MAX_SECONDS: Record<FilmKindLengthBand, number> = { up_to_6s: 6, up_to_15s: 15, up_to_30s: 30, up_to_60s: 60, up_to_3min: 180, up_to_10min: 600, over_10min: Infinity };

export const FILM_KIND_AUDIENCES = Object.freeze(["general", "kids", "teens", "adults", "professional", "internal", "other"] as const);
export type FilmKindAudience = typeof FILM_KIND_AUDIENCES[number];

/** Where the pictures come from: generated, built from the person's own media, or both. */
export const FILM_KIND_SOURCES = Object.freeze(["generated", "own_media", "mixed"] as const);
export type FilmKindSource = typeof FILM_KIND_SOURCES[number];

/** stated: in the person's words; asked: their answer to an intake question; inferred: the Director's reading; default: the documented default. */
export const FILM_KIND_BASES = Object.freeze(["stated", "asked", "inferred", "default"] as const);
export type FilmKindBasis = typeof FILM_KIND_BASES[number];
export const FILM_KIND_FIELDS = Object.freeze(["kind", "subtype", "tones", "platform", "aspect", "lengthBand", "audience", "source"] as const);
export type FilmKindField = typeof FILM_KIND_FIELDS[number];
/** Fields whose `other` value needs a free-text label. */
export const FILM_KIND_LABEL_FIELDS = Object.freeze(["kind", "subtype", "tone", "platform", "aspect", "audience"] as const);
export type FilmKindLabelField = typeof FILM_KIND_LABEL_FIELDS[number];

export interface FilmKind {
  version: typeof FILM_KIND_VERSION;
  kind: FilmKindKind;
  subtype?: FilmKindSubtype;
  tones?: FilmKindTone[];
  format?: { platform?: FilmKindPlatform; aspect?: FilmKindAspect; lengthBand?: FilmKindLengthBand; targetSeconds?: number };
  audience?: FilmKindAudience;
  source?: FilmKindSource;
  /** Required exactly for the fields whose value is `other`. */
  labels?: Partial<Record<FilmKindLabelField, string>>;
  basis?: Partial<Record<FilmKindField, FilmKindBasis>>;
}
/** What prepare_change creative.project.filmKind accepts: the whole record; the application stamps `version`. */
export type FilmKindInput = Omit<FilmKind, "version"> & { version?: typeof FILM_KIND_VERSION };

const label = { type: "string", minLength: 1, maxLength: 80 };
const closed = (properties: object, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
/** JSON Schema for the 7.0.0 catalog. Cross-field rules (subtype per kind, labels for `other`) are in validateFilmKind. */
export const filmKindInputSchema = Object.freeze(closed({
  version: { enum: [FILM_KIND_VERSION] },
  kind: { enum: FILM_KIND_KINDS },
  subtype: { enum: FILM_KIND_ALL_SUBTYPES },
  tones: { type: "array", maxItems: 3, uniqueItems: true, items: { enum: FILM_KIND_TONES } },
  format: { ...closed({ platform: { enum: FILM_KIND_PLATFORMS }, aspect: { enum: FILM_KIND_ASPECTS }, lengthBand: { enum: FILM_KIND_LENGTH_BANDS },
    targetSeconds: { type: "integer", minimum: 1, maximum: 3600 } }), minProperties: 1 },
  audience: { enum: FILM_KIND_AUDIENCES },
  source: { enum: FILM_KIND_SOURCES },
  labels: { ...closed(Object.fromEntries(FILM_KIND_LABEL_FIELDS.map(key => [key, label]))), minProperties: 1 },
  basis: { ...closed(Object.fromEntries(FILM_KIND_FIELDS.map(key => [key, { enum: FILM_KIND_BASES }]))), minProperties: 1 },
}, ["kind"]));

/** The 7.0.0 enum strings stored before the structured record. 7.0.0 never shipped; these are read and normalized only. */
export const LEGACY_FILM_KIND_VALUES = Object.freeze(["narrative_short", "commercial_ad", "product_showcase", "brand_film", "explainer", "tutorial",
  "mini_doc", "testimonial", "social_vertical", "trailer_teaser", "event_recap", "fashion_lookbook", "place_film",
  "kids_animated_story", "app_promo", "narrated_story", "tribute", "music_video"] as const);
export type LegacyFilmKindValue = typeof LEGACY_FILM_KIND_VALUES[number];
const LEGACY_MAP: Record<LegacyFilmKindValue, Omit<FilmKind, "version" | "basis">> = {
  narrative_short: { kind: "narrative", subtype: "short" },
  commercial_ad: { kind: "commercial", subtype: "ad" },
  product_showcase: { kind: "showcase", subtype: "product" },
  brand_film: { kind: "commercial", subtype: "brand_film" },
  explainer: { kind: "explainer", subtype: "concept" },
  tutorial: { kind: "explainer", subtype: "tutorial" },
  mini_doc: { kind: "documentary", subtype: "mini_doc" },
  testimonial: { kind: "documentary", subtype: "testimonial" },
  social_vertical: { kind: "social", format: { aspect: "9:16" } },
  trailer_teaser: { kind: "trailer" },
  event_recap: { kind: "documentary", subtype: "event_recap" },
  fashion_lookbook: { kind: "showcase", subtype: "fashion" },
  place_film: { kind: "showcase", subtype: "place" },
  kids_animated_story: { kind: "narrative", subtype: "kids_story", audience: "kids" },
  app_promo: { kind: "commercial", subtype: "app_promo" },
  narrated_story: { kind: "narrated_story" },
  tribute: { kind: "documentary", subtype: "tribute" },
  music_video: { kind: "music_video" },
};

const has = <T extends string>(list: readonly T[], value: unknown): value is T => typeof value === "string" && (list as readonly string[]).includes(value);

/** Lengths in seconds map to exactly one band. */
export function lengthBandFor(seconds: number): FilmKindLengthBand {
  invariant(Number.isFinite(seconds) && seconds > 0, "VALIDATION_ERROR", "A length must be positive");
  return FILM_KIND_LENGTH_BANDS.find(band => seconds <= BAND_MAX_SECONDS[band])!;
}

/** Problems with a film kind record, empty when valid. Schema shape is checked first by the catalog. */
export function filmKindProblems(value: FilmKindInput): string[] {
  const problems: string[] = [];
  const labels = value.labels ?? {};
  const needsLabel: Partial<Record<FilmKindLabelField, boolean>> = {
    kind: value.kind === "other", subtype: value.subtype === "other", tone: value.tones?.includes("other") ?? false,
    platform: value.format?.platform === "other", aspect: value.format?.aspect === "other", audience: value.audience === "other",
  };
  if (value.version !== undefined && value.version !== FILM_KIND_VERSION) problems.push(`version must be ${FILM_KIND_VERSION}`);
  if (!has(FILM_KIND_KINDS, value.kind)) problems.push("unknown kind");
  else if (value.subtype !== undefined && !has(FILM_KIND_SUBTYPES[value.kind] as readonly string[], value.subtype))
    problems.push(`subtype ${value.subtype} is not a ${value.kind} subtype`);
  for (const key of FILM_KIND_LABEL_FIELDS) {
    if (needsLabel[key] && !labels[key]?.trim()) problems.push(`labels.${key} is required when ${key} is other`);
    if (!needsLabel[key] && labels[key] !== undefined) problems.push(`labels.${key} is only for an other ${key}`);
  }
  const { targetSeconds, lengthBand } = value.format ?? {};
  if (targetSeconds !== undefined && lengthBand !== undefined && lengthBandFor(targetSeconds) !== lengthBand)
    problems.push(`targetSeconds ${targetSeconds} is outside ${lengthBand}`);
  const present: Record<FilmKindField, boolean> = { kind: true, subtype: value.subtype !== undefined, tones: !!value.tones?.length,
    platform: value.format?.platform !== undefined, aspect: value.format?.aspect !== undefined,
    lengthBand: value.format?.lengthBand !== undefined || targetSeconds !== undefined, audience: value.audience !== undefined, source: value.source !== undefined };
  for (const key of Object.keys(value.basis ?? {}) as FilmKindField[]) if (!present[key]) problems.push(`basis.${key} describes a field that is not set`);
  if (value.kind === "undecided" && value.basis?.kind && value.basis.kind !== "default") problems.push("an undecided kind has no stated, asked or inferred basis");
  return problems;
}

/** Validates and returns the stored record (version stamped, lengthBand derived from targetSeconds when absent). */
export function parseFilmKind(value: FilmKindInput): FilmKind {
  const problems = filmKindProblems(value);
  invariant(!problems.length, "VALIDATION_ERROR", `Invalid filmKind: ${problems.join("; ")}`);
  const result = structuredClone(value) as FilmKind;
  result.version = FILM_KIND_VERSION;
  if (result.format?.targetSeconds !== undefined && result.format.lengthBand === undefined) result.format.lengthBand = lengthBandFor(result.format.targetSeconds);
  if (result.tones && !result.tones.length) delete result.tones;
  return result;
}

/**
 * Reads a stored or proposed film kind: a structured record passes through, a pre-structure 7.0.0 string maps to
 * its record with `basis.kind: "inferred"` (the old value did not say who chose it), anything else is unknown.
 */
export function normalizeFilmKind(value: unknown): FilmKind | undefined {
  if (has(LEGACY_FILM_KIND_VALUES, value)) return { version: FILM_KIND_VERSION, ...structuredClone(LEGACY_MAP[value]), basis: { kind: "inferred" } };
  if (value && typeof value === "object" && !Array.isArray(value) && has(FILM_KIND_KINDS, (value as { kind?: unknown }).kind))
    return { ...(structuredClone(value) as FilmKind), version: FILM_KIND_VERSION };
  return undefined;
}

/** Normalizes a project body read from storage. Returns the same object when nothing changes. */
export function normalizeStoredFilmKind<T extends { filmKind?: unknown }>(project: T): T {
  if (project.filmKind === undefined || (typeof project.filmKind === "object" && project.filmKind !== null && (project.filmKind as { version?: unknown }).version === FILM_KIND_VERSION)) return project;
  const filmKind = normalizeFilmKind(project.filmKind);
  const next = { ...project };
  if (filmKind) next.filmKind = filmKind; else delete next.filmKind;
  return next;
}

/** A decided kind: neither absent nor `undecided`. */
export function decidedKind(value: unknown): FilmKindKind | undefined {
  const kind = normalizeFilmKind(value)?.kind;
  return kind === undefined || kind === "undecided" ? undefined : kind;
}

const VERTICAL_PLATFORMS: readonly FilmKindPlatform[] = ["tiktok", "ig_reels", "ig_stories", "yt_shorts", "douyin", "xiaohongshu", "wechat_channels"];
/** Documented default aspect per platform; `other` has none. */
export const PLATFORM_DEFAULT_ASPECT: Readonly<Record<FilmKindPlatform, FilmKindAspect | null>> = Object.freeze({
  tiktok: "9:16", ig_reels: "9:16", ig_stories: "9:16", yt_shorts: "9:16", douyin: "9:16", xiaohongshu: "9:16", wechat_channels: "9:16",
  ig_feed: "4:5", facebook: "4:5", linkedin: "1:1", x: "16:9", youtube: "16:9", bilibili: "16:9", web: "16:9", tv: "16:9", cinema: "21:9", presentation: "16:9", other: null,
});
const KIND_DEFAULT_BAND: Record<FilmKindKind, FilmKindLengthBand | null> = { undecided: null, other: null, narrative: "up_to_3min", music_video: "up_to_3min",
  commercial: "up_to_30s", social: "up_to_30s", explainer: "up_to_3min", documentary: "up_to_3min", showcase: "up_to_30s", trailer: "up_to_60s", narrated_story: "up_to_3min" };

export interface FilmKindIntake {
  /** Nothing blocks planning when empty. */
  ask: Array<"kind" | "aspect">;
  /** What the Director uses, with basis "default", when the person has not said; stated in its reply so they can correct it. */
  defaults: { aspect?: FilmKindAspect; lengthBand?: FilmKindLengthBand; audience: "general"; source: "generated" };
}
/**
 * Intake rule: kind is required, and aspect (directly, or through a platform with a default aspect) because it
 * changes every keyframe's framing. Everything else defaults. Pure; read_context exposes it in 7.0.0.
 */
export function filmKindIntake(value: unknown): FilmKindIntake {
  const film = normalizeFilmKind(value);
  const kind = decidedKind(film);
  const platformAspect = film?.format?.platform ? PLATFORM_DEFAULT_ASPECT[film.format.platform] : null;
  const aspect = film?.format?.aspect ?? platformAspect ?? undefined;
  const ask: FilmKindIntake["ask"] = [...(kind ? [] : ["kind" as const]), ...(aspect ? [] : ["aspect" as const])];
  const platform = film?.format?.platform;
  const lengthBand = film?.format?.lengthBand ?? (platform === "ig_stories" ? "up_to_15s" : platform && VERTICAL_PLATFORMS.includes(platform) ? "up_to_30s" : kind ? KIND_DEFAULT_BAND[kind] ?? undefined : undefined);
  return { ask, defaults: { ...(aspect && !film?.format?.aspect ? { aspect } : {}), ...(lengthBand && !film?.format?.lengthBand ? { lengthBand } : {}), audience: "general", source: "generated" } };
}

/** Type skill package per kind (docs/ai/skill-architecture §3.2, plus type-social). `undecided` and `other` use the fallback. */
export const FILM_KIND_TYPE_PACKAGES: Readonly<Record<FilmKindKind, string | null>> = Object.freeze({
  undecided: null, other: null, narrative: "type-narrative", music_video: "type-music-video", commercial: "type-commercial", social: "type-social",
  explainer: "type-explainer", documentary: "type-documentary", showcase: "type-showcase", trailer: "type-trailer", narrated_story: "type-narrated-story",
});
export const FORMAT_SOCIAL_VERTICAL = "format-social-vertical";

export interface FilmKindRouteKey { typePackage: string | null; formatPackages: string[]; toneTags: string[] }
/**
 * Deterministic routing key for the skill loader. typePackage null means the release fallback. The vertical format
 * package applies to a 9:16 aspect, or to a vertical-first platform when no aspect is set. toneTags are the closed
 * tone ids in their saved order (an `other` tone is dropped; its free text is not a routing input).
 */
export function filmKindRouteKey(value: unknown): FilmKindRouteKey {
  const film = normalizeFilmKind(value);
  if (!film) return { typePackage: null, formatPackages: [], toneTags: [] };
  const aspect = film.format?.aspect, platform = film.format?.platform;
  const vertical = aspect ? aspect === "9:16" : !!platform && VERTICAL_PLATFORMS.includes(platform);
  return { typePackage: FILM_KIND_TYPE_PACKAGES[film.kind] ?? null, formatPackages: vertical ? [FORMAT_SOCIAL_VERTICAL] : [],
    toneTags: (film.tones ?? []).filter(tone => tone !== "other") };
}

/** The kind axis, under the name earlier 7.0.0 code used. */
export const FILM_KINDS = FILM_KIND_KINDS;
