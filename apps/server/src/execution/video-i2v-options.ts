import { invariant } from "@openslate/core";
import type { JsonObject, ProviderProfile } from "@openslate/core";
import { seedanceModel, falVideoModel, validateSeedanceSettings, validateFalVideoSettings, falVideoPriceMicros } from "@openslate/providers";
export const codeOnlyVideoAdapter = (adapter: string): boolean => adapter === "seedance" || adapter === "fal-video-i2v";
/** Fixed model policy, shared by installation validation, pricing and dispatch translation. */
export function videoI2vOptions(profile: ProviderProfile, input: JsonObject) {
  const adapter = profile.adapter, model = profile.configuration?.model, settings = profile.configuration?.settings ?? {};
  invariant(codeOnlyVideoAdapter(adapter) && typeof model === "string", "CODE_PLAN_MODEL", "Use a supported installed image-to-video model");
  const row = adapter === "seedance" ? seedanceModel(model) : falVideoModel(model);
  const seconds = Number(input.durationSeconds);
  invariant(Number.isSafeInteger(input.durationSeconds) && seconds >= row.minSeconds && seconds <= row.maxSeconds
    && seconds * 30 >= (profile.minFrames ?? 1) && seconds * 30 <= (profile.maxFrames ?? 900), "CODE_PLAN_INPUT", "Video duration must fit this model and installed profile");
  const resolution = input.resolution ?? settings.resolution;
  const aspectRatio = input.aspectRatio ?? settings[adapter === "seedance" ? "ratio" : "aspectRatio"] ?? (model.includes("veo") ? "auto" : "adaptive");
  const generateAudio = input.generateAudio ?? settings.generateAudio ?? false;
  invariant(typeof resolution === "string" && typeof aspectRatio === "string" && typeof generateAudio === "boolean", "CODE_PLAN_INPUT", "Use supported resolution, aspect ratio and audio options");
  invariant(input.seed === undefined || Number.isSafeInteger(input.seed) && Number(input.seed) >= 0 && Number(input.seed) <= 2147483647,
    "CODE_PLAN_INPUT", "Seed must be an integer from 0 to 2147483647");
  const result = { resolution, aspectRatio, generateAudio };
  if (adapter === "seedance") validateSeedanceSettings(model, { ...result, ratio: aspectRatio });
  else falVideoPriceMicros(model, result, seconds);
  invariant(!input.lastFrame || (adapter === "seedance" ? seedanceModel(model).lastFrame : !model.includes("veo")), "CODE_PLAN_INPUT", "This model supports only a first frame");
  invariant(adapter !== "fal-video-i2v" || !model.includes("kling") || input.seed === undefined, "CODE_PLAN_INPUT", "Kling does not expose a seed field");
  return { model, seconds, ...result, ...(input.seed === undefined ? {} : { seed: Number(input.seed) }) };
}
export function assertVideoI2vProfile(profile: ProviderProfile): void {
  const configuration = profile.configuration, settings = configuration?.settings;
  invariant(profile.kind === "video" && profile.executionVersion === "1" && settings && configuration
    && Object.keys(configuration).every(k => ["model","settings"].includes(k))
    && Object.keys(settings).every(k => ["resolution", profile.adapter === "seedance" ? "ratio" : "aspectRatio", "generateAudio"].includes(k)), "PROVIDER_CATALOG_INVALID", "Use the fixed image-to-video settings");
  const row = profile.adapter === "seedance" ? seedanceModel(configuration.model) : falVideoModel(configuration.model);
  invariant(Number.isSafeInteger(profile.minFrames) && Number.isSafeInteger(profile.maxFrames) && profile.minFrames! >= row.minSeconds * 30
    && profile.maxFrames! <= row.maxSeconds * 30 && profile.minFrames! <= profile.maxFrames! && profile.minFrames! % 30 === 0 && profile.maxFrames! % 30 === 0,
    "PROVIDER_CATALOG_INVALID", "Explicit whole-second bounds must fit the model");
  if (profile.adapter === "seedance") validateSeedanceSettings(configuration.model, settings as never);
  else validateFalVideoSettings(configuration.model, settings as never);
  // Also reject profiles whose interval contains no legal duration (e.g. Veo restricted to 5 s).
  const minimum = profile.minFrames! / 30, maximum = profile.maxFrames! / 30;
  invariant(!("durations" in row) || row.durations === null || row.durations.some(s => s >= minimum && s <= maximum), "PROVIDER_CATALOG_INVALID", "Profile must allow a supported duration");
}
