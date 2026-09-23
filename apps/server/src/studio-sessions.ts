import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { invariant } from "@openslate/core";

const random = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const valid = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const STUDIO_COOKIE = "openslate_studio";
const sessionSeconds = 12 * 60 * 60;
interface Session { csrf: string; expires: number }

/** Process-local pairing and sessions. Restart invalidates both; no project authority is minted here. */
export class StudioSessions {
  private readonly launches = new Map<string, number>();
  private readonly sessions = new Map<string, Session>();
  constructor(private readonly now = Date.now) {}
  private prune() {
    for (const [key, expires] of this.launches) if (expires <= this.now()) this.launches.delete(key);
    for (const [key, session] of this.sessions) if (session.expires <= this.now()) this.sessions.delete(key);
  }
  issueLaunch(): string {
    this.prune();
    invariant(this.launches.size < 16, "SERVICE_UNAVAILABLE", "Too many pending studio launches");
    const code = random(); this.launches.set(hash(code), this.now() + 60_000); return code;
  }
  connect(code: string, previousCookie?: string) {
    this.prune();
    invariant(valid(code) && this.launches.has(hash(code)), "STUDIO_LINK_EXPIRED", "Open a fresh studio link from the launcher");
    invariant(this.sessions.size < 32, "SERVICE_UNAVAILABLE", "Too many studio sessions");
    this.launches.delete(hash(code));
    this.logout(previousCookie);
    const id = random(), session = { csrf: random(), expires: this.now() + sessionSeconds * 1000 };
    this.sessions.set(hash(id), session);
    return { cookie: `${STUDIO_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=${sessionSeconds}`, csrf: session.csrf };
  }
  private identity(cookie?: string): string | undefined {
    const values = (cookie ?? "").split(";").map(part => part.trim()).filter(part => part.startsWith(`${STUDIO_COOKIE}=`));
    if (values.length !== 1) return;
    const value = values[0]!.slice(STUDIO_COOKIE.length + 1); return valid(value) ? hash(value) : undefined;
  }
  get(cookie?: string): Session | undefined {
    const key = this.identity(cookie), session = key ? this.sessions.get(key) : undefined;
    if (!session || session.expires <= this.now()) { if (key) this.sessions.delete(key); return; }
    return session;
  }
  authorize(request: FastifyRequest) {
    const session = this.get(request.headers.cookie);
    invariant(session, "AUTH_REQUIRED", "Open studio from the local launcher");
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      // The outer host/origin allowlist is also enforced. Missing Origin is not accepted for cookie writes.
      const csrf = request.headers["x-openslate-csrf"];
      invariant(request.headers.origin && valid(csrf) && timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf)), "CSRF_DENIED", "Invalid studio request");
    }
  }
  logout(cookie?: string) { const key = this.identity(cookie); if (key) this.sessions.delete(key); }
  clear() { this.launches.clear(); this.sessions.clear(); }
}

export function registerStudioSessions(app: FastifyInstance, sessions: StudioSessions) {
  const noStore = (reply: import("fastify").FastifyReply) => reply.header("Cache-Control", "no-store").header("Referrer-Policy", "no-referrer");
  app.post("/api/studio/launch", async (_request, reply) => noStore(reply).send({ code: sessions.issueLaunch() }));
  app.post<{ Body: { code: string } }>("/api/session", {
    schema: { body: { type: "object", additionalProperties: false, required: ["code"], properties: { code: { type: "string", pattern: "^[A-Za-z0-9_-]{43}$" } } } },
  }, async (request, reply) => {
    const { cookie, csrf } = sessions.connect(request.body.code, request.headers.cookie);
    return noStore(reply).header("Set-Cookie", cookie).send({ csrf });
  });
  app.get("/api/session", async (request, reply) => {
    const session = sessions.get(request.headers.cookie); invariant(session, "AUTH_REQUIRED", "Open studio from the launcher");
    return noStore(reply).send({ csrf: session.csrf });
  });
  app.post("/api/session/logout", async (request, reply) => {
    sessions.logout(request.headers.cookie);
    return noStore(reply).header("Set-Cookie", `${STUDIO_COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0`).send({ disconnected: true });
  });
  app.addHook("onClose", async () => sessions.clear());
}
