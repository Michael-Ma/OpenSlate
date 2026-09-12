import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { FIXTURE_TOOLS, type FixtureTool } from "./epoch-fixture.js";
import { record } from "./protocol.js";

export async function serveFakeMcp(): Promise<void> {
  // Copy once at process start; model arguments can never change this attribution.
  const credential = process.env.OPENSLATE_PROBE_CREDENTIAL;
  const endpoint = process.env.OPENSLATE_PROBE_ENDPOINT;
  if (!credential || !endpoint) throw new Error("FIXTURE_LAUNCH_CONFIG_MISSING");
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== "/tool") {
    throw new Error("FIXTURE_ENDPOINT_FORBIDDEN");
  }
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    let message: Record<string, unknown>;
    try { message = record(JSON.parse(line)); } catch { continue; }
    if (!("id" in message)) continue;
    const params = record(message.params);
    let result: unknown;
    if (message.method === "initialize") {
      result = { protocolVersion: params.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} }, serverInfo: { name: "openslate-no-paid-probe", version: "1.0.0" } };
    } else if (message.method === "tools/list") {
      result = { tools: FIXTURE_TOOLS.map(name => ({ name,
        description: "Local probe fixture only; no production work or media calls.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      })) };
    } else if (message.method === "tools/call" && FIXTURE_TOOLS.includes(params.name as FixtureTool)) {
      try {
        const response = await fetch(endpoint, { method: "POST",
          headers: { authorization: `Bearer ${credential}`, "content-type": "application/json" },
          body: JSON.stringify({ tool: params.name, arguments: params.arguments ?? {} }),
          signal: AbortSignal.timeout(5_000), redirect: "error" });
        const value: unknown = await response.json();
        result = { content: [{ type: "text", text: JSON.stringify(value) }], isError: !response.ok };
      } catch {
        result = { content: [{ type: "text", text: "FIXTURE_BRIDGE_UNAVAILABLE" }], isError: true };
      }
    } else if (message.method === "ping") result = {};
    else {
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id,
        error: { code: -32601, message: "Fixture method unavailable" } }) + "\n");
      continue;
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await serveFakeMcp();
}
