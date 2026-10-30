import { canonical, digest, invariant, moneyMicros } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { InstalledProviderCatalog } from "../application/provider-catalog.js";
import type { Store } from "../persistence/store.js";
import { CODE_PLAN_MODELS, type CodePlanModel } from "./identity.js";

export interface CodePlanCapabilityLock { id: string; projectId: string; profiles: ProviderProfile[]; localExecution?: unknown; [key: string]: unknown }
export const supportedCodePlanAdapters = new Set(["codex-image", "openai-image", "viggle-h3", "minimax-h3", "openai-speech", "gemini-lyria"]);

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
    if (!["image", "video", "speech", "music"].includes(profile.kind)) continue;
    invariant(profile.id !== "local-render", "CODE_PLAN_MODEL", "The profile id local-render is reserved for local assembly");
    models[profile.id] = { kind: profile.kind as CodePlanModel["kind"], profile: structuredClone(profile),
      profileDefinitionDigest: digest(profile), priceMicros: profile.unitCostMicros,
      // Same basis as the graph quote (generation-quotes.ts): one unitCostMicros per call, clips included.
      priceUnit: "call",
      defaults: profile.kind === "video" ? { durationSeconds: Math.min((profile.maxFrames ?? 180) / 30, Math.max(6, (profile.minFrames ?? 0) / 30)) }
        : profile.kind === "music" ? { instrumental: true } : profile.kind === "speech" ? { voice: "coral", instructions: "" } : {} };
  }
  return models;
}

/** Duration is validated against the profile in provider-input.ts; it never scales the price. */
export function modelPrice(model: CodePlanModel): string {
  return moneyMicros(model.priceMicros ?? "0").toString();
}

export function modelDescriptions(models: Readonly<Record<string, CodePlanModel>>) {
  return Object.entries(models).map(([id, model]) => ({ id, kind: model.kind, unitCostMicros: model.priceMicros ?? null,
    priceUnit: model.priceUnit ?? "call", priceUnknown: !model.priceMicros || model.priceMicros === "0" && !!model.profile && model.profile.adapter !== "codex-image",
    ...(model.profile?.adapter === "codex-image" ? { subscription: "codex", authentication: "checked_before_dispatch" } : {}),
    ...(model.profile?.adapter === "gemini-lyria" ? { note: "length is approximate; trim and fade at the cut", watermark: "SynthID" } : {}),
    defaults: model.defaults ?? {}, ...(model.profile ? { minFrames: model.profile.minFrames ?? null, maxFrames: model.profile.maxFrames ?? null } : {}) }));
}
