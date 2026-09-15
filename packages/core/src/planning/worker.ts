import { composeModelProfiles } from "./model-profile-composition.js";
import type { ModelProfileReplacement } from "./model-profile-composition.js";
import { parentPort, workerData } from "node:worker_threads";
import { DomainError, newId } from "../common.js";
import { compilePlan } from "./index.js";
import type { CompileContext } from "../contracts.js";
import type { CompiledPlan } from "../contracts.js";
import { composeTranscriptionPlan } from "./transcription-composition.js";
import type { TranscriptionCompositionOperation } from "./transcription-composition.js";
import { composeSpeechPlan } from "./speech-composition.js";
import type { SpeechCompositionOperation } from "./speech-composition.js";

type CompositionData = { mode: "compose_models"; base: CompiledPlan; replacements: ModelProfileReplacement[]; context: Omit<CompileContext, "allocateId"> }
  | { mode: "compose_transcription"; basePlan: CompiledPlan | null; operation: TranscriptionCompositionOperation; context: Omit<CompileContext, "allocateId"> }
  | { mode: "compose_speech"; basePlan: CompiledPlan | null; operation: SpeechCompositionOperation; context: Omit<CompileContext, "allocateId"> };
const data = workerData as (Omit<CompileContext, "allocateId"> & { source: string; mode?: undefined }) | CompositionData;
try {
  if (data.mode === "compose_models") {
    const context = { ...data.context, allocateId: newId }, plan = composeModelProfiles(data.base, data.replacements, context);
    parentPort!.postMessage({ ok: true, plan, logicalIds: context.logicalIds });
  } else if (data.mode === "compose_transcription") {
    const context = { ...data.context, allocateId: newId }, plan = composeTranscriptionPlan(data.basePlan, data.operation, context);
    parentPort!.postMessage({ ok: true, plan, logicalIds: context.logicalIds });
  } else if (data.mode === "compose_speech") {
    const context = { ...data.context, allocateId: newId }, plan = composeSpeechPlan(data.basePlan, data.operation, context);
    parentPort!.postMessage({ ok: true, plan, logicalIds: context.logicalIds });
  } else {
    const plan = compilePlan(data.source, { ...data, allocateId: newId });
    parentPort!.postMessage({ ok: true, plan, logicalIds: data.logicalIds });
  }
} catch (error) {
  parentPort!.postMessage({ ok: false, error: { code: error instanceof DomainError ? error.code : "COMPILER_FAILED", message: error instanceof Error ? error.message : "Compilation failed", details: error instanceof DomainError ? error.details : undefined } });
}
