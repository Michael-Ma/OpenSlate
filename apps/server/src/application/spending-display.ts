import { canonical, digest, providerProfileArguments } from "@openslate/core";
import type { ProviderProfile } from "@openslate/core";
import type { AllowanceSelection, ExternalAllowance } from "../execution/external-allowance-records.js";
import type { PlanRecord } from "../execution/engine.js";
import { profilePolicy } from "./provider-catalog.js";

interface DisplayIdentity { id: string; revision: string; definitionDigest: string }
export type SpendingProviderDisplay = DisplayIdentity & (
  { adapter: "openai-image"; model: string; settings: { width: number; height: number; quality: string } }
  | { adapter: "minimax-h3"; model: string; settings: { resolution: string } }
);
export interface SpendingWorkDisplay extends AllowanceSelection {
  alias: string | null; shotId: string | null; operation: "image" | "video" | null;
  current: boolean; historyAvailable: boolean;
}
interface RetainedLock { projectId: string; profiles: unknown }
interface RetainedProfile { canonical: string; profileDigest: string; display: SpendingProviderDisplay }
interface RetainedWork { alias: string; shotId: string | null; operation: "image" | "video"; profileDigest: string }
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const label = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 160
  && !/[\u0000-\u001f\u007f]/.test(value) && !/\b[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/^(?:\/|~\/)/.test(value);
const nodeKey = (selection: Pick<AllowanceSelection, "nodeId" | "specDigest">) => JSON.stringify([selection.nodeId, selection.specDigest]);
const selectionKey = (selection: AllowanceSelection) => JSON.stringify([selection.candidateId, selection.nodeId, selection.specDigest]);

/** Copy only the supported model/settings fields, bound to the entire expected definition. */
export function spendingProviderDisplay(value: unknown, expectedDefinitionDigest: string | null): SpendingProviderDisplay | null {
  try {
    if (!hash(expectedDefinitionDigest)) return null;
    const profile = structuredClone(value) as ProviderProfile;
    const policy = profilePolicy(profile);
    if (policy.fixture || digest(profile) !== expectedDefinitionDigest) return null;
    const identity = { id: profile.id, revision: profile.revision, definitionDigest: expectedDefinitionDigest };
    const { model, settings } = profile.configuration!;
    if (profile.adapter === "openai-image") return { ...identity, adapter: "openai-image", model,
      settings: { width: settings!.width as number, height: settings!.height as number, quality: settings!.quality as string } };
    if (profile.adapter === "minimax-h3") return { ...identity, adapter: "minimax-h3", model,
      settings: { resolution: settings!.resolution as string } };
    return null;
  } catch { return null; }
}

/** Index only retained same-project evidence. Conflicting histories remain explicitly unavailable. */
export function spendingHistoryDisplay(projectId: string, locks: readonly RetainedLock[], plans: readonly PlanRecord[]) {
  const profiles = new Map<string, RetainedProfile | null>(), work = new Map<string, RetainedWork | null>();
  for (const lock of locks) {
    if (lock.projectId !== projectId || !Array.isArray(lock.profiles)) continue;
    for (const value of lock.profiles) {
      try {
        const definitionDigest = digest(value), display = spendingProviderDisplay(value, definitionDigest);
        if (!display) continue;
        const encoded = canonical(value), prior = profiles.get(definitionDigest);
        if (profiles.has(definitionDigest) && (prior === null || prior!.canonical !== encoded)) { profiles.set(definitionDigest, null); continue; }
        profiles.set(definitionDigest, { canonical: encoded, profileDigest: String(providerProfileArguments(value).profileDigest), display });
      } catch { /* Missing or unsupported retained definitions supply no display identity. */ }
    }
  }
  for (const plan of plans) {
    if (plan.projectId !== projectId || !Array.isArray(plan.compiled?.nodes)) continue;
    for (const node of plan.compiled.nodes) {
      if (!id(node.id) || !hash(node.specDigest)) continue;
      const key = nodeKey({ nodeId: node.id, specDigest: node.specDigest });
      const value: RetainedWork | null = (node.kind === "image" || node.kind === "video") && label(node.alias)
        && (node.shotId === null || id(node.shotId)) && hash(node.args?.profileDigest)
        ? { alias: node.alias, shotId: node.shotId, operation: node.kind, profileDigest: node.args.profileDigest } : null;
      if (work.has(key) && canonical(work.get(key)) !== canonical(value)) work.set(key, null);
      else work.set(key, value);
    }
  }
  return (allowance: ExternalAllowance, currentSelections: readonly AllowanceSelection[]) => {
    const retained = profiles.get(allowance.profileDefinitionDigest);
    const providerDisplay = allowance.projectId === projectId && retained?.profileDigest === allowance.profileDigest
      ? structuredClone(retained.display) : null;
    const current = new Set(currentSelections.map(selectionKey));
    return { providerDisplay, work: allowance.selections.map((selection): SpendingWorkDisplay => {
      const found = allowance.projectId === projectId ? work.get(nodeKey(selection)) : null;
      const saved = found?.profileDigest === allowance.profileDigest ? found : null;
      return { ...selection, alias: saved?.alias ?? null, shotId: saved?.shotId ?? null, operation: saved?.operation ?? null,
        current: allowance.projectId === projectId && current.has(selectionKey(selection)), historyAvailable: !!saved };
    }) };
  };
}
