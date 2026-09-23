import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ServerResponse } from "node:http";
import { invariant } from "@openslate/core";
import type { Store } from "../persistence/store.js";

interface Client { projectId: string; cursor: number; response: ServerResponse; heartbeatAt: number; status: string; close(): void; authorize(): void }
export interface ProjectEventStreamOptions {
  store: Store;
  /** Read-only in-memory status. Database-only changes are detected independently. */
  directorStatus?: (projectId: string) => unknown;
  /** Revalidate expiring/revoked browser sessions before emitting more project data. */
  authorize?: (request: FastifyRequest) => void;
  /** Trusted test/host timing overrides; never browser input. */
  intervalMs?: number; heartbeatMs?: number;
}
const frameLimit = 65536, pageLimit = 32, queueLimit = 256 * 1024;
/** One small database watcher for all active streams. No entity/history snapshots or authority are created. */
export function registerProjectEventStream(app: FastifyInstance, options: ProjectEventStreamOptions): void {
  const { store } = options, intervalMs = options.intervalMs ?? 1000, heartbeatMs = options.heartbeatMs ?? 15000;
  invariant(Number.isSafeInteger(intervalMs) && intervalMs >= 10 && intervalMs <= 10000 && Number.isSafeInteger(heartbeatMs) && heartbeatMs >= intervalMs && heartbeatMs <= 30000,
    "VALIDATION_ERROR", "Invalid event stream timing");
  const clients = new Set<Client>(); let timer: ReturnType<typeof setInterval> | undefined, stopping = false;
  const stamp = (): string => `${(store.db.prepare("SELECT total_changes() AS n").get() as { n: number }).n}:${store.db.pragma("data_version", { simple: true })}`;
  let previous = stamp();
  const status = (projectId: string): string => {
    if (!options.directorStatus) return "";
    const value = JSON.stringify(options.directorStatus(projectId));
    invariant(typeof value === "string" && Buffer.byteLength(value) <= 16384, "EVENT_STREAM_STATUS_LIMIT", "Director status exceeds the stream metadata bound");
    return value;
  };
  const write = (client: Client, frame: string): boolean => {
    if (client.response.destroyed || client.response.writableEnded || client.response.writableLength + Buffer.byteLength(frame) > queueLimit) { client.close(); return false; }
    client.response.write(frame); return true;
  };
  const control = (client: Client, event: "project.invalidate" | "project.resync", cursor: number) => write(client,
    `${event === "project.resync" ? `id: ${cursor}\n` : ""}event: ${event}\ndata: ${JSON.stringify({ version: 1, projectId: client.projectId, cursor })}\n\n`);
  const pump = (client: Client, changed: boolean, now: number) => {
    try {
      client.authorize();
      const latest = store.cursor(client.projectId), nextStatus = status(client.projectId), statusChanged = nextStatus !== client.status;
      client.status = nextStatus;
      if (latest < client.cursor || latest - client.cursor > pageLimit) {
        if (control(client, "project.resync", latest)) client.cursor = latest;
      } else if (latest > client.cursor) {
        // Limit before transferring body text from SQLite; a large old event causes explicit snapshot resync.
        const rows = store.db.prepare("SELECT sequence, CASE WHEN length(CAST(body AS BLOB)) <= ? THEN body ELSE NULL END AS body FROM events WHERE project_id=? AND sequence>? ORDER BY sequence LIMIT ?")
          .all(frameLimit - 1024, client.projectId, client.cursor, pageLimit) as { sequence: number; body: string | null }[];
        let expected = client.cursor + 1;
        for (const row of rows) {
          if (!row.body || row.sequence !== expected) { if (control(client, "project.resync", latest)) client.cursor = latest; break; }
          const event = JSON.parse(row.body) as { projectId?: unknown; sequence?: unknown; kind?: unknown };
          invariant(event.projectId === client.projectId && event.sequence === row.sequence && typeof event.kind === "string" && /^[A-Za-z0-9_.:-]{1,160}$/.test(event.kind),
            "EVENT_STREAM_INVALID", "Saved project event identity is invalid");
          if (!write(client, `id: ${row.sequence}\nevent: ${event.kind}\ndata: ${row.body}\n\n`)) return;
          client.cursor = row.sequence; expected++;
        }
        if (client.cursor < latest) { if (control(client, "project.resync", latest)) client.cursor = latest; }
      } else if (changed || statusChanged) control(client, "project.invalidate", latest);
      if (now - client.heartbeatAt >= heartbeatMs) { if (write(client, ": heartbeat\n\n")) client.heartbeatAt = now; }
    } catch { client.close(); }
  };
  const tick = () => {
    try {
      const next = stamp(), changed = next !== previous; previous = next; const now = Date.now();
      for (const client of [...clients]) pump(client, changed, now);
    } catch { for (const client of [...clients]) client.close(); }
  };
  app.addHook("preClose", async () => { stopping = true; clearInterval(timer); timer = undefined; for (const client of [...clients]) client.close(); });
  app.get<{ Params: { projectId: string }; Querystring: { after?: string } }>("/api/projects/:projectId/events", async (request, reply) => {
    invariant(!stopping && clients.size < 32, "SERVICE_UNAVAILABLE", "Project event stream capacity is unavailable");
    const projectId = request.params.projectId, latest = store.cursor(projectId);
    const raw = request.headers["last-event-id"] ?? request.query.after ?? "0";
    const cursor = typeof raw === "string" && /^(0|[1-9][0-9]{0,15})$/.test(raw) ? Number(raw) : NaN;
    invariant(Number.isSafeInteger(cursor) && cursor >= 0 && cursor <= latest, "VALIDATION_ERROR", "Invalid event cursor");
    const initialStatus = status(projectId); reply.hijack();
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "private, no-cache, no-transform",
      Connection: "keep-alive", "X-Accel-Buffering": "no", "X-Content-Type-Options": "nosniff" });
    let closed = false;
    const close = () => {
      if (closed) return; closed = true; clients.delete(client); reply.raw.off("close", close); request.raw.off("aborted", close);
      if (!reply.raw.writableEnded) reply.raw.end();
      if (!clients.size) { clearInterval(timer); timer = undefined; }
    };
    const client: Client = { projectId, cursor, response: reply.raw, heartbeatAt: 0, status: initialStatus, close,
      authorize: () => options.authorize?.(request) };
    clients.add(client); reply.raw.on("close", close); request.raw.on("aborted", close);
    if (!timer) { previous = stamp(); timer = setInterval(tick, intervalMs); timer.unref(); }
    pump(client, false, Date.now());
  });
}
