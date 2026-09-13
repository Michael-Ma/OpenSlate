import { invariant } from "@openslate/core";
import { isSpoolOutput } from "@openslate/providers";
import type { ExecutionOutputIngestor } from "./engine.js";
import { materializeFixtureOutput } from "./fixture-ingester.js";

/** Trusted host composition. Missing real-media handlers fail closed; fixtures remain explicitly labeled. */
export class ExecutionIngestionRouter implements ExecutionOutputIngestor {
  readonly #image: ExecutionOutputIngestor | undefined;
  readonly #video: ExecutionOutputIngestor | undefined;
  readonly #audio: ExecutionOutputIngestor | undefined;
  readonly #transcription: ExecutionOutputIngestor | undefined;
  constructor(handlers: { image?: ExecutionOutputIngestor; video?: ExecutionOutputIngestor; audio?: ExecutionOutputIngestor; transcription?: ExecutionOutputIngestor }) {
    invariant(handlers && Object.keys(handlers).every(key => key === "image" || key === "video" || key === "audio" || key === "transcription")
      && Object.values(handlers).every(handler => handler && typeof handler.ingest === "function"),
    "OUTPUT_INGESTION_CONFIGURATION", "Configure explicit supported image/video/audio/transcription ingesters");
    this.#image = handlers.image; this.#video = handlers.video; this.#audio = handlers.audio;
    this.#transcription = handlers.transcription;
  }
  ingest(input: Parameters<ExecutionOutputIngestor["ingest"]>[0]): ReturnType<ExecutionOutputIngestor["ingest"]> {
    const captured = { attempt: structuredClone(input.attempt), output: structuredClone(input.output), artifactDir: input.artifactDir, signal: input.signal };
    invariant(!captured.signal.aborted, "OUTPUT_STORE_CANCELLED", "Output ingestion cancelled");
    if (!isSpoolOutput(captured.output) && captured.output.fixture === true) return materializeFixtureOutput(captured);
    invariant(isSpoolOutput(captured.output) && captured.output.fixture === false, "OUTPUT_INGESTION_UNSUPPORTED", "Real media requires an owned spool and its explicit ingester");
    const supportedTranscript = captured.output.kind === "data" && captured.output.port === "cues"
      && captured.output.mimeType === "application/json" && captured.output.extension === "json"
      && captured.attempt.request?.kind === "transcription" && captured.attempt.request.execution?.adapter === "openai-transcription"
      && captured.attempt.request.execution.version === "1";
    const handler = captured.output.kind === "image" ? this.#image : captured.output.kind === "video" ? this.#video
      : captured.output.kind === "audio" ? this.#audio : supportedTranscript ? this.#transcription : undefined;
    invariant(handler, "OUTPUT_INGESTION_UNSUPPORTED", "No ingester is configured for this output kind");
    return handler.ingest(captured);
  }
}
