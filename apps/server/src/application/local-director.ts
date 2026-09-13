import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { digest, invariant, newId } from "@openslate/core";
import { CodexDirectorRuntime, setupLocalCodex } from "@openslate/director";
import type { DirectorRunInput, DirectorRuntime, DirectorStartOptions } from "@openslate/director";
import { DirectorSupervisor } from "./director-supervisor.js";
import { FakeWorkflowDirector } from "./fake-director.js";
import { createDirectorInput } from "./director-input.js";
import { directorInputDigest } from "./director-input-identity.js";
import { DirectorImageProjector } from "./director-images.js";
import type { SelectedDirectorImage } from "./director-images.js";
import type { ActorContext } from "@openslate/core";
import { DirectorToolSettings } from "./director-tools-upgrade.js";
import type { DirectorToolsUpgrade } from "./director-tools-upgrade.js";
import type { ProductionService } from "./service.js";

export interface LocalDirectorSelection { mode: "fake" | "native"; binaryPath?: string; model?: string; codexHome?: string }
interface SavedSelection { id: string; projectId: string; selection: LocalDirectorSelection; digest: string }
interface SelectionCommand { id: string; projectId: string; selectionDigest: string; state: "pending" | "completed" }
type Setup = typeof setupLocalCodex;
type Ready = Awaited<ReturnType<Setup>>;
export interface LocalDirectorOptions {
  repositoryRoot: string; dataDirectory: string; endpoint: string;
  /** Test/deployment injection points are trusted host code, never browser arguments. */
  setup?: Setup;
  makeRuntime?: (result: Ready) => DirectorRuntime;
  defaults?: { binaryPath: string; model: string; codexHome?: string };
  /** Trusted local executable for selected-reference thumbnails. No browser path input. */
  ffmpegPath?: string;
}

/** One computer, persistent project choices, separate fake/native queues. */
export class LocalDirectorController {
  readonly fake: DirectorSupervisor;
  readonly native: DirectorSupervisor;
  private readonly setup: Setup;
  private readonly prepared = new Map<string, Promise<{ runtime: DirectorRuntime; input: ReturnType<typeof createDirectorInput>; readiness: Ready["readiness"] }>>();
  private readonly configuring = new Set<string>();
  readonly defaults: NonNullable<LocalDirectorOptions["defaults"]>;
  private readonly toolSettings: DirectorToolSettings;
  private readonly imageProjector: DirectorImageProjector | null;
  constructor(readonly service: ProductionService, readonly config: LocalDirectorOptions) {
    this.setup = config.setup ?? setupLocalCodex;
    this.defaults = config.defaults ?? { binaryPath: this.findBinary(), model: "gpt-6-astra" };
    this.imageProjector = config.ffmpegPath ? new DirectorImageProjector(service, { ffmpegPath: config.ffmpegPath }) : null;
    this.toolSettings = new DirectorToolSettings(service, projectId => this.mode(projectId) === "native"
      ? { repositoryRoot: config.repositoryRoot, snapshotRoot: join(config.dataDirectory, "native", projectId, "workspace", ".agents", "skills"), runtimeId: "codex-app-server" }
      : { repositoryRoot: config.repositoryRoot, snapshotRoot: join(config.dataDirectory, "skill-snapshots"), runtimeId: "fake-workflow-v1" },
      projectId => this.configuring.has(projectId));
    const fakeInput = createDirectorInput(service, { repositoryRoot: config.repositoryRoot, snapshotRoot: join(config.dataDirectory, "skill-snapshots"), endpoint: config.endpoint });
    this.fake = new DirectorSupervisor(service, new FakeWorkflowDirector(service), { mode: "fake", projectFilter: id => this.mode(id) === "fake", prepareInput: fakeInput });
    const proxy: DirectorRuntime = { id: "codex-app-server", start: async (input, options) => this.startNative(input, options) };
    this.native = new DirectorSupervisor(service, proxy, { mode: "native", projectFilter: id => this.mode(id) === "native",
      prepareInput: async (turn, human, bridge, preparation) => {
        const input = await (await this.ready(turn.projectId)).input(turn, human, bridge);
        if (!service.store.get("request_image_selection", turn.requestId)) return input;
        invariant(this.imageProjector, "DIRECTOR_IMAGES_UNAVAILABLE", "Local FFmpeg is required to prepare reference images");
        return this.imageProjector.prepare(input, bridge.actor, join(config.dataDirectory, "native", turn.projectId, "workspace"), preparation);
      } });
  }
  private findBinary(): string {
    // Prefer bundled native executables over optional npm launchers that may lack platform binaries.
    // This is a UI suggestion only: setup still checks the selected executable's exact version.
    const candidates = [process.env.OPENSLATE_CODEX_BINARY, "/Applications/ChatGPT.app/Contents/Resources/codex",
      "/Applications/Codex.app/Contents/Resources/codex", ...((process.env.PATH ?? "").split(":").filter(Boolean).map(path => join(path, "codex")))];
    for (const candidate of candidates) if (candidate && isAbsolute(candidate) && existsSync(candidate)) {
      try { return realpathSync(candidate); } catch { /* A disappeared suggestion must not prevent server startup. */ }
    }
    return "";
  }
  mode(projectId: string): "fake" | "native" { return this.service.store.get<SavedSelection>("project_director_selection", projectId)?.selection.mode ?? "fake"; }
  private controller(projectId: string) { return this.mode(projectId) === "native" ? this.native : this.fake; }
  status(projectId: string) {
    const status = this.controller(projectId).status(projectId);
    const imageErrors: Record<string, string> = {
      DIRECTOR_IMAGE_LIMIT: "This reference's discussion thumbnail exceeds the size limit. Import a simpler or smaller PNG and start a new discussion.",
      DIRECTOR_IMAGE_CHANGED: "A saved reference or thumbnail changed. Import the original image again and start a new discussion.",
      DIRECTOR_IMAGE_MISSING: "A saved reference or thumbnail is missing. Import it again and start a new discussion.",
      DIRECTOR_IMAGE_SCOPE: "The selected image is no longer available in this project's managed reference library.",
      DIRECTOR_IMAGE_IDENTITY: "The saved image selection or thumbnail receipt no longer matches this request. Start a new discussion with the intended reference.",
      DIRECTOR_IMAGE_TOOL_CHANGED: "The local image tool changed. Restart OpenSlate before preparing a new image discussion.",
      DIRECTOR_IMAGES_UNAVAILABLE: "Image discussion needs a native director and local FFmpeg.",
    };
    return { ...status, message: status.message ?? (status.turn?.state === "failed" ? imageErrors[status.turn.errorCode ?? ""] ?? null : null),
      imageAttachmentsAvailable: this.mode(projectId) === "native" && this.imageProjector !== null };
  }
  recordImages(projectId: string, actor: ActorContext, images: SelectedDirectorImage[]) {
    invariant(this.mode(projectId) === "native" && this.imageProjector, "DIRECTOR_IMAGES_UNAVAILABLE", "Image discussion requires a native director and local FFmpeg");
    return this.imageProjector.record(projectId, actor, images);
  }
  enqueue(...args: Parameters<DirectorSupervisor["enqueue"]>) { return this.controller(args[0]).enqueue(...args); }
  answerQuestion(...args: Parameters<DirectorSupervisor["answerQuestion"]>) { return this.controller(args[0]).answerQuestion(...args); }
  tick(): void { this.fake.tick(); this.native.tick(); }
  async settle(): Promise<void> { await Promise.all([this.fake.settle(), this.native.settle()]); }
  async close(): Promise<void> { await Promise.all([this.fake.close(), this.native.close()]); }
  settings(projectId: string) {
    this.service.store.getProject(projectId);
    const saved = this.service.store.get<SavedSelection>("project_director_selection", projectId);
    return { selection: saved?.selection ?? { mode: "fake" as const }, defaults: this.defaults, locked: this.locked(projectId),
      modelCalls: this.service.store.list("native_model_start", projectId).length };
  }
  tools(projectId: string) { return this.toolSettings.status(projectId); }
  upgradeTools(projectId: string, input: DirectorToolsUpgrade, key: string) {
    const result = this.toolSettings.upgrade(projectId, input, key);
    const saved = this.service.store.get<SavedSelection>("project_director_selection", projectId);
    if (saved) this.prepared.delete(digest({ projectId, selection: saved.selection }));
    return result;
  }
  private locked(projectId: string): boolean { return this.service.store.list("director_turn", projectId).length > 0 || this.service.store.list("director_skill_lock", projectId).length > 0; }
  private validate(input: LocalDirectorSelection): LocalDirectorSelection {
    invariant(input && ["fake", "native"].includes(input.mode) && Object.keys(input).every(key => ["mode", "binaryPath", "model", "codexHome"].includes(key)), "VALIDATION_ERROR", "Choose a supported local director");
    if (input.mode === "fake") return { mode: "fake" };
    invariant(typeof input.binaryPath === "string" && isAbsolute(input.binaryPath) && input.binaryPath.length <= 4096 && !input.binaryPath.includes("\0"), "VALIDATION_ERROR", "Select the local Codex executable");
    invariant(typeof input.model === "string" && /^[A-Za-z0-9_.:/-]{1,120}$/.test(input.model), "VALIDATION_ERROR", "Select a Codex model");
    invariant(input.codexHome === undefined || (isAbsolute(input.codexHome) && input.codexHome.length <= 4096 && !input.codexHome.includes("\0")), "VALIDATION_ERROR", "Codex home must be an absolute local path");
    return { mode: "native", binaryPath: input.binaryPath, model: input.model, ...(input.codexHome ? { codexHome: input.codexHome } : {}) };
  }
  async configure(projectId: string, supplied: LocalDirectorSelection, key: string) {
    this.service.recovery.assertWritable(projectId);
    this.service.store.getProject(projectId);
    const selection = this.validate(structuredClone(supplied)); const identity = digest(selection);
    invariant(typeof key === "string" && key.length > 0 && key.length <= 160, "VALIDATION_ERROR", "Use one bounded setup command identity");
    // Reserve payload identity before any binary/setup work. A failed setup remains retryable with
    // this exact key/payload; a completed command is never applied again over a later selection.
    const reservation = this.service.store.command<{ selectionDigest: string; commandId?: string }>(`local-user:${projectId}:director-selection`, key, identity, () => {
      const id = newId();
      this.service.store.insert<SelectionCommand>("director_selection_command", id, projectId, { id, projectId, selectionDigest: identity, state: "pending" });
      return { selectionDigest: identity, commandId: id };
    });
    // Older receipts were written only after selecting a director, and have no separate command row.
    if (!reservation.commandId || this.service.store.get<SelectionCommand>("director_selection_command", reservation.commandId)?.state === "completed")
      return this.configurationResponse(projectId, identity);
    invariant(!this.configuring.has(projectId), "DIRECTOR_SETUP_BUSY", "A setup check is already running for this project");
    const existing = this.service.store.get<SavedSelection>("project_director_selection", projectId);
    invariant(!this.locked(projectId) || existing?.digest === identity, "DIRECTOR_SELECTION_LOCKED", "Choose the director before this project's first conversation; use a new project to select another director");
    this.configuring.add(projectId);
    try {
      if (selection.mode === "native") await this.prepare(projectId, selection);
      this.service.store.transaction(() => {
        const command = this.service.store.get<SelectionCommand>("director_selection_command", reservation.commandId!);
        invariant(command?.projectId === projectId && command.selectionDigest === identity, "IDEMPOTENCY_CONFLICT", "Setup command identity changed");
        if (command.state === "completed") return;
        const current = this.service.store.get<SavedSelection>("project_director_selection", projectId);
        invariant(!this.locked(projectId) || current?.digest === identity, "DIRECTOR_SELECTION_LOCKED", "A conversation started while setup was running; use a new project");
        if (current?.digest !== identity) {
          this.service.store.put("project_director_selection", projectId, projectId, { id: projectId, projectId, selection, digest: identity });
          this.service.store.appendEvent(projectId, "director.configured", { mode: selection.mode, model: selection.model ?? null, selectionDigest: identity });
        }
        this.service.store.put("director_selection_command", command.id, projectId, { ...command, state: "completed" });
      });
      return await this.configurationResponse(projectId, identity);
    } finally { this.configuring.delete(projectId); }
  }
  private async configurationResponse(projectId: string, requestedDigest: string) {
    const current = this.service.store.get<SavedSelection>("project_director_selection", projectId);
    const selection = current?.selection ?? { mode: "fake" as const };
    const selectionDigest = current?.digest ?? digest(selection);
    const readiness = selection.mode === "native" ? (await this.prepare(projectId, selection)).readiness : null;
    return this.service.store.transaction(() => {
      const latest = this.service.store.get<SavedSelection>("project_director_selection", projectId);
      invariant((latest?.digest ?? digest({ mode: "fake" })) === selectionDigest, "DIRECTOR_SETUP_BUSY", "Director choices changed while readiness was being checked; retry the same command");
      return { ...this.settings(projectId), readiness, readinessSelectionDigest: selectionDigest,
        selectionMatchesCommand: selectionDigest === requestedDigest };
    });
  }
  private async ready(projectId: string) {
    const saved = this.service.store.get<SavedSelection>("project_director_selection", projectId);
    invariant(saved?.selection.mode === "native", "DIRECTOR_NOT_CONFIGURED", "Native director has not been configured for this project");
    return this.prepare(projectId, saved.selection);
  }
  private prepare(projectId: string, selection: LocalDirectorSelection) {
    this.service.recovery.assertWritable(projectId);
    const key = digest({ projectId, selection }); const existing = this.prepared.get(key); if (existing) return existing;
    const pending = (async () => {
      const root = resolve(this.config.dataDirectory, "native", projectId), projection = join(root, "workspace"), snapshots = join(projection, ".agents", "skills"), storage = join(root, "runtime");
      for (const path of [projection, snapshots, storage]) mkdirSync(path, { recursive: true, mode: 0o700 });
      const result = await this.setup({ command: { file: selection.binaryPath! }, model: selection.model!, nativeHome: homedir(), codexHome: selection.codexHome ?? join(homedir(), ".codex"),
        env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, SHELL: "/bin/sh", NO_COLOR: "1", CI: "1" }, directories: { projection, snapshots, storage } });
      invariant(result.readiness.status === "ready" && result.runtimeOptions, "DIRECTOR_SETUP_REQUIRED", "Codex setup checks did not pass. Verify the selected binary, model and existing Codex sign-in.");
      const runtime = this.config.makeRuntime?.(result) ?? new CodexDirectorRuntime(result.runtimeOptions);
      const input = createDirectorInput(this.service, { repositoryRoot: this.config.repositoryRoot, snapshotRoot: snapshots, endpoint: this.config.endpoint, runtimeId: "codex-app-server" });
      return { runtime, input, readiness: result.readiness };
    })();
    this.prepared.set(key, pending); void pending.catch(() => this.prepared.delete(key)); return pending;
  }
  private async startNative(input: DirectorRunInput, options: DirectorStartOptions = {}) {
    this.service.recovery.assertWritable(input.projectId, input.requestId);
    this.service.recovery.assertFreshAuthority(input.projectId, "director_turn", input.turnId);
    const { runtime } = await this.ready(input.projectId);
    this.service.recovery.assertWritable(input.projectId, input.requestId);
    this.service.recovery.assertFreshAuthority(input.projectId, "director_turn", input.turnId);
    return runtime.start(input, { ...options, onEvent: async event => {
      if (event.kind === "runtime_started") this.service.store.transaction(() => {
        invariant(!this.service.store.get("native_model_start", input.turnId), "NATIVE_DISPATCH_ALREADY_RESERVED", "This native turn already has a dispatch reservation; do not replay it");
        this.service.store.insert("native_model_start", input.turnId, input.projectId, { id: input.turnId, projectId: input.projectId, requestId: input.requestId,
          epochId: input.epochId, nativeThreadId: event.nativeThreadId, contextDigest: digest(input.context), inputDigest: directorInputDigest(input), reservedAt: new Date().toISOString() });
      });
      await options.onEvent?.(event);
    } });
  }
}
