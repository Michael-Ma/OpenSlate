import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeProvider } from "@openslate/providers";
import { invariant } from "@openslate/core";
import { createApp } from "./app.js";
import { ProductionService } from "./application/service.js";
import { Store } from "./persistence/store.js";
import { Engine } from "./execution/engine.js";
import { LocalDirectorController } from "./application/local-director.js";
import { LocalMediaService, MediaApplicationService } from "./media/index.js";
import { NarrationService, NarrationCanonicalService } from "./narration/index.js";
import { ManagedUploadStore } from "./narration/managed-upload.js";

const directory = resolve(process.env.OPENSLATE_DATA_DIR ?? ".openslate");
mkdirSync(directory, { recursive: true, mode: 0o700 });
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
const provider = new FakeProvider(join(directory, "fake-provider.sqlite"));
const engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts") });
const service = new ProductionService(store, engine);
const uploadDirectory = join(directory, "uploads");
mkdirSync(uploadDirectory, { recursive: true, mode: 0o700 });
const findMediaTool = (name: string, override?: string) => {
  const candidates = override ? [resolve(override)] : [...(process.env.PATH ?? "").split(":").filter(Boolean).map(path => join(path, name)), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
  const path = candidates.find(path => existsSync(path)); return path ? realpathSync(path) : null;
};
const ffmpegPath = findMediaTool("ffmpeg", process.env.OPENSLATE_FFMPEG), ffprobePath = findMediaTool("ffprobe", process.env.OPENSLATE_FFPROBE);
const localMedia = ffmpegPath && ffprobePath ? new LocalMediaService({ rootDir: join(directory, "media"), allowedInputRoots: [uploadDirectory], ffmpegPath, ffprobePath }) : null;
const narration = localMedia ? new NarrationService(service, localMedia) : null;
// Each project starts in demo mode until its user chooses and checks local Codex.
const director = new LocalDirectorController(service, { repositoryRoot: fileURLToPath(new URL("../../../", import.meta.url)), dataDirectory: directory, endpoint: "http://127.0.0.1:3001" });
const app = createApp({ service, director, runtimeSettings: director, localToken, logger: true,
  ...(narration ? { narrationRoutes: { production: service, narration, canonical: new NarrationCanonicalService(narration), uploadDirectory } } : {}),
  ...(localMedia ? { mediaRoutes: { production: service, media: new MediaApplicationService(service, localMedia), uploads: new ManagedUploadStore({ rootDir: uploadDirectory }) } } : {}) });
let running = false;
const timer = setInterval(() => {
  try { director.tick(); } catch (error) { app.log.error(error); }
  if (running) return;
  running = true;
  void engine.reconcile().then(() => engine.runReady()).catch(error => app.log.error(error)).finally(() => { running = false; });
}, 500);
app.addHook("onClose", async () => { clearInterval(timer); await director.close(); while (running) await new Promise(resolve => setTimeout(resolve, 10)); store.close(); provider.close(); });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void app.close().catch(error => { app.log.error(error); process.exitCode = 1; }); });
try { await app.listen({ host: "127.0.0.1", port: 3001 }); }
catch (error) { clearInterval(timer); app.log.error(error); await app.close(); process.exitCode = 1; }
