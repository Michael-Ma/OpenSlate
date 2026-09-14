import { createHash } from "node:crypto";
import { lstat, realpath, open } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { digest } from "@openslate/core";
import { CODEX_IMAGE_LIMITS, codexImageTurnText, describeCodexImageInput, inspectCodexImagePng,
  type CodexImageInput, type CodexImageOutcome, type CodexImagePrepared, type CodexImageTransport } from "@openslate/providers";
import { setupLocalCodex } from "../runtime/setup.js";
import { CODEX_RUNTIME_LIMITS, normalizePermissionProfile, toml, type CodexConfigValue, type CodexDirectorOptions } from "../runtime/policy.js";
import { object, requireRuntime, RuntimeFault } from "../runtime/validation.js";
import { ImageRpc, type RpcMessage } from "./image-rpc.js";
import { imageDirectory, imageFileSha, imageRead, imageStopped, imageWithin, imageWrite } from "./image-files.js";

export interface CodexImageWorkerOptions {
  command: { file: string; args?: readonly string[] };
  nativeHome: string; codexHome: string; env: Readonly<Record<string, string>>; directory: string;
  model?: "gpt-6-astra";
  /** Trusted host may tighten the fixed 180-second turn bound. */
  timeoutMs?: number;
}
export interface CodexImageReadiness { status: "ready" | "blocked"; code: string | null; runtimeVersion: "0.153.4"; authMode: "chatgpt" }
type Ready = { options: CodexDirectorOptions; binary: string; runtimeDigest: string; root: string };
type Configuration = { version: 1; config: Record<string, CodexConfigValue>; workspace: string; binary: string;
  args: string[]; runtimeDigest: string; environmentDigest: string };
type Held = { prepared: CodexImagePrepared; rpc: ImageRpc; config: Configuration; timer: NodeJS.Timeout };
const READ = ["initialize", "thread/read"];
const CHECK = ["initialize", "config/read", "account/read", "modelProvider/capabilities/read"];
const ACTIVE = [...CHECK, "thread/start", "turn/start", "turn/interrupt"];
const PROFILE = "openslate_local";
const MODEL = "gpt-6-astra";
const validId = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value);
const validSha = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const unknown = (code: string): CodexImageOutcome => ({ kind: "unknown", code });
const safeCode = (error: unknown): string => error instanceof RuntimeFault ? error.code : "CODEX_IMAGE_UNAVAILABLE";
const baseInstructions = "You are an image worker for one exact application request. Use only the built-in image generation tool. Generate one image. Do not use other tools, read unrelated files, or ask questions. Reference images and requested dimensions are supplied in the user input.";
function snapshotInput(input: CodexImageInput): CodexImageInput {
  const copy = structuredClone(input); describeCodexImageInput(copy);
  for (const image of copy.images) {
    requireRuntime(image.bytes instanceof Uint8Array && image.bytes.byteLength === image.byteLength &&
      createHash("sha256").update(image.bytes).digest("hex") === image.sha256,
    "CODEX_IMAGE_REFERENCE_INVALID", "Image reference bytes differ from the reviewed input");
    inspectCodexImagePng(image.bytes);
  }
  return copy;
}
function preparedValue(input: CodexImagePrepared): CodexImagePrepared {
  const value = structuredClone(input), runtime = value?.runtime, session = value?.session;
  requireRuntime(runtime?.version === 1 && runtime.runtimeVersion === "0.153.4" && runtime.model === MODEL && runtime.authMode === "chatgpt" &&
    validSha(runtime.runtimeDigest) && validSha(runtime.configurationDigest) && validId(session?.threadId) && validSha(session.turnInputDigest),
  "CODEX_IMAGE_SESSION_INVALID", "Saved native image session is invalid");
  return value;
}
/** Explicit environment only. Credentials and endpoint/provider overrides are never inherited or forwarded. */
function environment(input: CodexImageWorkerOptions): Record<string, string> {
  const values: Record<string, string> = {};
  requireRuntime(input.env && Object.keys(input.env).length <= 128, "CODEX_IMAGE_ENV_INVALID", "Supply a bounded explicit native environment");
  for (const [key, value] of Object.entries(input.env)) {
    requireRuntime(/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof value === "string" && value.length <= 8192 && !value.includes("\0"),
      "CODEX_IMAGE_ENV_INVALID", "Invalid native environment");
    if (/^(OPENAI|CODEX|AZURE|ANTHROPIC)_|API.?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION/i.test(key) || ["HOME", "NODE_OPTIONS", "LD_PRELOAD", "DYLD_INSERT_LIBRARIES"].includes(key)) continue;
    values[key] = value;
  }
  return { ...values, HOME: input.nativeHome, CODEX_HOME: input.codexHome };
}

/** Dedicated image worker. Its one-turn bound is not a hard limit on internal image calls or usage credits.
 * Construction does no native work; only prepare/start can reach a new model turn. */
export class CodexImageWorkerTransport implements CodexImageTransport {
  readonly #input: CodexImageWorkerOptions;
  readonly #env: Record<string, string>;
  #ready: Ready | undefined;
  #held: Held | undefined;
  #preparing = false;
  #turnRunning = false;
  #closed = false;
  readonly #running = new Set<ImageRpc>();
  constructor(supplied: CodexImageWorkerOptions) {
    this.#input = structuredClone(supplied);
    requireRuntime(this.#input.model === undefined || this.#input.model === MODEL, "CODEX_IMAGE_MODEL_UNSUPPORTED", "Image worker requires its pinned model");
    requireRuntime([this.#input.command?.file, this.#input.nativeHome, this.#input.codexHome, this.#input.directory].every(value =>
      typeof value === "string" && isAbsolute(value) && value.length <= 4096 && !value.includes("\0")),
    "CODEX_IMAGE_PATH_INVALID", "Image worker requires explicit absolute host paths");
    requireRuntime(this.#input.timeoutMs === undefined || (Number.isSafeInteger(this.#input.timeoutMs) && this.#input.timeoutMs > 0 && this.#input.timeoutMs <= 180_000),
      "CODEX_IMAGE_LIMIT_INVALID", "Image worker turn limit may only tighten its bound");
    this.#env = environment(this.#input);
  }
  async #command(signal?: AbortSignal): Promise<{ file: string; args?: readonly string[] }> {
    imageStopped(signal); let file = await realpath(this.#input.command.file);
    // npm's supported launcher is JavaScript. Resolve only its exact official optional-package layout,
    // so the durable identity hashes the executable rather than a shim that could hide a native update.
    if (file.endsWith("/@openai/codex/bin/codex.js")) {
      requireRuntime((process.platform === "darwin" || process.platform === "linux") && (process.arch === "arm64" || process.arch === "x64"),
        "CODEX_IMAGE_PLATFORM_UNSUPPORTED", "No pinned native package layout is supported for this host");
      const triple = `${process.arch === "arm64" ? "aarch64" : "x86_64"}-${process.platform === "darwin" ? "apple-darwin" : "unknown-linux-musl"}`;
      const packageRoot = join(dirname(dirname(dirname(file))), `codex-${process.platform}-${process.arch}`);
      file = await realpath(join(packageRoot, "vendor", triple, "bin", "codex"));
    }
    const handle = await open(file, "r");
    try {
      const header = Buffer.alloc(4); await handle.read(header, 0, 4, 0);
      requireRuntime(["7f454c46", "cffaedfe", "feedfacf", "cafebabe", "bebafeca"].includes(header.toString("hex")),
        "CODEX_IMAGE_BINARY_INVALID", "Select the pinned native executable or its official npm launcher");
    } finally { await handle.close(); }
    imageStopped(signal); return { file, ...(this.#input.command.args ? { args: [...this.#input.command.args] } : {}) };
  }
  async #setup(signal?: AbortSignal): Promise<Ready> {
    imageStopped(signal); requireRuntime(!this.#closed, "CODEX_IMAGE_CLOSED", "Image worker has closed");
    if (this.#ready) return this.#ready;
    const root = resolve(this.#input.directory), projection = join(root, "workspaces"), snapshots = join(projection, "skills");
    const command = await this.#command(signal);
    const result = await setupLocalCodex({ command, model: MODEL, nativeHome: this.#input.nativeHome,
      codexHome: this.#input.codexHome, env: this.#env, directories: { projection, snapshots, storage: join(root, "runtime") } }, signal ? { signal } : {});
    requireRuntime(result.runtimeOptions && result.readiness.status === "ready", result.readiness.issues[0]?.code ?? "CODEX_IMAGE_SETUP_FAILED", "Image worker setup is unavailable");
    const binary = command.file, runtimeDigest = await imageFileSha(binary, signal);
    const ready = { options: result.runtimeOptions, binary, runtimeDigest, root: await realpath(root) };
    imageStopped(signal); this.#ready = ready; return ready;
  }
  #configuration(ready: Ready, workspace: string): Configuration {
    const config = structuredClone(ready.options.policy!.config) as Record<string, CodexConfigValue>;
    config["features.image_generation"] = true;
    config.forced_login_method = "chatgpt";
    config.permissions = { [PROFILE]: { filesystem: { ":root": "deny", ":minimal": "read", [workspace]: "write", [ready.binary]: "read" }, network: { enabled: false } } };
    return { version: 1, config, workspace, binary: ready.binary, args: [...(this.#input.command.args ?? [])], runtimeDigest: ready.runtimeDigest,
      environmentDigest: digest(this.#env) };
  }
  #launch(config: Configuration, methods: readonly string[], receive: (message: RpcMessage) => void = () => {}): ImageRpc {
    requireRuntime(!this.#closed, "CODEX_IMAGE_CLOSED", "Image worker has closed");
    const args = [...config.args, "app-server", "--strict-config", ...Object.entries(config.config).flatMap(([key, value]) => ["-c", `${key}=${toml(value)}`])];
    requireRuntime(Buffer.byteLength(args.join("\0")) <= 128 * 1024, "CODEX_IMAGE_CONFIG_LIMIT", "Image worker configuration exceeds its bound");
    const rpc = new ImageRpc({ command: config.binary, args, cwd: config.workspace, env: { ...this.#env },
      limits: { ...CODEX_RUNTIME_LIMITS, outputBytes: 192 * 1024 ** 2 }, secrets: Object.values(this.#env), allowedMethods: methods,
      onMessage: message => {
        if (message.id !== undefined) { rpc.rejectServerRequest(message.id); rpc.fail(new RuntimeFault("CODEX_IMAGE_INTERACTIVE_DENIED", "Interactive image worker requests are unavailable")); }
        else receive(message);
      } });
    this.#running.add(rpc); return rpc;
  }
  async #close(rpc: ImageRpc): Promise<void> { try { await rpc.close(); } finally { this.#running.delete(rpc); } }
  async #initialize(rpc: ImageRpc, signal?: AbortSignal): Promise<void> {
    await rpc.request("initialize", { clientInfo: { name: "openslate_image_worker", version: "1" }, capabilities: { experimentalApi: true } }, signal);
    rpc.notification("initialized"); imageStopped(signal);
  }
  async #check(rpc: ImageRpc, configuration: Configuration, signal?: AbortSignal): Promise<void> {
    const account = object(await rpc.request("account/read", { refreshToken: false }, signal));
    requireRuntime(account.requiresOpenaiAuth === true && object(account.account).type === "chatgpt", "CODEX_IMAGE_CHATGPT_REQUIRED", "Sign in with ChatGPT in the selected Codex installation");
    const config = object(object(await rpc.request("config/read", { cwd: configuration.workspace, includeLayers: false }, signal)).config);
    const expected = configuration.config;
    for (const [key, value] of Object.entries(expected)) {
      if (key === "skills.config") continue;
      const actual = key.split(".").reduce<unknown>((item, part) => object(item)[part], config);
      const same = key === "permissions" ? isDeepStrictEqual(normalizePermissionProfile(object(actual)[PROFILE]), normalizePermissionProfile(object(value)[PROFILE])) : isDeepStrictEqual(actual, value);
      requireRuntime(same, "CODEX_IMAGE_CONFIG_MISMATCH", "Native image configuration differs from the pinned configuration");
    }
    requireRuntime(Object.values(object(config.mcp_servers)).every(server => object(server).enabled === false),
      "CODEX_IMAGE_MCP_UNEXPECTED", "Image worker cannot use inherited application tools");
    requireRuntime(object(await rpc.request("modelProvider/capabilities/read", {}, signal)).imageGeneration === true,
      "CODEX_IMAGE_CAPABILITY_UNAVAILABLE", "Selected native provider does not advertise image generation");
    imageStopped(signal);
  }
  async checkReadiness(options: { signal?: AbortSignal } = {}): Promise<CodexImageReadiness> {
    const signal = options.signal; let rpc: ImageRpc | undefined;
    try {
      const ready = await this.#setup(signal), config = this.#configuration(ready, ready.options.cwd);
      rpc = this.#launch(config, CHECK); await this.#initialize(rpc, signal); await this.#check(rpc, config, signal);
      await this.#close(rpc); rpc = undefined; imageStopped(signal);
      return { status: "ready", code: null, runtimeVersion: "0.153.4", authMode: "chatgpt" };
    } catch (error) { return { status: "blocked", code: safeCode(error), runtimeVersion: "0.153.4", authMode: "chatgpt" }; }
    finally { if (rpc) await this.#close(rpc); }
  }
  async prepare(supplied: CodexImageInput, options: { signal?: AbortSignal } = {}): Promise<CodexImagePrepared> {
    const signal = options.signal; imageStopped(signal); const input = snapshotInput(supplied), description = describeCodexImageInput(input);
    requireRuntime(!this.#preparing && !this.#held && !this.#turnRunning, "CODEX_IMAGE_BUSY", "Image worker is already preparing a turn"); this.#preparing = true;
    let rpc: ImageRpc | undefined;
    try {
      const ready = await this.#setup(signal), workspace = await imageDirectory(ready.options.cwd, description.turnInputDigest);
      requireRuntime(await imageFileSha(ready.binary, signal) === ready.runtimeDigest, "CODEX_IMAGE_BINARY_CHANGED", "Native binary changed after setup");
      for (const [index, image] of input.images.entries()) {
        const path = join(workspace, `reference-${index}-${image.sha256}.png`);
        try { await imageWrite(workspace, path, image.bytes, signal); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
        const installed = await imageRead(workspace, path, CODEX_IMAGE_LIMITS.referenceBytes, signal);
        requireRuntime(installed.equals(Buffer.from(image.bytes)), "CODEX_IMAGE_REFERENCE_CHANGED", "Owned image reference differs from the reviewed bytes");
      }
      const config = this.#configuration(ready, workspace), configurationDigest = digest(config);
      const configurations = await imageDirectory(ready.root, "configurations"), path = join(configurations, `${configurationDigest}.json`);
      try { await imageWrite(configurations, path, Buffer.from(JSON.stringify(config)), signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      requireRuntime(digest(JSON.parse((await imageRead(configurations, path, 256 * 1024, signal)).toString("utf8"))) === configurationDigest,
        "CODEX_IMAGE_CONFIG_MISMATCH", "Saved image worker configuration changed");
      rpc = this.#launch(config, ACTIVE); await this.#initialize(rpc, signal); await this.#check(rpc, config, signal);
      const response = object(await rpc.request("thread/start", { model: MODEL, modelProvider: "openai", cwd: workspace, approvalPolicy: "never", permissions: PROFILE,
        historyMode: "legacy", ephemeral: false, allowProviderModelFallback: false, baseInstructions }, signal));
      const threadId = object(response.thread).id;
      requireRuntime(validId(threadId) && response.model === MODEL && response.modelProvider === "openai" && response.cwd === workspace,
        "CODEX_IMAGE_THREAD_INVALID", "Native image thread identity is invalid");
      imageStopped(signal);
      const prepared: CodexImagePrepared = { runtime: { version: 1, runtimeVersion: "0.153.4", runtimeDigest: ready.runtimeDigest,
        configurationDigest, model: MODEL, authMode: "chatgpt" }, session: { threadId, turnInputDigest: description.turnInputDigest } };
      requireRuntime(!this.#closed, "CODEX_IMAGE_CLOSED", "Image worker closed before prepared handoff");
      const heldRpc = rpc;
      const timer = setTimeout(() => { if (this.#held?.rpc === heldRpc) this.#held = undefined; void this.#close(heldRpc).catch(() => {}); }, 120_000); timer.unref();
      this.#held = { prepared, rpc, config, timer }; rpc = undefined;
      return structuredClone(prepared);
    } finally { this.#preparing = false; if (rpc) await this.#close(rpc); }
  }
  async #load(prepared: CodexImagePrepared, signal?: AbortSignal): Promise<Configuration> {
    const root = await realpath(this.#input.directory), configurations = join(root, "configurations");
    const bytes = await imageRead(configurations, join(configurations, `${prepared.runtime.configurationDigest}.json`), 256 * 1024, signal);
    const config = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Configuration;
    requireRuntime(digest(config) === prepared.runtime.configurationDigest && config.version === 1 && config.environmentDigest === digest(this.#env) &&
      config.runtimeDigest === prepared.runtime.runtimeDigest && config.binary === (await this.#command(signal)).file &&
      isDeepStrictEqual(config.args, [...(this.#input.command.args ?? [])]) && config.workspace === join(root, "workspaces", prepared.session.turnInputDigest) &&
      config.config.model === MODEL && config.config.model_provider === "openai" && config.config["features.image_generation"] === true && config.config.forced_login_method === "chatgpt",
    "CODEX_IMAGE_CONFIG_MISMATCH", "Saved image worker configuration differs from this installation");
    requireRuntime(await realpath(config.workspace) === config.workspace && await imageFileSha(config.binary, signal) === prepared.runtime.runtimeDigest,
      "CODEX_IMAGE_BINARY_CHANGED", "Native runtime identity changed since this image turn");
    imageStopped(signal); return config;
  }
  async #result(prepared: CodexImagePrepared, turn: Record<string, unknown>, images: readonly Record<string, unknown>[], workspace: string,
    signal?: AbortSignal): Promise<CodexImageOutcome> {
    imageStopped(signal); const threadId = prepared.session.threadId, turnId = turn.id;
    requireRuntime(validId(turnId), "CODEX_IMAGE_TURN_INVALID", "Image turn identity is invalid");
    requireRuntime(images.length <= 1, "CODEX_IMAGE_MULTIPLE_OUTPUTS", "Image turn produced multiple image items; no result was selected");
    if (turn.status === "inProgress") return { kind: "pending", threadId, turnId };
    const image = images[0];
    if (object(image?.failure).type === "usageLimitExceeded") return { kind: "failed", threadId, turnId, code: "USAGE_LIMIT" };
    if (turn.status === "failed" || turn.status === "interrupted") return { kind: "failed", threadId, turnId, code: "TURN_FAILED" };
    requireRuntime(turn.status === "completed", "CODEX_IMAGE_TURN_INVALID", "Image turn did not report a supported terminal state");
    if (image?.status === "failed") return { kind: "failed", threadId, turnId, code: "IMAGE_FAILED" };
    requireRuntime(image && validId(image.id) && image.type === "imageGeneration" && image.status === "completed" &&
      typeof image.result === "string" && (image.failure === undefined || image.failure === null),
    "CODEX_IMAGE_COMPLETION_MISSING", "Completed turn has no unique successful image item");
    requireRuntime(image.revisedPrompt === undefined || image.revisedPrompt === null ||
      (typeof image.revisedPrompt === "string" && Buffer.byteLength(image.revisedPrompt) <= CODEX_IMAGE_LIMITS.revisedPromptBytes),
    "CODEX_IMAGE_ITEM_INVALID", "Image metadata exceeds its bound");
    let bytes: Buffer | undefined;
    const encoded = image.result.startsWith("data:image/png;base64,") ? image.result.slice(22) : image.result;
    if (encoded.length > 0 && encoded.length <= Math.ceil(CODEX_IMAGE_LIMITS.outputBytes / 3) * 4 && encoded.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
      const value = Buffer.from(encoded, "base64");
      if (value.toString("base64") === encoded && value.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) bytes = value;
    }
    if (!bytes) {
      requireRuntime(typeof image.savedPath === "string" && isAbsolute(image.savedPath) && image.savedPath.length <= 4096 && !image.savedPath.includes("\0"),
        "CODEX_IMAGE_BYTES_UNAVAILABLE", "Image item has no bounded PNG bytes or exact native output path");
      const path = image.savedPath;
      // The native tool writes this specific output namespace by default. We read only the exact structured-item path,
      // never enumerate native homes, search for a newest file, or interpret assistant prose as a locator.
      const nativeOutput = join(await realpath(this.#input.codexHome), "generated_images");
      const root = imageWithin(workspace, path) ? workspace : nativeOutput;
      const directory = await lstat(root);
      requireRuntime(directory.isDirectory() && !directory.isSymbolicLink(), "CODEX_IMAGE_PATH_INVALID", "Native output namespace is not canonical");
      bytes = await imageRead(root, path, CODEX_IMAGE_LIMITS.outputBytes, signal);
    }
    inspectCodexImagePng(bytes); imageStopped(signal);
    return { kind: "completed", threadId, turnId, itemId: image.id, bytes: new Uint8Array(bytes), revisedPrompt: typeof image.revisedPrompt === "string" ? image.revisedPrompt : null };
  }
  async start(suppliedPrepared: CodexImagePrepared, suppliedInput: CodexImageInput,
    suppliedOptions: { signal?: AbortSignal; observeTurn: (turnId: string) => Promise<void> }): Promise<CodexImageOutcome> {
    const signal = suppliedOptions.signal, observeTurn = suppliedOptions.observeTurn;
    let prepared: CodexImagePrepared, input: CodexImageInput;
    try { prepared = preparedValue(suppliedPrepared); input = snapshotInput(suppliedInput); imageStopped(signal); }
    catch (error) { return unknown(safeCode(error)); }
    if (typeof observeTurn !== "function" || describeCodexImageInput(input).turnInputDigest !== prepared.session.turnInputDigest) return unknown("CODEX_IMAGE_SESSION_MISMATCH");
    const held = this.#held;
    if (!held || !isDeepStrictEqual(held.prepared, prepared)) return unknown("CODEX_IMAGE_PREPARED_PROCESS_LOST");
    this.#held = undefined; clearTimeout(held.timer); this.#turnRunning = true;
    const rpc = held.rpc, threadId = prepared.session.threadId;
    let turnId: string | undefined, finished: Record<string, unknown> | undefined, observation = Promise.resolve(), eventFault: unknown;
    const images = new Map<string, Record<string, unknown>>();
    let wake!: () => void; const completion = new Promise<void>(resolve => { wake = resolve; });
    let deadline = false; const cancellation = new AbortController();
    const abort = () => cancellation.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    const timer = setTimeout(() => { deadline = true; cancellation.abort(); wake(); }, this.#input.timeoutMs ?? 180_000);
    const aborted = () => wake(); cancellation.signal.addEventListener("abort", aborted, { once: true });
    const identity = (id: unknown): void => {
      requireRuntime(validId(id) && (turnId === undefined || turnId === id), "CODEX_IMAGE_TURN_MISMATCH", "Native event belongs to another image turn");
      if (!turnId) { turnId = id; observation = Promise.resolve().then(() => observeTurn(id)); observation.catch(error => { eventFault = error; wake(); }); }
    };
    const item = (raw: unknown): void => {
      const value = object(raw); if (value.type !== "imageGeneration") return;
      requireRuntime(validId(value.id), "CODEX_IMAGE_ITEM_INVALID", "Image item has no stable identity");
      const snapshot = { type: value.type, id: value.id, status: value.status, result: value.result, savedPath: value.savedPath ?? null,
        revisedPrompt: value.revisedPrompt ?? null, failure: value.failure ?? null };
      const previous = images.get(value.id);
      requireRuntime(!previous || isDeepStrictEqual(previous, snapshot), "CODEX_IMAGE_ITEM_CONFLICT", "Image completion item changed");
      images.set(value.id, snapshot);
      requireRuntime(images.size <= 1, "CODEX_IMAGE_MULTIPLE_OUTPUTS", "Image turn produced multiple image items; no result was selected");
    };
    rpc.setMessageHandler(message => {
      try {
        if (message.id !== undefined) { rpc.rejectServerRequest(message.id); throw new RuntimeFault("CODEX_IMAGE_INTERACTIVE_DENIED", "Image worker cannot request interactive authority"); }
        if (!["turn/started", "turn/completed", "item/completed"].includes(message.method)) return;
        const params = object(message.params);
        requireRuntime(params.threadId === threadId, "CODEX_IMAGE_THREAD_MISMATCH", "Native event belongs to another image thread");
        if (message.method === "item/completed") { identity(params.turnId); item(params.item); return; }
        const turn = object(params.turn); identity(turn.id);
        if (message.method === "turn/completed") {
          requireRuntime(Array.isArray(turn.items) && turn.items.length <= 128, "CODEX_IMAGE_HISTORY_LIMIT", "Native image turn history exceeds its bound");
          for (const value of turn.items) item(value);
          finished = turn; wake();
        }
      } catch (error) { eventFault = error; wake(); }
    });
    let outcome: CodexImageOutcome;
    try {
      await this.#load(prepared, cancellation.signal); await this.#check(rpc, held.config, cancellation.signal);
      for (const [index, image] of input.images.entries()) {
        const bytes = await imageRead(held.config.workspace, join(held.config.workspace, `reference-${index}-${image.sha256}.png`), CODEX_IMAGE_LIMITS.referenceBytes, cancellation.signal);
        requireRuntime(bytes.equals(Buffer.from(image.bytes)), "CODEX_IMAGE_REFERENCE_CHANGED", "Owned image reference changed before its native turn");
      }
      // Defense in depth for direct callers. The application also stores its own durable dispatch marker before this method.
      await imageWrite(held.config.workspace, join(held.config.workspace, "turn-started.json"), Buffer.from(JSON.stringify(prepared)), cancellation.signal);
      imageStopped(cancellation.signal);
      const inputs = [{ type: "text", text: codexImageTurnText(input), text_elements: [] }, ...input.images.map((image, index) =>
        ({ type: "localImage", path: join(held.config.workspace, `reference-${index}-${image.sha256}.png`) }))];
      const response = object(await rpc.request("turn/start", { threadId, input: inputs, model: MODEL, effort: "low", approvalPolicy: "never", permissions: PROFILE }, cancellation.signal));
      identity(object(response.turn).id);
      await Promise.race([completion, rpc.failed.then(error => { throw error; })]);
      if (eventFault) throw eventFault;
      if (cancellation.signal.aborted) throw new RuntimeFault(deadline ? "CODEX_IMAGE_TIMEOUT" : "CODEX_IMAGE_ABORTED", "Image worker stopped waiting for its native turn");
      await Promise.race([observation, new Promise<never>((_, reject) => {
        if (cancellation.signal.aborted) reject(new RuntimeFault("CODEX_IMAGE_ABORTED", "Image observation stopped"));
        else cancellation.signal.addEventListener("abort", () => reject(new RuntimeFault("CODEX_IMAGE_ABORTED", "Image observation stopped")), { once: true });
      })]);
      requireRuntime(finished, "CODEX_IMAGE_COMPLETION_MISSING", "Image turn completion was not observed");
      outcome = await this.#result(prepared, finished, [...images.values()], held.config.workspace, signal);
    } catch (error) {
      outcome = unknown(safeCode(error));
      if (turnId && !rpc.closed) await rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort); cancellation.signal.removeEventListener("abort", aborted);
      try { await this.#close(rpc); } catch { outcome = unknown("CODEX_IMAGE_CLEANUP_FAILED"); }
      this.#turnRunning = false;
    }
    return signal?.aborted ? unknown("CODEX_IMAGE_ABORTED") : outcome!;
  }
  async lookup(suppliedPrepared: CodexImagePrepared, options: { turnId?: string; signal?: AbortSignal } = {}): Promise<CodexImageOutcome> {
    const signal = options.signal, selectedTurn = options.turnId; let rpc: ImageRpc | undefined, outcome: CodexImageOutcome;
    try {
      const prepared = preparedValue(suppliedPrepared); imageStopped(signal);
      requireRuntime(selectedTurn === undefined || validId(selectedTurn), "CODEX_IMAGE_TURN_INVALID", "Saved native turn identity is invalid");
      const config = await this.#load(prepared, signal);
      rpc = this.#launch(config, READ); await this.#initialize(rpc, signal);
      // Pinned 0.153.4 advertises items/list but returns -32601. Its legacy history mode supports this bounded read.
      // Never fall back to resume/start when history is unavailable, incomplete, oversized or ambiguous.
      const response = object(await rpc.request("thread/read", { threadId: prepared.session.threadId, includeTurns: true }, signal));
      const thread = object(response.thread);
      requireRuntime(thread.id === prepared.session.threadId && thread.cwd === config.workspace && thread.modelProvider === "openai" &&
        Array.isArray(thread.turns) && thread.turns.length <= 1, "CODEX_IMAGE_HISTORY_INVALID", "Saved native history is not the dedicated image thread");
      const turn = thread.turns.map(object).find(value => selectedTurn === undefined || value.id === selectedTurn);
      requireRuntime(turn && Array.isArray(turn.items) && turn.items.length <= 128, "CODEX_IMAGE_TURN_MISSING", "Exact original image turn is unavailable");
      outcome = await this.#result(prepared, turn, turn.items.map(object).filter(value => value.type === "imageGeneration"), config.workspace, signal);
    } catch (error) { outcome = unknown(safeCode(error)); }
    finally { if (rpc) { try { await this.#close(rpc); } catch { outcome = unknown("CODEX_IMAGE_CLEANUP_FAILED"); } } }
    return signal?.aborted ? unknown("CODEX_IMAGE_ABORTED") : outcome!;
  }
  async release(supplied: CodexImagePrepared): Promise<void> {
    const prepared = preparedValue(supplied), held = this.#held;
    if (!held || !isDeepStrictEqual(held.prepared, prepared)) return;
    this.#held = undefined; clearTimeout(held.timer); await this.#close(held.rpc);
  }
  async close(): Promise<void> {
    this.#closed = true; if (this.#held) clearTimeout(this.#held.timer); this.#held = undefined;
    const results = await Promise.allSettled([...this.#running].map(rpc => this.#close(rpc)));
    if (results.some(result => result.status === "rejected")) throw new RuntimeFault("CODEX_IMAGE_CLEANUP_FAILED", "Native image worker cleanup was not confirmed");
  }
}
