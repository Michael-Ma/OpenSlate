// Synthetic native API: no Codex binary, authentication files, or network calls.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
let imageScenario = process.env.IMAGE_FIXTURE_SCENARIO ?? "inline";
try { imageScenario = readFileSync(process.env.IMAGE_FIXTURE_CONTROL, "utf8").trim() || imageScenario; } catch {}
const scenario = "ready";
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
const imageProcess = config.features?.image_generation === true;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6XsAAAAASUVORK5CYII=", "base64");
function crc32(data) { let n=0xffffffff; for(const b of data) {n^=b;for(let i=0;i<8;i++)n=(n>>>1)^((n&1)?0xedb88320:0);}return(n^0xffffffff)>>>0; }
function largePng() { const body=Buffer.concat([Buffer.from("tEXt"),Buffer.alloc(5*1024*1024,65)]),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(body.length-4);crc.writeUInt32BE(crc32(body));return Buffer.concat([png.subarray(0,png.length-12),size,body,crc,png.subarray(png.length-12)]); }
const readHistory = () => JSON.parse(readFileSync(join(process.cwd(), "fixture-history.json"),"utf8"));
const saveHistory = value => writeFileSync(join(process.cwd(), "fixture-history.json"), JSON.stringify(value));
log({ kind: "launch", verifying, parentSecretAbsent: !process.env.SETUP_PARENT_SECRET,
  apiEnvironmentAbsent: !process.env.OPENAI_API_KEY && !process.env.CODEX_API_KEY && !process.env.OPENAI_BASE_URL, home: process.env.HOME, codexHome: process.env.CODEX_HOME });
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
    if(imageScenario==="close-setup" && !imageProcess && !verifying) {
      const started=Date.now(),wait=setInterval(()=>{
        if(existsSync(process.env.IMAGE_FIXTURE_CONTROL+".release")){clearInterval(wait);respond(id,{config});}
        else if(Date.now()-started>10000){clearInterval(wait);send({id,error:{code:-1,message:"Fixture release barrier timed out"}});}
      },10);return;
    }
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
    if (imageProcess && imageScenario === "api-key") return respond(id,{requiresOpenaiAuth:true,account:{type:"apiKey"}});
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
  if (method === "modelProvider/capabilities/read") return respond(id,{imageGeneration:imageScenario!=="capability",namespaceTools:true,webSearch:true});
  if (method === "thread/start") {
    const threadId="thread-"+process.cwd().split("/").at(-1).slice(0,20);
    const thread={id:threadId,cwd:process.cwd(),modelProvider:"openai",historyMode:params.historyMode,turns:[]};saveHistory(thread);
    return respond(id,{thread,model:"gpt-6-astra",modelProvider:"openai",cwd:process.cwd()});
  }
  if (method === "thread/read") {
    if(imageScenario==="history-error")return send({id,error:{code:-32601,message:"PRIVATE_NATIVE_HISTORY_UNAVAILABLE"}});
    let thread=readHistory();if(imageScenario==="wrong-history")thread={...thread,id:"another-thread"};
    if(imageScenario==="multiple-turns")thread.turns.push({...thread.turns[0],id:"another-turn"});
    return respond(id,{thread});
  }
  if (method === "turn/interrupt") return respond(id,{});
  if (method === "turn/start") {
    const thread=readHistory(),threadId=thread.id,turnId="turn-1";
    let bytes=imageScenario==="large"?largePng():png;
    const item={type:"imageGeneration",id:"image-1",status:"completed",result:bytes.toString("base64"),revisedPrompt:"Fixture image"};
    if(["path","symlink","outside"].includes(imageScenario)) {
      const folder=join(process.env.CODEX_HOME,"generated_images",threadId);mkdirSync(folder,{recursive:true});
      const path=join(folder,"result.png"),outside=join(process.env.HOME,"not-generated.png");
      if(imageScenario==="symlink"){writeFileSync(outside,bytes);symlinkSync(outside,path);}else writeFileSync(path,bytes);
      item.result="";item.savedPath=imageScenario==="outside"?outside:path;
    }
    if(imageScenario==="no-bytes")item.result="assistant said see /tmp/result.png";
    if(imageScenario==="usage")Object.assign(item,{status:"failed",result:"",failure:{type:"usageLimitExceeded",limitId:"images"}});
    if(imageScenario==="image-failed")Object.assign(item,{status:"failed",result:""});
    const turn={id:turnId,status:imageScenario==="pending"?"inProgress":"completed",items:[item]};
    if(imageScenario==="multiple")turn.items.push({...item,id:"image-2"});
    if(imageScenario==="no-image")turn.items=[{type:"agentMessage",id:"message-1",text:"/tmp/result.png"}];
    thread.turns=[turn];saveHistory(thread);
    const startedThread=imageScenario==="wrong-event"?"other-thread":threadId;
    send({method:"turn/started",params:{threadId:startedThread,turn:{id:turnId,status:"inProgress",items:[]}}});
    if(imageScenario!=="lost-ack")respond(id,{turn:{id:turnId,status:"inProgress",items:[]}});
    if(imageScenario==="pending")return;
    for(const row of turn.items)send({method:"item/completed",params:{threadId,turnId,item:row}});
    if(imageScenario==="conflicting-item")turn.items[0]={...item,revisedPrompt:"Changed completion"};
    send({method:"turn/completed",params:{threadId,turn}});return;
  }
  // Every unrecognized method is a fixture failure, never network work.
  log({ kind: "forbidden-method", method });
  send({ id, error: { code: -32601, message: "Outside read-only fixture contract" } });
});
