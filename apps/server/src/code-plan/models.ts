import { vigglePriceMicros, VIGGLE_PRICE_CREDITS, seedancePriceMicros, falVideoPriceMicros, seedanceModel, falVideoModel } from "@openslate/providers";
import type { VideoImageSize, ViggleH3Resolution } from "@openslate/providers";
import type { JsonObject } from "@openslate/core";
import type { ArtifactRecord } from "../execution/engine.js";
import { codeOnlyVideoAdapter, videoI2vOptions } from "../execution/video-i2v-options.js";
import { canonical, digest, invariant, moneyMicros } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import { profilePolicy, type InstalledProviderCatalog } from "../application/provider-catalog.js";
import type { Store } from "../persistence/store.js";
import { CODE_PLAN_MODELS, videoMode, videoModes, type CodePlanModel } from "./identity.js";
import { videoCapabilities } from "./video-capabilities.js";
import { codePlanArtifacts } from "./artifacts.js";
import { assertImageReferenceRecords, imageCapabilities } from "../execution/codex-image-plan.js";

export interface CodePlanCapabilityLock { id: string; projectId: string; profiles: ProviderProfile[]; localExecution?: unknown; [key: string]: unknown }
export const supportedCodePlanAdapters = new Set(["codex-image", "openai-image", "viggle-h3", "minimax-h3", "openai-speech", "seedance", "fal-video-i2v", "gemini-lyria"]);

/** Keep locked definitions byte for byte so journal keys never change. Retired Codex locks can replay;
 * new dispatch requires an exact installed definition or the catalog's sole runtime-only upgrade. */
export function projectModels(store: Store, projectId: string, catalog?: InstalledProviderCatalog): Record<string, CodePlanModel> {
  const project = store.getProject(projectId), lock = store.get<CodePlanCapabilityLock>("capability_lock", project.capabilityLockId);
  const installed = catalog?.view().profiles ?? [];
  const recordedCodex = (profile: ProviderProfile): boolean => {
    if (profile.adapter !== "codex-image" || profile.configuration?.settings?.runtimeVersion !== "0.153.4") return false;
    try { profilePolicy(profile, { historical: true }); return true; } catch { return false; }
  };
  const real = lock?.profiles.filter(profile => supportedCodePlanAdapters.has(profile.adapter)
    && (recordedCodex(profile) || installed.some(row => row.installedDefinition && canonical(row.profile) === canonical(profile)))) ?? [];
  // A saved real lock must fail closed if its installation disappears; never turn it into a fixture project.
  const hasRealLock = lock?.profiles.some(profile => profile.adapter !== "fake") ?? false;
  const withImageValidation = (models: Record<string, CodePlanModel>) => {
    for (const model of Object.values(models)) if (model.kind === "image") model.validateImageReferences = references => {
      if (!references.length) return;
      const media = codePlanArtifacts(store, projectId);
      const records = references.map(ref => {
        const record = media.find(ref);
        invariant(record?.artifact.kind === "image", "CODE_PLAN_INPUT", "Use PNG image artifacts owned by this film; replace foreign or missing references");
        return record;
      });
      if (model.profile) assertImageReferenceRecords(records, "CODE_PLAN_INPUT");
    };
    return models;
  };
  if (!hasRealLock) return withImageValidation(structuredClone(CODE_PLAN_MODELS));
  const models: Record<string, CodePlanModel> = { "local-render": { kind: "render", priceMicros: "0" } };
  for (const profile of real) {
    if (!["image", "video", "speech", "music"].includes(profile.kind)) continue;
    invariant(profile.id !== "local-render", "CODE_PLAN_MODEL", "The profile id local-render is reserved for local assembly");
    const video = codeOnlyVideoAdapter(profile.adapter);
    const row = video ? profile.adapter === "seedance" ? seedanceModel(profile.configuration!.model) : falVideoModel(profile.configuration!.model) : undefined;
    const minimum = (profile.minFrames ?? 0) / 30, maximum = (profile.maxFrames ?? 180) / 30;
    const durations = row && "durations" in row ? row.durations : null;
    const durationSeconds = durations ? durations.find(s => s >= minimum && s <= maximum)! : Math.min(maximum, Math.max(row?.minSeconds ?? minimum, 6, minimum));
    models[profile.id] = { kind: profile.kind as CodePlanModel["kind"], profile: structuredClone(profile),
      profileDefinitionDigest: digest(profile), priceMicros: profile.unitCostMicros,
      // Viggle and N2 adapters price exact inputs; other adapters retain configured estimates.
      priceUnit: video || profile.adapter === "viggle-h3" ? "input" : "call",
      defaults: profile.kind === "video" ? { durationSeconds, ...(video ? { resolution: profile.configuration!.settings!.resolution!, aspectRatio: profile.configuration!.settings![profile.adapter === "seedance" ? "ratio" : "aspectRatio"] ?? (profile.configuration!.model.includes("veo") ? "auto" : "adaptive"), generateAudio: profile.configuration!.settings!.generateAudio ?? false } : {}) }
        : profile.kind === "music" ? { instrumental: true } : profile.kind === "speech" ? { voice: "coral", instructions: "" } : {} };
  }
  return withImageValidation(models);
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
export function codePlanPriceFrame(store: Pick<Store, "list">, projectId: string, input: JsonObject): VideoImageSize | undefined {
  const frame = input.firstFrame ?? (Array.isArray(input.references) ? input.references[0] : undefined);
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return;
  const record = store.list<ArtifactRecord>("artifact", projectId).find(row => row.projectId === projectId && row.artifact.kind === "image" && row.artifact.sha256 === frame.sha256);
  return record && Number.isSafeInteger(record.width) && Number.isSafeInteger(record.height) ? { width: record.width!, height: record.height! } : undefined;
}

export function modelDescriptions(models: Readonly<Record<string, CodePlanModel>>) {
  return Object.entries(models).map(([id, model]) => ({ id, kind: model.kind, unitCostMicros: model.priceUnit === "input" ? null : model.priceMicros ?? null,
    priceUnit: model.priceUnit ?? "call", priceUnknown: model.priceUnit === "input" ? false : !model.priceMicros || model.priceMicros === "0" && !!model.profile && model.profile.adapter !== "codex-image",
    ...(model.profile?.adapter === "codex-image" ? { subscription: "codex", authentication: "checked_before_dispatch" } : {}),
    ...(model.profile?.adapter === "gemini-lyria" ? { note: "length is approximate; trim and fade at the cut", watermark: "SynthID" } : {}),
    ...(model.kind === "video" ? { videoModes: videoModes(model), ...videoCapabilities(model) } : {}),
    ...(model.kind === "image" ? imageCapabilities(model.profile) : {}),
    ...(model.priceUnit === "input" ? { priceBasis: model.profile?.adapter === "viggle-h3" ? { unit: "ceil_output_seconds", formula: "ceil(seconds) * creditsPer5Seconds / 5 * $0.01", enhance: false,
      resolution: model.profile.configuration!.settings!.resolution,
      creditsPer5Seconds: Object.fromEntries(Object.entries(VIGGLE_PRICE_CREDITS).map(([mode, rates]) => [mode, rates.off[["480p", "768p", "1080p", "2k", "4k"].indexOf(String(model.profile!.configuration!.settings!.resolution))]])) }
      : model.profile?.adapter === "seedance" ? { unit: "output_tokens", formula: "seconds * width * height * 24 / 1024", usdPerMillionTokens: model.profile.configuration!.model.startsWith("seedance-1") ? "1.00" : model.profile.configuration!.model.includes("mini") ? "3.50" : "7.00 (1080p: 7.70)" }
      : { unit: "output_seconds", usdPerSecond: model.profile!.configuration!.model.includes("kling") ? "0.084 (silent)" : model.profile!.configuration!.model.includes("veo") ? "0.10 silent / 0.15 audio; 4k 0.30 / 0.35" : "480p 0.05 / 720p 0.10 / 1080p 0.20" }, modelId: model.profile!.configuration!.model } : {}),
    defaults: model.defaults ?? {}, ...(model.profile ? { minFrames: model.profile.minFrames ?? null, maxFrames: model.profile.maxFrames ?? null } : {}) }));
}
