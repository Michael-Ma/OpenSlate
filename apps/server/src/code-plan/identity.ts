import { canonical, digest, invariant } from "@openslate/core";
import type { JsonObject, JsonValue, ProviderProfile } from "@openslate/core";
import { videoRatios, assertProfileVideoDuration } from "./video-capabilities.js";
import { assertImageReferences, imageCapabilities } from "../execution/codex-image-plan.js";
import { rowEdits, rowFrames, SOUND_NAMES, fadeSamples } from "../media/local-timeline.js";
import { layoutCaptions, validateCaptions, type FontLookup } from "../media/captions.js";

export type CodePlanMediaKind = "image" | "video" | "speech" | "music" | "render";
export type VideoMode = "reference" | "first_frame" | "first_last_frame" | "text";
export function videoMode(input: Record<string, unknown>): VideoMode {
  invariant(input.references === undefined || Array.isArray(input.references), "CODE_PLAN_INPUT", "Video references must be an image array");
  const references = Array.isArray(input.references) && input.references.length > 0;
  invariant(!references || !input.firstFrame && !input.lastFrame, "CODE_PLAN_INPUT", "References cannot be combined with firstFrame or lastFrame");
  invariant(!input.lastFrame || input.firstFrame, "CODE_PLAN_INPUT", "lastFrame requires firstFrame");
  return references ? "reference" : input.lastFrame ? "first_last_frame" : input.firstFrame ? "first_frame" : "text";
}
export function videoModes(model: CodePlanModel): VideoMode[] {
  const profile = model.profile, adapter = profile?.adapter;
  if (!profile || adapter === "viggle-h3" || adapter === "seedance" && !profile.configuration!.model.startsWith("seedance-1"))
    return ["reference", "first_frame", "first_last_frame", "text"];
  return adapter === "fal-video-i2v" && !profile.configuration!.model.includes("veo") ? ["first_frame", "first_last_frame"] : ["first_frame"];
}
export interface CodePlanModel { kind: CodePlanMediaKind; defaults?: JsonObject; priceMicros?: string; priceUnit?: "call" | "input"; profile?: ProviderProfile; profileDefinitionDigest?: string;
  /** Host-selected price/dispatch policy; never normalized into the step key. */
  videoResolution?: import("@openslate/providers").ViggleH3Resolution;
  validateImageReferences?: (references: readonly Record<string, unknown>[]) => void }
export const CODE_PLAN_MODELS: Readonly<Record<string, CodePlanModel>> = Object.freeze({
  "fake-image": { kind: "image" },
  "fake-video": { kind: "video", defaults: { durationSeconds: 6 } },
  "fake-speech": { kind: "speech", defaults: { voice: "fixture" }, priceMicros: "10000" },
  "fake-music": { kind: "music", defaults: { instrumental: true }, priceMicros: "80000" },
  "local-render": { kind: "render", priceMicros: "0" },
});
const defaultModel = { image: "fake-image", video: "fake-video", speech: "fake-speech", music: "fake-music", render: "local-render" };

/** Validate render additions without adding defaults to the journal identity of saved plans. */
export function validateRenderInput(source: Record<string, unknown>, options: { fontLookup?: FontLookup } = {}): void {
  // Historical fixture plans can carry opaque render inputs. Their identities stay intact.
  if (source.timeline === undefined && source.captions === undefined) return;
  invariant(Array.isArray(source.timeline) && source.timeline.length >= 1 && source.timeline.length <= 64,
    "CODE_PLAN_RENDER_INPUT", "Use 1–64 timeline rows");
  const number = (value: unknown, min: number, max: number, name: string) => invariant(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max,
    "CODE_PLAN_RENDER_INPUT", `${name} must be an integer in ${min}–${max}`);
  let total = 0, measured = true;
  source.timeline.forEach((raw, index) => {
    invariant(raw && typeof raw === "object" && !Array.isArray(raw), "CODE_PLAN_RENDER_INPUT", `Row ${index + 1}: use a video artifact or timeline clip`);
    const row = raw as Record<string, unknown>, edits = rowEdits(row, index);
    if (row.startFrame !== undefined) number(row.startFrame, 0, 10799, `Row ${index + 1}: startFrame`);
    if (row.durationFrames !== undefined) { number(row.durationFrames, 1, 10800, `Row ${index + 1}: durationFrames`); total += rowFrames({ durationFrames: row.durationFrames as number, ...edits }); }
    else measured = false;
    invariant(row.fit === undefined || row.fit === "contain" || row.fit === "cover", "CODE_PLAN_RENDER_INPUT", `Row ${index + 1}: fit must be contain or cover`);
  });
  invariant(!measured || total >= 1 && total <= 10800, "CODE_PLAN_RENDER_INPUT", "Edited film length must be in 1–10800 frames (360 seconds)");
  if (source.audio !== undefined) {
    invariant(Array.isArray(source.audio) && source.audio.length <= 65, "CODE_PLAN_RENDER_INPUT", "Use at most 65 audio placements, including sounds");
    source.audio.forEach((raw, index) => {
      invariant(raw && typeof raw === "object" && !Array.isArray(raw), "CODE_PLAN_RENDER_INPUT", `Audio row ${index + 1}: use an audio or sound placement`);
      const row = raw as Record<string, unknown>;
      if (row.sound !== undefined) {
        invariant((SOUND_NAMES as readonly unknown[]).includes(row.sound) && Object.keys(row).every(key => ["sound", "atSample", "gainMilliDb"].includes(key)),
          "CODE_PLAN_RENDER_INPUT", `Audio row ${index + 1}: sound must be one of ${SOUND_NAMES.join(", ")}, with atSample and optional gainMilliDb`);
        number(row.atSample, 0, (measured ? total : 10800) * 1600 - 1, `Audio row ${index + 1}: atSample`);
      }
      for (const key of ["startSample", "atSample", "durationSamples"]) if (row[key] !== undefined) number(row[key], key === "durationSamples" ? 1 : 0, 17280000, `Audio row ${index + 1}: ${key}`);
      if (row.gainMilliDb !== undefined) number(row.gainMilliDb, -60000, 12000, `Audio row ${index + 1}: gainMilliDb`);
      for (const key of ["fadeInSamples", "fadeOutSamples"]) if (row[key] !== undefined) fadeSamples(row[key], Number(row.durationSamples ?? 240000), index, key);
    });
  }
  for (const key of ["width", "height"]) if (source[key] !== undefined) {
    number(source[key], 2, 1920, key); invariant(Number(source[key]) % 2 === 0, "CODE_PLAN_RENDER_INPUT", `${key} must be even, in 2–1920`);
  }
  // A missing dimension comes from the film aspect ratio at capture, not from a universal landscape default.
  if (source.width !== undefined && source.height !== undefined)
    invariant(Number(source.width) * Number(source.height) <= 1920 * 1080, "CODE_PLAN_RENDER_INPUT", "Output area must be at most 2073600 pixels");
  if (source.captions !== undefined) layoutCaptions(validateCaptions(source.captions, measured ? total : 10800), Number(source.width ?? 1280), Number(source.height ?? 720), options.fontLookup);
}

/** Whitespace in creative strings is significant. Only object order, defaults and artifact identities normalize. */
export function normalizeStepInput(kind: CodePlanMediaKind, value: unknown,
  models: Readonly<Record<string, CodePlanModel>> = CODE_PLAN_MODELS): JsonObject {
  const input = kind === "render" && Array.isArray(value) ? { timeline: value } : value;
  invariant(input && typeof input === "object" && !Array.isArray(input), "CODE_PLAN_INPUT", "Media input must be an object");
  const source = input as Record<string, unknown>;
  if (kind === "render") validateRenderInput(source);
  if (kind !== "render" && Object.hasOwn(source, "shot")) invariant(typeof source.shot === "string" && source.shot.length > 0 && source.shot.length <= 120,
    "CODE_PLAN_INPUT", "Use a shot annotation of 1 to 120 characters");
  const { shot: _shot, ...media } = source;
  if (kind === "music") invariant(typeof media.prompt === "string" && media.prompt.trim().length > 0 && Buffer.byteLength(media.prompt as string) <= 32768
    && typeof media.durationSeconds === "number" && Number.isFinite(media.durationSeconds) && media.durationSeconds > 0 && media.durationSeconds <= 360
    && (media.instrumental === undefined || typeof media.instrumental === "boolean")
    && Object.keys(media).every(key => ["model", "prompt", "durationSeconds", "instrumental", "variant", "profileDefinitionDigest"].includes(key)),
  "CODE_PLAN_INPUT", "Music requires a prompt, a duration within 360 seconds and optional instrumental/variant settings");
  const model = source.model ?? (models[defaultModel[kind]] ? defaultModel[kind] : Object.keys(models).find(id => models[id]?.kind === kind));
  invariant(typeof model === "string" && Object.hasOwn(models, model) && models[model]?.kind === kind,
    "CODE_PLAN_MODEL", "Use a configured model for this operation");
  if (kind === "image") {
    const selected = models[model]!;
    assertImageReferences(media.references, selected.profile);
    selected.validateImageReferences?.(media.references ?? []);
    const ratios = imageCapabilities(selected.profile).imageAspectRatios;
    invariant(media.aspectRatio === undefined || typeof media.aspectRatio === "string" && ratios.includes(media.aspectRatio),
      "CODE_PLAN_INPUT", `${model} accepts image aspectRatio: ${ratios.join(", ") || "none; omit aspectRatio and use its installed canvas"}`);
  }
  if (kind === "video") {
    invariant(models[model]!.profile?.adapter !== "viggle-h3" || media.resolution === undefined,
      "CODE_PLAN_INPUT", "Viggle resolution belongs to the film's video settings; omit resolution from ctx.video");
    const mode = videoMode(media), modes = videoModes(models[model]!);
    invariant(modes.includes(mode), "CODE_PLAN_INPUT", `${model} supports video modes: ${modes.join(", ")}`);
    invariant(mode !== "text" || typeof media.aspectRatio === "string" && (videoRatios as readonly string[]).includes(media.aspectRatio),
      "CODE_PLAN_INPUT", "Text video requires an explicit aspectRatio");
    const references = media.references as unknown[] | undefined;
    const maximum = models[model]!.profile?.adapter === "viggle-h3" ? 4 : 9;
    invariant(!references || references.length <= maximum, "CODE_PLAN_INPUT", `${model} accepts at most ${maximum} reference images`);
    for (const frame of [media.firstFrame, media.lastFrame, ...(references ?? [])].filter(value => value !== undefined))
      invariant(frame && typeof frame === "object" && !Array.isArray(frame) && "kind" in frame && frame.kind === "image" && "sha256" in frame,
        "CODE_PLAN_INPUT", "Video inputs must be owned image artifacts");
    if (references?.length === 0) delete media.references;
    const selected = models[model]!;
    if (selected.profile) assertProfileVideoDuration(selected.profile, media.durationSeconds ?? selected.defaults?.durationSeconds);
    invariant(models[model]!.profile?.adapter !== "viggle-h3" || mode !== "reference"
      || Number(media.durationSeconds ?? models[model]!.defaults?.durationSeconds) >= 5, "CODE_PLAN_INPUT", "Viggle reference clips need 5–15 seconds");
  }
  const normalize = (item: unknown, depth: number): JsonValue => {
    invariant(depth <= 40, "CODE_PLAN_INPUT", "Media input nesting exceeds its limit");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number") { invariant(Number.isFinite(item), "CODE_PLAN_INPUT", "Use finite parameters"); return Object.is(item, -0) ? 0 : item; }
    if (Array.isArray(item)) return item.map(value => normalize(value, depth + 1));
    invariant(item && typeof item === "object", "CODE_PLAN_INPUT", "Media parameters must be JSON values");
    const object = item as Record<string, unknown>;
    if (typeof object.sha256 === "string" && typeof object.kind === "string") {
      invariant(/^[a-f0-9]{64}$/.test(object.sha256) && ["image", "video", "audio", "document", "data"].includes(object.kind),
        "CODE_PLAN_INPUT", "Invalid input artifact identity");
      return { kind: object.kind, sha256: object.sha256 };
    }
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, normalize(object[key], depth + 1)]));
  };
  const result = normalize({ ...models[model]?.defaults, ...(kind === "render" ? source : media), model, ...(models[model]?.profileDefinitionDigest ? { profileDefinitionDigest: models[model]!.profileDefinitionDigest! } : {}) }, 0) as JsonObject;
  invariant(Buffer.byteLength(canonical(result)) <= 256 * 1024, "CODE_PLAN_INPUT", "Media input exceeds its byte limit");
  return result;
}

export function stepKey(kind: CodePlanMediaKind, input: JsonObject): string { return digest({ kind, input }); }
