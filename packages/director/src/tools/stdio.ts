import type { Readable, Writable } from "node:stream";
import { DomainError, TOOL_CONTRACT_VERSION, TOOL_DESCRIPTORS } from "@openslate/core";
import { BRIDGE_LIMITS, type ToolInvoker } from "./bridge.js";

export const MCP_PROTOCOL_VERSIONS = Object.freeze(["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]);
export const STDIO_LIMITS = Object.freeze({ frameBytes: BRIDGE_LIMITS.requestBytes + 4096, outputBytes: BRIDGE_LIMITS.responseBytes * 2 + 4096, concurrency: 4, requests: 4096, writeTimeoutMs: 5000 });
export interface StdioToolBridgeOptions {
  bridge: ToolInvoker;
  input?: Readable;
  output?: Writable;
  limits?: { frameBytes?: number; outputBytes?: number; concurrency?: number; requests?: number; writeTimeoutMs?: number };
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const requestId = (id: unknown): id is string | number => typeof id === "string" ? id.length > 0 && id.length <= 160 : typeof id === "number" && Number.isSafeInteger(id);
const keyFor = (id: unknown) => JSON.stringify([typeof id, id]);

/** Legacy MCP initialization and newline-delimited stdio; no resource, shell, or sampling surface. */
export async function runStdioToolBridge(options: StdioToolBridgeOptions): Promise<void> {
  const input = options.input ?? process.stdin, output = options.output ?? process.stdout;
  const limits = { ...STDIO_LIMITS, ...options.limits };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value <= 0 || value > STDIO_LIMITS[name as keyof typeof STDIO_LIMITS]) throw new Error("STDIO_LIMIT_INVALID");
  const active = new Map<string, AbortController>();
  const seen = new Set<string>();
  const tasks = new Set<Promise<void>>();
  let buffer = Buffer.alloc(0), initialized = false, ready = false, stopped = false;
  let finish!: () => void;
  const ended = new Promise<void>(resolve => { finish = resolve; });
  const stop = (destroy = false) => {
    if (stopped) return;
    stopped = true; input.pause(); input.off("data", onData);
    for (const controller of active.values()) controller.abort();
    if (destroy) input.destroy();
    finish();
  };
  const send = async (message: unknown) => {
    if (output.destroyed || !output.writable) { stop(true); return; }
    const bytes = Buffer.from(JSON.stringify(message) + "\n");
    if (bytes.length > limits.outputBytes || output.writableLength + bytes.length > limits.outputBytes * 2) { stop(true); return; }
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { stop(true); resolve(); }, limits.writeTimeoutMs);
      try { output.write(bytes, error => { clearTimeout(timer); if (error) stop(true); resolve(); }); }
      catch { clearTimeout(timer); stop(true); resolve(); }
    });
  };
  const rpcError = (id: unknown, code: number, message: string) => send({ jsonrpc: "2.0", id, error: { code, message } });
  const toolError = (id: unknown, code: string, message: string) => send({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }] } });
  const handle = async (value: unknown) => {
    if (!record(value) || value.jsonrpc !== "2.0" || typeof value.method !== "string") { await rpcError(null, -32600, "Invalid MCP request"); return; }
    const params = value.params === undefined ? {} : value.params;
    if (!("id" in value)) {
      if (value.method === "notifications/initialized" && initialized) ready = true;
      if (value.method === "notifications/cancelled" && record(params) && requestId(params.requestId)) active.get(keyFor(params.requestId))?.abort();
      return;
    }
    if (!requestId(value.id)) { await rpcError(null, -32600, "Invalid request ID"); return; }
    const id = value.id, key = keyFor(id);
    if (seen.has(key)) { await rpcError(id, -32600, "Request ID already used on this connection"); return; }
    if (seen.size >= limits.requests) { await rpcError(id, -32000, "Connection request limit reached"); stop(true); return; }
    seen.add(key);
    if (!record(params)) { await rpcError(id, -32602, "Parameters must be an object"); return; }
    if (value.method === "initialize") {
      if (initialized || typeof params.protocolVersion !== "string" || !record(params.capabilities) || !record(params.clientInfo) || typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string") {
        await rpcError(id, -32602, "Invalid initialization"); return;
      }
      initialized = true;
      await send({ jsonrpc: "2.0", id, result: {
        protocolVersion: MCP_PROTOCOL_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : MCP_PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} }, serverInfo: { name: "openslate", version: TOOL_CONTRACT_VERSION },
      } }); return;
    }
    if (value.method === "ping") { await send({ jsonrpc: "2.0", id, result: {} }); return; }
    if (!ready) { await rpcError(id, -32002, "MCP initialization is incomplete"); return; }
    if (value.method === "tools/list") {
      if (Object.keys(params).some(key => !["cursor", "_meta"].includes(key)) || (params.cursor !== undefined && params.cursor !== null && params.cursor !== "")) {
        await rpcError(id, -32602, "Fixed catalog has no additional page"); return;
      }
      await send({ jsonrpc: "2.0", id, result: { tools: TOOL_DESCRIPTORS } }); return;
    }
    if (value.method !== "tools/call") { await rpcError(id, -32601, "MCP method unavailable"); return; }
    if (typeof params.name !== "string" || Object.keys(params).some(key => !["name", "arguments", "_meta"].includes(key))) {
      await rpcError(id, -32602, "Invalid tool call"); return;
    }
    if (active.size >= limits.concurrency) { await toolError(id, "BRIDGE_BUSY", "No free tool request slot"); return; }
    const controller = new AbortController(); active.set(key, controller);
    try {
      const result = await options.bridge.call(params.name, params.arguments === undefined ? {} : params.arguments, controller.signal);
      const response = { jsonrpc: "2.0", id, result: {
        isError: result.isError, content: [{ type: "text", text: JSON.stringify(result.value) }], _meta: { "openslate/callId": result.callId },
      } };
      if (Buffer.byteLength(JSON.stringify(response)) + 1 > limits.outputBytes) {
        await toolError(id, "TOOL_CALL_UNRESOLVED", `Tool result exceeded the output limit. Reconcile call ${result.callId} before retrying.`);
      } else await send(response);
    } catch (error) {
      await toolError(id, error instanceof DomainError ? error.code : "BRIDGE_ERROR", error instanceof DomainError ? error.message : "Tool bridge could not complete the request");
    } finally { active.delete(key); }
  };
  const dispatch = (line: Buffer) => {
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)); }
    catch { const work = rpcError(null, -32700, "Invalid JSON"); tasks.add(work); void work.finally(() => tasks.delete(work)); return; }
    const work = handle(value).catch(() => stop(true)); tasks.add(work); void work.finally(() => tasks.delete(work));
  };
  function onData(chunk: Buffer | string) {
    if (stopped) return;
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    buffer = Buffer.concat([buffer, incoming]);
    while (!stopped) {
      const newline = buffer.indexOf(10);
      if (newline < 0) { if (buffer.length > limits.frameBytes) stop(true); break; }
      if (newline > limits.frameBytes) { stop(true); break; }
      const line = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
      if (line.length) dispatch(line);
    }
  }
  const end = () => stop();
  const failed = () => stop(true);
  input.on("data", onData); input.on("end", end); input.on("close", end); input.on("error", failed); output.on("error", failed);
  try { await ended; await Promise.allSettled([...tasks]); }
  finally { input.off("data", onData); input.off("end", end); input.off("close", end); input.off("error", failed); output.off("error", failed); }
}
