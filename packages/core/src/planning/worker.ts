import { parentPort, workerData } from "node:worker_threads";
import { DomainError, newId } from "../common.js";
import { compilePlan } from "./index.js";
import type { CompileContext } from "../contracts.js";

const data = workerData as Omit<CompileContext, "allocateId"> & { source: string };
try {
  const plan = compilePlan(data.source, { ...data, allocateId: newId });
  parentPort!.postMessage({ ok: true, plan, logicalIds: data.logicalIds });
} catch (error) {
  parentPort!.postMessage({ ok: false, error: { code: error instanceof DomainError ? error.code : "COMPILER_FAILED", message: error instanceof Error ? error.message : "Compilation failed", details: error instanceof DomainError ? error.details : undefined } });
}
