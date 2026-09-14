// Model-free protocol fixture. This file never imports or launches Codex.
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";

const mode = process.env.FIXTURE_SCENARIO ?? "complete";
const log = value => appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(value) + "\n");
if (process.argv.includes("--version")) {
  log({ kind: "version", pid: process.pid });
  process.stdout.write(mode === "version-wrong" ? "codex-cli 0.0.0\n" : "codex-cli 0.153.4\n");
  process.exit(0);
}
const config = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== "-c") continue;
  const arg = process.argv[++i], separator = arg.indexOf("="), keys = arg.slice(0, separator).split(".");
  // The production serializer emits this restricted JSON-like TOML subset.
  const value = JSON.parse(arg.slice(separator + 1).replace(/("(?:\\.|[^"\\])*")=/g, "$1:"));
  let row = config; for (const key of keys.slice(0, -1)) row = row[key] ??= {};
  row[keys.at(-1)] = value;
}
const credential = config.mcp_servers.openslate.env.OPENSLATE_BRIDGE_CREDENTIAL;
log({ kind: "launch", pid: process.pid, parentSecretAbsent: !process.env.OPENSLATE_PARENT_SECRET,
  credentialDigest: createHash("sha256").update(credential).digest("hex"),
  endpoint: config.mcp_servers.openslate.env.OPENSLATE_BRIDGE_ENDPOINT });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const respond = (id, result) => send({ id, result });
const notify = (method, params) => send({ method, params });
let threadId = "native-thread-1", turnId = "native-turn-1";
const completed = status => notify("turn/completed", { threadId, turn: { id: turnId, status } });
const assistant = (text, id = "message-1") => notify("item/completed", { threadId, turnId,
  item: { id, type: "agentMessage", text, phase: "final_answer" } });
const done = () => { assistant("Prepared safely. 你好 🟢"); completed("completed"); };
if (mode === "ignore-shutdown") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
}
const lines = createInterface({ input: process.stdin });
lines.on("close", () => { if (mode !== "ignore-shutdown") process.exit(0); });
lines.on("line", line => {
  const message = JSON.parse(line);
  if (!message.method) { log({ kind: "server-response", response: message }); return; }
  const { id, method, params } = message;
  log({ kind: "request", method, ...(method.startsWith("thread/") || method.startsWith("turn/") ? { params } : {}) });
  if (method === "initialize") {
    if (mode === "initialize-hang") return;
    if (mode === "missing-result") return send({ id });
    return respond(id, { userAgent: "codex-cli/0.153.4" });
  }
  if (method === "initialized") return;
  if (method === "config/read") {
    if (mode === "question-feature-wrong") config.features.default_mode_request_user_input = false;
    if (mode === "bridge-wrong") config.mcp_servers.openslate.env.OPENSLATE_BRIDGE_CREDENTIAL = "wrong-fixed-credential";
    if (mode === "permissions-wrong") config.permissions.fixture.network.enabled = true;
    if (mode === "permissions-expanded") config.permissions.fixture.filesystem["/unexpected-readable-root"] = "read";
    if (mode.startsWith("permissions-defaults")) {
      Object.assign(config.permissions.fixture, { description: null, extends: null, workspace_roots: null });
      config.permissions.fixture.filesystem.glob_scan_max_depth = null;
      Object.assign(config.permissions.fixture.network, { proxy_url: null, enable_socks5: null, socks_url: null, enable_socks5_udp: null,
        allow_upstream_proxy: null, dangerously_allow_non_loopback_proxy: null, dangerously_allow_all_unix_sockets: null,
        mode: null, domains: null, unix_sockets: null, allow_local_binding: null, mitm: null });
      if (mode === "permissions-defaults-expanded") config.permissions.fixture.network.allow_local_binding = true;
      if (mode === "permissions-defaults-unknown") config.permissions.fixture.future_permission = null;
    }
    return respond(id, { config });
  }
  if (method === "skills/list") {
    if (mode === "skills-config-dedup" && new Set(config.skills.config.map(skill => skill.path)).size !== config.skills.config.length)
      return send({ id, error: { code: -1, message: "Duplicate skill configuration" } });
    const skills = JSON.parse(process.env.FIXTURE_SKILLS ?? "[]").map(skill => ({ ...skill, enabled: true }));
    if (mode === "skill-extra") skills.push({ name: "untrusted", path: "/fake/untrusted/SKILL.md", enabled: true });
    return respond(id, { data: [{ cwd: process.cwd(), skills, errors: mode === "skills-error" ? [{ message: "fixture error" }] : [] }] });
  }
  if (method === "thread/start" || method === "thread/resume") {
    threadId = params.threadId ?? threadId;
    return respond(id, { thread: { id: threadId }, activePermissionProfile: { id: "fixture" },
      instructionSources: mode === "instructions-extra" ? [{ path: "/fake/AGENTS.md" }] : [] });
  }
  if (method === "mcpServerStatus/list") {
    const tools = Object.fromEntries(["read_context", "prepare_change", "apply_change", "control_execution", "inspect_artifact"].map(name => [name, { name }]));
    if (["2.0.0", "3.0.0"].includes(config.mcp_servers.openslate.env.OPENSLATE_BRIDGE_TOOL_CONTRACT) && mode !== "catalog-legacy") tools.revise_narration_draft = { name: "revise_narration_draft" };
    if (config.mcp_servers.openslate.env.OPENSLATE_BRIDGE_TOOL_CONTRACT === "3.0.0" && mode !== "catalog-legacy") { tools.prepare_recording_transcription = { name: "prepare_recording_transcription" }; tools.prepare_narration_speech = { name: "prepare_narration_speech" }; }
    if (mode === "catalog-extra") tools.extra = { name: "extra" };
    return respond(id, { data: [{ name: "openslate", runtimeStatus: "connected", tools }], nextCursor: null });
  }
  if (method === "turn/start") {
    if (mode === "start-rejected") return send({ id, error: { code: -1, message: credential } });
    if (mode !== "early-events") notify("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } });
    if (mode === "early-events") done();
    respond(id, { turn: { id: turnId, status: "inProgress" } });
    if (mode === "early-events") return;
    if (mode === "crash") { process.stderr.write(`Bearer ${credential}\n`); return setTimeout(() => process.exit(2), 10); }
    if (mode === "invalid-utf8") return process.stdout.write(Buffer.from([0xff, 10]));
    if (mode === "flood") return process.stdout.write("x".repeat(100_000));
    if (mode === "stderr-flood") return process.stderr.write("x".repeat(100_000));
    if (mode === "question") return setTimeout(() => send({ id: "question-1", method: "item/tool/requestUserInput", params: {
      threadId, turnId, questions: [{ id: "tone", header: "Tone", question: "Choose a tone", isSecret: false,
        options: [{ label: "Warm", description: "Friendly narration" }] }] } }), 10);
    if (mode === "approval") return setTimeout(() => send({ id: "approval-1", method: "item/commandExecution/requestApproval", params: { threadId, turnId } }), 10);
    if (["hang", "interrupt-unconfirmed", "ignore-shutdown"].includes(mode)) return;
    if (mode === "descendant") {
      const descendant = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], { stdio: "ignore", env: {} });
      log({ kind: "descendant", pid: descendant.pid });
    }
    if (mode === "unicode-chunks") {
      const row = Buffer.from(JSON.stringify({ method: "item/completed", params: { threadId, turnId,
        item: { type: "agentMessage", text: "你好 🟢", phase: "final_answer" } } }) + "\n");
      const split = row.indexOf(Buffer.from("你")) + 1;
      process.stdout.write(row.subarray(0, split));
      return setTimeout(() => { process.stdout.write(row.subarray(split)); completed("completed"); }, 10);
    }
    if (mode === "secret-message") { assistant(`redact ${credential}`); return completed("completed"); }
    setTimeout(done, 10); return;
  }
  if (method === "turn/interrupt") {
    if (mode === "interrupt-unconfirmed" || mode === "ignore-shutdown") return;
    respond(id, {}); completed("interrupted"); return;
  }
  send({ id, error: { code: -32601, message: "Unknown fixture method" } });
});
