import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { Agent, get } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createServerShutdown } from "../dist/shutdown.js";
import { acquireInstallationOwner } from "../dist/persistence/installation-owner.js";

function loggedApp() {
  const lines = [];
  const stream = new Writable({ write(chunk, _encoding, done) { lines.push(JSON.parse(String(chunk))); done(); } });
  return { app: Fastify({ logger: { stream } }), lines };
}
async function listen(t, app) {
  t.after(async () => { app.server.closeAllConnections(); await app.close(); });
  await app.listen({ host: "127.0.0.1", port: 0 });
  return `http://127.0.0.1:${app.server.address().port}`;
}
function request(url, options) {
  return new Promise((resolve, reject) => { const req = get(url, options, resolve); req.once("error", reject); });
}

test("shutdown closes a held keep-alive socket and an unending hijacked stream before storage and ownership", { timeout: 4000 }, async t => {
  const { app, lines } = loggedApp(), order = [];
  app.get("/", async () => ({ ok: true }));
  app.get("/events", async (_request, reply) => { reply.hijack(); reply.raw.writeHead(200, { "content-type": "text/event-stream" }); reply.raw.write(": held stream\n\n"); });
  const close = createServerShutdown(app, { stop: () => order.push("fence"), cleanup: [{ name: "Director turns", close: async () => { order.push("director"); } }],
    resources: [{ name: "storage", close: () => order.push("storage") }, { name: "ownership", close: () => order.push("ownership") }],
    timeoutMs: 1000, connectionGraceMs: 20, logIntervalMs: 10 });
  const origin = await listen(t, app), agent = new Agent({ keepAlive: true }); t.after(() => agent.destroy());
  const idle = await request(origin, { agent }); const idleSocket = idle.socket; idle.resume(); await once(idle, "end");
  assert.equal(idleSocket.destroyed, false, "the keep-alive socket is still held by the client");
  const events = await request(`${origin}/events`, { agent: false }); events.resume(); await once(events, "data");
  events.on("error", () => {}); // A forced stream close may surface as ECONNRESET.
  const streamClosed = new Promise(resolve => events.once("close", resolve)), idleClosed = once(idleSocket, "close"), start = Date.now();
  const result = await close(); await Promise.all([streamClosed, idleClosed]);
  assert.ok(Date.now() - start < 1000); assert.deepEqual(result, { timedOut: [], failed: [] });
  assert.deepEqual(order, ["fence", "director", "storage", "ownership"]);
  assert.ok(lines.some(line => line.msg === "Waiting for OpenSlate shutdown cleanup" && line.waitingFor.includes("HTTP connections and local render cleanup")));
});

test("shutdown shares a bounded deadline, reports hanging and failed cleanup, and releases ownership last exactly once", { timeout: 2000 }, async t => {
  const { app, lines } = loggedApp(), order = [];
  const close = createServerShutdown(app, { stop: () => order.push("fence"),
    cleanup: [{ name: "Director turns", close: () => new Promise(() => {}) }, { name: "media reconciliation", close: () => new Promise(() => {}) },
      { name: "native media workers", close: async () => { throw new Error("private diagnostic must not appear"); } }],
    resources: [{ name: "storage", close: () => order.push("storage") }, { name: "ownership", close: () => order.push("ownership") }],
    terminate: code => { order.push(`exit:${code}`); }, timeoutMs: 60, connectionGraceMs: 5, logIntervalMs: 10 });
  await listen(t, app); const start = Date.now(), work = close(); assert.equal(close(), work);
  const result = await work;
  assert.deepEqual(result, { timedOut: ["Director turns", "media reconciliation"], failed: ["native media workers"] });
  assert.ok(Date.now() - start < 500); assert.deepEqual(order, ["fence", "storage", "ownership", "exit:1"]);
  assert.ok(lines.filter(line => line.msg === "Waiting for OpenSlate shutdown cleanup").length >= 2);
  assert.ok(lines.some(line => line.msg.includes("deadline reached") && line.waitingFor.includes("media reconciliation")));
  assert.equal(JSON.stringify(lines).includes("private diagnostic"), false);
});

test("a process with hanging cleanup exits within its deadline and permits immediate installation reacquisition", { timeout: 6000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), "openslate-shutdown-owner-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const shutdownModule = new URL("../dist/shutdown.js", import.meta.url).href, ownerModule = new URL("../dist/persistence/installation-owner.js", import.meta.url).href;
  const source = `import Fastify from 'fastify'; import { createServerShutdown } from ${JSON.stringify(shutdownModule)}; import { acquireInstallationOwner } from ${JSON.stringify(ownerModule)};
    const installation=acquireInstallationOwner(process.argv[1]), app=Fastify({logger:true});
    const close=createServerShutdown(app,{stop(){console.log('FENCED');},cleanup:[{name:'media reconciliation',close:()=>new Promise(()=>{})}],
      resources:[{name:'storage',close(){console.log('STORAGE_CLOSED');}},{name:'installation ownership',close(){installation.close();console.log('OWNER_RELEASED');}}],
      terminate:code=>process.exit(code),timeoutMs:250,connectionGraceMs:10,logIntervalMs:30});
    process.on('SIGTERM',()=>void close()); await app.listen({host:'127.0.0.1',port:0}); console.log('READY');`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", source, directory], { cwd: new URL("..", import.meta.url), stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", data => { output += data; }); child.stderr.on("data", data => { output += data; });
  const completed = once(child, "exit"); t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  const until = async phrase => { const start = Date.now(); while (!output.includes(phrase)) { if (child.exitCode !== null || Date.now() - start > 2000) throw new Error(output); await new Promise(resolve => setTimeout(resolve, 5)); } };
  await until("READY"); assert.throws(() => acquireInstallationOwner(directory), { code: "INSTALLATION_IN_USE" });
  child.kill("SIGTERM"); await until("FENCED");
  assert.throws(() => acquireInstallationOwner(directory), { code: "INSTALLATION_IN_USE" }, "ownership remains held while cleanup is pending");
  const [code, signal] = await completed; assert.equal(code, 0, output); assert.equal(signal, null);
  assert.match(output, /deadline reached/); assert.ok(output.indexOf("STORAGE_CLOSED") < output.indexOf("OWNER_RELEASED"));
  const replacement = acquireInstallationOwner(directory); replacement.close();
});
