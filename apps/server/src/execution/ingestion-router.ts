import { invariant } from "@openslate/core";
import { isSpoolOutput } from "@openslate/providers";
import type { ExecutionOutputIngestor } from "./engine.js";
import { materializeFixtureOutput } from "./fixture-ingester.js";

/** Trusted host composition. Missing real-media handlers fail closed; fixtures remain explicitly labeled. */
export class ExecutionIngestionRouter implements ExecutionOutputIngestor {
  readonly #image: ExecutionOutputIngestor | undefined;
  readonly #video: ExecutionOutputIngestor | undefined;
  constructor(handlers: { image?: ExecutionOutputIngestor; video?: ExecutionOutputIngestor }) {
    invariant(handlers && Object.keys(handlers).every(key => key === "image" || key === "video")
      && Object.values(handlers).every(handler => handler && typeof handler.ingest === "function"),
    "OUTPUT_INGESTION_CONFIGURATION", "Configure explicit supported image/video ingesters");
    this.#image = handlers.image; this.#video = handlers.video;
  }
  ingest(input: Parameters<ExecutionOutputIngestor["ingest"]>[0]): ReturnType<ExecutionOutputIngestor["ingest"]> {
    const captured = { attempt: structuredClone(input.attempt), output: structuredClone(input.output), artifactDir: input.artifactDir, signal: input.signal };
    invariant(!captured.signal.aborted, "OUTPUT_STORE_CANCELLED", "Output ingestion cancelled");
    if (!isSpoolOutput(captured.output) && captured.output.fixture === true) return materializeFixtureOutput(captured);
    invariant(isSpoolOutput(captured.output) && captured.output.fixture === false, "OUTPUT_INGESTION_UNSUPPORTED", "Real media requires an owned spool and its explicit ingester");
    const handler = captured.output.kind === "image" ? this.#image : captured.output.kind === "video" ? this.#video : undefined;
    invariant(handler, "OUTPUT_INGESTION_UNSUPPORTED", "No ingester is configured for this output kind");
    return handler.ingest(captured);
  }
}
