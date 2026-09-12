import { randomUUID } from "node:crypto";
import { invariant, parseToolArguments, toolCatalog } from "@openslate/core";
import type { ToolContractVersion } from "@openslate/core";

export interface BridgeLimits { requestBytes: number; responseBytes: number; timeoutMs: number; concurrency: number }
export const BRIDGE_LIMITS: Readonly<BridgeLimits> = Object.freeze({ requestBytes: 3 * 1024 * 1024, responseBytes: 4 * 1024 * 1024, timeoutMs: 30_000, concurrency: 4 });
export interface ToolBridgeOptions {
  endpoint: string;
  projectId: string;
  credential: string;
  /** Trusted launch configuration. Server authority still comes from the epoch's saved lock. */
  toolContractVersion?: ToolContractVersion;
  /** May only tighten the production defaults. */
  limits?: Partial<BridgeLimits>;
}
export interface ToolBridgeResult { callId: string; isError: boolean; value: unknown }
export interface ToolInvoker { readonly toolContractVersion?: ToolContractVersion; call(name: string, input: unknown, signal?: AbortSignal): Promise<ToolBridgeResult> }

function limit(value: number | undefined, maximum: number): number {
  const result = value ?? maximum;
  invariant(Number.isSafeInteger(result) && result > 0 && result <= maximum, "BRIDGE_CONFIG_INVALID", "Bridge limits must be positive and bounded");
  return result;
}

/** Local transport only. It cannot issue authority or retry a possibly committed command. */
export class ToolBridge implements ToolInvoker {
  readonly #toolContractVersion: ToolContractVersion;
  get toolContractVersion(): ToolContractVersion { return this.#toolContractVersion; }
  readonly #endpoint: string;
  readonly #credential: string;
  readonly #limits: { requestBytes: number; responseBytes: number; timeoutMs: number; concurrency: number };
  #active = 0;

  constructor(options: ToolBridgeOptions) {
    this.#toolContractVersion = toolCatalog(options.toolContractVersion).version;
    let url: URL;
    try { url = new URL(options.endpoint); } catch { throw new Error("BRIDGE_ENDPOINT_INVALID"); }
    invariant(url.protocol === "http:" && url.hostname === "127.0.0.1" && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password,
      "BRIDGE_ENDPOINT_INVALID", "Bridge endpoint must be an HTTP origin on 127.0.0.1");
    invariant(/^[A-Za-z0-9_-]{1,160}$/.test(options.projectId), "BRIDGE_CONFIG_INVALID", "Invalid bridge project identity");
    invariant(/^[A-Za-z0-9_-]{20,256}$/.test(options.credential), "BRIDGE_CONFIG_INVALID", "Invalid bridge credential");
    this.#endpoint = `${url.origin}/internal/projects/${encodeURIComponent(options.projectId)}/tools/`;
    this.#credential = options.credential;
    this.#limits = Object.freeze({
      requestBytes: limit(options.limits?.requestBytes, BRIDGE_LIMITS.requestBytes),
      responseBytes: limit(options.limits?.responseBytes, BRIDGE_LIMITS.responseBytes),
      timeoutMs: limit(options.limits?.timeoutMs, BRIDGE_LIMITS.timeoutMs),
      concurrency: limit(options.limits?.concurrency, BRIDGE_LIMITS.concurrency),
    });
  }

  async call(name: string, input: unknown, signal?: AbortSignal): Promise<ToolBridgeResult> {
    const parsed = parseToolArguments(name, input, this.toolContractVersion);
    const body = JSON.stringify(parsed.arguments);
    invariant(Buffer.byteLength(body) <= this.#limits.requestBytes, "TOOL_ARGUMENTS_TOO_LARGE", "Tool arguments exceed the bridge request limit");
    invariant(this.#active < this.#limits.concurrency, "BRIDGE_BUSY", "Bridge has no free request slot");
    invariant(!signal?.aborted, "TOOL_CALL_CANCELLED", "Tool call was cancelled before dispatch");
    const callId = randomUUID();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, this.#limits.timeoutMs);
    this.#active++;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(this.#endpoint + parsed.name, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.#credential}`, "x-openslate-tool-call-id": callId }, body,
      });
      invariant(response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "application/json", "INVALID_TOOL_RESPONSE", "Expected a JSON tool response");
      const declared = response.headers.get("content-length");
      invariant(declared === null || (/^\d+$/.test(declared) && Number(declared) <= this.#limits.responseBytes), "TOOL_RESPONSE_TOO_LARGE", "Tool response exceeds the bridge limit");
      invariant(response.body, "INVALID_TOOL_RESPONSE", "Tool response is empty");
      reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) {
        const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength;
        invariant(bytes <= this.#limits.responseBytes, "TOOL_RESPONSE_TOO_LARGE", "Tool response exceeds the bridge limit");
        chunks.push(chunk.value);
      }
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
      const value: unknown = JSON.parse(text.replaceAll(this.#credential, "[redacted]"));
      const applicationError = value !== null && typeof value === "object" && "error" in value;
      if (response.status >= 500) throw new Error("SERVER_OUTCOME_UNKNOWN");
      if (!response.ok && !applicationError) throw new Error("INVALID_TOOL_ERROR_RESPONSE");
      return { callId, isError: !response.ok || applicationError, value };
    } catch {
      // Even a socket/timeout/response error can follow a successful server commit.
      return { callId, isError: true, value: { error: { code: "TOOL_CALL_UNRESOLVED", message: "Tool outcome is unknown. Reconcile this call with application state before retrying.", callId, outcome: "unknown" } } };
    } finally {
      clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.abort();
      if (reader) await reader.cancel().catch(() => {});
      this.#active--;
    }
  }
}

export function createToolBridge(options: ToolBridgeOptions): ToolBridge { return new ToolBridge(options); }
