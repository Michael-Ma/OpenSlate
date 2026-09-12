// Synthetic native API: no Codex binary, authentication files, or network calls.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const scenario = process.env.SETUP_FIXTURE_SCENARIO ?? "ready";
const log = value => appendFileSync(process.env.SETUP_FIXTURE_LOG, JSON.stringify({ pid: process.pid, ...value }) + "\n");
if (process.argv.includes("--version")) {
  log({ kind: "version" });
  process.stdout.write(`codex-cli ${scenario === "version" ? "0.0.1" : "0.153.4"}\n`);
  process.exit(0);
}
const config = {
  mcp_servers: { inherited: { command: "/secret/native/tool", env: { TOKEN: "INHERITED_TOKEN_NEVER_COPY" } }, already_disabled: { enabled: false } },
};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] !== "-c") continue;
  const arg = process.argv[++i], separator = arg.indexOf("="), keys = arg.slice(0, separator).split(".");
  const value = JSON.parse(arg.slice(separator + 1).replace(/("(?:\\.|[^"\\])*")=/g, "$1:"));
  let row = config; for (const key of keys.slice(0, -1)) row = row[key] ??= {};
  row[keys.at(-1)] = value;
}
const verifying = Array.isArray(config.skills?.config);
log({ kind: "launch", verifying, parentSecretAbsent: !process.env.SETUP_PARENT_SECRET,
  home: process.env.HOME, codexHome: process.env.CODEX_HOME });
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const respond = (id, result) => send({ id, result });
const lines = createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", line => {
  const message = JSON.parse(line), { id, method, params } = message;
  if (!method) { log({ kind: "rejected-request", response: message }); return; }
  log({ kind: "request", method, params });
  if (method === "initialized") return;
  if (method === "initialize") {
    if (scenario === "hang") return;
    if (scenario === "approval") { send({ id: "auth-request", method: "account/chatgptAuthTokens/refresh", params: {} }); return; }
    return respond(id, { userAgent: "codex-cli/0.153.4" });
  }
  if (method === "config/read") {
    if (verifying && scenario === "policy") config.permissions.openslate_local.filesystem["/unexpected-root"] = "read";
    if (verifying && scenario === "permissions-null") {
      Object.assign(config.permissions.openslate_local, { description: null, extends: null, workspace_roots: null });
      config.permissions.openslate_local.filesystem.glob_scan_max_depth = null;
      Object.assign(config.permissions.openslate_local.network, { proxy_url: null, enable_socks5: null, socks_url: null, enable_socks5_udp: null,
        allow_upstream_proxy: null, dangerously_allow_non_loopback_proxy: null, dangerously_allow_all_unix_sockets: null,
        mode: null, domains: null, unix_sockets: null, allow_local_binding: null, mitm: null });
    }
    if (verifying && scenario === "mcp-drift") config.mcp_servers.new_server = { command: "must-not-launch" };
    if (verifying && scenario === "feature-drift") config.features.plugins = true;
    if (verifying && scenario === "question-feature-drift") config.features.default_mode_request_user_input = false;
    if (verifying && scenario === "search-drift") config.web_search = "live";
    if (scenario === "invalid-mcp-name") config.mcp_servers["contains.dot"] = { enabled: true };
    return respond(id, { config });
  }
  if (method === "skills/list") {
    const paths = [process.env.SETUP_FIXTURE_SKILL];
    if (verifying && scenario === "skill-drift") paths.push("/unexpected/SKILL.md");
    const skills = paths.map(path => ({ name: "inherited-skill", path,
      enabled: !config.skills?.config?.some(skill => skill.path === path && !skill.enabled) }));
    return respond(id, { data: [{ cwd: params.cwds[0], skills, errors: scenario === "skill-error" ? [{ message: "PRIVATE_DISCOVERY_ERROR" }] : [] }] });
  }
  if (method === "account/read") {
    if (scenario === "rpc-error") {
      process.stderr.write("credential=RAW_PRIVATE_DIAGNOSTIC\n");
      return send({ id, error: { code: -1, message: "RAW_PRIVATE_RPC_ERROR" } });
    }
    return respond(id, { requiresOpenaiAuth: true, account: scenario === "auth" ? null : { type: "chatgpt", email: "PRIVATE_ACCOUNT_EMAIL", planType: "pro" } });
  }
  if (method === "model/list") {
    if (scenario === "cursor-loop") return respond(id, { data: [], nextCursor: "repeat-cursor" });
    if (scenario === "pagination" && !params.cursor) return respond(id, { data: [], nextCursor: "second-page" });
    return respond(id, { data: scenario === "model" ? [] : [{ model: process.env.SETUP_FIXTURE_MODEL,
      inputModalities: ["text"], supportedReasoningEfforts: [{ reasoningEffort: scenario === "effort" ? "high" : "low" }] }], nextCursor: null });
  }
  // Any model or thread operation is an explicit fixture failure, never simulated success.
  log({ kind: "forbidden-method", method });
  send({ id, error: { code: -32601, message: "Outside read-only fixture contract" } });
});
