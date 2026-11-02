import { invariant, moneyMicros } from "@openslate/core";
import type { JsonObject, ProviderProfile } from "@openslate/core";
import { falVideoModel, falVideoPriceMicros, seedanceModel, seedancePriceMicros, vigglePriceMicros } from "@openslate/providers";
import type { VideoImageSize, ViggleH3Resolution } from "@openslate/providers";
import { codeOnlyVideoAdapter, videoI2vOptions } from "../execution/video-i2v-options.js";
import { videoMode, videoModes, type CodePlanModel, type VideoMode } from "./identity.js";

export interface ProviderPricing {
  unit: "second";
  modes: { mode: VideoMode; microsPerSecond: string }[];
  minMicrosPerSecond: string;
  maxMicrosPerSecond: string;
}

export const hasDurationPrice = (profile: ProviderProfile): boolean => profile.adapter === "viggle-h3" || codeOnlyVideoAdapter(profile.adapter);

/** Shared defaults: display estimates must use the same settings as new code-plan calls. */
export function videoDefaults(profile: ProviderProfile): JsonObject {
  const video = codeOnlyVideoAdapter(profile.adapter);
  const row = video ? profile.adapter === "seedance" ? seedanceModel(profile.configuration!.model) : falVideoModel(profile.configuration!.model) : undefined;
  const minimum = (profile.minFrames ?? 0) / 30, maximum = (profile.maxFrames ?? 180) / 30;
  const durations = row && "durations" in row ? row.durations : null;
  const durationSeconds = durations ? durations.find(s => s >= minimum && s <= maximum)! : Math.min(maximum, Math.max(row?.minSeconds ?? minimum, 6, minimum));
  return { durationSeconds, ...(video ? { resolution: profile.configuration!.settings!.resolution!, aspectRatio: profile.configuration!.settings![profile.adapter === "seedance" ? "ratio" : "aspectRatio"] ?? (profile.configuration!.model.includes("veo") ? "auto" : "adaptive"), generateAudio: profile.configuration!.settings!.generateAudio ?? false } : {}) };
}

/** Exact input-based rules live in the adapters; legacy profiles keep their configured per-call estimate. */
export function modelPrice(model: CodePlanModel, input?: JsonObject, firstFrame?: VideoImageSize): string {
  if (model.profile?.adapter === "viggle-h3") {
    invariant(input, "CODE_PLAN_INPUT", "Viggle pricing requires the exact input");
    return vigglePriceMicros({ mode: videoMode(input), resolution: model.profile.configuration!.settings!.resolution as ViggleH3Resolution,
      durationSeconds: Number(input.durationSeconds), enhance: false });
  }
  if (model.profile && codeOnlyVideoAdapter(model.profile.adapter)) {
    invariant(input, "CODE_PLAN_INPUT", "Input-based pricing requires the exact media parameters");
    const options = videoI2vOptions(model.profile, input);
    if (model.profile.adapter === "fal-video-i2v") return falVideoPriceMicros(options.model, options, options.seconds);
    invariant(firstFrame || videoMode(input) === "text", "CODE_PLAN_INPUT", "Seedance pricing requires owned image dimensions");
    return seedancePriceMicros(options.model, { ...options, ratio: options.aspectRatio }, { seconds: options.seconds, ...(firstFrame ? { firstFrame } : {}) });
  }
  return moneyMicros(model.priceMicros ?? "0").toString();
}

/** Read-only code-film estimates, never persisted into profiles, locks or receipts.
 * Seedance adaptive inputs use a representative 16:9 frame; actual owned dimensions still price each call.
 * Divide the default clip price, rounding up to a micro, since token pricing can round per clip.
 */
export function providerPricing(profile: ProviderProfile): ProviderPricing | undefined {
  if (profile.kind !== "video" || !hasDurationPrice(profile)) return;
  const defaults = videoDefaults(profile), model: CodePlanModel = { kind: "video", profile };
  const frame = { width: 1280, height: 720 };
  const modes = videoModes(model).filter(mode => profile.adapter !== "viggle-h3" || mode !== "reference" || (profile.maxFrames ?? 450) >= 150).map(mode => {
    // Old Viggle profiles may stop below reference mode's five-second minimum.
    const seconds = profile.adapter === "viggle-h3" && mode === "reference" ? Math.max(5, Number(defaults.durationSeconds)) : Number(defaults.durationSeconds);
    const input: JsonObject = { ...defaults, durationSeconds: seconds,
      ...(mode === "reference" ? { references: [{}] } : mode === "first_frame" ? { firstFrame: {} }
        : mode === "first_last_frame" ? { firstFrame: {}, lastFrame: {} } : {}) };
    if (profile.adapter === "seedance" && mode === "text" && input.aspectRatio === "adaptive") input.aspectRatio = "16:9";
    const price = BigInt(modelPrice(model, input, mode === "text" ? undefined : frame)), duration = BigInt(seconds);
    return { mode, microsPerSecond: ((price + duration - 1n) / duration).toString() };
  });
  const prices = modes.map(row => BigInt(row.microsPerSecond));
  return { unit: "second", modes, minMicrosPerSecond: prices.reduce((a, b) => a < b ? a : b).toString(),
    maxMicrosPerSecond: prices.reduce((a, b) => a > b ? a : b).toString() };
}
