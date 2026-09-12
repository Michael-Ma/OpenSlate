import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ArtifactRef, JsonObject, OperationKind } from "@openslate/core";

export type FakeMode = "complete" | "pending" | "unknown_after_accept" | "technical_failure" | "reject_before_accept";
export interface FakeRequest {
  attemptId: string; nodeId: string; kind: OperationKind; fingerprint: string;
  args: JsonObject; inputs: ArtifactRef[];
}
export interface FakeOutput {
  port: string; kind: ArtifactRef["kind"]; mimeType: string; extension: string;
  bytesBase64: string; sha256: string; fixture: true;
}
export type FakeOutcome =
  | { type: "accepted"; taskId: string }
  | { type: "completed"; taskId: string; outputs: FakeOutput[] }
  | { type: "failed"; taskId: string; failureId: string; technical: true }
  | { type: "rejected"; certainty: "not_accepted"; technical: true; failureId: string }
  | { type: "unknown"; diagnostic: string };

interface JobRow { id: string; request: string; status: string; outputs: string; failure_id: string | null }

/** Fault-injectable backend with durable acceptance evidence in a separate database.
 * submit intentionally does NOT deduplicate attempt IDs: tests can detect a blind resubmit.
 */
export class FakeProvider {
  readonly db: Database.Database;
  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS fake_jobs (
        id TEXT PRIMARY KEY, attempt_id TEXT NOT NULL, node_id TEXT NOT NULL,
        request TEXT NOT NULL, status TEXT NOT NULL, outputs TEXT NOT NULL,
        failure_id TEXT, accepted_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS fake_attempt_lookup ON fake_jobs(attempt_id);
      CREATE TABLE IF NOT EXISTS fake_modes(node_id TEXT PRIMARY KEY, modes TEXT NOT NULL);
    `);
  }

  setMode(nodeId: string, mode: FakeMode | FakeMode[]): void {
    this.db.prepare("INSERT INTO fake_modes(node_id,modes) VALUES(?,?) ON CONFLICT(node_id) DO UPDATE SET modes=excluded.modes")
      .run(nodeId, JSON.stringify(Array.isArray(mode) ? mode : [mode]));
  }

  private nextMode(nodeId: string): FakeMode {
    const row = this.db.prepare("SELECT modes FROM fake_modes WHERE node_id=?").get(nodeId) as { modes: string } | undefined;
    if (!row) return "complete";
    const modes = JSON.parse(row.modes) as FakeMode[];
    const mode = modes.shift() ?? "complete";
    this.db.prepare("UPDATE fake_modes SET modes=? WHERE node_id=?").run(JSON.stringify(modes), nodeId);
    return mode;
  }

  async submit(request: FakeRequest): Promise<FakeOutcome> {
    return this.db.transaction((): FakeOutcome => {
      const mode = this.nextMode(request.nodeId);
      if (mode === "reject_before_accept") return { type: "rejected", certainty: "not_accepted", technical: true, failureId: randomUUID() };
      const taskId = randomUUID();
      const status = mode === "pending" ? "pending" : mode === "technical_failure" ? "failed" : "completed";
      const failureId = status === "failed" ? randomUUID() : null;
      this.db.prepare("INSERT INTO fake_jobs VALUES(?,?,?,?,?,?,?,?)").run(
        taskId, request.attemptId, request.nodeId, JSON.stringify(request), status,
        JSON.stringify(fixtureOutputs(request)), failureId, new Date().toISOString(),
      );
      if (mode === "unknown_after_accept") return { type: "unknown", diagnostic: "Injected lost response after durable fake acceptance" };
      return { type: "accepted", taskId };
    }).immediate();
  }

  async poll(taskId: string): Promise<FakeOutcome> {
    const job = this.db.prepare("SELECT * FROM fake_jobs WHERE id=?").get(taskId) as JobRow | undefined;
    if (!job) return { type: "unknown", diagnostic: "No backend receipt found" };
    if (job.status === "pending") return { type: "accepted", taskId };
    if (job.status === "failed") return { type: "failed", taskId, failureId: job.failure_id!, technical: true };
    return { type: "completed", taskId, outputs: JSON.parse(job.outputs) as FakeOutput[] };
  }

  async lookup(attemptId: string): Promise<FakeOutcome> {
    const jobs = this.db.prepare("SELECT id FROM fake_jobs WHERE attempt_id=?").all(attemptId) as { id: string }[];
    if (jobs.length !== 1) return { type: "unknown", diagnostic: jobs.length === 0 ? "Acceptance is not yet known" : "Multiple accepts require reconciliation" };
    return this.poll(jobs[0]!.id);
  }

  complete(taskId: string): void { this.db.prepare("UPDATE fake_jobs SET status='completed' WHERE id=? AND status='pending'").run(taskId); }
  acceptedCount(attemptId?: string): number {
    const row = attemptId
      ? this.db.prepare("SELECT count(*) AS count FROM fake_jobs WHERE attempt_id=?").get(attemptId)
      : this.db.prepare("SELECT count(*) AS count FROM fake_jobs").get();
    return (row as { count: number }).count;
  }
  jobs(): { id: string; attemptId: string; nodeId: string; status: string }[] {
    return this.db.prepare("SELECT id,attempt_id AS attemptId,node_id AS nodeId,status FROM fake_jobs ORDER BY rowid").all() as { id: string; attemptId: string; nodeId: string; status: string }[];
  }
  close(): void { this.db.close(); }
}

export function fixtureOutputs(request: FakeRequest): FakeOutput[] {
  let bytes: Buffer;
  let kind: ArtifactRef["kind"];
  let mimeType: string;
  let extension: string;
  let port = "output";
  if (request.kind === "image") {
    bytes = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#26364b"/><text x="16" y="80" fill="white" font-size="18">OpenSlate FAKE FIXTURE</text><text x="16" y="110" fill="white" font-size="12">${request.fingerprint.slice(0, 20)}</text></svg>`);
    kind = "image"; mimeType = "image/svg+xml"; extension = "svg"; port = "image";
  } else if (request.kind === "speech") {
    // A real, silent, one-second WAV fixture; it is not synthesized narration.
    bytes = Buffer.alloc(44 + 48000 * 2);
    bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
    bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
    bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(96000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
    bytes.write("data", 36); bytes.writeUInt32LE(96000, 40);
    kind = "audio"; mimeType = "audio/wav"; extension = "wav"; port = "audio";
  } else if (request.kind === "video" || request.kind === "render") {
    bytes = Buffer.from(VIDEO_FIXTURE_BASE64, "base64");
    kind = "video"; mimeType = "video/mp4"; extension = "mp4"; port = "video";
  } else {
    bytes = Buffer.from(JSON.stringify({ fixture: true, label: "OpenSlate FAKE FIXTURE", kind: request.kind, args: request.args, inputs: request.inputs }));
    kind = "data"; mimeType = "application/json"; extension = "json";
    port = request.kind === "transcription" ? "cues" : "timeline";
  }
  return [{ port, kind, mimeType, extension, bytesBase64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), fixture: true }];
}

// One-second 160x90 color test clip, encoded once for portable fixture playback.
// Its physical duration is independent of simulated job duration and is never an export.
const VIDEO_FIXTURE_BASE64 = "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";
