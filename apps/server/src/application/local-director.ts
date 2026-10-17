import { SUPPORTED_TOOL_CONTRACTS } from "@openslate/core";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { digest, DomainError, invariant, newId } from "@openslate/core";
import { CODEX_PROTOCOL_VERSION, CodexDirectorRuntime, classifyNativeDiagnostic, setupLocalCodex, verifySkillLock } from "@openslate/director";
import { toolVersion } from "../installation-status.js";
import type { DirectorRunInput, DirectorRuntime, DirectorStartOptions } from "@openslate/director";
import { DirectorSupervisor } from "./director-supervisor.js";
import { FakeWorkflowDirector } from "./fake-director.js";
import { createDirectorInput } from "./director-input.js";
import { directorInputDigest } from "./director-input-identity.js";
import { KeyframeProjector, describeUnattachedKeyframes } from "./keyframe-projector.js";
import { triggerKeyframeReviews } from "./keyframe-review.js";
import { DirectorImageProjector } from "./director-images.js";
import type { SelectedDirectorImage } from "./director-images.js";
import type { ActorContext, NativeDiagnostic, ToolContractVersion } from "@openslate/core";
import { DirectorToolSettings } from "./director-tools-upgrade.js";
import type { DirectorToolsUpgrade } from "./director-tools-upgrade.js";
import type { ProductionService } from "./service.js";
import { createDirectorSkillLock, directorSkillEnvironment } from "./director-capabilities.js";
import type { SkillCapabilityLock } from "@openslate/director";
import { snapshotOwnedTranscriptionData } from "../narration/owned-transcription-records.js";
import { readCodexStartupTimeout, readDirectorRunTimeout } from "./director-run-config.js";
import { logNativeDiagnostic, safeNativeDiagnostic } from "./native-diagnostics.js";
import { findLocalCodexBinary, supportedCodexInstall } from "./codex-binary.js";

export interface LocalDirectorSelection { mode: "fake" | "native"; binaryPath?: string; model?: string; codexHome?: string }
interface SavedSelection { id: string; projectId: string; selection: LocalDirectorSelection; digest: string }
interface SelectionCommand { id: string; projectId: string; selectionDigest: string; state: "pending" | "completed" }
type Setup = typeof setupLocalCodex;
type Ready = Awaited<ReturnType<Setup>>;
interface CodexVersionDiagnostic { code: "DIRECTOR_CODEX_VERSION_MISMATCH"; expectedVersion: string; foundVersion: string | null; binaryPath: string; installPath: string }
interface SuccessfulCodexCheck { binaryPath: string; version: string; checkedAt: string }
/** Diagnostic evidence only: never cached runtime options, native configuration, sign-in data or authority. */
interface SavedCodexCheck {
  id: string; projectId: string; status: "ready" | "blocked"; checkedAt: string;
  modelChoices?: { id: string; label: string }[];
  lastSuccessfulCheck: SuccessfulCodexCheck | null;
  diagnostic: CodexVersionDiagnostic | null;
  nativeDiagnostic?: NativeDiagnostic;
}
export interface LocalDirectorOptions {
  repositoryRoot: string; dataDirectory: string; endpoint: string;
  /** Finite trusted host turn deadline; defaults to the runtime's three minutes. */
  runTimeoutMs?: number;
  /** Trusted host cold native startup deadline; never accepted from a browser command. */
  startupTimeoutMs?: number;
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
  private readonly prepared = new Map<string, Promise<{ runtime: DirectorRuntime; input: ReturnType<typeof createDirectorInput>; readiness: Ready["readiness"]; runtimeOptions: NonNullable<Ready["runtimeOptions"]> }>>();
  private readonly configuring = new Set<string>();
  private readonly modelReadiness = new Map<string, Ready["readiness"]>();
  private readonly modelChecks = new Map<string, Promise<Ready["readiness"]>>();
  private readonly binaryDiagnostics = new Map<string, CodexVersionDiagnostic>();
  private readonly setupEpoch = new Map<string, number>();
  private readonly shutdown = new AbortController();
  private readonly activeNativeRuntimes = new Set<DirectorRuntime>();
  private readonly setupChecks = new Set<Promise<Ready>>();
  readonly defaults: NonNullable<LocalDirectorOptions["defaults"]>;
  private readonly toolSettings: DirectorToolSettings;
  private readonly imageProjector: DirectorImageProjector | null;
  constructor(readonly service: ProductionService, readonly config: LocalDirectorOptions) {
    if (config.runTimeoutMs !== undefined) readDirectorRunTimeout({ OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS: String(config.runTimeoutMs) });
    if (config.startupTimeoutMs !== undefined) readCodexStartupTimeout({ OPENSLATE_CODEX_STARTUP_TIMEOUT_MS: String(config.startupTimeoutMs) });
    this.setup = config.setup ?? setupLocalCodex;
    this.defaults = config.defaults ?? { binaryPath: findLocalCodexBinary(), model: "gpt-6-astra" };
    try { this.imageProjector = config.ffmpegPath ? new KeyframeProjector(service, { ffmpegPath: config.ffmpegPath }) : null; }
    catch (error) { if (!['ENOENT', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; this.imageProjector = null; }
    this.toolSettings = new DirectorToolSettings(service, projectId => this.mode(projectId) === "native"
      ? { repositoryRoot: config.repositoryRoot, snapshotRoot: join(config.dataDirectory, "native", projectId, "workspace", ".agents", "skills"), runtimeId: "codex-app-server" }
      : { repositoryRoot: config.repositoryRoot, snapshotRoot: join(config.dataDirectory, "skill-snapshots"), runtimeId: "fake-workflow-v1" },
      projectId => this.configuring.has(projectId));
    const fakeInput = createDirectorInput(service, { repositoryRoot: config.repositoryRoot, snapshotRoot: join(config.dataDirectory, "skill-snapshots"), endpoint: config.endpoint });
    this.fake = new DirectorSupervisor(service, new FakeWorkflowDirector(service), { mode: "fake", projectFilter: id => this.mode(id) === "fake", prepareInput: async (turn, human, bridge) => describeUnattachedKeyframes(service, await fakeInput(turn, human, bridge), bridge.actor, "scripted_runtime_not_visually_inspected") });
    const proxy: DirectorRuntime = { id: "codex-app-server", start: async (input, options) => this.startNative(input, options) };
    this.native = new DirectorSupervisor(service, proxy, { mode: "native", projectFilter: id => this.mode(id) === "native",
      prepareInput: async (turn, human, bridge, preparation) => {
        const input = await (await this.ready(turn.projectId)).input(turn, human, bridge);
        if (!this.imageProjector && !service.store.get("request_image_selection", turn.requestId)) return describeUnattachedKeyframes(service, input, bridge.actor, "ffmpeg_unavailable");
        invariant(this.imageProjector, "DIRECTOR_IMAGES_UNAVAILABLE", "Local FFmpeg is required to prepare reference images");
        return this.imageProjector.prepare(input, bridge.actor, join(config.dataDirectory, "native", turn.projectId, "workspace"), preparation);
      } });
  }
  mode(projectId: string): "fake" | "native" { return this.service.store.get<SavedSelection>("project_director_selection", projectId)?.selection.mode ?? "fake"; }
  /** No account discovery or model call; sign-in remains unknown on this version-only read. */
  async codexStatus(projectId?: string) {
    const binary = projectId ? this.modelSelection(projectId).binaryPath : this.defaults.binaryPath;
    const version = await toolVersion(binary, "codex");
    return { found: version !== null, version, pinnedVersion: CODEX_PROTOCOL_VERSION, signedIn: null };
  }
  /** Version-only Settings read, including an actionable mismatch before any setup session. */
  async inspectSettings(projectId: string) {
    this.service.store.getProject(projectId);
    const selection = this.modelSelection(projectId), identity = this.modelKey(projectId, selection);
    const version = await toolVersion(selection.binaryPath, "codex");
    const settings = this.settings(projectId), unchanged = identity === this.modelKey(projectId, this.modelSelection(projectId));
    return { ...settings, codexVersion: unchanged ? version : null, codexDiagnostic: settings.codexDiagnostic ??
      (unchanged && version && version !== CODEX_PROTOCOL_VERSION ? this.versionDiagnostic(selection, version) : null) };
  }
  private versionDiagnostic(selection: LocalDirectorSelection, foundVersion: string | null): CodexVersionDiagnostic {
    return { code: "DIRECTOR_CODEX_VERSION_MISMATCH", expectedVersion: CODEX_PROTOCOL_VERSION, foundVersion,
      binaryPath: selection.binaryPath!, installPath: supportedCodexInstall() };
  }
  private recordVersionDiagnostic(projectId: string, selection: LocalDirectorSelection, readiness: Ready["readiness"]) {
    const diagnostic = readiness.issues?.some(issue => issue.code === "SETUP_VERSION_MISMATCH")
      ? this.versionDiagnostic(selection, readiness.binaryVersion?.foundVersion ?? null) : null;
    if (diagnostic) this.binaryDiagnostics.set(projectId, diagnostic); else this.binaryDiagnostics.delete(projectId);
    return diagnostic;
  }
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
      DIRECTOR_GUIDANCE_UNSUPPORTED: "OpenSlate could not verify this project's Director guidance. Saved work is retained. Restore the matching application files, then send a new message.",
      DIRECTOR_GUIDANCE_IN_FLIGHT: "This conversation began with older Director guidance. Send a new message to use the current application; saved work is retained.",
      DIRECTOR_TOOLS_BUSY: "Wait for the current conversation or setup to finish, then send a new message.",
      DIRECTOR_TOOLS_STALE: "Director setup changed while the conversation was being prepared. Send a new message; saved work is retained.",
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
  tick(): void { triggerKeyframeReviews(this.service, (id, actor) => this.enqueue(id, actor)); this.fake.tick(); this.native.tick(); }
  async settle(): Promise<void> { await Promise.all([this.fake.settle(), this.native.settle()]); }
  async close(): Promise<void> {
    this.shutdown.abort();
    await Promise.all([this.fake.close(), this.native.close(), ...[...this.activeNativeRuntimes].map(runtime => runtime.close?.()),
      // Canceled setup is expected, but its native finally/close must finish
      // before the installation can exit and release process ownership.
      Promise.allSettled([...this.setupChecks])]);
  }
  settings(projectId: string) {
    this.service.store.getProject(projectId);
    const saved = this.service.store.get<SavedSelection>("project_director_selection", projectId);
    const busy = this.configuring.has(projectId) || this.conversationBusy(projectId);
    const selection = this.modelSelection(projectId), storedCheck = this.savedCheck(projectId, selection);
    const catalog = this.modelReadiness.get(this.modelKey(projectId, selection)) ?? storedCheck;
    return { selection: saved?.selection ?? { mode: "fake" as const }, selectionDigest: saved?.digest ?? digest({ mode: "fake" }),
      busy, changeAvailable: !busy, changeAppliesTo: "next_turn" as const, defaults: this.defaults, locked: this.locked(projectId),
      modelCalls: this.service.store.list("native_model_start", projectId).length,
      modelChoices: structuredClone(catalog?.modelChoices ?? []), modelCatalogStatus: !catalog || catalog.status === "ready" && catalog.modelChoices === undefined ? "unchecked" as const
        : catalog.status === "ready" ? "ready" as const : "blocked" as const, modelCatalogCheckedAt: catalog?.checkedAt ?? null,
      lastSuccessfulCheck: structuredClone(storedCheck?.lastSuccessfulCheck ?? null),
      nativeDiagnostic: safeNativeDiagnostic(catalog?.nativeDiagnostic) ?? (catalog?.status === "blocked" ? { category: "native_unknown" as const } : null),
      codexDiagnostic: this.binaryDiagnostics.has(projectId) ? structuredClone(this.binaryDiagnostics.get(projectId)!) : storedCheck?.diagnostic ?? null };
  }
  private modelSelection(projectId: string): LocalDirectorSelection {
    const selection = this.service.store.get<SavedSelection>("project_director_selection", projectId)?.selection;
    return selection?.mode === "native" ? selection : { mode: "native", ...this.defaults };
  }
  private modelKey(projectId: string, selection: LocalDirectorSelection): string { return digest({ projectId, selection }); }

  private checkKey(projectId: string, selection: LocalDirectorSelection): string {
    // Bump setupRevision whenever the trusted setup requirements change. A prior check never prepares
    // a runtime: prepare() still runs the complete local check before the next native conversation.
    return digest({ projectId, selection, setupRevision: 1, version: CODEX_PROTOCOL_VERSION,
      repositoryRoot: resolve(this.config.repositoryRoot), dataDirectory: resolve(this.config.dataDirectory),
      nativeHome: homedir(), runTimeoutMs: this.config.runTimeoutMs ?? null,
      startupTimeoutMs: this.config.startupTimeoutMs ?? null });
  }
  private savedCheck(projectId: string, selection: LocalDirectorSelection): SavedCodexCheck | undefined {
    return this.service.store.get<SavedCodexCheck>("director_local_check", this.checkKey(projectId, selection));
  }
  private saveCheck(projectId: string, selection: LocalDirectorSelection, readiness: Ready["readiness"]) {
    this.service.recovery.assertWritable(projectId);
    const id = this.checkKey(projectId, selection), previous = this.savedCheck(projectId, selection);
    const checkedAt = readiness.checkedAt ?? new Date().toISOString();
    const lastSuccessfulCheck = readiness.status === "ready"
      ? { binaryPath: selection.binaryPath!, version: CODEX_PROTOCOL_VERSION, checkedAt } : previous?.lastSuccessfulCheck ?? null;
    const diagnostic = this.recordVersionDiagnostic(projectId, selection, readiness);
    const nativeDiagnostic = safeNativeDiagnostic(readiness.nativeDiagnostic) ?? (readiness.status === "blocked" ? { category: "native_unknown" as const } : undefined);
    this.service.store.put<SavedCodexCheck>("director_local_check", id, projectId, { id, projectId, status: readiness.status, checkedAt,
      ...(readiness.modelChoices === undefined ? {} : { modelChoices: structuredClone(readiness.modelChoices) }), lastSuccessfulCheck, diagnostic,
      ...(nativeDiagnostic ? { nativeDiagnostic } : {}) });
    if (nativeDiagnostic) logNativeDiagnostic("director_setup", projectId, nativeDiagnostic);
  }

  /** Read-only native preflight; only local diagnostic evidence is retained. No selection, project, thread or turn is written. */
  async models(projectId: string) {
    this.service.store.getProject(projectId); this.service.recovery.assertWritable(projectId);
    if (this.configuring.has(projectId) || this.conversationBusy(projectId)) return this.settings(projectId);
    const selection = this.modelSelection(projectId), identity = this.modelKey(projectId, selection), setupEpoch = this.setupEpoch.get(projectId) ?? 0;
    let pending = this.modelChecks.get(identity);
    if (!pending) {
      pending = this.checkLocal(projectId, selection).then(result => {
        this.service.recovery.assertWritable(projectId);
        if (this.modelKey(projectId, this.modelSelection(projectId)) === identity && !this.configuring.has(projectId)
          && setupEpoch === (this.setupEpoch.get(projectId) ?? 0)) {
          this.modelReadiness.set(identity, structuredClone(result.readiness));
          this.saveCheck(projectId, selection, result.readiness);
        }
        return result.readiness;
      });
      this.modelChecks.set(identity, pending);
      void pending.finally(() => { if (this.modelChecks.get(identity) === pending) this.modelChecks.delete(identity); }).catch(() => {});
    }
    await pending; return this.settings(projectId);
  }
  private conversationBusy(projectId: string): boolean {
    return !!this.service.store.db.prepare("SELECT 1 FROM entities WHERE kind='director_turn' AND project_id=? AND json_extract(body,'$.state') IN ('queued','running') LIMIT 1").get(projectId);
  }
  /** Explicit local choice for the next turn. Never interrupts or resumes an existing turn. */
  async changeSelection(projectId: string, supplied: { expectedSelectionDigest: string; selection: LocalDirectorSelection }, key: string) {
    const input = snapshotOwnedTranscriptionData(supplied, 16384);
    invariant(input && Object.keys(input).length === 2 && /^[a-f0-9]{64}$/.test(input.expectedSelectionDigest)
      && typeof key === "string" && key.length > 0 && key.length <= 160, "VALIDATION_ERROR", "Choose the displayed director and one command identity");
    const selection = this.validate(input.selection), identity = digest(selection), requestDigest = digest(input), store = this.service.store;
    this.service.recovery.assertWritable(projectId); store.getProject(projectId);
    const scope = `local-user:${projectId}:director-change`;
    const previous = store.commandReplay<{ selectionDigest: string }>(scope, key, requestDigest);
    if (previous) return { ...this.settings(projectId), readiness: null, readinessSelectionDigest: null,
      selectionMatchesCommand: this.settings(projectId).selectionDigest === previous.result.selectionDigest };
    invariant(!this.configuring.has(projectId) && !this.conversationBusy(projectId), "DIRECTOR_SETUP_BUSY", "Wait for the current conversation and setup to finish");
    const before = this.settings(projectId);
    invariant(before.selectionDigest === input.expectedSelectionDigest, "DIRECTOR_SELECTION_STALE", "Director choices changed; refresh before applying");
    const latestLock = () => store.list<{ id: string; lock: SkillCapabilityLock }>("director_skill_lock", projectId).at(-1);
    const oldLock = latestLock();
    const turns = () => store.db.prepare("SELECT count(*) count,coalesce(max(rowid),0) newest FROM entities WHERE kind='director_turn' AND project_id=?").get(projectId);
    const turnDigest = digest(turns());
    this.configuring.add(projectId);
    try {
      const prepared = selection.mode === "native" ? await this.prepare(projectId, selection) : null;
      const changedMode = before.selection.mode !== selection.mode;
      invariant(!oldLock || (SUPPORTED_TOOL_CONTRACTS as readonly string[]).includes(oldLock.lock.compatibility.toolContract), "CAPABILITY_MISMATCH", "Saved director guidance version is unsupported");
      const replacement = changedMode && oldLock ? createDirectorSkillLock({ repositoryRoot: this.config.repositoryRoot,
        snapshotRoot: selection.mode === "native" ? join(this.config.dataDirectory, "native", projectId, "workspace", ".agents", "skills") : join(this.config.dataDirectory, "skill-snapshots"),
        runtimeId: selection.mode === "native" ? "codex-app-server" : "fake-workflow-v1" }, oldLock.lock.compatibility.toolContract as ToolContractVersion).lock : null;
      store.transaction(() => {
        this.service.recovery.assertWritable(projectId);
        store.command(scope, key, requestDigest, () => {
          invariant(!this.conversationBusy(projectId) && digest(turns()) === turnDigest, "DIRECTOR_SETUP_BUSY", "A conversation started during setup; wait and refresh");
          invariant(this.settings(projectId).selectionDigest === input.expectedSelectionDigest && latestLock()?.id === oldLock?.id,
            "DIRECTOR_SELECTION_STALE", "Director choices or guidance changed during setup");
          if (identity !== before.selectionDigest) {
            if (replacement) {
              store.insert("director_skill_lock", replacement.id, projectId, { id: replacement.id, projectId, lock: replacement });
              store.appendEvent(projectId, "director.lock_installed", { lockId: replacement.id, lockDigest: replacement.lockDigest,
                previousLockId: oldLock!.id, source: "local_director_change", principalId: "local-user" });
            }
            store.put("project_director_selection", projectId, projectId, { id: projectId, projectId, selection, digest: identity });
            for (const epoch of store.list<{ id: string; state: string }>("epoch", projectId)) if (epoch.state !== "revoked")
              store.put("epoch", epoch.id, projectId, { ...epoch, state: "revoked" });
            store.appendEvent(projectId, "director.configured", { mode: selection.mode, model: selection.model ?? null,
              selectionDigest: identity, appliesTo: "next_turn", principalId: "local-user" });
          }
          return { selectionDigest: identity };
        });
      });
      this.configuring.delete(projectId);
      return { ...this.settings(projectId), readiness: prepared?.readiness ?? null, readinessSelectionDigest: identity, selectionMatchesCommand: true };
    } finally { this.configuring.delete(projectId); }
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
    this.setupEpoch.set(projectId, (this.setupEpoch.get(projectId) ?? 0) + 1);
    const pending = (async () => {
      const root = resolve(this.config.dataDirectory, "native", projectId), projection = join(root, "workspace"), snapshots = join(projection, ".agents", "skills"), storage = join(root, "runtime");
      for (const path of [projection, snapshots, storage]) mkdirSync(path, { recursive: true, mode: 0o700 });
      const result = await this.checkLocal(projectId, selection);
      this.modelReadiness.set(this.modelKey(projectId, selection), structuredClone(result.readiness));
      this.saveCheck(projectId, selection, result.readiness);
      const diagnostic = this.binaryDiagnostics.get(projectId);
      if (diagnostic && result.readiness.issues?.some(issue => issue.code === "SETUP_VERSION_MISMATCH"))
        throw new DomainError(diagnostic.code, `Codex ${diagnostic.expectedVersion} is required; found ${diagnostic.foundVersion ?? "an unrecognized version"} at ${diagnostic.binaryPath}. The supported installation is ${diagnostic.installPath}.`, diagnostic);
      if (result.readiness.status !== "ready" || !result.runtimeOptions)
        throw new DomainError("DIRECTOR_SETUP_REQUIRED", "Codex setup checks did not pass. Verify the selected binary, model and existing Codex sign-in.",
          { nativeDiagnostic: safeNativeDiagnostic(result.readiness.nativeDiagnostic) ?? { category: "native_unknown" } });
      const runtime = this.config.makeRuntime?.(result) ?? new CodexDirectorRuntime(result.runtimeOptions);
      const input = createDirectorInput(this.service, { repositoryRoot: this.config.repositoryRoot, snapshotRoot: snapshots, endpoint: this.config.endpoint, runtimeId: "codex-app-server", freshTurnGuidance: this.toolSettings });
      return { runtime, input, readiness: result.readiness, runtimeOptions: result.runtimeOptions };
    })();
    this.prepared.set(key, pending); void pending.catch(() => this.prepared.delete(key)); return pending;
  }
  private checkLocal(projectId: string, selection: LocalDirectorSelection): Promise<Ready> {
    invariant(!this.shutdown.signal.aborted, "DIRECTOR_SHUTTING_DOWN", "Director is shutting down");
    const root = resolve(this.config.dataDirectory, "native", projectId), projection = join(root, "workspace");
    const checking = this.setup({ command: { file: selection.binaryPath! }, model: selection.model!, nativeHome: homedir(), codexHome: selection.codexHome ?? join(homedir(), ".codex"),
      limits: { ...(this.config.runTimeoutMs === undefined ? {} : { runTimeoutMs: this.config.runTimeoutMs }),
        ...(this.config.startupTimeoutMs === undefined ? {} : { startupTimeoutMs: this.config.startupTimeoutMs }) },
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, SHELL: "/bin/sh", NO_COLOR: "1", CI: "1" },
      directories: { projection, snapshots: join(projection, ".agents", "skills"), storage: join(root, "runtime") } }, { signal: this.shutdown.signal }).then(result => {
      invariant(!this.shutdown.signal.aborted, "DIRECTOR_SHUTTING_DOWN", "Director is shutting down");
      const nativeDiagnostic = safeNativeDiagnostic(result.readiness.nativeDiagnostic) ?? (result.readiness.status === "blocked"
        ? classifyNativeDiagnostic({ code: result.readiness.issues?.[0]?.code }) : undefined);
      // Native prose is never an API payload, including errors injected by a host adapter.
      return { ...result, readiness: { ...result.readiness, ...(nativeDiagnostic ? { nativeDiagnostic } : {}),
        ...(result.readiness.issues ? { issues: result.readiness.issues.map(issue => ({ code: issue.code, message: "Codex setup check did not pass." })) } : {}) } };
    });
    this.setupChecks.add(checking);
    void checking.finally(() => this.setupChecks.delete(checking)).catch(() => {});
    return checking;
  }
  private async startNative(input: DirectorRunInput, options: DirectorStartOptions = {}) {
    invariant(!this.shutdown.signal.aborted, "DIRECTOR_SHUTTING_DOWN", "Director is shutting down");
    this.service.recovery.assertWritable(input.projectId, input.requestId);
    this.service.recovery.assertFreshAuthority(input.projectId, "director_turn", input.turnId);
    const prepared = await this.ready(input.projectId);
    let runtime = prepared.runtime;
    if (prepared.runtimeOptions.policy) {
      // Immutable packages are retained for old epochs and receipts. Packages
      // installed after setup must not become additional native instructions.
      const configuration = this.toolSettings.configuration(input.projectId);
      const paths = new Set<string>();
      for (const row of this.service.store.list<{ lock: SkillCapabilityLock }>("director_skill_lock", input.projectId)) {
        if (!row.lock.bindings.some(binding => binding.kind === "runtime" && binding.id === "codex-app-server")) continue;
        invariant((SUPPORTED_TOOL_CONTRACTS as readonly string[]).includes(row.lock.compatibility.toolContract), "DIRECTOR_GUIDANCE_UNSUPPORTED", "Saved Director guidance is unsupported");
        const environment = directorSkillEnvironment(configuration, row.lock.compatibility.toolContract as ToolContractVersion);
        for (const skill of verifySkillLock(row.lock, environment)) paths.add(skill.entryPath);
      }
      const policy = prepared.runtimeOptions.policy, configured = policy.config["skills.config"];
      const disabled = new Map<string, { path: string; enabled: false }>();
      if (Array.isArray(configured)) for (const row of configured) {
        invariant(row && typeof row === "object" && !Array.isArray(row) && typeof row.path === "string" && row.enabled === false,
          "CAPABILITY_MISMATCH", "Saved native setup has an unexpected skill selection");
        disabled.set(row.path, { path: row.path, enabled: false });
      }
      const changed = [...paths].some(path => !disabled.has(path));
      if (changed) {
        for (const path of paths) disabled.set(path, { path, enabled: false });
        const result: Ready = { readiness: prepared.readiness, runtimeOptions: { ...prepared.runtimeOptions,
          policy: { ...policy, config: { ...policy.config, "skills.config": [...disabled.values()] } } } };
        runtime = this.config.makeRuntime?.(result) ?? new CodexDirectorRuntime(result.runtimeOptions!);
      }
    }
    this.service.recovery.assertWritable(input.projectId, input.requestId);
    this.service.recovery.assertFreshAuthority(input.projectId, "director_turn", input.turnId);
    invariant(!this.shutdown.signal.aborted, "DIRECTOR_SHUTTING_DOWN", "Director is shutting down");
    this.activeNativeRuntimes.add(runtime);
    try { return await runtime.start(input, { ...options, onEvent: async event => {
      if (event.kind === "runtime_started") this.service.store.transaction(() => {
        invariant(!this.service.store.get("native_model_start", input.turnId), "NATIVE_DISPATCH_ALREADY_RESERVED", "This native turn already has a dispatch reservation; do not replay it");
        this.service.store.insert("native_model_start", input.turnId, input.projectId, { id: input.turnId, projectId: input.projectId, requestId: input.requestId,
          epochId: input.epochId, nativeThreadId: event.nativeThreadId, contextDigest: digest(input.context), inputDigest: directorInputDigest(input), reservedAt: new Date().toISOString() });
      });
      await options.onEvent?.(event);
    } }); } finally { this.activeNativeRuntimes.delete(runtime); }
  }
}
