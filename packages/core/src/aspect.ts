/**
 * The film's frame shape. One reader, `projectAspect`, used by planning (keyframe canvas, video aspect, render size),
 * the server (storyboard export) and the web (preview shapes).
 *
 * The source is `project.filmKind.format` (film-kind@1): `format.aspect`, or the platform default when only
 * `format.platform` is set (PLATFORM_DEFAULT_ASPECT). It is read defensively: older rows store `filmKind` as a plain string or not at all.
 *
 * A project with no format choice is a *legacy* project: it reads as 16:9 but keeps the old sizes
 * (1024×1024 keyframes under codex-image-turn-v1, the profile's video aspect and a 1280×720 export), so its
 * compiled digests and saved receipts stay byte-for-byte the same. Only an explicit format selects the new sizes.
 */
import { PLATFORM_DEFAULT_ASPECT } from "./film-kind.js";

export const PROJECT_ASPECTS = Object.freeze(["16:9", "9:16", "1:1"] as const);
export type ProjectAspect = typeof PROJECT_ASPECTS[number];

/**
 * Aspects the film-kind format can request that no installed provider renders, mapped deliberately:
 * 4:5 (IG feed, Facebook) → 1:1, the closest supported shape (Viggle H3 has no 4:5; Codex has no 4:5 canvas);
 * 21:9 (cinema) → 16:9; "other" → 16:9.
 */
const REQUESTED_ASPECT: Readonly<Record<string, ProjectAspect>> = Object.freeze({
  "16:9": "16:9", "9:16": "9:16", "1:1": "1:1", "4:5": "1:1", "21:9": "16:9", other: "16:9",
});
/** film-kind@1 platform defaults; "other" has none. */
const PLATFORM_ASPECT: Readonly<Record<string, string | null>> = PLATFORM_DEFAULT_ASPECT;

export interface ProjectFormat {
  aspect: ProjectAspect;
  /** False for projects without a format choice: they keep the legacy sizes. */
  explicit: boolean;
  /** The aspect the format asked for before mapping to a supported one (e.g. "4:5"), or null. */
  requested: string | null;
}
type FormatSource = { filmKind?: unknown } | null | undefined;
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;

export function projectFormat(project: FormatSource): ProjectFormat {
  const filmKind = project?.filmKind;
  // Pre-structure string kind; Store.getProject normalizes it to { kind: "social", format: { aspect: "9:16" } }.
  if (filmKind === "social_vertical") return { aspect: "9:16", explicit: true, requested: "9:16" };
  const format = record(record(filmKind)?.format);
  const stated = typeof format?.aspect === "string" && Object.hasOwn(REQUESTED_ASPECT, format.aspect) ? format.aspect : undefined;
  const platform = typeof format?.platform === "string" && Object.hasOwn(PLATFORM_ASPECT, format.platform) ? PLATFORM_ASPECT[format.platform] ?? undefined : undefined;
  const requested = stated ?? platform;
  return requested === undefined ? { aspect: "16:9", explicit: false, requested: null } : { aspect: REQUESTED_ASPECT[requested]!, explicit: true, requested };
}
/** The film's aspect: 16:9, 9:16 or 1:1. Defaults to 16:9. */
export function projectAspect(project: FormatSource): ProjectAspect { return projectFormat(project).aspect; }
/** The aspect only when the person chose a format; null keeps legacy sizes and digests. */
export function explicitProjectAspect(project: FormatSource): ProjectAspect | null {
  const format = projectFormat(project); return format.explicit ? format.aspect : null;
}

export interface FrameSize { width: number; height: number }
/** Codex keyframe canvas per aspect (codex-image-turn-v2; gpt-image sizes). 9:16 uses 2:3, the closest portrait canvas. */
export const KEYFRAME_CANVAS: Readonly<Record<ProjectAspect, FrameSize>> = Object.freeze({
  "16:9": Object.freeze({ width: 1536, height: 1024 }), "9:16": Object.freeze({ width: 1024, height: 1536 }), "1:1": Object.freeze({ width: 1024, height: 1024 }),
});
/** Export size per aspect: 720 on the short side, matching the 768p video the pipeline renders. */
export const EXPORT_SIZE: Readonly<Record<ProjectAspect, FrameSize>> = Object.freeze({
  "16:9": Object.freeze({ width: 1280, height: 720 }), "9:16": Object.freeze({ width: 720, height: 1280 }), "1:1": Object.freeze({ width: 720, height: 720 }),
});
export const LEGACY_KEYFRAME_CANVAS: FrameSize = Object.freeze({ width: 1024, height: 1024 });
export const LEGACY_EXPORT_SIZE: FrameSize = Object.freeze({ width: 1280, height: 720 });

export function projectExportSize(project: FormatSource): FrameSize {
  const aspect = explicitProjectAspect(project); return { ...(aspect ? EXPORT_SIZE[aspect] : LEGACY_EXPORT_SIZE) };
}
export function isProjectAspect(value: unknown): value is ProjectAspect {
  return typeof value === "string" && (PROJECT_ASPECTS as readonly string[]).includes(value);
}
const RATIO: Readonly<Record<ProjectAspect, number>> = Object.freeze({ "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1 });
/** Largest accepted ratio between a frame and its target aspect: admits 2:3 for 9:16 and 3:2 for 16:9, refuses the other orientation and square. */
export const FRAME_ASPECT_TOLERANCE = 1.2;
/** Whether an image of this size can be the first frame of a video in this aspect. */
export function frameMatchesAspect(width: number, height: number, aspect: ProjectAspect): boolean {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 || !isProjectAspect(aspect)) return false;
  return Math.abs(Math.log((width / height) / RATIO[aspect])) <= Math.log(FRAME_ASPECT_TOLERANCE);
}
