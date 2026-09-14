import { canonical, digest, providerProfileArguments } from "@openslate/core";
import type { PlanNode, ProviderProfile } from "@openslate/core";
import type { AllowanceSelection, ExternalAllowance } from "../execution/external-allowance-records.js";
import type { PlanRecord } from "../execution/engine.js";
import { profilePolicy } from "./provider-catalog.js";
import { assertAudioOperationOptions, preflightAudioProfile } from "../execution/audio-preflight.js";

interface DisplayIdentity { id: string; revision: string; definitionDigest: string }
export type SpendingProviderDisplay = DisplayIdentity & (
  { adapter: "codex-image"; model: string; settings: { runtimeVersion: string; directorModel: string; width: number; height: number };
    usage: { kind: "codex_subscription"; unit: "native_turn"; quotaEstimateAvailable: false } }
  | { adapter: "openai-image"; model: string; settings: { width: number; height: number; quality: string } }
  | { adapter: "minimax-h3"; model: string; settings: { resolution: string } }
  | { adapter: "viggle-h3"; model: string; settings: { quality: string; resolution: string; aspectRatio: string } }
  | { adapter: "openai-speech" | "openai-transcription"; model: string; settings: Record<string, never> }
);
export type SpendingAudioDisplay = { operation: "speech"; voice: string; textBytes: number; instructionsPresent: boolean }
  | { operation: "transcription"; language: string | null; timing: "word" };
export interface SpendingAudioDetails {
  audioDisplay: SpendingAudioDisplay | null;
  audioUnavailableCode: "AUDIO_PROFILE_UNAVAILABLE" | "AUDIO_OPERATION_UNSUPPORTED" | null;
}
export interface SpendingWorkDisplay extends AllowanceSelection {
  alias: string | null; shotId: string | null; operation: "image" | "video" | "speech" | "transcription" | null;
  current: boolean; historyAvailable: boolean;
  audioDisplay?: SpendingAudioDisplay | null; audioUnavailableCode?: SpendingAudioDetails["audioUnavailableCode"];
}
interface RetainedLock { projectId: string; profiles: unknown }
interface RetainedProfile { canonical: string; profileDigest: string; display: SpendingProviderDisplay; profile: ProviderProfile }
interface RetainedWork { alias: string; shotId: string | null; operation: "image" | "video" | "speech" | "transcription"; profileDigest: string; audioNode?: PlanNode }
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
    if (profile?.adapter === "openai-speech" || profile?.adapter === "openai-transcription") {
      const checked = preflightAudioProfile(profile);
      if (checked.definitionDigest !== expectedDefinitionDigest) return null;
      return { id: checked.id, revision: checked.revision, definitionDigest: expectedDefinitionDigest,
        adapter: profile.adapter, model: checked.model, settings: {} };
    }
    const policy = profilePolicy(profile);
    if (policy.fixture || digest(profile) !== expectedDefinitionDigest) return null;
    const identity = { id: profile.id, revision: profile.revision, definitionDigest: expectedDefinitionDigest };
    const { model, settings } = profile.configuration!;
    if (profile.adapter === "codex-image") return { ...identity, adapter: "codex-image", model,
      settings: { runtimeVersion: settings!.runtimeVersion as string, directorModel: settings!.directorModel as string,
        width: settings!.width as number, height: settings!.height as number },
      usage: { kind: "codex_subscription", unit: "native_turn", quotaEstimateAvailable: false } };
    if (profile.adapter === "openai-image") return { ...identity, adapter: "openai-image", model,
      settings: { width: settings!.width as number, height: settings!.height as number, quality: settings!.quality as string } };
    if (profile.adapter === "minimax-h3") return { ...identity, adapter: "minimax-h3", model,
      settings: { resolution: settings!.resolution as string } };
    if (profile.adapter === "viggle-h3") return { ...identity, adapter: "viggle-h3", model,
      settings: { quality: settings!.quality as string, resolution: settings!.resolution as string, aspectRatio: settings!.aspectRatio as string } };
    return null;
  } catch { return null; }
}

/** Exact saved options only. Text, instructions, source paths and arbitrary settings never enter spending payloads. */
export function spendingAudioDetails(profile: unknown, node: PlanNode): SpendingAudioDetails {
  try { preflightAudioProfile(profile); }
  catch { return { audioDisplay: null, audioUnavailableCode: "AUDIO_PROFILE_UNAVAILABLE" }; }
  try {
    const value = assertAudioOperationOptions(profile as ProviderProfile, node.args);
    if (value.kind !== node.kind || node.inputs.length !== (value.kind === "speech" ? 0 : 1)) throw new Error("Invalid operation shape");
    const audioDisplay: SpendingAudioDisplay = value.kind === "speech"
      ? { operation: "speech", voice: value.voice, textBytes: value.textBytes, instructionsPresent: value.instructionBytes > 0 }
      : { operation: "transcription", language: value.language, timing: value.timing };
    return { audioDisplay, audioUnavailableCode: null };
  } catch { return { audioDisplay: null, audioUnavailableCode: "AUDIO_OPERATION_UNSUPPORTED" }; }
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
        profiles.set(definitionDigest, { canonical: encoded, profileDigest: String(providerProfileArguments(value).profileDigest), display, profile: structuredClone(value) });
      } catch { /* Missing or unsupported retained definitions supply no display identity. */ }
    }
  }
  for (const plan of plans) {
    if (plan.projectId !== projectId || !Array.isArray(plan.compiled?.nodes)) continue;
    for (const node of plan.compiled.nodes) {
      if (!id(node.id) || !hash(node.specDigest)) continue;
      const key = nodeKey({ nodeId: node.id, specDigest: node.specDigest });
      const value: RetainedWork | null = ["image", "video", "speech", "transcription"].includes(node.kind) && label(node.alias)
        && (node.shotId === null || id(node.shotId)) && hash(node.args?.profileDigest)
        ? { alias: node.alias, shotId: node.shotId, operation: node.kind as RetainedWork["operation"], profileDigest: node.args.profileDigest,
          ...((node.kind === "speech" || node.kind === "transcription") ? { audioNode: structuredClone(node) } : {}) } : null;
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
        current: allowance.projectId === projectId && current.has(selectionKey(selection)), historyAvailable: !!saved,
        ...(saved?.audioNode ? spendingAudioDetails(providerDisplay ? retained?.profile : undefined, saved.audioNode) : {}) };
    }) };
  };
}
