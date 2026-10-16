import type { FastifyInstance } from "fastify";
import type { Socket } from "node:net";

interface Cleanup { name: string; close(): Promise<unknown> | unknown }
export interface ShutdownResult { timedOut: string[]; failed: string[] }
export interface ServerShutdownOptions {
  /** Synchronously fence dispatch and stop scheduling before starting any waits. */
  stop(): void;
  cleanup: Cleanup[];
  /** Synchronous handles in dependency order; installation ownership must be last. */
  resources: { name: string; close(): void }[];
  /** Production exits in this same final stack, so abandoned work cannot outlive ownership. */
  terminate?: (code: number) => void;
  /** Trusted host/test limits, never request input. All cleanup shares one deadline. */
  timeoutMs?: number; connectionGraceMs?: number; logIntervalMs?: number;
}

/** A single bounded shutdown, including hijacked streams and non-cooperating workers. */
export function createServerShutdown(app: FastifyInstance, options: ServerShutdownOptions): () => Promise<ShutdownResult> {
  const timeoutMs = options.timeoutMs ?? 4000, connectionGraceMs = options.connectionGraceMs ?? 100,
    logIntervalMs = options.logIntervalMs ?? 500;
  const sockets = new Set<Socket>(); let stopping = false, completion: Promise<ShutdownResult> | undefined;
  const connected = (socket: Socket) => {
    if (stopping) { socket.destroy(); return; }
    sockets.add(socket); socket.once("close", () => sockets.delete(socket));
  };
  app.server.on("connection", connected);
  return () => completion ??= (async () => {
    stopping = true;
    const start = Date.now(), failed: string[] = [], pending = new Set<string>();
    const fail = (name: string) => { failed.push(name); app.log.warn({ component: name }, "OpenSlate shutdown cleanup failed; saved intent is retained for recovery"); };
    // No scheduling/dispatch can begin after this point. Do not persist Stop or
    // discard reservations: accepted/unknown media still needs exact recovery.
    try { options.stop(); } catch { fail("dispatch fence"); }
    const cleanup = [{ name: "HTTP connections and local render cleanup", close: () => app.close() }, ...options.cleanup];
    const tasks = cleanup.map(task => {
      pending.add(task.name);
      // Invoke immediately, so Director close revokes epochs and aborts turns
      // before another event-loop turn, even if its returned promise hangs.
      let work: Promise<unknown>;
      try { work = Promise.resolve(task.close()); } catch { work = Promise.reject(new Error("Shutdown cleanup failed")); }
      return work.catch(() => fail(task.name)).finally(() => pending.delete(task.name));
    });
    app.server.closeIdleConnections();
    const forceConnections = () => {
      if (sockets.size) app.log.info({ connections: sockets.size }, "Closing remaining OpenSlate HTTP streams and connections");
      app.server.closeAllConnections();
      // Also covers upgraded/hijacked sockets that HTTP's connection registry
      // does not own. New connections are rejected by the listener above.
      for (const socket of sockets) socket.destroy();
    };
    const connectionTimer = setTimeout(forceConnections, connectionGraceMs);
    const report = () => { if (pending.size) app.log.info({ waitingFor: [...pending], elapsedMs: Date.now() - start, connections: sockets.size }, "Waiting for OpenSlate shutdown cleanup"); };
    report(); const logTimer = setInterval(report, logIntervalMs);
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.all(tasks), new Promise<void>(resolve => { deadline = setTimeout(resolve, timeoutMs); })]);
    } finally { clearTimeout(deadline); clearTimeout(connectionTimer); clearInterval(logTimer); }
    const timedOut = [...pending];
    if (timedOut.length) app.log.warn({ waitingFor: timedOut, elapsedMs: Date.now() - start }, "OpenSlate shutdown deadline reached; unconfirmed work will reconcile on restart");
    forceConnections(); app.server.off("connection", connected);
    // This final section is synchronous. Production exits immediately after
    // releasing ownership, leaving no window for late worker continuations or
    // a second process to race an old submission against closed storage.
    for (const resource of options.resources) { try { resource.close(); } catch { fail(resource.name); } }
    const result = { timedOut, failed };
    app.log.info({ elapsedMs: Date.now() - start }, "OpenSlate shutdown complete; installation ownership released");
    options.terminate?.(failed.length ? 1 : 0);
    return result;
  })();
}
