import { parentPort, workerData } from "node:worker_threads";
import { DomainError, newId } from "../common.js";
import { compilePlan } from "./index.js";
import type { CompileContext } from "../contracts.js";
import type { CompiledPlan } from "../contracts.js";
import { composeTranscriptionPlan } from "./transcription-composition.js";
import type { TranscriptionCompositionOperation } from "./transcription-composition.js";

type CompositionData = { mode: "compose_transcription"; basePlan: CompiledPlan | null; operation: TranscriptionCompositionOperation; context: Omit<CompileContext, "allocateId"> };
const data = workerData as (Omit<CompileContext, "allocateId"> & { source: string; mode?: undefined }) | CompositionData;
try {
  if (data.mode === "compose_transcription") {
    const context = { ...data.context, allocateId: newId }, plan = composeTranscriptionPlan(data.basePlan, data.operation, context);
    parentPort!.postMessage({ ok: true, plan, logicalIds: context.logicalIds });
  } else {
    const plan = compilePlan(data.source, { ...data, allocateId: newId });
    parentPort!.postMessage({ ok: true, plan, logicalIds: data.logicalIds });
  }
} catch (error) {
  parentPort!.postMessage({ ok: false, error: { code: error instanceof DomainError ? error.code : "COMPILER_FAILED", message: error instanceof Error ? error.message : "Compilation failed", details: error instanceof DomainError ? error.details : undefined } });
}
