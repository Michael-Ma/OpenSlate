import Database from "better-sqlite3";
import { mkdirSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonical, DomainError, invariant, newId } from "@openslate/core";
import type { JsonObject, ProjectEvent, ProjectRecord } from "@openslate/core";

interface EntityRow { body: string; project_id: string; version: number }
interface ProjectRow { body: string; head_version: number }

/** Local SQLite repository. Domain services remain responsible for authorization. */
export class Store {
  readonly db: Database.Database;
  private savepoint = 0;
  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true }) as number;
    invariant(version <= 1, "DATABASE_VERSION_UNSUPPORTED", "Database requires a newer OpenSlate version");
    this.transaction(() => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, head_version INTEGER NOT NULL CHECK(head_version >= 0),
          body TEXT NOT NULL CHECK(json_valid(body)), event_sequence INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS entities (
          kind TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
          body TEXT NOT NULL CHECK(json_valid(body)), version INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY(kind,id)
        );
        CREATE INDEX IF NOT EXISTS entity_project ON entities(project_id,kind);
        CREATE UNIQUE INDEX IF NOT EXISTS candidate_grant_once
          ON entities(json_extract(body,'$.grantId')) WHERE kind='candidate';
        CREATE UNIQUE INDEX IF NOT EXISTS attempt_ordinal_once
          ON entities(json_extract(body,'$.candidateId'), json_extract(body,'$.ordinal')) WHERE kind='attempt';
        CREATE UNIQUE INDEX IF NOT EXISTS local_work_once
          ON entities(json_extract(body,'$.workKey')) WHERE kind='attempt' AND json_extract(body,'$.candidateId') IS NULL;
        CREATE UNIQUE INDEX IF NOT EXISTS reservation_attempt_once
          ON entities(json_extract(body,'$.attemptId')) WHERE kind='reservation';
        CREATE TABLE IF NOT EXISTS commands (
          actor_scope TEXT NOT NULL, key TEXT NOT NULL, digest TEXT NOT NULL,
          result TEXT NOT NULL CHECK(json_valid(result)), PRIMARY KEY(actor_scope,key)
        );
        CREATE TABLE IF NOT EXISTS events (
          project_id TEXT NOT NULL REFERENCES projects(id), sequence INTEGER NOT NULL,
          id TEXT NOT NULL UNIQUE, body TEXT NOT NULL CHECK(json_valid(body)), PRIMARY KEY(project_id,sequence)
        );
        PRAGMA user_version=1;
      `);
    });
  }

  transaction<T>(fn: () => T): T {
    invariant(fn.constructor.name !== "AsyncFunction", "ASYNC_TRANSACTION", "Transactions must be synchronous");
    const nested = this.db.inTransaction;
    const sp = `store_${++this.savepoint}`;
    this.db.exec(nested ? `SAVEPOINT ${sp}` : "BEGIN IMMEDIATE");
    try {
      const result = fn();
      invariant(!(result && typeof (result as { then?: unknown }).then === "function"), "ASYNC_TRANSACTION", "Transactions cannot return a promise");
      this.db.exec(nested ? `RELEASE SAVEPOINT ${sp}` : "COMMIT");
      return result;
    } catch (error) {
      if (nested) this.db.exec(`ROLLBACK TO SAVEPOINT ${sp}; RELEASE SAVEPOINT ${sp}`);
      else if (this.db.inTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
  }

  createProject(project: ProjectRecord): ProjectRecord {
    invariant(Number.isSafeInteger(project.headVersion) && project.headVersion >= 0, "VALIDATION_ERROR", "Invalid project version");
    this.db.prepare("INSERT INTO projects(id,head_version,body) VALUES(?,?,?)").run(project.id, project.headVersion, canonical(project));
    return this.getProject(project.id);
  }

  getProject(id: string): ProjectRecord {
    const row = this.db.prepare("SELECT body,head_version FROM projects WHERE id=?").get(id) as ProjectRow | undefined;
    invariant(row, "NOT_FOUND", "Project not found");
    return JSON.parse(row.body) as ProjectRecord;
  }

  saveProject(project: ProjectRecord, expectedHeadVersion: number): ProjectRecord {
    const saved = { ...project, headVersion: expectedHeadVersion + 1 };
    const result = this.db.prepare("UPDATE projects SET body=?,head_version=? WHERE id=? AND head_version=?")
      .run(canonical(saved), saved.headVersion, project.id, expectedHeadVersion);
    invariant(result.changes === 1, "REVISION_CONFLICT", "Project changed; reload before applying");
    return saved;
  }

  get<T>(kind: string, id: string): T | undefined {
    const row = this.db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, id) as EntityRow | undefined;
    return row ? JSON.parse(row.body) as T : undefined;
  }

  list<T>(kind: string, projectId: string): T[] {
    this.getProject(projectId);
    return (this.db.prepare("SELECT body FROM entities WHERE kind=? AND project_id=? ORDER BY rowid").all(kind, projectId) as EntityRow[])
      .map(row => JSON.parse(row.body) as T);
  }

  private checkedBody(kind: string, id: string, projectId: string, value: unknown): string {
    this.getProject(projectId);
    invariant(value !== null && typeof value === "object" && !Array.isArray(value), "VALIDATION_ERROR", "Entity body must be an object");
    const body = value as Record<string, unknown>;
    invariant(body.id === undefined || body.id === id, "IDENTITY_MISMATCH", "Entity ID does not match its record");
    invariant(body.projectId === undefined || body.projectId === projectId, "SCOPE_DENIED", "Entity project does not match its record");
    const reference = (targetKind: string, targetId: unknown) => {
      invariant(typeof targetId === "string", "REFERENCE_REQUIRED", `${kind} requires ${targetKind}`);
      const target = this.db.prepare("SELECT project_id FROM entities WHERE kind=? AND id=?").get(targetKind, targetId) as EntityRow | undefined;
      invariant(target && target.project_id === projectId, "SCOPE_DENIED", `Invalid ${targetKind} reference`);
    };
    if (kind === "grant") {
      invariant(typeof body.authorityId === "string" && typeof body.scopeId === "string" && typeof body.kind === "string", "ORIGIN_NOT_AUTHORIZED", "A grant requires immutable authority, scope, and operation kind");
      invariant(body.origin === "initial_slot" || body.origin === "user_change", "ORIGIN_NOT_AUTHORIZED", "Invalid grant origin");
    }
    if (kind === "candidate") {
      reference("grant", body.grantId);
      invariant(typeof body.nodeId === "string", "REFERENCE_REQUIRED", "Candidate requires a logical node");
      invariant(body.origin === "initial_slot" || body.origin === "user_change", "ORIGIN_NOT_AUTHORIZED", "Invalid candidate origin");
      const grant = this.get<{ origin: string }>("grant", String(body.grantId))!;
      invariant(body.origin === grant.origin, "ORIGIN_NOT_AUTHORIZED", "Candidate must retain its grant's origin");
    }
    if (kind === "attempt") {
      if (body.candidateId !== null) reference("candidate", body.candidateId);
      else invariant(typeof body.workKey === "string", "REFERENCE_REQUIRED", "Local work requires a work key");
      invariant(Number.isSafeInteger(body.ordinal) && Number(body.ordinal) >= 1, "VALIDATION_ERROR", "Invalid attempt ordinal");
    }
    if (kind === "reservation") reference("attempt", body.attemptId);
    if (["director_epoch_lock", "director_context", "skill_activation", "skill_read"].includes(kind)) {
      reference("message", body.requestId);
      reference("epoch", body.epochId);
      const epoch = this.get<{ requestId: string }>("epoch", String(body.epochId));
      invariant(epoch?.requestId === body.requestId, "SCOPE_DENIED", "Director record request does not match its epoch");
    }
    if (kind === "tool_invocation") {
      reference("message", body.requestId);
      reference("epoch", body.epochId);
      const epoch = this.get<{ requestId: string }>("epoch", String(body.epochId));
      invariant(epoch?.requestId === body.requestId, "SCOPE_DENIED", "Tool invocation request does not match its epoch");
      invariant(["started", "succeeded", "failed", "unresolved"].includes(String(body.state)), "VALIDATION_ERROR", "Invalid tool invocation state");
    }
    return canonical({ ...body, id, projectId });
  }

  insert<T>(kind: string, id: string, projectId: string, body: T): T {
    return this.transaction(() => {
      const encoded = this.checkedBody(kind, id, projectId, body);
      try { this.db.prepare("INSERT INTO entities(kind,id,project_id,body) VALUES(?,?,?,?)").run(kind, id, projectId, encoded); }
      catch (error) { this.constraint(error); }
      return JSON.parse(encoded) as T;
    });
  }

  put<T>(kind: string, id: string, projectId: string, body: T): T {
    return this.transaction(() => {
      const old = this.db.prepare("SELECT body,project_id FROM entities WHERE kind=? AND id=?").get(kind, id) as EntityRow | undefined;
      if (!old) return this.insert(kind, id, projectId, body);
      invariant(old.project_id === projectId, "SCOPE_DENIED", "Cannot move records between projects");
      const encoded = this.checkedBody(kind, id, projectId, body);
      if (["grant", "candidate", "artifact", "plan", "review_snapshot", "approval", "execution_evidence", "capability_lock", "director_skill_lock", "director_epoch_lock", "director_context", "skill_activation", "skill_read"].includes(kind))
        invariant(old.body === encoded, "IMMUTABLE_RECORD", `${kind} records are immutable`);
      if (kind === "epoch") {
        const previous = JSON.parse(old.body) as Record<string, unknown>;
        const next = JSON.parse(encoded) as Record<string, unknown>;
        for (const field of ["requestId", "principalId", "tokenHash", "scopeIds"])
          invariant(canonical(previous[field]) === canonical(next[field]), "IMMUTABLE_RECORD", `Epoch ${field} is immutable`);
        const allowed = previous.state === "active" ? ["active", "read_only", "revoked"] : previous.state === "read_only" ? ["read_only", "revoked"] : ["revoked"];
        invariant(allowed.includes(String(next.state)), "EPOCH_REVOKED", "An epoch cannot regain write authority");
      }
      if (kind === "tool_invocation") {
        const previous = JSON.parse(old.body) as Record<string, unknown>;
        const next = JSON.parse(encoded) as Record<string, unknown>;
        for (const field of ["requestId", "epochId", "callId", "tool", "argumentsDigest"])
          invariant(canonical(previous[field]) === canonical(next[field]), "IMMUTABLE_RECORD", `Tool invocation ${field} is immutable`);
        if (previous.state !== "started") invariant(old.body === encoded, "IMMUTABLE_RECORD", "Completed tool invocations are immutable");
      }
      if (kind === "attempt") {
        const previous = JSON.parse(old.body) as Record<string, unknown>;
        const next = JSON.parse(encoded) as Record<string, unknown>;
        for (const field of ["candidateId", "ordinal", "nodeId", "specDigest", "fingerprint", "request", "workKey"])
          invariant(canonical(previous[field] ?? null) === canonical(next[field] ?? null), "IMMUTABLE_RECORD", `Attempt ${field} is immutable`);
      }
      this.db.prepare("UPDATE entities SET body=?,version=version+1 WHERE kind=? AND id=?").run(encoded, kind, id);
      return JSON.parse(encoded) as T;
    });
  }

  private constraint(error: unknown): never {
    if (error && typeof error === "object" && "code" in error && String(error.code).startsWith("SQLITE_CONSTRAINT"))
      throw new DomainError("UNIQUENESS_CONFLICT", "Record identity, grant slot, or attempt ordinal is already used");
    throw error;
  }

  appendEvent(projectId: string, kind: string, payload: JsonObject): ProjectEvent {
    return this.transaction(() => {
      const row = this.db.prepare("UPDATE projects SET event_sequence=event_sequence+1 WHERE id=? RETURNING event_sequence").get(projectId) as { event_sequence: number } | undefined;
      invariant(row, "NOT_FOUND", "Project not found");
      const event: ProjectEvent = { eventId: newId(), projectId, sequence: row.event_sequence, kind, payload, occurredAt: new Date().toISOString() };
      this.db.prepare("INSERT INTO events(project_id,sequence,id,body) VALUES(?,?,?,?)").run(projectId, event.sequence, event.eventId, canonical(event));
      return event;
    });
  }

  cursor(projectId: string): number {
    const row = this.db.prepare("SELECT event_sequence FROM projects WHERE id=?").get(projectId) as { event_sequence: number } | undefined;
    invariant(row, "NOT_FOUND", "Project not found");
    return row.event_sequence;
  }

  readEvents(projectId: string, after = 0): ProjectEvent[] {
    this.getProject(projectId);
    invariant(Number.isSafeInteger(after) && after >= 0, "VALIDATION_ERROR", "Invalid event cursor");
    return (this.db.prepare("SELECT body FROM events WHERE project_id=? AND sequence>? ORDER BY sequence").all(projectId, after) as { body: string }[])
      .map(row => JSON.parse(row.body) as ProjectEvent);
  }

  command<T>(actorScope: string, key: string, requestDigest: string, fn: () => T): T {
    invariant(fn.constructor.name !== "AsyncFunction", "ASYNC_TRANSACTION", "Command mutations must be synchronous");
    return this.transaction(() => {
      const old = this.db.prepare("SELECT digest,result FROM commands WHERE actor_scope=? AND key=?").get(actorScope, key) as { digest: string; result: string } | undefined;
      if (old) {
        invariant(old.digest === requestDigest, "IDEMPOTENCY_CONFLICT", "Command key was used with different content");
        return JSON.parse(old.result) as T;
      }
      const result = fn();
      this.db.prepare("INSERT INTO commands(actor_scope,key,digest,result) VALUES(?,?,?,?)").run(actorScope, key, requestDigest, canonical(result));
      return result;
    });
  }

  async backup(destination: string): Promise<void> {
    invariant(!this.db.inTransaction, "TRANSACTION_ACTIVE", "Backup must run outside a write transaction");
    invariant(resolve(destination) !== resolve(this.path) && !existsSync(destination), "BACKUP_EXISTS", "Use a new backup destination");
    mkdirSync(dirname(resolve(destination)), { recursive: true });
    await this.db.backup(destination);
    Store.checkDatabase(destination);
  }

  static checkDatabase(path: string): void {
    const db = new Database(path, { readonly: true, fileMustExist: true });
    try {
      invariant(db.pragma("integrity_check", { simple: true }) === "ok", "DATABASE_CORRUPT", "SQLite integrity check failed");
      invariant((db.pragma("foreign_key_check") as unknown[]).length === 0, "DATABASE_CORRUPT", "SQLite reference check failed");
      invariant(db.pragma("user_version", { simple: true }) === 1, "DATABASE_VERSION_UNSUPPORTED", "Unsupported backup schema");
    } finally { db.close(); }
  }

  static restore(source: string, destination: string): void {
    invariant(!existsSync(destination) && !existsSync(`${destination}-wal`) && !existsSync(`${destination}-shm`), "RESTORE_DESTINATION_EXISTS", "Restore requires a new closed database path");
    Store.checkDatabase(source);
    mkdirSync(dirname(resolve(destination)), { recursive: true });
    try { copyFileSync(source, destination); Store.checkDatabase(destination); }
    catch (error) { if (existsSync(destination)) unlinkSync(destination); throw error; }
  }

  close(): void { this.db.close(); }
}
