import { Worker } from "node:worker_threads";
import { DomainError, invariant } from "@openslate/core";

export const DOCUMENT_TEXT_MAX_CHARACTERS = 200_000;
export interface ExtractedDocumentText { text: string; pages?: number; truncated: boolean }
export type PdfTextExtractor = (bytes: Uint8Array, options: { signal?: AbortSignal; timeoutMs: number }) => Promise<ExtractedDocumentText>;

/** A document parser cannot block the server loop or retain an unbounded text result. */
export const extractPdfText: PdfTextExtractor = async (bytes, options) => {
  invariant(!options.signal?.aborted, "MEDIA_CANCELLED", "Document extraction cancelled");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./document-extraction-worker.js", import.meta.url), {
      workerData: { bytes: Uint8Array.from(bytes), maxCharacters: DOCUMENT_TEXT_MAX_CHARACTERS },
      env: {}, execArgv: [], resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    let settled = false;
    const finish = (error?: Error, result?: ExtractedDocumentText) => {
      if (settled) return; settled = true;
      clearTimeout(timer); options.signal?.removeEventListener("abort", cancel);
      void worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const cancel = () => finish(new DomainError("MEDIA_CANCELLED", "Document extraction cancelled"));
    const timer = setTimeout(() => finish(new DomainError("DOCUMENT_EXTRACTION_TIMEOUT", "PDF text extraction exceeded its time limit")), options.timeoutMs);
    timer.unref();
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
    worker.once("message", (value: { ok?: boolean; result?: ExtractedDocumentText; code?: string }) => {
      if (!value.ok) return finish(new DomainError(value.code === "DOCUMENT_EXTRACTOR_UNAVAILABLE" ? value.code : "DOCUMENT_INVALID", value.code === "DOCUMENT_EXTRACTOR_UNAVAILABLE" ? "The pinned PDF text extractor is unavailable on this installation" : "Choose a valid PDF document with readable structure"));
      const result = value.result;
      if (!result || typeof result.text !== "string" || result.text.length > DOCUMENT_TEXT_MAX_CHARACTERS || !Number.isSafeInteger(result.pages) || result.pages! < 1 || typeof result.truncated !== "boolean")
        return finish(new DomainError("DOCUMENT_INVALID", "PDF text extraction returned invalid metadata"));
      finish(undefined, result);
    });
    worker.once("error", () => finish(new DomainError("DOCUMENT_INVALID", "PDF text extraction failed within its resource limit")));
    worker.once("exit", () => { if (!settled) finish(new DomainError("DOCUMENT_INVALID", "PDF text extraction ended without a result")); });
  });
};
