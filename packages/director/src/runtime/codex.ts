import { execFile } from "node:child_process";
import { TOOL_NAMES } from "@openslate/core";
import { normalizePermissionProfile, toml, validateOptions } from "./policy.js";
import type { CodexConfigValue, CodexDirectorOptions } from "./policy.js";
import { CodexTransport, timeout, type RpcMessage } from "./transport.js";
import { prepareDirectorImages } from "./images.js";
import { fault, identity, object, requireRuntime, RuntimeFault, validateInput } from "./validation.js";
import type { DirectorQuestion, DirectorRunInput, DirectorRunResult, DirectorRuntime, DirectorRuntimeEvent, DirectorStartOptions } from "./types.js";

const SERVER = "openslate";
// These reduce native surface area; they are not a filesystem/credential isolation proof.
const DISABLED = ["apps", "plugins", "remote_plugin", "hooks", "shell_tool", "shell_snapshot", "unified_exec", "browser_use",
  "browser_use_external", "computer_use", "in_app_browser", "image_generation", "memories", "multi_agent", "multi_agent_v2",
  "skill_search", "skill_mcp_dependency_install", "tool_suggest", "sleep_tool", "workspace_dependencies", "code_mode", "unbounded_connection_retries"];

function redact(value: string, secrets: readonly string[]): string {
  for (const secret of secrets) if (secret) value = value.replaceAll(secret, "[redacted]");
  return value;
}
function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, i) => contains(actual[i], item));
  if (expected !== null && typeof expected === "object") return Object.entries(expected).every(([key, value]) => contains(object(actual)[key], value));
  return actual === expected;
}
function equal(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, i) => equal(actual[i], item));
  if (expected !== null && typeof expected === "object") {
    const keys = Object.keys(expected);
    return actual !== null && typeof actual === "object" && !Array.isArray(actual) && Object.keys(actual).length === keys.length &&
      Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && equal(object(actual)[key], value));
  }
  return actual === expected;
}
function configuredProfile(config: Readonly<Record<string, CodexConfigValue>>, id: string): unknown {
  const permissions = structuredClone(object(config.permissions));
  for (const [key, value] of Object.entries(config)) {
    if (!key.startsWith("permissions.")) continue;
    const parts = key.split(".").slice(1); let parent = permissions;
    for (const part of parts.slice(0, -1)) {
      if (!Object.hasOwn(parent, part) || parent[part] === null || typeof parent[part] !== "object")
        Object.defineProperty(parent, part, { value: {}, writable: true, configurable: true, enumerable: true });
      parent = object(parent[part]);
    }
    Object.defineProperty(parent, parts.at(-1)!, { value: structuredClone(value), writable: true, configurable: true, enumerable: true });
  }
  return permissions[id];
}
function questions(value: unknown): DirectorQuestion[] {
  requireRuntime(Array.isArray(value) && value.length > 0 && value.length <= 3, "RUNTIME_INPUT_UNSUPPORTED", "Native question shape is unsupported");
  return value.map(raw => {
    const question = object(raw);
    requireRuntime(question.isSecret !== true && ["id", "header", "question"].every(key => typeof question[key] === "string" &&
      (question[key] as string).length <= 4000), "RUNTIME_INPUT_UNSUPPORTED", "Native secret or malformed questions are unsupported");
    const choices = question.options === null || question.options === undefined ? [] : question.options;
    requireRuntime(Array.isArray(choices) && choices.length <= 10, "RUNTIME_INPUT_UNSUPPORTED", "Too many native question options");
    return { id: question.id as string, header: question.header as string, question: question.question as string,
      options: choices.map(rawChoice => { const choice = object(rawChoice);
        requireRuntime(typeof choice.label === "string" && typeof choice.description === "string" &&
          choice.label.length <= 1000 && choice.description.length <= 4000, "RUNTIME_INPUT_UNSUPPORTED", "Malformed native question option");
        return { label: choice.label, description: choice.description }; }) };
  });
}

/**
 * One native process per authority epoch/run. Persistent thread IDs never carry application authority.
 * Protocol shape is pinned to the 0.153.4 compatibility fixtures, including experimental named permissions.
 * Reference: https://developers.openai.com/codex/app-server . A new native version requires new evidence.
 */
export class CodexDirectorRuntime implements DirectorRuntime {
  readonly id = "codex-app-server";
  #options: ReturnType<typeof validateOptions>;
  #projects = new Set<string>();

  constructor(options: CodexDirectorOptions) { this.#options = validateOptions(options); }

  async start(supplied: DirectorRunInput, options: DirectorStartOptions = {}): Promise<DirectorRunResult> {
    const input = validateInput(supplied); const base = identity(input);
    requireRuntime(!this.#projects.has(input.projectId), "RUNTIME_BUSY", "This project already has an active director run");
    this.#projects.add(input.projectId);
    const config = this.#options; const secrets = [input.bridge.credential, ...Object.values(config.env).filter(value => value.length >= 12)];
    let nativeThreadId: string | undefined; let nativeTurnId: string | undefined;
    let dispatched = false; let transport: CodexTransport | undefined; let terminalStatus: DirectorRunResult["status"] | undefined;
    let terminalError: RuntimeFault | undefined; let stopReason: RuntimeFault | undefined;
    let interruptionRequested = false;
    let delivery: Promise<void> = Promise.resolve(); let queued = 0; let deliveryFailed = false;
    const messages: { text: string; phase: string }[] = []; const early: RpcMessage[] = [];
    const cancellation = new AbortController();
    let resolveTerminal!: () => void; const terminal = new Promise<void>(resolve => { resolveTerminal = resolve; });
    let resolveStop!: () => void; const stopping = new Promise<void>(resolve => { resolveStop = resolve; });
    const stop = (reason: RuntimeFault) => { if (!stopReason) { stopReason = reason; cancellation.abort(); resolveStop(); } };
    const abort = () => stop(new RuntimeFault("RUNTIME_ABORTED", "Director run was cancelled"));
    const emit = (event: DirectorRuntimeEvent) => {
      if (!options.onEvent || deliveryFailed) return;
      if (++queued > config.limits.eventQueue) { stop(new RuntimeFault("RUNTIME_EVENT_LIMIT", "Runtime event consumer is too slow")); return; }
      delivery = delivery.then(async () => {
        if (deliveryFailed) return;
        await timeout(Promise.resolve().then(() => options.onEvent!(event)), config.limits.eventTimeoutMs, "RUNTIME_EVENT_TIMEOUT");
      }).catch(() => { deliveryFailed = true; stop(new RuntimeFault("RUNTIME_EVENT_CONSUMER_FAILED", "Runtime event consumer failed")); }).finally(() => { queued--; });
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    const runTimer = setTimeout(() => stop(new RuntimeFault("RUNTIME_RUN_TIMEOUT", "Director run exceeded its time limit")), config.limits.runTimeoutMs);
    let result: DirectorRunResult | undefined;
    try {
      requireRuntime(!options.signal?.aborted, "RUNTIME_ABORTED", "Director run was cancelled");
      const images = await prepareDirectorImages(input.images, config.cwd);
      await this.verifyVersion(cancellation.signal);
      if (stopReason) throw stopReason;
      const launch = this.launchConfig(input);
      const onMessage = (message: RpcMessage): void => {
        const params = object(message.params);
        if (dispatched && nativeTurnId === undefined && params.threadId === nativeThreadId && message.method !== "turn/started") {
          requireRuntime(early.length < 128, "RUNTIME_EVENT_LIMIT", "Too many native events before turn acknowledgment");
          early.push(message); return;
        }
        if (message.id !== undefined) {
          // Never turn a native approval, auth refresh or elicitation into application authority.
          transport!.rejectServerRequest(message.id);
          if (message.method === "item/tool/requestUserInput" && params.threadId === nativeThreadId && params.turnId === nativeTurnId) {
            try { emit({ ...base, kind: "pending_input", nativeRequestId: String(message.id),
              questions: questions(JSON.parse(redact(JSON.stringify(params.questions), secrets))) }); }
            catch { emit({ ...base, kind: "diagnostic", code: "RUNTIME_INPUT_UNSUPPORTED", message: "Native question could not be represented safely" }); }
            stop(new RuntimeFault("RUNTIME_INPUT_REQUIRED", "Native question surfaced; resume through a new application request"));
          } else {
            emit({ ...base, kind: "diagnostic", code: "RUNTIME_INTERACTIVE_DENIED", message: "Native approval or interactive request was denied" });
            stop(new RuntimeFault("RUNTIME_INTERACTIVE_DENIED", "Unexpected native interactive request"));
          }
          return;
        }
        if (params.threadId !== nativeThreadId || !dispatched) return;
        if (message.method === "turn/started") {
          const turn = object(params.turn);
          if (typeof turn.id === "string" && nativeTurnId === undefined) nativeTurnId = turn.id;
        }
        const eventTurnId = params.turnId ?? object(params.turn).id;
        if (eventTurnId !== nativeTurnId) return;
        if (message.method === "item/completed") {
          const item = object(params.item);
          if (item.type === "agentMessage" && typeof item.text === "string") {
            const text = redact(item.text, secrets);
            requireRuntime(Buffer.byteLength(text) <= 1024 * 1024, "RUNTIME_OUTPUT_LIMIT", "Assistant message exceeds its byte limit");
            const phase = item.phase === "commentary" ? "commentary" : ["final", "final_answer", "finalAnswer"].includes(String(item.phase)) ? "final" : "unknown";
            messages.push({ text, phase }); emit({ ...base, kind: "assistant_message", text, phase });
          }
        }
        if (message.method === "turn/completed") {
          const turn = object(params.turn);
          requireRuntime(["completed", "interrupted", "failed"].includes(String(turn.status)), "RUNTIME_PROTOCOL_INVALID", "Unknown native terminal status");
          terminalStatus = turn.status as "completed" | "interrupted" | "failed";
          if (terminalStatus === "failed") terminalError = new RuntimeFault("RUNTIME_TURN_FAILED", "Native director turn failed");
          resolveTerminal();
        }
      };
      transport = new CodexTransport({ command: config.command.file, args: [...(config.command.args ?? []), "app-server", "--strict-config",
        ...Object.entries(launch).flatMap(([key, value]) => ["-c", `${key}=${toml(value)}`])],
      cwd: config.cwd, env: { ...config.env }, limits: config.limits, secrets, onMessage });
      const rpc = (method: string, params: unknown) => {
        if (stopReason) return Promise.reject(stopReason);
        return transport!.request(method, params, cancellation.signal);
      };
      await rpc("initialize", { clientInfo: { name: "openslate", version: "1" }, capabilities: { experimentalApi: true } });
      transport.notification("initialized");
      await this.preflight(transport, input, cancellation.signal);
      if (stopReason) throw stopReason;
      const opened = object(await rpc(input.resumeThreadId ? "thread/resume" : "thread/start", {
        ...(input.resumeThreadId ? { threadId: input.resumeThreadId, excludeTurns: true } : { ephemeral: false, historyMode: "legacy" }),
        cwd: config.cwd, model: config.model, approvalPolicy: "never", permissions: config.policy.id,
        baseInstructions: "You are OpenSlate's director. Use supplied immutable skills and application context. OpenSlate owns creative state, authorization, receipts and execution. Propose changes only through the configured OpenSlate tools.",
        developerInstructions: "Use canonical application context after every restart. Never replay side effects from native history. Human media review and generation grants can only come from OpenSlate. Do not retry unresolved tool outcomes.",
      }));
      const thread = object(opened.thread);
      requireRuntime(typeof thread.id === "string" && (!input.resumeThreadId || thread.id === input.resumeThreadId), "RUNTIME_PROTOCOL_INVALID", "Native thread identity differs from request");
      nativeThreadId = thread.id;
      requireRuntime(object(opened.activePermissionProfile).id === config.policy.id, "RUNTIME_POLICY_MISMATCH", "Native runtime did not select the configured permission profile");
      requireRuntime(Array.isArray(opened.instructionSources) && opened.instructionSources.length === 0, "RUNTIME_INSTRUCTIONS_UNEXPECTED", "Unexpected inherited native instructions");
      await this.catalog(transport, nativeThreadId, cancellation.signal);
      emit({ ...base, kind: "runtime_started", nativeThreadId });
      await delivery; if (stopReason) throw stopReason;
      dispatched = true;
      const started = object(await rpc("turn/start", { threadId: nativeThreadId,
        input: [{ type: "text", text: input.text }, ...input.skills.map(skill => ({ type: "skill", ...skill })), ...images],
        additionalContext: { openslate: { kind: "application", value: input.context } },
        effort: "low", permissions: config.policy.id, approvalPolicy: "never" }));
      const turn = object(started.turn);
      requireRuntime(typeof turn.id === "string" && (nativeTurnId === undefined || nativeTurnId === turn.id), "RUNTIME_PROTOCOL_INVALID", "Native turn identity differs from notification");
      nativeTurnId = turn.id;
      emit({ ...base, kind: "turn_started", nativeThreadId, nativeTurnId });
      for (const message of early.splice(0)) onMessage(message);
      await Promise.race([terminal, stopping, transport.failed.then(error => { throw error; })]);
      if (stopReason && !terminalStatus) { interruptionRequested = true; await this.interrupt(transport, nativeThreadId, nativeTurnId, terminal); }
      await delivery;
      if (!terminalStatus) throw stopReason ?? new RuntimeFault("RUNTIME_COMPLETION_UNKNOWN", "Native completion is unknown");
      result = { ...base, status: terminalStatus, text: this.finalText(messages), dispatched,
        nativeThreadId, nativeTurnId, ...((terminalError ?? stopReason) ? { error: { code: (terminalError ?? stopReason)!.code, message: (terminalError ?? stopReason)!.message } } : {}) };
    } catch (error) {
      const problem = stopReason ?? fault(error);
      if (transport && dispatched && nativeThreadId && nativeTurnId && !terminalStatus && !interruptionRequested) {
        await this.interrupt(transport, nativeThreadId, nativeTurnId, terminal).catch(() => {});
      }
      const status = terminalStatus ?? (dispatched ? "unknown" : problem.code === "RUNTIME_ABORTED" ? "interrupted" : "failed");
      result = { ...base, status, text: this.finalText(messages), dispatched,
        ...(nativeThreadId ? { nativeThreadId } : {}), ...(nativeTurnId ? { nativeTurnId } : {}), error: { code: problem.code, message: problem.message } };
    } finally {
      clearTimeout(runTimer); options.signal?.removeEventListener("abort", abort);
      if (transport) {
        try { await transport.close(); }
        catch {
          const error = { code: "RUNTIME_CLEANUP_FAILED", message: "Native process cleanup was not confirmed" };
          result = { ...base, ...result, text: result?.text ?? "", dispatched, status: dispatched ? "unknown" : "failed", error };
          emit({ ...base, kind: "diagnostic", ...error });
        }
        const diagnostic = transport.diagnostics();
        if (diagnostic && stopReason) emit({ ...base, kind: "diagnostic", code: "RUNTIME_STDERR", message: diagnostic });
      }
      await delivery; this.#projects.delete(input.projectId);
    }
    if (deliveryFailed || stopReason?.code === "RUNTIME_EVENT_LIMIT") {
      result = { ...base, ...result, text: result?.text ?? "", dispatched, status: dispatched ? "unknown" : "failed",
        error: { code: "RUNTIME_EVENT_CONSUMER_FAILED", message: "Runtime events were not completely delivered" } };
    }
    requireRuntime(result, "RUNTIME_FAILED", "Director runtime produced no result");
    return result;
  }
  private finalText(messages: { text: string; phase: string }[]): string {
    const final = messages.filter(message => message.phase === "final");
    return (final.length ? final : messages).map(message => message.text).join("\n");
  }
  private verifyVersion(signal?: AbortSignal): Promise<void> {
    const value = this.#options;
    return new Promise((resolve, reject) => {
      execFile(value.command.file, [...(value.command.args ?? []), "--version"], {
        cwd: value.cwd, env: { ...value.env }, timeout: value.limits.requestTimeoutMs, killSignal: "SIGKILL", maxBuffer: 4096,
        ...(signal ? { signal } : {}),
      }, (error, stdout) => {
        if (error) reject(new RuntimeFault(signal?.aborted ? "RUNTIME_ABORTED" : "RUNTIME_VERSION_FAILED", "Pinned native version could not be checked"));
        else if (stdout.trim() !== `codex-cli ${value.runtimeVersion}`) reject(new RuntimeFault("RUNTIME_VERSION_MISMATCH", "Native binary does not match the pinned version"));
        else resolve();
      });
    });
  }
  private launchConfig(input: DirectorRunInput): Record<string, CodexConfigValue> {
    const config: Record<string, CodexConfigValue> = { ...this.#options.policy.config,
      model: this.#options.model, model_reasoning_effort: "low", approval_policy: "never", web_search: "disabled", project_doc_max_bytes: 0,
      "analytics.enabled": false, "feedback.enabled": false, "history.persistence": "none", check_for_update_on_startup: false,
      "shell_environment_policy.inherit": "none", "shell_environment_policy.experimental_use_profile": false,
      "features.code_mode_host": true, "features.skip_host_skill_discovery": true,
      "features.default_mode_request_user_input": true,
      "skills.config": [...(Array.isArray(this.#options.policy.config["skills.config"])
        ? this.#options.policy.config["skills.config"].filter(value => object(value).enabled === false &&
          !input.skills.some(skill => skill.path === object(value).path)) : []),
      ...input.skills.map(skill => ({ path: skill.path, enabled: true }))],
      [`mcp_servers.${SERVER}.command`]: process.execPath, [`mcp_servers.${SERVER}.args`]: [input.bridge.entrypoint],
      [`mcp_servers.${SERVER}.enabled`]: true, [`mcp_servers.${SERVER}.required`]: true,
      [`mcp_servers.${SERVER}.env`]: { OPENSLATE_BRIDGE_ENDPOINT: input.bridge.endpoint, OPENSLATE_BRIDGE_PROJECT_ID: input.projectId, OPENSLATE_BRIDGE_CREDENTIAL: input.bridge.credential },
    };
    for (const feature of DISABLED) config[`features.${feature}`] = false;
    for (const tool of TOOL_NAMES) config[`mcp_servers.${SERVER}.tools.${tool}.approval_mode`] = "approve";
    return config;
  }
  private async preflight(transport: CodexTransport, input: DirectorRunInput, signal?: AbortSignal): Promise<void> {
    const config = object(object(await transport.request("config/read", { cwd: this.#options.cwd, includeLayers: false }, signal)).config);
    const enabled = Object.entries(object(config.mcp_servers)).filter(([, value]) => object(value).enabled !== false);
    requireRuntime(enabled.length === 1 && enabled[0]![0] === SERVER, "RUNTIME_CATALOG_UNEXPECTED", "Unexpected enabled native MCP server");
    const bridge = object(enabled[0]![1]);
    requireRuntime(bridge.command === process.execPath && contains(bridge.args, [input.bridge.entrypoint]) && bridge.required === true &&
      equal(bridge.env, { OPENSLATE_BRIDGE_ENDPOINT: input.bridge.endpoint, OPENSLATE_BRIDGE_PROJECT_ID: input.projectId,
        OPENSLATE_BRIDGE_CREDENTIAL: input.bridge.credential }) &&
      TOOL_NAMES.every(name => object(object(bridge.tools)[name]).approval_mode === "approve"),
    "RUNTIME_BRIDGE_MISMATCH", "Native bridge configuration differs from the fixed request binding");
    const policy = this.#options.policy;
    // Compare the complete selected profile: a subset check would admit unexpected grant roots.
    requireRuntime(config.default_permissions === policy.id && equal(normalizePermissionProfile(object(config.permissions)[policy.id]), normalizePermissionProfile(configuredProfile(policy.config, policy.id))),
      "RUNTIME_POLICY_MISMATCH", "Effective native permissions differ from the exact configured profile");
    const features = object(config.features);
    requireRuntime(features.code_mode_host === true && features.default_mode_request_user_input === true && DISABLED.every(name => features[name] === false), "RUNTIME_CONFIG_MISMATCH", "Native capability configuration differs from expected settings");
    const data = object(await transport.request("skills/list", { cwds: [this.#options.cwd], forceReload: true }, signal)).data;
    requireRuntime(Array.isArray(data), "RUNTIME_PROTOCOL_INVALID", "Native skill catalog is missing");
    const found: { name: unknown; path: unknown }[] = [];
    for (const raw of data) { const row = object(raw);
      requireRuntime(Array.isArray(row.skills) && Array.isArray(row.errors) && row.errors.length === 0, "RUNTIME_SKILLS_INVALID", "Native skill discovery failed");
      for (const rawSkill of row.skills) { const skill = object(rawSkill); if (skill.enabled !== false) found.push({ name: skill.name, path: skill.path }); }
    }
    const key = (skill: { name: unknown; path: unknown }) => JSON.stringify([skill.name, skill.path]);
    requireRuntime(JSON.stringify(found.map(key).sort()) === JSON.stringify(input.skills.map(key).sort()), "RUNTIME_SKILLS_UNEXPECTED", "Native skill catalog differs from pinned input");
  }
  private async catalog(transport: CodexTransport, threadId: string, signal?: AbortSignal): Promise<void> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = object(await transport.request("mcpServerStatus/list", { threadId, detail: "toolsAndAuthOnly", limit: 100 }, signal));
      requireRuntime(!response.nextCursor && Array.isArray(response.data), "RUNTIME_CATALOG_UNEXPECTED", "Unexpected native MCP catalog pagination");
      const active = response.data.map(object).filter(server => server.runtimeStatus !== "disabled");
      requireRuntime(active.every(server => server.name === SERVER && ["notStarted", "starting", "connected"].includes(String(server.runtimeStatus))), "RUNTIME_CATALOG_UNEXPECTED", "Unexpected or failed native MCP server");
      const server = active[0];
      if (active.length === 1 && server?.runtimeStatus === "connected") {
        const names = Object.values(object(server.tools)).map(tool => object(tool).name).sort();
        requireRuntime(JSON.stringify(names) === JSON.stringify([...TOOL_NAMES].sort()), "RUNTIME_CATALOG_UNEXPECTED", "Native MCP tool catalog differs from the fixed five tools"); return;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new RuntimeFault("RUNTIME_CATALOG_TIMEOUT", "Native MCP server did not become ready");
  }
  private async interrupt(transport: CodexTransport, threadId: string, turnId: string, terminal: Promise<void>): Promise<void> {
    if (transport.closed) return;
    await timeout(transport.request("turn/interrupt", { threadId, turnId }).catch(() => {}), this.#options.limits.interruptGraceMs, "RUNTIME_INTERRUPT_TIMEOUT").catch(() => {});
    await timeout(terminal, this.#options.limits.interruptGraceMs, "RUNTIME_INTERRUPT_UNCONFIRMED").catch(() => {});
  }
}
