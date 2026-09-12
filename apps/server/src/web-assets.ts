import type { FastifyInstance, FastifyRequest } from "fastify";
import { constants, closeSync, existsSync, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const types: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".gif": "image/gif", ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2",
};
const limits = { files: 256, depth: 8, fileBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024 };
const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
interface Asset { bytes: Buffer; type: string }
export interface WebAssets { register(app: FastifyInstance): void }

/** A user-selected data location must never become part of the public bundle. */
export function assertWebDataSeparation(bundleDirectory: string, dataDirectory: string): void {
  const canonicalTarget = (path: string) => {
    const missing: string[] = []; let current = resolve(path);
    while (!existsSync(current)) { missing.unshift(basename(current)); current = dirname(current); }
    return join(realpathSync(current), ...missing);
  };
  const bundle = canonicalTarget(bundleDirectory), data = canonicalTarget(dataDirectory);
  const contains = (parent: string, child: string) => { const rel = relative(parent, child); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
  if (contains(bundle, data) || contains(data, bundle)) throw new Error("Choose OPENSLATE_DATA_DIR outside the public web bundle and its parent directories");
}

function requestPath(raw: string): string | null {
  const encoded = raw.split("?")[0]!;
  if (!encoded.startsWith("/") || encoded.length > 4096 || /%2f|%5c/i.test(encoded)) return null;
  let path: string;
  try { path = decodeURIComponent(encoded); } catch { return null; }
  if (/[\\\u0000-\u001f\u007f%#]/.test(path) || path.includes("//") || path.split("/").some(part => part.startsWith("."))) return null;
  return path;
}

function reserved(path: string): boolean { return /^\/(?:api|internal)(?:\/|$)/i.test(path); }

/** Only the explicit bundle route is public. API/bridge paths never inherit its access. */
export function isPublicWebRequest(request: FastifyRequest): boolean {
  const config = request.routeOptions.config as { openslatePublicWeb?: boolean };
  const path = requestPath(request.raw.url ?? "");
  return config.openslatePublicWeb === true && (request.method === "GET" || request.method === "HEAD") && path !== null && !reserved(path);
}

/** Snapshot only a small built bundle; requests never open caller-selected filesystem paths. */
export function loadWebAssets(directory: string): WebAssets {
  const root = realpathSync(directory), manifest = new Map<string, Asset>();
  if (!lstatSync(root).isDirectory()) throw new Error("The built web bundle must be a directory");
  let count = 0, total = 0;
  const scan = (path: string, depth: number) => {
    if (depth > limits.depth) throw new Error("The built web bundle exceeds its directory limit");
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      if (++count > limits.files) throw new Error("The built web bundle exceeds its file limit");
      const candidate = join(path, entry.name);
      const stat = lstatSync(candidate);
      if (stat.isSymbolicLink()) throw new Error("The built web bundle cannot contain symbolic links");
      const canonical = realpathSync(candidate), rel = relative(root, canonical);
      if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("The built web bundle escapes its directory");
      if (stat.isDirectory()) { scan(canonical, depth + 1); continue; }
      const type = types[extname(entry.name).toLowerCase()];
      if (!type || !stat.isFile()) continue;
      const fd = openSync(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size > limits.fileBytes || total + opened.size > limits.totalBytes)
          throw new Error("The built web bundle changed or exceeds its byte limit");
        const buffer = Buffer.alloc(opened.size + 1); let length = 0;
        while (length < buffer.length) { const read = readSync(fd, buffer, length, buffer.length - length, length); if (!read) break; length += read; }
        if (length !== opened.size) throw new Error("The built web bundle changed while loading");
        const bytes = buffer.subarray(0, length);
        total += bytes.length;
        const url = `/${relative(root, resolve(candidate)).split(sep).join("/")}`;
        if (requestPath(url) !== url || reserved(url)) throw new Error("The built web bundle contains an unsupported path");
        manifest.set(url, { bytes, type });
      } finally { closeSync(fd); }
    }
  };
  scan(root, 0);
  const index = manifest.get("/index.html");
  if (!index) throw new Error("The built web bundle has no index.html");
  return { register(app) {
    app.get("/*", { config: { openslatePublicWeb: true } }, async (request, reply) => {
      const path = requestPath(request.raw.url ?? "");
      if (path === null || reserved(path)) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
      const acceptsHtml = request.headers.accept?.split(",").some(value => /^text\/html(?:\s*;|\s*$)/i.test(value.trim()));
      const asset = manifest.get(path) ?? (path === "/" || (acceptsHtml && !path.split("/").some(part => part.includes(".")) && !path.startsWith("/assets/")) ? index : undefined);
      if (!asset) return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Web asset not found" } });
      return reply.header("Cache-Control", "no-cache").header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", policy).header("Referrer-Policy", "no-referrer").type(asset.type).send(asset.bytes);
    });
  } };
}
