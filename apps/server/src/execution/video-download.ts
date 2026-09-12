import { lookup } from "node:dns/promises";
import { Agent, request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { BlockList, isIP } from "node:net";
import type { LookupFunction } from "node:net";
import { DomainError, invariant } from "@openslate/core";
import type { OutputByteSource, OutputReceipt } from "./output-store.js";

export const VIDEO_DOWNLOAD_LIMITS = Object.freeze({ maxBytes: 256 * 1024 * 1024, timeoutMs: 300000,
  headerBytes: 16 * 1024, chunkBytes: 1024 * 1024, addresses: 16 });
type Address = { address: string; family: number };
type Request = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
export interface VideoDownloadOptions {
  /** Exact DNS hostnames from trusted host configuration; never model-authored URLs or wildcards. */
  allowedHosts: readonly string[];
  maxBytes?: number;
  timeoutMs?: number;
  /** Trusted test/host dependencies. Neither receives API credentials. */
  lookup?: (hostname: string) => Promise<Address[]>;
  request?: Request;
}

// Conservative IPv4-only first slice. Reject special/local ranges even when an
// allowlisted hostname resolves to one; the validated address is pinned for TLS.
const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(address, prefix, "ipv4");
blocked.addAddress("168.63.129.16", "ipv4");
const hostName = (host: unknown): host is string => typeof host === "string" && host.length <= 253
  && host === host.toLowerCase() && isIP(host) === 0 && host.includes(".")
  && host.split(".").every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
const publicAddress = (address: Address) => address.family === 4 && isIP(address.address) === 4 && !blocked.check(address.address, "ipv4");
const interrupted = (signal: AbortSignal) => invariant(!signal.aborted, "OUTPUT_DOWNLOAD_CANCELLED", "Output download was cancelled");

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DomainError("OUTPUT_DOWNLOAD_CANCELLED", "Output download was cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work.then(value => { signal.removeEventListener("abort", abort); resolve(value); }, error => { signal.removeEventListener("abort", abort); reject(error); });
  });
}

/** Download bytes only. The output store owns receipt binding, durable storage and recovery. */
export class ProtectedVideoDownloader {
  private readonly hosts: ReadonlySet<string>;
  private readonly maximum: number;
  private readonly timeoutMs: number;
  private readonly resolveHost: NonNullable<VideoDownloadOptions["lookup"]>;
  private readonly request: Request;
  constructor(options: VideoDownloadOptions) {
    invariant(Array.isArray(options.allowedHosts) && options.allowedHosts.length >= 1 && options.allowedHosts.length <= 32
      && options.allowedHosts.every(hostName), "OUTPUT_DOWNLOAD_CONFIGURATION", "Configure exact output hostnames");
    this.hosts = new Set(options.allowedHosts);
    this.maximum = options.maxBytes ?? VIDEO_DOWNLOAD_LIMITS.maxBytes;
    this.timeoutMs = options.timeoutMs ?? VIDEO_DOWNLOAD_LIMITS.timeoutMs;
    invariant(Number.isSafeInteger(this.maximum) && this.maximum > 0 && this.maximum <= VIDEO_DOWNLOAD_LIMITS.maxBytes
      && Number.isSafeInteger(this.timeoutMs) && this.timeoutMs >= 10 && this.timeoutMs <= VIDEO_DOWNLOAD_LIMITS.timeoutMs,
    "OUTPUT_DOWNLOAD_CONFIGURATION", "Download limits can only lower the supported bounds");
    this.resolveHost = options.lookup ?? (hostname => lookup(hostname, { family: 4, all: true }));
    this.request = options.request ?? ((request, callback) => httpsRequest(request, callback));
  }

  /** Capture protected data once. Call only with a receipt already admitted by ExecutionOutputStore. */
  source(receipt: OutputReceipt): OutputByteSource {
    const saved = structuredClone(receipt);
    invariant(saved.kind === "video" && saved.port === "video" && saved.mimeType === "video/mp4"
      && saved.source.kind === "protected_locator" && typeof saved.vendorTaskId === "string" && saved.vendorTaskId.length > 0,
    "OUTPUT_DOWNLOAD_RECEIPT", "A known video task and protected locator receipt are required");
    let url: URL;
    try { url = new URL(saved.source.locator); } catch { throw new DomainError("OUTPUT_DOWNLOAD_LOCATOR", "Output locator is invalid"); }
    invariant(saved.source.locator.length <= 8192 && !/[\u0000-\u0020\u007f]/.test(saved.source.locator)
      && url.protocol === "https:" && url.port === "" && url.username === "" && url.password === "" && url.hash === ""
      && hostName(url.hostname) && this.hosts.has(url.hostname), "OUTPUT_DOWNLOAD_LOCATOR", "Output locator is outside the configured HTTPS hosts");
    const locator = url.href, expiresAt = saved.source.expiresAt;
    invariant(expiresAt === null || (typeof expiresAt === "string" && Number.isFinite(Date.parse(expiresAt))),
      "OUTPUT_DOWNLOAD_RECEIPT", "Output locator expiry is invalid");
    return signal => this.download(locator, expiresAt, signal);
  }

  private async *download(locator: string, expiresAt: string | null, originalSignal: AbortSignal): AsyncGenerator<Uint8Array> {
    interrupted(originalSignal);
    invariant(expiresAt === null || Date.parse(expiresAt) > Date.now(), "OUTPUT_DOWNLOAD_EXPIRED", "The saved output locator has expired");
    const abort = new AbortController(); let timedOut = false;
    const cancel = () => abort.abort(); originalSignal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, this.timeoutMs); timer.unref();
    let client: ClientRequest | undefined, response: IncomingMessage | undefined, agent: Agent | undefined;
    let closed: Promise<void> | undefined;
    try {
      interrupted(abort.signal);
      const url = new URL(locator), addresses = await abortable(this.resolveHost(url.hostname), abort.signal);
      interrupted(abort.signal);
      invariant(Array.isArray(addresses) && addresses.length > 0 && addresses.length <= VIDEO_DOWNLOAD_LIMITS.addresses
        && addresses.every(publicAddress), "OUTPUT_DOWNLOAD_ADDRESS", "Output host has no permitted public IPv4 route");
      const chosen = addresses[0]!.address;
      const pinnedLookup: LookupFunction = (_host, options, callback) => {
        if (options.all) callback(null, [{ address: chosen, family: 4 }]);
        else callback(null, chosen, 4);
      };
      // A private non-pooling agent bypasses environment proxies and global-agent
      // sockets; TLS still verifies the original allowlisted DNS hostname.
      agent = new Agent({ keepAlive: false, maxSockets: 1, maxCachedSessions: 0, proxyEnv: {} });
      response = await new Promise<IncomingMessage>((resolve, reject) => {
        client = this.request({ protocol: "https:", hostname: url.hostname, port: 443, servername: url.hostname,
          path: url.pathname + url.search, method: "GET", agent, lookup: pinnedLookup, family: 4, rejectUnauthorized: true,
          maxHeaderSize: VIDEO_DOWNLOAD_LIMITS.headerBytes, signal: abort.signal,
          headers: { accept: "video/mp4,application/octet-stream", "accept-encoding": "identity" } }, resolve);
        closed = new Promise<void>(done => client!.once("close", done));
        client.once("error", reject); client.end();
      });
      interrupted(abort.signal);
      invariant(response.statusCode === 200, "OUTPUT_DOWNLOAD_HTTP_STATUS", "Output server did not return a complete file");
      const encoding = response.headers["content-encoding"], type = response.headers["content-type"];
      invariant((encoding === undefined || encoding === "identity") && (type === undefined
        || (typeof type === "string" && ["video/mp4", "application/octet-stream"].includes(type.split(";")[0]!.trim().toLowerCase()))),
      "OUTPUT_DOWNLOAD_FORMAT", "Output server returned an unsupported content format");
      const length = response.headers["content-length"];
      invariant(length === undefined || (typeof length === "string" && /^\d+$/.test(length) && Number.isSafeInteger(Number(length))
        && Number(length) > 0 && Number(length) <= this.maximum), "OUTPUT_DOWNLOAD_SIZE", "Output file exceeds the download size limit");
      let received = 0;
      for await (const part of response) {
        interrupted(abort.signal);
        invariant(Buffer.isBuffer(part), "OUTPUT_DOWNLOAD_FORMAT", "Output body must contain raw bytes");
        received += part.length;
        invariant(received <= this.maximum && (length === undefined || received <= Number(length)), "OUTPUT_DOWNLOAD_SIZE", "Output body exceeds its declared or configured size");
        for (let offset = 0; offset < part.length; offset += VIDEO_DOWNLOAD_LIMITS.chunkBytes) {
          interrupted(abort.signal); yield part.subarray(offset, offset + VIDEO_DOWNLOAD_LIMITS.chunkBytes);
        }
      }
      interrupted(abort.signal);
      invariant(received > 0 && (length === undefined || received === Number(length)), "OUTPUT_DOWNLOAD_SIZE", "Output body is empty or truncated");
    } catch (error) {
      if (timedOut) throw new DomainError("OUTPUT_DOWNLOAD_TIMEOUT", "Output download exceeded its deadline");
      if (originalSignal.aborted) throw new DomainError("OUTPUT_DOWNLOAD_CANCELLED", "Output download was cancelled");
      if (error instanceof DomainError) throw error;
      // Raw network errors can contain a signed URL. Never expose or retain them.
      throw new DomainError("OUTPUT_DOWNLOAD_UNAVAILABLE", "Output download is unavailable");
    } finally {
      abort.abort(); response?.destroy(); client?.destroy(); agent?.destroy();
      try { if (closed) await closed; }
      finally { clearTimeout(timer); originalSignal.removeEventListener("abort", cancel); }
    }
    // Socket cleanup is still part of the operation. A late cancellation or
    // deadline must not turn an interrupted download into a successful source.
    if (timedOut) throw new DomainError("OUTPUT_DOWNLOAD_TIMEOUT", "Output download exceeded its deadline");
    interrupted(originalSignal);
  }
}
