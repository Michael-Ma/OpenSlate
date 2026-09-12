import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { record } from "./protocol.js";

export const FIXTURE_TOOLS = Object.freeze([
  "read_context", "prepare_change", "apply_change", "control_execution", "inspect_artifact",
] as const);
export type FixtureTool = typeof FIXTURE_TOOLS[number];
const READ_TOOLS = new Set<string>(["read_context", "inspect_artifact"]);
type State = "active" | "read_only" | "revoked";
interface Epoch { epochId: string; authorityRequestId: string; state: State; }
export interface CapturedAuthority {
  readonly epochId: string;
  readonly authorityRequestId: string;
}

/** An in-memory fixture, not OpenSlate's durable authorization implementation. */
export class EpochFixture {
  private readonly credentials = new Map<string, Epoch>();
  private readonly captures = new WeakMap<CapturedAuthority, Epoch>();
  readonly commits: CapturedAuthority[] = [];

  issue(authorityRequestId = randomUUID()): { credential: string; epochId: string } {
    const credential = randomBytes(32).toString("hex");
    const epoch = { epochId: randomUUID(), authorityRequestId, state: "active" as State };
    this.credentials.set(credential, epoch);
    return { credential, epochId: epoch.epochId };
  }

  capture(credential: string): CapturedAuthority {
    const epoch = this.credentials.get(credential);
    if (!epoch) throw new Error("FIXTURE_CREDENTIAL_INVALID");
    if (epoch.state === "revoked") throw new Error("AUTHORIZATION_EPOCH_REVOKED");
    const captured = Object.freeze({ epochId: epoch.epochId, authorityRequestId: epoch.authorityRequestId });
    this.captures.set(captured, epoch);
    return captured;
  }

  setState(credential: string, state: "read_only" | "revoked"): void {
    if (state !== "read_only" && state !== "revoked") throw new Error("FIXTURE_STATE_REGRESSION");
    const epoch = this.credentials.get(credential);
    if (!epoch) throw new Error("FIXTURE_CREDENTIAL_INVALID");
    if (epoch.state === "revoked" && state !== "revoked") throw new Error("FIXTURE_STATE_REGRESSION");
    epoch.state = state;
  }

  invoke(captured: CapturedAuthority, tool: FixtureTool): object {
    if (!FIXTURE_TOOLS.includes(tool)) throw new Error("FIXTURE_TOOL_UNKNOWN");
    const epoch = this.captures.get(captured);
    if (!epoch) throw new Error("FIXTURE_CAPTURE_FORGED");
    // Synchronous check + write represents the future database commit fence.
    if (epoch.state === "revoked") throw new Error("AUTHORIZATION_EPOCH_REVOKED");
    if (!READ_TOOLS.has(tool)) {
      if (epoch.state !== "active") throw new Error("AUTHORIZATION_EPOCH_READ_ONLY");
      this.commits.push(captured);
    }
    return { fixtureOnly: true, ...captured, tool, mutationCount: this.commits.length };
  }
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject); server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("FIXTURE_LISTEN_FAILED");
  return address.port;
}

export async function createFixtureServers(gate: EpochFixture) {
  const providerRequests: string[] = [];
  const guard = createServer((request, response) => {
    providerRequests.push(`${request.method} ${request.url}`);
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "No inference permitted by OpenSlate probe" } }));
  });
  guard.on("connect", (_request, socket) => {
    providerRequests.push("CONNECT blocked"); socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  const bridge = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    try {
      if (request.method !== "POST" || request.url !== "/tool") throw new Error("FIXTURE_ROUTE_FORBIDDEN");
      const auth = request.headers.authorization;
      if (!auth?.startsWith("Bearer ")) throw new Error("FIXTURE_CREDENTIAL_INVALID");
      const captured = gate.capture(auth.slice(7));
      let body = "";
      for await (const chunk of request) {
        body += String(chunk);
        if (Buffer.byteLength(body) > 16_384) throw new Error("FIXTURE_BODY_LIMIT");
      }
      const input = record(JSON.parse(body));
      if (!FIXTURE_TOOLS.includes(input.tool as FixtureTool)) throw new Error("FIXTURE_TOOL_UNKNOWN");
      if (Object.keys(record(input.arguments)).length !== 0) throw new Error("FIXTURE_ARGUMENTS_FORBIDDEN");
      response.end(JSON.stringify(gate.invoke(captured, input.tool as FixtureTool)));
    } catch (error) {
      response.statusCode = 403;
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "FIXTURE_ERROR" }));
    }
  });
  let guardPort: number;
  let bridgePort: number;
  try { guardPort = await listen(guard); bridgePort = await listen(bridge); }
  catch (error) {
    if (guard.listening) guard.close();
    if (bridge.listening) bridge.close();
    throw error;
  }
  return {
    providerUrl: `http://127.0.0.1:${guardPort}`,
    bridgeUrl: `http://127.0.0.1:${bridgePort}/tool`, providerRequests,
    async close() {
      await Promise.all([guard, bridge].map(server => new Promise<void>(resolve => {
        server.close(() => resolve()); server.closeAllConnections();
      })));
    },
  };
}
