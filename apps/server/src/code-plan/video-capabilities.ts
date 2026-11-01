import { SEEDANCE_RATIOS, seedanceModel, falVideoModel } from "@openslate/providers";
import type { CodePlanModel } from "./identity.js";
import { invariant } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";

/** Shared by code-plan validation, aspect inference and model descriptions. */
export const videoRatios = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] as const;

/** Saved profile bounds remain authoritative for legacy calls; new Viggle profiles start at five seconds. */
export function assertProfileVideoDuration(profile: ProviderProfile, seconds: unknown): void {
  const minimum = (profile.minFrames ?? 1) / 30, maximum = (profile.maxFrames ?? 450) / 30;
  invariant(Number.isSafeInteger(seconds) && Number(seconds) >= minimum && Number(seconds) <= maximum,
    "CODE_PLAN_INPUT", `Video duration must be a whole number of seconds within ${minimum}–${maximum} seconds for ${profile.id}`);
}

export function videoCapabilities(model: CodePlanModel) {
  const profile = model.profile, adapter = profile?.adapter;
  const row = adapter === "seedance" ? seedanceModel(profile!.configuration!.model)
    : adapter === "fal-video-i2v" ? falVideoModel(profile!.configuration!.model) : undefined;
  const vendorMin = row?.minSeconds ?? (adapter === "viggle-h3" ? 5 : adapter === "minimax-h3" ? profile!.configuration!.model === "MiniMax-H3" ? 4 : 5 : 1);
  const vendorMax = row?.maxSeconds ?? (profile ? 15 : 360);
  const minimum = Math.max(vendorMin, (profile?.minFrames ?? vendorMin * 30) / 30);
  const maximum = Math.min(vendorMax, (profile?.maxFrames ?? vendorMax * 30) / 30);
  // Veo's discrete durations must also be intersected with the saved profile.
  const durations = row && "durations" in row ? row.durations?.filter(seconds => seconds >= minimum && seconds <= maximum) : undefined;
  const aspectRatios = adapter === "seedance" ? [...SEEDANCE_RATIOS, "adaptive"]
    : row && "ratios" in row ? [...row.ratios] : adapter === "minimax-h3" ? ["adaptive"] : [...videoRatios];
  const available = minimum <= maximum && (!durations || durations.length > 0);
  return { aspectRatios, durationSeconds: { min: available ? durations ? Math.min(...durations) : minimum : null,
    max: available ? durations ? Math.max(...durations) : maximum : null },
    ...(durations ? { durationValuesSeconds: durations } : {}) };
}
