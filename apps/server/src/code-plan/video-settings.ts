import { canonical, codePlanExportSize, digest, invariant } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { ViggleH3Resolution } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import type { CodePlanCapabilityLock } from "./models.js";
import type { CodePlanModel } from "./identity.js";
import type { CodePlanSettings } from "./records.js";
import { providerPricing } from "./model-pricing.js";

export const CODE_PLAN_VIDEO_RESOLUTIONS = ["480p", "768p", "1080p", "2k"] as const;
export type CodePlanVideoResolution = typeof CODE_PLAN_VIDEO_RESOLUTIONS[number];
export function isCodePlanVideoResolution(value: unknown): value is CodePlanVideoResolution {
  return typeof value === "string" && (CODE_PLAN_VIDEO_RESOLUTIONS as readonly string[]).includes(value);
}
export function filmVideoResolution(store: Pick<Store, "get">, projectId: string, profile: ProviderProfile): ViggleH3Resolution {
  return store.get<CodePlanSettings>("code_plan_settings", projectId)?.videoResolution
    ?? profile.configuration!.settings!.resolution as ViggleH3Resolution;
}
/** Refresh policy at the synchronous admission boundary, even when the sandbox pass started earlier. */
export function currentVideoModel(store: Pick<Store, "get">, projectId: string, model: CodePlanModel): CodePlanModel {
  return model.profile?.adapter === "viggle-h3" ? { ...model, videoResolution: filmVideoResolution(store, projectId, model.profile) } : model;
}
export function codePlanVideoProfile(store: Store, projectId: string): ProviderProfile {
  const project = store.getProject(projectId), lock = store.get<CodePlanCapabilityLock>("capability_lock", project.capabilityLockId);
  const preferred = lock?.preferredProfileIds as { video?: string } | undefined;
  const profile = lock?.profiles.find(row => row.id === preferred?.video) ?? lock?.profiles.find(row => row.kind === "video");
  invariant(project.planMode === "code" && profile?.adapter === "viggle-h3", "CODE_PLAN_VIDEO_SETTINGS_UNAVAILABLE",
    "Video settings require a code film using Viggle");
  return profile;
}
export function codePlanVideoSettings(store: Store, projectId: string) {
  const project = store.getProject(projectId), profile = codePlanVideoProfile(store, projectId);
  const resolution = filmVideoResolution(store, projectId, profile);
  return { version: 1 as const, projectId, model: "viggle-h3" as const,
    quality: profile.configuration!.settings!.quality as "high" | "low", resolution,
    options: CODE_PLAN_VIDEO_RESOLUTIONS.map(resolution => ({ resolution, pricing: providerPricing(profile, resolution)! })),
    exportSize: codePlanExportSize(project, resolution), appliesTo: "unsent" as const };
}

export interface VideoSubmissionPolicy {
  version: 1; sourceCapabilityLockId: string; sourceProfileDefinitionDigest: string; resolution: CodePlanVideoResolution;
}
/** An immutable per-submission lock, separate from the film's unchanged identity lock.
 * Existing provider adapters can validate and retain their exact full profile as usual.
 */
export function videoSubmissionLock(source: CodePlanCapabilityLock, profile: ProviderProfile,
  resolution: CodePlanVideoResolution): CodePlanCapabilityLock {
  invariant(profile.adapter === "viggle-h3" && isCodePlanVideoResolution(resolution)
    && source.profiles.some(row => canonical(row) === canonical(profile)), "CODE_PLAN_PROVIDER_AUTHORITY", "Invalid video submission policy");
  const codePlanVideo: VideoSubmissionPolicy = { version: 1, sourceCapabilityLockId: source.id,
    sourceProfileDefinitionDigest: digest(profile), resolution };
  return { ...source, id: digest({ codePlanVideo }), codePlanVideo,
    profiles: source.profiles.map(row => row.id === profile.id ? { ...row,
      configuration: { ...row.configuration!, settings: { ...row.configuration!.settings!, resolution } } } : row) };
}
