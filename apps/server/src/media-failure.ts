import type { MediaFailure } from "@openslate/core";
import type { Store } from "./persistence/store.js";
import type { Attempt } from "./execution/engine.js";
import { automaticRetriesLeft } from "./execution/retry-eligibility.js";
import { assertCodexImageRecords } from "./execution/codex-image-lineage.js";
import { safeNativeDiagnostic } from "./application/native-diagnostics.js";
import { assertSpeechExecutionResult } from "./execution/audio-execution-receipts.js";
import { assertTranscriptionExecutionResult } from "./execution/transcription-execution-receipts.js";
import { resolveTranscriptionPreparation } from "./execution/transcription-execution-authority.js";
import type { SpeechExecutionMapping, SpeechExecutionDispatch, SpeechExecutionResult } from "./execution/audio-execution-receipts.js";
import type { TranscriptionExecutionMapping, TranscriptionExecutionDispatch, TranscriptionExecutionResult } from "./execution/transcription-execution-receipts.js";

/** An uncharged reservation alone does not prove that the provider was never called. */
function audioNotDispatched(store: Store, attempt: Readonly<Attempt>): boolean {
  try {
    if (attempt.request.execution?.adapter === "openai-speech") {
      const result = store.get<SpeechExecutionResult>("speech_execution_result", attempt.id);
      if (result?.observation.kind !== "not_dispatched") return false;
      assertSpeechExecutionResult(attempt,
        store.get<SpeechExecutionMapping>("speech_execution_mapping", attempt.id),
        store.get<SpeechExecutionDispatch>("speech_execution_dispatch", attempt.id), result);
      return true;
    }
    if (attempt.request.execution?.adapter === "openai-transcription") {
      const result = store.get<TranscriptionExecutionResult>("transcription_execution_result", attempt.id);
      if (result?.observation.kind !== "not_dispatched") return false;
      const mapping = store.get<TranscriptionExecutionMapping>("transcription_execution_mapping", attempt.id);
      assertTranscriptionExecutionResult(attempt, mapping,
        store.get<TranscriptionExecutionDispatch>("transcription_execution_dispatch", attempt.id), result,
        mapping ? resolveTranscriptionPreparation(store, attempt, mapping) : undefined);
      return true;
    }
  } catch {
    // Older or inconsistent diagnostic records cannot break the read or prove non-dispatch.
  }
  return false;
}

/** Shared, read-only failure projection for pictures, clips, voice lines and transcriptions. */
export function attemptMediaFailure(store: Store, attempt: Readonly<Attempt>, maxRetries = 0): MediaFailure {
  const evidence = store.list<{ attemptId: string; outcome: { failureId?: string; technical?: boolean }; recordedAt: string }>("execution_evidence", attempt.projectId)
    .filter(item => item.attemptId === attempt.id).at(-1);
  const failure = attempt.failure ?? (evidence?.outcome.failureId
    ? { id: evidence.outcome.failureId, technical: evidence.outcome.technical === true } : null);
  const retriesLeft = automaticRetriesLeft(store, attempt, maxRetries);
  const native = attempt.request.execution?.adapter === "codex-image" ? (() => {
    try { return assertCodexImageRecords(store, attempt).result?.observation; } catch { return undefined; }
  })() : undefined;
  const nativeDiagnostic = native?.kind === "not_dispatched" ? safeNativeDiagnostic(native.nativeDiagnostic)
    : native?.kind === "failed" && native.code === "USAGE_LIMIT" ? { category: "native_rate_limited" as const } : undefined;
  return { code: failure?.id ?? "EXECUTION_FAILED", technical: failure?.technical ?? false,
    retryAllowed: retriesLeft > 0, autoRetriesLeft: retriesLeft,
    charged: !attempt.reservationId || store.get<{ state: string }>("reservation", attempt.reservationId)?.state !== "released",
    at: evidence?.recordedAt ?? attempt.createdAt,
    ...(nativeDiagnostic ? { nativeDiagnostic } : {}),
    ...(native?.kind === "not_dispatched" || audioNotDispatched(store, attempt) ? { notDispatched: true } : {}) };
}
