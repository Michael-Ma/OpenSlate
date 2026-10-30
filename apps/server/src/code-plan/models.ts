import { seedancePriceMicros, falVideoPriceMicros, seedanceModel, falVideoModel } from "@openslate/providers";
import type { VideoImageSize } from "@openslate/providers";
import type { JsonObject } from "@openslate/core";
import type { ArtifactRecord } from "../execution/engine.js";
import { codeOnlyVideoAdapter, videoI2vOptions } from "../execution/video-i2v-options.js";
import { canonical, digest, invariant, moneyMicros } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { InstalledProviderCatalog } from "../application/provider-catalog.js";
import type { Store } from "../persistence/store.js";
import { CODE_PLAN_MODELS, type CodePlanModel } from "./identity.js";

export interface CodePlanCapabilityLock { id: string; projectId: string; profiles: ProviderProfile[]; localExecution?: unknown; [key: string]: unknown }
export const supportedCodePlanAdapters = new Set(["codex-image", "openai-image", "viggle-h3", "minimax-h3", "openai-speech", "seedance", "fal-video-i2v"]);

/** Catalog definitions and the project lock must agree byte for byte. Readiness never supplies a replacement profile. */
export function projectModels(store: Store, projectId: string, catalog?: InstalledProviderCatalog): Record<string, CodePlanModel> {
  const project = store.getProject(projectId), lock = store.get<CodePlanCapabilityLock>("capability_lock", project.capabilityLockId);
  const installed = catalog?.view().profiles ?? [];
  const real = lock?.profiles.filter(profile => supportedCodePlanAdapters.has(profile.adapter)
    && installed.some(row => row.installedDefinition && canonical(row.profile) === canonical(profile))) ?? [];
  // A saved real lock must fail closed if its installation disappears; never turn it into a fixture project.
  const hasRealLock = lock?.profiles.some(profile => profile.adapter !== "fake") ?? false;
  if (!hasRealLock) return structuredClone(CODE_PLAN_MODELS);
  const models: Record<string, CodePlanModel> = { "local-render": { kind: "render", priceMicros: "0" } };
  for (const profile of real) {
    if (!["image", "video", "speech"].includes(profile.kind)) continue;
    invariant(profile.id !== "local-render", "CODE_PLAN_MODEL", "The profile id local-render is reserved for local assembly");
    const video = codeOnlyVideoAdapter(profile.adapter);
    const row = video ? profile.adapter === "seedance" ? seedanceModel(profile.configuration!.model) : falVideoModel(profile.configuration!.model) : undefined;
    const minimum = (profile.minFrames ?? 0) / 30, maximum = (profile.maxFrames ?? 180) / 30;
    const durations = row && "durations" in row ? row.durations : null;
    const durationSeconds = durations ? durations.find(s => s >= minimum && s <= maximum)! : Math.min(maximum, Math.max(row?.minSeconds ?? minimum, 6, minimum));
    models[profile.id] = { kind: profile.kind as CodePlanModel["kind"], profile: structuredClone(profile),
      profileDefinitionDigest: digest(profile), priceMicros: profile.unitCostMicros,
      // Legacy adapters retain per-call estimates; N2 adapters compute from the exact input.
      priceUnit: video ? "input" : "call",
      defaults: profile.kind === "video" ? { durationSeconds, ...(video ? { resolution: profile.configuration!.settings!.resolution!, aspectRatio: profile.configuration!.settings![profile.adapter === "seedance" ? "ratio" : "aspectRatio"] ?? (profile.configuration!.model.includes("veo") ? "auto" : "adaptive"), generateAudio: profile.configuration!.settings!.generateAudio ?? false } : {}) }
        : profile.kind === "speech" ? { voice: "coral", instructions: "" } : {} };
  }
  return models;
}

/** Exact input-based rules live in the adapters; legacy profiles keep their configured per-call estimate. */
export function modelPrice(model: CodePlanModel, input?: JsonObject, firstFrame?: VideoImageSize): string {
  if (model.profile && codeOnlyVideoAdapter(model.profile.adapter)) {
    invariant(input, "CODE_PLAN_INPUT", "Input-based pricing requires the exact media parameters");
    const options = videoI2vOptions(model.profile, input);
    if (model.profile.adapter === "fal-video-i2v") return falVideoPriceMicros(options.model, options, options.seconds);
    invariant(firstFrame, "CODE_PLAN_INPUT", "Seedance pricing requires an owned first frame's measured dimensions");
    return seedancePriceMicros(options.model, { ...options, ratio: options.aspectRatio }, { seconds: options.seconds, firstFrame });
  }
  return moneyMicros(model.priceMicros ?? "0").toString();
}
export function codePlanPriceFrame(store: Pick<Store, "list">, projectId: string, input: JsonObject): VideoImageSize | undefined {
  const frame = input.firstFrame;
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return;
  const record = store.list<ArtifactRecord>("artifact", projectId).find(row => row.projectId === projectId && row.artifact.kind === "image" && row.artifact.sha256 === frame.sha256);
  return record && Number.isSafeInteger(record.width) && Number.isSafeInteger(record.height) ? { width: record.width!, height: record.height! } : undefined;
}

export function modelDescriptions(models: Readonly<Record<string, CodePlanModel>>) {
  return Object.entries(models).map(([id, model]) => ({ id, kind: model.kind, unitCostMicros: model.priceUnit === "input" ? null : model.priceMicros ?? null,
    priceUnit: model.priceUnit ?? "call", priceUnknown: model.priceUnit === "input" ? false : !model.priceMicros || model.priceMicros === "0" && !!model.profile && model.profile.adapter !== "codex-image",
    ...(model.profile?.adapter === "codex-image" ? { subscription: "codex", authentication: "checked_before_dispatch" } : {}),
    ...(model.priceUnit === "input" ? { priceBasis: model.profile?.adapter === "seedance" ? { unit: "output_tokens", formula: "seconds * width * height * 24 / 1024", usdPerMillionTokens: model.profile.configuration!.model.startsWith("seedance-1") ? "1.00" : model.profile.configuration!.model.includes("mini") ? "3.50" : "7.00 (1080p: 7.70)" }
      : { unit: "output_seconds", usdPerSecond: model.profile!.configuration!.model.includes("kling") ? "0.084 (silent)" : model.profile!.configuration!.model.includes("veo") ? "0.10 silent / 0.15 audio; 4k 0.30 / 0.35" : "480p 0.05 / 720p 0.10 / 1080p 0.20" }, modelId: model.profile!.configuration!.model } : {}),
    defaults: model.defaults ?? {}, ...(model.profile ? { minFrames: model.profile.minFrames ?? null, maxFrames: model.profile.maxFrames ?? null } : {}) }));
}
