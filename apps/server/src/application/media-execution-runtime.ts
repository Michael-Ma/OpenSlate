import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { CodexImageWorkerTransport } from "@openslate/director";
import { invariant, snapshotLocalExecution } from "@openslate/core";
import { ExecutionRegistry } from "@openslate/providers";
import type { CodexImageTransport, ExecutionIdentity, ExecutionProvider, FakeProvider } from "@openslate/providers";
import type { Store } from "../persistence/store.js";
import { Engine } from "../execution/engine.js";
import type { ExternalExecutionAdmission, NodeBinding } from "../execution/engine.js";
import { assertAudioOperationOptions } from "../execution/audio-preflight.js";
import { assertViggleH3OperationOptions } from "../execution/viggle-h3-receipts.js";
import { ExecutionOutputStore } from "../execution/output-store.js";
import { ExecutionIngestionRouter } from "../execution/ingestion-router.js";
import { SpoolImageIngestor } from "../execution/spool-image-ingester.js";
import { SpoolVideoIngestor } from "../execution/spool-video-ingester.js";
import { SpoolAudioIngestor } from "../execution/spool-audio-ingester.js";
import { SpoolTranscriptIngestor } from "../execution/spool-transcript-ingestor.js";
import { TranscriptionAudioService } from "../execution/transcription-audio-service.js";
import { TranscriptionAudioStore } from "../media/transcription-audio-store.js";
import { LocalMediaExecutor } from "../execution/local-media-executor.js";
import { DurableExternalAdmission } from "../execution/durable-external-admission.js";
import { CodexImageExecution } from "../execution/codex-image-execution.js";
import { assertCodexImageOperationOptions } from "../execution/codex-image-receipts.js";
import { OpenAIImageExecution } from "../execution/openai-image-execution.js";
import { MiniMaxH3Execution } from "../execution/minimax-h3-execution.js";
import { ViggleH3Execution } from "../execution/viggle-h3-execution.js";
import { OpenAISpeechExecution } from "../execution/openai-speech-execution.js";
import { OpenAITranscriptionExecution } from "../execution/openai-transcription-execution.js";
import { ProtectedVideoDownloader } from "../execution/video-download.js";
import type { VideoDownloadOptions } from "../execution/video-download.js";
import { LocalImageStore, LocalMediaService } from "../media/index.js";
import { EnvironmentMediaCredentials } from "./provider-credentials.js";
import { InstalledProviderCatalog, profilePolicy } from "./provider-catalog.js";
import { ExternalAllowanceService } from "./external-allowances.js";
import type { ProductionServiceOptions } from "./service.js";
import type { MediaExecutionConfiguration } from "./media-execution-config.js";

export interface MediaExecutionRuntimeOptions {
  store: Store; fakeProvider: FakeProvider; dataDirectory: string; configuration: Readonly<MediaExecutionConfiguration>;
  ffmpegPath: string | null; ffprobePath: string | null;
  credentials?: EnvironmentMediaCredentials; providerConfiguration?: unknown;
  /** Trusted host/test dependencies only; never populated from a browser or model request. */
  transport?: { codexImage?: CodexImageTransport; imageFetch?: typeof globalThis.fetch; h3Fetch?: typeof globalThis.fetch; viggleFetch?: typeof globalThis.fetch;
    speechFetch?: typeof globalThis.fetch; transcriptionFetch?: typeof globalThis.fetch;
    download?: Pick<VideoDownloadOptions, "lookup" | "request">;
    viggleDownload?: Pick<VideoDownloadOptions, "lookup" | "request"> };
}
function executable(path: string | null): path is string {
  if (!path || !isAbsolute(path)) return false;
  try { accessSync(path, constants.X_OK); return statSync(path).isFile(); } catch { return false; }
}

/** One local installation. Construction performs no network, generation or authority writes. */
export function createMediaExecutionRuntime(options: MediaExecutionRuntimeOptions) {
  const { store, fakeProvider, ffmpegPath, ffprobePath } = options;
  const captured = structuredClone(options.configuration);
  const configuration = { ...captured, codexImage: captured.codexImage === undefined ? false : captured.codexImage, speech: captured.speech === undefined ? false : captured.speech,
    transcription: captured.transcription === undefined ? false : captured.transcription,
    viggleH3: captured.viggleH3 === undefined ? false : captured.viggleH3,
    viggleH3DownloadHosts: captured.viggleH3DownloadHosts === undefined ? [] : captured.viggleH3DownloadHosts };
  invariant(typeof configuration.image === "boolean" && typeof configuration.codexImage === "boolean" && typeof configuration.h3 === "boolean"
    && typeof configuration.speech === "boolean" && typeof configuration.transcription === "boolean" && typeof configuration.viggleH3 === "boolean"
    && Array.isArray(configuration.h3DownloadHosts) && Array.isArray(configuration.viggleH3DownloadHosts),
    "MEDIA_EXECUTION_CONFIGURATION", "Use validated local generation configuration");
  const enabled = configuration.image || configuration.codexImage || configuration.h3 || configuration.viggleH3 || configuration.speech || configuration.transcription,
    haveTools = executable(ffmpegPath) && executable(ffprobePath);
  invariant(!enabled || haveTools, "MEDIA_EXECUTION_TOOLS_REQUIRED", "Enabled media generation requires executable FFmpeg and ffprobe on this computer");
  invariant([configuration.codexImageBinary, configuration.codexImageHome].every(path => path === undefined
    || typeof path === "string" && isAbsolute(path) && path.length <= 4096 && !path.includes("\0")),
    "MEDIA_EXECUTION_CONFIGURATION", "Use bounded absolute Codex image paths");
  const injectedCodex = options.transport?.codexImage;
  invariant(injectedCodex === undefined || injectedCodex !== null && typeof injectedCodex === "object"
    && [injectedCodex.prepare, injectedCodex.start, injectedCodex.lookup].every(method => typeof method === "function")
    && (injectedCodex.release === undefined || typeof injectedCodex.release === "function"),
    "MEDIA_EXECUTION_CONFIGURATION", "Use a complete trusted Codex image transport");
  const codexImageConfigured = injectedCodex !== undefined || executable(configuration.codexImageBinary ?? null);
  invariant(!configuration.codexImage || codexImageConfigured, "MEDIA_EXECUTION_CODEX_REQUIRED",
    "Enabled Codex image generation requires an executable pinned native binary");
  const nativeWorker = !injectedCodex && configuration.codexImage ? new CodexImageWorkerTransport({ directory: join(resolve(options.dataDirectory), "codex-images"),
    command: { file: configuration.codexImageBinary! }, nativeHome: homedir(), codexHome: configuration.codexImageHome ?? join(homedir(), ".codex"),
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, SHELL: "/bin/sh", CI: "1", NO_COLOR: "1" } }) : undefined;
  let closing: Promise<void> | undefined;
  // Capture the trusted instance and methods once. Later option mutation cannot replace the route.
  const codexTransport: CodexImageTransport | undefined = injectedCodex ? {
    prepare: injectedCodex.prepare.bind(injectedCodex), start: injectedCodex.start.bind(injectedCodex), lookup: injectedCodex.lookup.bind(injectedCodex),
    ...(injectedCodex.release ? { release: injectedCodex.release.bind(injectedCodex) } : {}),
  } : nativeWorker;
  const viggleFetch = options.transport?.viggleFetch, viggleDownload = options.transport?.viggleDownload;
  invariant(viggleDownload === undefined || viggleDownload !== null && typeof viggleDownload === "object" && !Array.isArray(viggleDownload),
    "MEDIA_EXECUTION_CONFIGURATION", "Use valid trusted Viggle download dependencies");
  const viggleLookup = viggleDownload?.lookup, viggleRequest = viggleDownload?.request;
  invariant([viggleFetch, viggleLookup, viggleRequest].every(value => value === undefined || typeof value === "function"),
    "MEDIA_EXECUTION_CONFIGURATION", "Use callable trusted Viggle transport dependencies");
  const credentials = options.credentials ?? new EnvironmentMediaCredentials();
  const directory = resolve(options.dataDirectory), artifactDir = join(directory, "artifacts"), uploadDirectory = join(directory, "uploads");
  const downloader = configuration.h3 ? new ProtectedVideoDownloader({ allowedHosts: configuration.h3DownloadHosts,
    ...(options.transport?.download?.lookup ? { lookup: options.transport.download.lookup } : {}),
    ...(options.transport?.download?.request ? { request: options.transport.download.request } : {}) }) : undefined;
  const viggleDownloader = configuration.viggleH3 ? new ProtectedVideoDownloader({ allowedHosts: configuration.viggleH3DownloadHosts,
    ...(viggleLookup === undefined ? {} : { lookup: viggleLookup }),
    ...(viggleRequest === undefined ? {} : { request: viggleRequest }) }) : undefined;
  mkdirSync(uploadDirectory, { recursive: true, mode: 0o700 });
  const outputStore = new ExecutionOutputStore(store, { rootDir: join(directory, "execution-output") });
  const localMedia = haveTools ? new LocalMediaService({ rootDir: join(directory, "media"),
    allowedInputRoots: [uploadDirectory, join(outputStore.rootDir, "blobs")], ffmpegPath: ffmpegPath!, ffprobePath: ffprobePath! }) : null;
  const imageStore = haveTools ? new LocalImageStore({ rootDir: join(artifactDir, "images"), ffmpegPath: ffmpegPath!, ffprobePath: ffprobePath! }) : null;
  // Ingestion remains available for already retained outputs independently of new-submit switches.
  const transcriptionFiles = localMedia ? new TranscriptionAudioStore({ rootDir: join(directory, "audio-derivatives") }) : null;
  const providers: ExecutionProvider[] = [fakeProvider], enabledExecutions: ExecutionIdentity[] = [];
  let transcriptionExecution: OpenAITranscriptionExecution | undefined;
  if (configuration.codexImage) {
    providers.push(new CodexImageExecution({ store, outputStore, artifactRoot: artifactDir, transport: codexTransport! }));
    enabledExecutions.push({ adapter: "codex-image", version: "1" });
  }
  if (configuration.image) {
    providers.push(new OpenAIImageExecution({ store, outputStore, artifactRoot: artifactDir, credentials,
      ...(options.transport?.imageFetch ? { fetch: options.transport.imageFetch } : {}) }));
    enabledExecutions.push({ adapter: "openai-image", version: "1" });
  }
  if (configuration.h3) {
    providers.push(new MiniMaxH3Execution({ store, outputStore, artifactRoot: artifactDir, credentials, downloader: downloader!,
      ...(options.transport?.h3Fetch ? { fetch: options.transport.h3Fetch } : {}) }));
    enabledExecutions.push({ adapter: "minimax-h3", version: "1" });
  }
  if (configuration.viggleH3) {
    providers.push(new ViggleH3Execution({ store, outputStore, artifactRoot: artifactDir, credentials, downloader: viggleDownloader!,
      ...(viggleFetch === undefined ? {} : { fetch: viggleFetch }) }));
    enabledExecutions.push({ adapter: "viggle-h3", version: "1" });
  }
  if (configuration.speech) {
    providers.push(new OpenAISpeechExecution({ store, outputStore, credentials,
      ...(options.transport?.speechFetch ? { fetch: options.transport.speechFetch } : {}) }));
    enabledExecutions.push({ adapter: "openai-speech", version: "1" });
  }
  if (configuration.transcription) {
    transcriptionExecution = new OpenAITranscriptionExecution({ store, outputStore, credentials,
      preparation: new TranscriptionAudioService(store, localMedia!, transcriptionFiles!),
      ...(options.transport?.transcriptionFetch ? { fetch: options.transport.transcriptionFetch } : {}) });
    providers.push(transcriptionExecution);
    enabledExecutions.push({ adapter: "openai-transcription", version: "1" });
  }
  const registry = new ExecutionRegistry(providers);
  const durable = new DurableExternalAdmission(store, profile => {
    const policy = profilePolicy(profile); registry.forProfile(profile);
    if (profile.adapter === "codex-image") {
      invariant(configuration.codexImage && codexImageConfigured, "EXTERNAL_EXECUTION_DISABLED", "Codex image generation is not configured");
      // Native ChatGPT authentication is checked by prepare before a turn marker; no API key or quota estimate is substituted.
      return;
    }
    invariant(!policy.fixture && policy.credential, "EXTERNAL_EXECUTION_DISABLED", "Only an explicitly enabled external media route can use spending allowances");
    invariant(credentials.status().credentials.some(value => value.id === policy.credential && value.configured),
      "MEDIA_CREDENTIAL_MISSING", "Configure the selected media provider credential on the local server");
  });
  const externalAdmission: ExternalExecutionAdmission = {
    authorize(input) {
      if (input.profile.adapter === "codex-image") {
        const binding = store.get<NodeBinding>("node_binding", input.nodeId);
        invariant(binding?.projectId === input.projectId && binding.candidateId === input.candidateId && binding.node.kind === "image",
          "ALLOWANCE_SELECTION_STALE", "Codex preflight requires the exact current image candidate");
        invariant(typeof binding.node.shotId === "string", "CODEX_IMAGE_PREFLIGHT_INVALID", "Codex image version 1 supports shot keyframes only");
        assertCodexImageOperationOptions(input.profile, binding.node.args);
      }
      if (input.profile.adapter === "openai-speech" || input.profile.adapter === "openai-transcription") {
        const binding = store.get<NodeBinding>("node_binding", input.nodeId);
        invariant(binding?.projectId === input.projectId && binding.candidateId === input.candidateId,
          "ALLOWANCE_SELECTION_STALE", "Audio preflight requires the exact current candidate");
        // Pure option validation precedes consumption. Durable admission below rechecks the full active selection.
        assertAudioOperationOptions(input.profile, binding.node.args);
      }
      if (input.profile.adapter === "viggle-h3") {
        const binding = store.get<NodeBinding>("node_binding", input.nodeId);
        invariant(binding?.projectId === input.projectId && binding.candidateId === input.candidateId && binding.node.kind === "video",
          "ALLOWANCE_SELECTION_STALE", "Viggle preflight requires the exact current video candidate");
        // The shared bridge policy rejects unsupported options before any allowance or reservation is consumed.
        // Durable admission below synchronously rechecks the full active node, profile definition and allowance.
        assertViggleH3OperationOptions(input.profile, binding.node.args);
      }
      if (input.profile.adapter === "minimax-h3" || input.profile.adapter === "viggle-h3") {
        const project = store.getProject(input.projectId), lock = store.get<{ projectId: string; localExecution?: unknown }>("capability_lock", project.capabilityLockId);
        let pinned = false;
        try { if (lock?.projectId === project.id && Object.hasOwn(lock, "localExecution")) { snapshotLocalExecution(lock.localExecution); pinned = true; } } catch { /* Historical projects cannot silently inherit a new runtime. */ }
        invariant(pinned, "LOCAL_EXECUTION_UPGRADE_REQUIRED", "Create a new production project with local assembly enabled before generating video; this project's saved execution mode cannot be changed");
      }
      return durable.authorize(input);
    },
    recordAdmission(attempt) { durable.recordAdmission(attempt); },
  };
  const engine = new Engine(store, registry, { artifactDir, outputStore,
    outputIngestor: new ExecutionIngestionRouter({ ...(imageStore ? { image: new SpoolImageIngestor(outputStore, imageStore) } : {}),
      ...(localMedia ? { video: new SpoolVideoIngestor(outputStore, localMedia, { rootDir: join(directory, "video-derivations") }),
        audio: new SpoolAudioIngestor(outputStore, localMedia, { rootDir: join(directory, "audio-derivations") }),
        transcription: new SpoolTranscriptIngestor(outputStore, localMedia, transcriptionFiles!, { artifactDir }) } : {}) }),
    ...(enabled ? { externalAdmission } : {}),
    ...(transcriptionExecution ? { submissionPreparation: transcriptionExecution } : {}),
    ...(localMedia ? { localExecution: new LocalMediaExecutor(store, localMedia, { artifactDir }) } : {}) });
  const providerCatalog = new InstalledProviderCatalog({ ...(options.providerConfiguration === undefined ? {} : { configuration: options.providerConfiguration }),
    registry, credentials, enabledExecutions, codexImageConfigured, mediaTools: { image: !!imageStore, video: !!localMedia, audio: !!localMedia } });
  const productionOptions: ProductionServiceOptions = configuration.h3 || configuration.viggleH3
    ? { newProjectLocalExecution: { adapter: "local-media", version: "1" }, newProjectLocalExecutionFor: "external-video" } : {};
  return { close: () => closing ??= nativeWorker?.close() ?? Promise.resolve(), engine, localMedia, imageStore, outputStore, allowances: new ExternalAllowanceService(store), providerCatalog, uploadDirectory, productionOptions };
}
