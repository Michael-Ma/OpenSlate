import Database from "better-sqlite3";
import { mkdirSync, existsSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonical, digest, DomainError, invariant, newId } from "@openslate/core";
import type { JsonObject, ProjectEvent, ProjectRecord } from "@openslate/core";
import { verifySchema } from "./schema.js";
import { initializeDatabase } from "./migrations.js";
import { flushSnapshot, prepareSnapshotDirectory, snapshotDatabase, verifyDatabase } from "./database-snapshot.js";

interface EntityRow { body: string; project_id: string; version: number }
interface ProjectRow { body: string; head_version: number }

/** Local SQLite repository. Domain services remain responsible for authorization. */
export class Store {
  readonly db: Database.Database;
  private savepoint = 0;
  constructor(readonly path: string) {
    invariant(typeof path === "string" && path.length > 0, "DATABASE_PATH_INVALID", "Use a database path or :memory:");
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    // Reject newer or unrecognized databases through a read-only connection before
    // opening a writer or applying persistent journal/schema configuration.
    if (path !== ":memory:" && existsSync(path)) {
      const existing = new Database(path, { readonly: true, fileMustExist: true });
      try { verifySchema(existing, { allowEmpty: true }); } finally { existing.close(); }
    }
    this.db = new Database(path);
    try {
      this.db.pragma("foreign_keys = ON");
      this.db.pragma("synchronous = FULL");
      this.db.pragma("busy_timeout = 5000");
      initializeDatabase(this.db, path);
      this.db.pragma("journal_mode = WAL");
    } catch (error) { this.db.close(); throw error; }
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

  listProjects(): ProjectRecord[] {
    return (this.db.prepare("SELECT body FROM projects ORDER BY rowid DESC").all() as ProjectRow[]).map(row => JSON.parse(row.body) as ProjectRecord);
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
    if (kind === "request_image_selection") {
      reference("message", id);
      invariant(body.requestId === id && Array.isArray(body.images) && body.images.length >= 1 && body.images.length <= 4 && body.selectionDigest === digest(body.images), "IDENTITY_MISMATCH", "Image selection must bind a bounded ordered request payload");
      const images = body.images as Array<{ artifactId: string; sha256: string }>;
      invariant(new Set(images.map(image => image.artifactId)).size === images.length, "IDENTITY_MISMATCH", "Image selections must be unique");
      for (const image of images) {
        reference("artifact", image.artifactId);
        const artifact = this.get<{ artifact: { sha256: string; kind: string }; origin?: string; fixture: boolean; mimeType: string }>("artifact", image.artifactId)!;
        invariant(artifact.artifact.sha256 === image.sha256 && artifact.artifact.kind === "image" && artifact.origin === "supplied_image" && artifact.fixture === false && artifact.mimeType === "image/png", "IDENTITY_MISMATCH", "Image selection must bind a supplied PNG's exact content");
      }
      const request = this.get<{ contextDigest: string }>("message", id)!;
      invariant(request.contextDigest === digest({ replyToReviewId: null, images }), "IDENTITY_MISMATCH", "Image selection must match the message's context identity");
    }
    if (kind === "request_image_projection") {
      reference("request_image_selection", id);
      const selection = this.get<{ selectionDigest: string; images: unknown[] }>("request_image_selection", id)!;
      invariant(body.requestId === id && body.selectionDigest === selection.selectionDigest && Array.isArray(body.images) && body.images.length === selection.images.length &&
        [body.recipeDigest, body.toolchainDigest].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value)), "IDENTITY_MISMATCH", "Image projection must bind its request, recipe and toolchain");
      const images = body.images as Array<{ artifactId: string; sha256: string; thumbnailSha256: string; byteLength: number; mediaType: string }>;
      invariant(canonical(images.map(({ artifactId, sha256 }) => ({ artifactId, sha256 }))) === canonical(selection.images), "IDENTITY_MISMATCH", "Image projection must preserve selected reference order and identity");
      invariant(images.every(image => /^[a-f0-9]{64}$/.test(image.thumbnailSha256) && Number.isSafeInteger(image.byteLength) && image.byteLength > 0 && image.byteLength <= 128 * 1024 && image.mediaType === "image/jpeg"), "VALIDATION_ERROR", "Image projection requires bounded JPEG content receipts");
    }
    if (kind === "image_import") reference("message", body.requestId);
    if (kind === "image_import_receipt") {
      reference("image_import", id);
      const artifact = body.artifact as { artifactId?: unknown } | undefined;
      reference("artifact", artifact?.artifactId);
      const imported = this.get<{ artifactId: string }>("image_import", id)!;
      invariant(imported.artifactId === artifact?.artifactId, "IDENTITY_MISMATCH", "Image receipt must match its import artifact identity");
    }
    if (kind === "execution_output_receipt") {
      reference("attempt", body.attemptId);
      const attempt = this.get<{ request: unknown }>("attempt", String(body.attemptId))!;
      invariant(body.requestDigest === digest(attempt.request), "IDENTITY_MISMATCH", "Output receipt must bind its immutable attempt request");
    }
    if (kind === "execution_output_spool") {
      reference("execution_output_receipt", body.receiptId);
      const receipt = this.get<Record<string, unknown>>("execution_output_receipt", String(body.receiptId))!;
      invariant(id === body.receiptId && body.attemptId === receipt.attemptId && body.requestDigest === receipt.requestDigest && body.port === receipt.port,
        "IDENTITY_MISMATCH", "Output spool must match its receipt and attempt");
    }
    if (kind === "execution_output_slot") {
      reference("execution_output_spool", body.spoolId);
      const spool = this.get<Record<string, unknown>>("execution_output_spool", String(body.spoolId))!;
      invariant(id === digest({ projectId, attemptId: body.attemptId, port: body.port }) && body.attemptId === spool.attemptId
        && body.port === spool.port && body.storageId === spool.storageId && body.sha256 === spool.sha256 && body.byteLength === spool.byteLength,
      "IDENTITY_MISMATCH", "Output slot must match its owned spool identity");
    }
    if (kind === "director_turn") {
      reference("message", body.requestId);
      if (body.epochId !== null) reference("epoch", body.epochId);
      invariant(["queued", "running", "completed", "waiting_user", "interrupted", "unknown", "failed"].includes(String(body.state)), "VALIDATION_ERROR", "Invalid director turn state");
    }
    if (kind === "native_model_start") {
      reference("director_turn", id); reference("message", body.requestId); reference("epoch", body.epochId);
      const turn = this.get<{ requestId: string; epochId: string }>("director_turn", id);
      invariant(turn?.requestId === body.requestId && turn?.epochId === body.epochId, "SCOPE_DENIED", "Native dispatch reservation must match its application turn");
    }
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
      if (["grant", "candidate", "artifact", "plan", "review_snapshot", "approval", "execution_evidence", "execution_output_receipt", "execution_output_spool", "execution_output_slot", "capability_lock", "director_skill_lock", "director_epoch_lock", "director_context", "skill_activation", "skill_read", "director_output", "tool_reconciliation", "native_model_start", "request_image_selection", "request_image_projection", "media_source", "media_import", "media_import_receipt", "image_import", "image_import_receipt", "narration_session", "narration_segment", "narration_audio", "narration_cue", "narration_acceptance", "narration_revision", "narration_prepared", "narration_canonical", "narration_commit_receipt"].includes(kind))
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
        for (const field of ["requestId", "epochId", "callId", "tool", "argumentsDigest", "recovery", "toolContractVersion", "catalogDigest", "skillLockId"])
          invariant(canonical(previous[field] ?? null) === canonical(next[field] ?? null), "IMMUTABLE_RECORD", `Tool invocation ${field} is immutable`);
        if (previous.state !== "started") invariant(old.body === encoded, "IMMUTABLE_RECORD", "Completed tool invocations are immutable");
      }
      if (kind === "director_turn") {
        const previous = JSON.parse(old.body) as Record<string, unknown>;
        const next = JSON.parse(encoded) as Record<string, unknown>;
        for (const field of ["requestId", "runtimeId", "createdAt"])
          invariant(canonical(previous[field]) === canonical(next[field]), "IMMUTABLE_RECORD", `Director ${field} is immutable`);
        if (previous.state !== "queued" && previous.state !== "running") invariant(old.body === encoded, "IMMUTABLE_RECORD", "Terminal director turns are immutable");
        if (previous.state === "running") invariant(next.state !== "queued", "IMMUTABLE_RECORD", "A dispatched turn cannot be requeued");
      }
      if (kind === "attempt") {
        const previous = JSON.parse(old.body) as Record<string, unknown>;
        const next = JSON.parse(encoded) as Record<string, unknown>;
        for (const field of ["candidateId", "ordinal", "nodeId", "specDigest", "fingerprint", "request", "workKey"])
          invariant(canonical(previous[field] ?? null) === canonical(next[field] ?? null), "IMMUTABLE_RECORD", `Attempt ${field} is immutable`);
      }
      if (kind === "media_render") {
        const previous = JSON.parse(old.body) as Record<string, unknown>, next = JSON.parse(encoded) as Record<string, unknown>;
        const mutable = new Set(["state", "ownerToken", "leaseUntil", "cancelRequested", "artifact", "finishedAt", "errorCode"]);
        for (const field of new Set([...Object.keys(previous), ...Object.keys(next)])) if (!mutable.has(field))
          invariant(canonical(previous[field] ?? null) === canonical(next[field] ?? null), "IMMUTABLE_RECORD", `Render ${field} is immutable`);
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
    invariant(typeof destination === "string" && destination.length > 0 && destination !== ":memory:" && destination === destination.trim() && resolve(destination) !== resolve(this.path)
      && !existsSync(destination) && !existsSync(`${destination}-wal`) && !existsSync(`${destination}-shm`), "BACKUP_EXISTS", "Use a new backup destination");
    verifySchema(this.db, { integrity: true });
    prepareSnapshotDirectory(destination);
    const fd = openSync(destination, "wx", 0o600); closeSync(fd);
    try { await this.db.backup(destination); Store.checkDatabase(destination); flushSnapshot(destination); }
    catch (error) { try { unlinkSync(destination); } catch { /* Do not replace the original backup error. */ } throw error; }
  }

  static checkDatabase(path: string): void {
    verifyDatabase(path);
  }

  static restore(source: string, destination: string): void {
    invariant(!existsSync(destination) && !existsSync(`${destination}-wal`) && !existsSync(`${destination}-shm`), "RESTORE_DESTINATION_EXISTS", "Restore requires a new closed database path");
    const reader = new Database(source, { readonly: true, fileMustExist: true });
    try { snapshotDatabase(reader, destination); } finally { reader.close(); }
  }

  close(): void { this.db.close(); }
}
