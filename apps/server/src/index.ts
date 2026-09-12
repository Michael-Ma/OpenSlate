import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FakeProvider } from "@openslate/providers";
import { invariant } from "@openslate/core";
import { createApp } from "./app.js";
import { ProductionService } from "./application/service.js";
import { Store } from "./persistence/store.js";
import { Engine } from "./execution/engine.js";
import { DirectorSupervisor } from "./application/director-supervisor.js";
import { FakeWorkflowDirector } from "./application/fake-director.js";
import { createDirectorInput } from "./application/director-input.js";

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
// Native launch needs explicit local configuration and supervised integration validation.
// The default is a transparent scripted runtime with zero external calls.
const director = new DirectorSupervisor(service, new FakeWorkflowDirector(service), { mode: "fake",
  prepareInput: createDirectorInput(service, { repositoryRoot: fileURLToPath(new URL("../../../", import.meta.url)), snapshotRoot: join(directory, "skill-snapshots"), endpoint: "http://127.0.0.1:3001" }) });
const app = createApp({ service, director, localToken, logger: true });
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
