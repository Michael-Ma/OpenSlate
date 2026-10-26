import { SceneConfirmationRunner } from "./scene-confirmations.js";
import { randomBytes } from "node:crypto";
import { StudioSessions } from "./studio-sessions.js";
import { openStudioBrowser, studioUrl } from "./studio-launcher.js";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeProvider } from "@openslate/providers";
import { invariant } from "@openslate/core";
import { createApp } from "./app.js";
import { ProductionService } from "./application/service.js";
import { Store } from "./persistence/store.js";
import { LocalDirectorController } from "./application/local-director.js";
import { readCodexStartupTimeout, readDirectorRunTimeout } from "./application/director-run-config.js";
import { DocumentApplicationService, DOCUMENT_IMPORT_MAX_BYTES, ImageApplicationService, MediaApplicationService, PNG_IMPORT_MAX_BYTES } from "./media/index.js";
import { NarrationService, NarrationCanonicalService } from "./narration/index.js";
import { NarrationSpeechService } from "./narration/narration-speech-service.js";
import { OwnedTranscriptionService } from "./narration/owned-transcription-service.js";
import { ManagedUploadStore } from "./narration/managed-upload.js";
import { assertWebDataSeparation, loadWebAssets } from "./web-assets.js";
import { acquireInstallationOwner } from "./persistence/installation-owner.js";
import { readInstalledProviderConfiguration } from "./application/provider-catalog.js";
import { readMediaExecutionConfiguration } from "./application/media-execution-config.js";
import { createMediaExecutionRuntime } from "./application/media-execution-runtime.js";
import { InstallationRecoveryGuard } from "./application/installation-recovery.js";
import { assertInstallationRestoreComplete } from "./persistence/installation-restore-state.js";
import { createServerShutdown } from "./shutdown.js";

const serveWeb = process.argv.includes("--serve-web");
const directory = resolve(process.env.OPENSLATE_DATA_DIR ?? ".openslate");
const webDirectory = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const providerConfiguration = process.env.OPENSLATE_PROVIDER_CONFIG
  ? readInstalledProviderConfiguration(resolve(process.env.OPENSLATE_PROVIDER_CONFIG)) : undefined;
const executionConfiguration = readMediaExecutionConfiguration(process.env);
const directorRunTimeoutMs = readDirectorRunTimeout(process.env);
const startupTimeoutMs = readCodexStartupTimeout(process.env);
if (serveWeb) assertWebDataSeparation(webDirectory, directory);
// Validate the production build before creating local application state.
const webAssets = serveWeb ? (() => {
  try { return loadWebAssets(webDirectory); }
  catch (error) { throw new Error("OpenSlate could not load its built interface. Run pnpm build first, then pnpm start.", { cause: error }); }
})() : undefined;
mkdirSync(directory, { recursive: true, mode: 0o700 });
// Acquire before opening project state, creating credentials, or recovering workers.
const installation = acquireInstallationOwner(directory);
const releaseInstallation = () => installation.close();
process.once("exit", releaseInstallation);
assertInstallationRestoreComplete(directory);
const tokenPath = join(directory, "local-session.token");
let localToken = process.env.OPENSLATE_LOCAL_TOKEN;
if (!localToken) {
  try { localToken = readFileSync(tokenPath, "utf8").trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    localToken = randomBytes(32).toString("base64url");
    writeFileSync(tokenPath, localToken, { flag: "wx", mode: 0o600 });
  }
}
invariant(/^[A-Za-z0-9_-]{20,256}$/.test(localToken), "CONFIGURATION_ERROR", "Local session token must contain 20–256 URL-safe characters");
const store = new Store(join(directory, "openslate.sqlite"));
const recovery = new InstallationRecoveryGuard(store);
const recoveryPending = recovery.isQuarantined();
const provider = new FakeProvider(join(directory, "fake-provider.sqlite"));
const findMediaTool = (name: string, override?: string) => {
  const candidates = override ? [resolve(override)] : [...(process.env.PATH ?? "").split(":").filter(Boolean).map(path => join(path, name)), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
  const path = candidates.find(path => existsSync(path)); return path ? realpathSync(path) : null;
};
const ffmpegPath = findMediaTool("ffmpeg", process.env.OPENSLATE_FFMPEG), ffprobePath = findMediaTool("ffprobe", process.env.OPENSLATE_FFPROBE);
const runtime = createMediaExecutionRuntime({ store, fakeProvider: provider, dataDirectory: directory, configuration: executionConfiguration,
  ffmpegPath, ffprobePath, startupTimeoutMs, ...(providerConfiguration === undefined ? {} : { providerConfiguration }) });
const { engine, localMedia, imageStore, providerCatalog, uploadDirectory } = runtime;
const service = new ProductionService(store, engine, undefined, runtime.productionOptions);
const narration = new NarrationService(service, localMedia ?? undefined);
// Each project starts in demo mode until its user chooses and checks local Codex.
const director = new LocalDirectorController(service, { repositoryRoot: fileURLToPath(new URL("../../../", import.meta.url)), dataDirectory: directory, endpoint: "http://127.0.0.1:3001", runTimeoutMs: directorRunTimeoutMs, startupTimeoutMs, ...(ffmpegPath ? { ffmpegPath } : {}), ...(localMedia ? { media: localMedia } : {}) });
const studioSessions = new StudioSessions();
const narrationSpeech = new NarrationSpeechService(narration), canonical = new NarrationCanonicalService(narration);
const sceneCommands = new SceneConfirmationRunner(service, { narration, narrationSpeech, canonical });
const app = createApp({ service, sceneCommands, director, runtimeSettings: director, providerCatalog, localToken, studioSessions, logger: true,
  // Each refresh reads several routes; set OPENSLATE_LOG_REQUESTS=1 to see every request while debugging.
  logRequests: process.env.OPENSLATE_LOG_REQUESTS === "1",
  mediaToolPaths: { ffmpeg: ffmpegPath, ffprobe: ffprobePath },
  ...(webAssets ? { webAssets } : {}),
  imageRoutes: { production: service, images: imageStore ? new ImageApplicationService(service, imageStore) : null,
    uploads: new ManagedUploadStore({ rootDir: join(uploadDirectory, "images"), maxBytes: PNG_IMPORT_MAX_BYTES }) },
  documentRoutes: { production: service, documents: new DocumentApplicationService(service),
    uploads: new ManagedUploadStore({ rootDir: join(uploadDirectory, "documents"), maxBytes: DOCUMENT_IMPORT_MAX_BYTES }) },
  narrationRoutes: { production: service, narration, narrationSpeech, canonical, uploadDirectory,
    ...(localMedia ? { ownedTranscription: new OwnedTranscriptionService(narration, join(directory, "artifacts")) } : {}) },
  ...(localMedia ? { mediaRoutes: { production: service, media: new MediaApplicationService(service, localMedia), uploads: new ManagedUploadStore({ rootDir: uploadDirectory }) } } : {}) });
let running = false, stopping = false, activeWork: Promise<unknown> = Promise.resolve();
const timer = setInterval(() => {
  if (stopping) return;
  if (recovery.isQuarantined()) return;
  try { director.tick(); } catch (error) { app.log.error(error); }
  if (running) return;
  running = true;
  activeWork = engine.reconcile().then(() => { if (!stopping) return engine.runReady(); }).then(() => { if (!stopping) return sceneCommands.advance(); })
    .catch(error => app.log.error(error)).finally(() => { running = false; });
}, 500);
const close = createServerShutdown(app, {
  stop: () => { stopping = true; clearInterval(timer); engine.stop(); },
  cleanup: [
    { name: "Director turns", close: () => director.close() },
    { name: "native media workers", close: () => runtime.close() },
    { name: "media reconciliation", close: () => activeWork },
  ],
  resources: [
    { name: "project storage", close: () => store.close() },
    { name: "fixture provider storage", close: () => provider.close() },
    { name: "installation ownership", close: () => { installation.close(); process.off("exit", releaseInstallation); } },
  ],
  // Final storage/ownership cleanup and exit share one synchronous stack. A
  // timed-out adapter cannot resume later against a replacement installation.
  terminate: code => process.exit(process.exitCode || code),
});
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void close().catch(error => { app.log.error(error); process.exitCode = 1; }); });
try {
  await app.listen({ host: "127.0.0.1", port: 3001 });
  if (recoveryPending) process.stdout.write("Restored workspace: inspect your saved work and finish recovery review before making changes.\n");
  process.stdout.write(`\nOpenSlate ${serveWeb ? "is ready" : "API is ready"} at http://127.0.0.1:3001${serveWeb ? "" : "/api/health"}\nLocal data: ${directory}\n${process.env.OPENSLATE_LOCAL_TOKEN ? "Local launcher credential: configured" : `Local launcher credential file: ${tokenPath}`}\nStop with Ctrl+C.\n\n`);
  // API-only development starts before Vite; open that browser explicitly with pnpm studio --dev.
  if (serveWeb) {
    const url = studioUrl(studioSessions.issueLaunch());
    if (!process.argv.includes("--no-open") && await openStudioBrowser(url)) process.stdout.write("Sent the connected studio link to your default browser. If it did not appear, run ./start.sh --no-open for a fresh link.\n");
    else process.stdout.write(`Open studio (valid for 60 seconds): ${url}\n`);
  }
}
catch (error) { app.log.error(error); process.exitCode = 1; await close(); }
