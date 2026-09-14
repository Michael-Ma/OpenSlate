import { digest, DomainError, invariant } from "@openslate/core";
import type { ProjectRecord, ProviderProfile } from "@openslate/core";
import { OPENAI_TRANSCRIPTION_MODEL, validateOpenAITranscriptionOptions } from "@openslate/providers";
import type { ProductionService } from "../application/service.js";
import type { Store } from "../persistence/store.js";
import type { Attempt } from "../execution/engine.js";
import type { TranscriptionAuthorityStore } from "../execution/transcription-execution-authority.js";
import { preflightAudioProfile } from "../execution/audio-preflight.js";
import { assertTranscriptionAudioSource } from "../execution/transcription-audio.js";
import { assertOwnedTranscriptionAttemptInput, resolveOwnedTranscriptionApplication } from "./owned-transcription-authorization.js";
import type { ResolvedOwnedTranscriptionApplication } from "./owned-transcription-authorization.js";
import { assertOwnedTranscriptionCurrent } from "../execution/owned-transcription-execution.js";
import { assertTranscriptionPreparationAttemptState } from "../persistence/transcription-preparation-state.js";
import { assertOwnedTranscriptionProposal, snapshotOwnedTranscriptionData } from "./owned-transcription-records.js";
import { currentOwnedTranscriptionReview } from "./owned-transcription-review-state.js";
import { isVerifiedGeneratedNarrationAudio, narrationAudioOrigin } from "./generated-audio.js";
import type { NarrationAudio } from "./types.js";
import type { OwnedTranscriptionApplyReceipt, OwnedTranscriptionProposal, OwnedTranscriptionSource, OwnedTranscriptionTarget } from "./owned-transcription-types.js";

export const OWNED_TRANSCRIPTION_PROJECTION_LIMITS = Object.freeze({ rows: 20, recordBytes: 16 * 1024 ** 2,
  readBytes: 32 * 1024 ** 2, responseBytes: 128 * 1024, maximumOffset: 1_000_000 });
export interface OwnedTranscriptionAudioSummary {
  id: string; sha256: string; durationSeconds: number; origin: "uploaded" | "generated";
  originEvidence: "human_declared" | "verified_generated_audio";
}
export interface OwnedTranscriptionProposalSummary {
  version: 1; id: string; proposalDigest: string; audio: OwnedTranscriptionAudioSummary; target: OwnedTranscriptionTarget;
  model: { profileId: string; provider: "OpenAI"; model: string; revision: string };
  language: string; timing: "word"; estimatedMicros: string; currency: "USD";
  plan: { preservedOperations: number; addedOperations: 1 }; baseProject: { headVersion: number; revisionId: string };
}
export interface OwnedTranscriptionProposalDetail {
  proposal: OwnedTranscriptionProposalSummary; eligibility: { current: boolean; code: string | null };
  application: OwnedTranscriptionApplyReceipt | null;
  execution: { state: "not_applied" | "ready" | Attempt["phase"] | "unavailable";
    generationCandidateId: string | null; attemptId: string | null; code: string | null };
}
export interface OwnedTranscriptionProposalPage {
  proposals: Array<{ id: string; proposal: OwnedTranscriptionProposalSummary | null;
    unavailableCode: null | "PROPOSAL_UNAVAILABLE" | "PROPOSAL_TOO_LARGE" }>;
  coverage: { offset: number; scanned: number; total: number; nextOffset: number | null; dataDigest: string; readBytes: number };
}
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") { for (const part of Object.values(value)) freeze(part); Object.freeze(value); }
  return value;
};
const size = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
const validId = (id: unknown): id is string => typeof id === "string" && id.length > 0 && Buffer.byteLength(id) <= 160;
const boundedIdSql = "CASE WHEN length(CAST(id AS BLOB)) BETWEEN 1 AND 160 THEN id ELSE NULL END id";
const invalid = (): never => { throw new DomainError("PROPOSAL_UNAVAILABLE", "Saved recording proposal evidence is unavailable"); };
class ProjectionLimit extends DomainError {
  constructor(readonly reason: "record" | "budget") { super("PROPOSAL_TOO_LARGE", "Saved recording proposal exceeds this bounded view"); }
}

/** One request-wide budget, including shared historical closure, before body retrieval/JSON allocation.
 * Cache hits do not hydrate again. The only direct body read in the reused validators is a small keyed event.
 */
class ProjectionReader {
  readonly reader: TranscriptionAuthorityStore;
  readBytes = 0;
  private readonly cache = new Map<string, unknown>();
  constructor(readonly store: Store, readonly projectId: string) {
    invariant(validId(projectId), "VALIDATION_ERROR", "Invalid project identity");
    const db = new Proxy(store.db, { get: (target, name) => {
      if (name !== "prepare") { const value = Reflect.get(target, name); return typeof value === "function" ? value.bind(target) : value; }
      return (sql: string) => {
        if (sql === "SELECT body FROM events WHERE project_id=? AND sequence=?") return { get: (id: string, sequence: number) => {
          if (id !== this.projectId) invalid();
          const key = `event:${id}:${sequence}`;
          if (!this.cache.has(key)) {
            const meta = target.prepare("SELECT length(CAST(body AS BLOB)) bytes FROM events WHERE project_id=? AND sequence=?").get(id, sequence) as { bytes: number } | undefined;
            invariant(meta, "PROPOSAL_UNAVAILABLE", "Recording publication event is unavailable"); this.charge(meta.bytes);
            this.cache.set(key, target.prepare(sql).get(id, sequence));
          }
          return this.cache.get(key);
        } };
        // Historical validators otherwise query only metadata. Do not silently add an unbudgeted body path.
        invariant(!/^SELECT\s+(?:\w+\.)?body\b/i.test(sql), "PROPOSAL_UNAVAILABLE", "Unbounded recording evidence query");
        return target.prepare(sql);
      };
    } });
    this.reader = { db, get: <T>(kind: string, id: string) => this.get<T>(kind, id), getProject: (id: string) => this.project(id) };
  }
  private charge(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > OWNED_TRANSCRIPTION_PROJECTION_LIMITS.recordBytes) throw new ProjectionLimit("record");
    if (this.readBytes + bytes > OWNED_TRANSCRIPTION_PROJECTION_LIMITS.readBytes) throw new ProjectionLimit("budget");
    this.readBytes += bytes;
  }
  get<T>(kind: string, id: string): T | undefined {
    if (!validId(id)) invalid(); const key = `entity:${kind}:${id}`;
    if (!this.cache.has(key)) {
      const meta = this.store.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind=? AND id=?").get(kind, id) as { project_id: string; bytes: number } | undefined;
      if (!meta) { this.cache.set(key, undefined); return undefined; }
      if (meta.project_id !== this.projectId) invalid(); this.charge(meta.bytes);
      const row = this.store.db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, id) as { body: string };
      this.cache.set(key, JSON.parse(row.body));
    }
    return this.cache.get(key) as T | undefined;
  }
  project(id = this.projectId): ProjectRecord {
    if (id !== this.projectId) invalid(); const key = `project:${id}`;
    if (!this.cache.has(key)) {
      const meta = this.store.db.prepare("SELECT length(CAST(body AS BLOB)) bytes FROM projects WHERE id=?").get(id) as { bytes: number } | undefined;
      invariant(meta, "NOT_FOUND", "Project not found"); this.charge(meta.bytes);
      const row = this.store.db.prepare("SELECT body FROM projects WHERE id=?").get(id) as { body: string };
      this.cache.set(key, JSON.parse(row.body));
    }
    return this.cache.get(key) as ProjectRecord;
  }
}
const read = <T>(store: Store, work: () => T): T => store.db.inTransaction ? work() : store.db.transaction(work).deferred();
const response = <T>(value: T): T => { invariant(size(value) <= OWNED_TRANSCRIPTION_PROJECTION_LIMITS.responseBytes,
  "PROPOSAL_TOO_LARGE", "Recording proposal view is too large"); return freeze(value); };

/** Safe shape projection, not an ownership assertion. Library/proposal callers separately validate the saved row. */
export function ownedTranscriptionAudioSummary(input: NarrationAudio): OwnedTranscriptionAudioSummary & { sourceRecordDigest: string } {
  const audio = snapshotOwnedTranscriptionData(input, 128 * 1024); assertTranscriptionAudioSource(audio.media);
  invariant(validId(audio.id) && audio.id === audio.media.artifactId, "PROPOSAL_UNAVAILABLE", "Recording identity is unavailable");
  return freeze({ id: audio.id, sha256: audio.media.sha256, durationSeconds: audio.media.probe.audio!.samples! / 48000,
    origin: narrationAudioOrigin(audio), originEvidence: isVerifiedGeneratedNarrationAudio(audio) ? "verified_generated_audio" : "human_declared",
    sourceRecordDigest: digest(audio) });
}

// Choices come from the existing exact provider validator, not a second language policy.
const languages = (): string[] => {
  const result = ["auto"];
  for (let a = 97; a <= 122; a++) for (let b = 97; b <= 122; b++) {
    const language = String.fromCharCode(a, b);
    try { validateOpenAITranscriptionOptions({ model: OPENAI_TRANSCRIPTION_MODEL, language, timing: "word" }); result.push(language); } catch { /* Unsupported code. */ }
  }
  return result;
};
const languageChoices = freeze(languages());
export function projectOwnedTranscriptionOptions(production: ProductionService, projectId: string) {
  return read(production.store, () => {
    const view = new ProjectionReader(production.store, projectId), project = view.project();
    const lock = view.get<{ profiles: ProviderProfile[] }>("capability_lock", project.capabilityLockId);
    invariant(lock && Array.isArray(lock.profiles) && lock.profiles.length <= 512, "PROPOSAL_UNAVAILABLE", "Pinned project profiles are unavailable");
    const profiles: Array<{ id: string; revision: string; provider: "OpenAI"; model: string; estimatedMicros: string; currency: "USD" }> = [];
    for (const profile of lock.profiles) {
      try { const info = preflightAudioProfile(profile); if (info.kind === "transcription") profiles.push({ id: info.id, revision: info.revision,
        provider: "OpenAI", model: info.model, estimatedMicros: info.estimatedMicros, currency: "USD" }); }
      catch (error) { if (!(error instanceof DomainError)) throw error; }
    }
    return response({ version: 1 as const, profiles, languages: [...languageChoices], timing: "word" as const });
  });
}

function summary(view: ProjectionReader, proposalId: string): OwnedTranscriptionProposalSummary {
  const proposal = view.get<OwnedTranscriptionProposal>("owned_transcription_proposal", proposalId);
  assertOwnedTranscriptionProposal(view.reader, view.projectId, proposal);
  invariant(proposal.id === proposalId, "PROPOSAL_UNAVAILABLE", "Recording proposal identity differs");
  const source = view.get<OwnedTranscriptionSource>("owned_transcription_source", proposal.sourceBinding.id)!;
  const { sourceRecordDigest: _digest, ...audio } = ownedTranscriptionAudioSummary(view.get<NarrationAudio>("narration_audio", source.sourceRecord.id)!);
  const profile = preflightAudioProfile(proposal.profile);
  return { version: 1, id: proposal.id, proposalDigest: digest(proposal), audio, target: structuredClone(source.target),
    model: { profileId: profile.id, provider: "OpenAI", model: profile.model, revision: profile.revision },
    language: proposal.operation.language, timing: "word", estimatedMicros: profile.estimatedMicros, currency: "USD",
    plan: { preservedOperations: proposal.compiled.nodes.length - 1, addedOperations: 1 },
    baseProject: { headVersion: proposal.baseProject.headVersion, revisionId: proposal.baseProject.revisionId } };
}
export function summarizeOwnedTranscriptionProposal(store: Store, projectId: string, proposalId: string): OwnedTranscriptionProposalSummary {
  return read(store, () => { const view = new ProjectionReader(store, projectId); view.project(); return response(summary(view, proposalId)); });
}

const eligibilityCodes = new Set(["REVISION_CONFLICT", "CAPABILITY_MISMATCH", "OWNED_TRANSCRIPTION_STALE", "STAGE_BINDING_CONFLICT"]);
function recoveryCode(view: ProjectionReader, proposalId: string): string | null {
  const db = view.store.db;
  if (db.prepare("SELECT 1 FROM installation_recoveries WHERE release_receipt IS NULL LIMIT 1").get()) return "INSTALLATION_QUARANTINED";
  if (db.prepare("SELECT 1 FROM entities WHERE kind='installation_recovery_fence' AND project_id=? AND json_extract(body,'$.kind')='owned_transcription_proposal' AND json_extract(body,'$.recordId')=? LIMIT 1")
    .get(view.projectId, proposalId)) return "RESTORED_AUTHORITY_REQUIRES_NEW";
  return null;
}
/** Read-only display checks; the mutation still performs the complete recovery guard and fresh human authorization. */
function eligibility(view: ProjectionReader, proposal: OwnedTranscriptionProposalSummary, applied: boolean): OwnedTranscriptionProposalDetail["eligibility"] {
  const recovery = recoveryCode(view, proposal.id);
  if (recovery) return { current: false, code: recovery };
  if (applied) return { current: false, code: "APPLIED" };
  try { currentOwnedTranscriptionReview(view.reader as Store, view.projectId, { key: "read-only-projection", proposalId: proposal.id, proposalDigest: proposal.proposalDigest }); return { current: true, code: null }; }
  catch (error) {
    if (error instanceof ProjectionLimit) throw error;
    if (!(error instanceof DomainError)) throw error;
    return { current: false, code: eligibilityCodes.has(error.code) ? error.code : "PROPOSAL_UNAVAILABLE" };
  }
}
function executionBlocker(view: ProjectionReader, resolved: ResolvedOwnedTranscriptionApplication): string | null {
  const recovery = recoveryCode(view, resolved.proposal.id); if (recovery) return recovery;
  const project = view.project(), node = resolved.proposal.compiled.nodes.find(item => item.id === resolved.review.nodeId)!;
  try { assertOwnedTranscriptionCurrent(view.reader, project, node, resolved.application.id, resolved); }
  catch (error) { if (error instanceof DomainError && error.code === "SUBMISSION_PREPARATION_OBSOLETE") return error.code; throw error; }
  if (view.get<{ paused: boolean }>("execution_control", project.id)?.paused) return "EXECUTION_PAUSED";
  // The validated owned node has a literal source, no upstream operations and no shot/scene scope.
  // Therefore the Engine's transitive hold traversal reduces to active project holds here.
  if (view.store.db.prepare("SELECT 1 FROM entities WHERE kind='hold' AND project_id=? AND json_extract(body,'$.active')=1 AND json_extract(body,'$.scopeId')=? LIMIT 1")
    .get(project.id, project.id)) return "EXECUTION_HELD";
  return null;
}
function detail(view: ProjectionReader, proposalId: string): OwnedTranscriptionProposalDetail {
  const proposal = summary(view, proposalId);
  const result: OwnedTranscriptionProposalDetail = { proposal, eligibility: { current: false, code: null }, application: null,
    execution: { state: "not_applied", generationCandidateId: null, attemptId: null, code: null } };
  try {
    // No proposal backlink exists. Discover at most two review IDs in SQLite; only then hydrate keyed evidence.
    const reviews = view.store.db.prepare(`SELECT ${boundedIdSql} FROM entities WHERE kind='owned_transcription_review' AND project_id=? AND json_extract(body,'$.proposal.id')=? ORDER BY rowid LIMIT 2`)
      .all(view.projectId, proposal.id) as { id: string | null }[];
    invariant(reviews.length <= 1, "PROPOSAL_UNAVAILABLE", "Recording proposal has conflicting reviews");
    if (reviews.length) {
      const reviewId = reviews[0]!.id;
      invariant(validId(reviewId), "PROPOSAL_UNAVAILABLE", "Recording review identity is unavailable");
      const candidate = view.store.db.prepare(`SELECT ${boundedIdSql} FROM entities WHERE kind='candidate' AND project_id=? AND json_extract(body,'$.grantId')=? LIMIT 1`)
        .get(view.projectId, reviewId) as { id: string | null } | undefined;
      invariant(candidate && validId(candidate.id), "PROPOSAL_UNAVAILABLE", "Recording review has no applied candidate");
      const candidateId = candidate.id;
      const resolved = resolveOwnedTranscriptionApplication(view.reader, view.projectId, candidateId), { application, review } = resolved;
      invariant(resolved.proposal.id === proposal.id && digest(resolved.proposal) === proposal.proposalDigest, "PROPOSAL_UNAVAILABLE", "Recording application differs from its proposal");
      result.application = { proposalId: proposal.id, proposalDigest: proposal.proposalDigest, reviewId: review.id,
        applicationId: application.id, grantId: review.id, candidateId: application.id, applied: structuredClone(application.receipt) };
      result.execution = { state: "ready", generationCandidateId: candidateId, attemptId: null, code: null };
      const row = view.store.db.prepare(`SELECT ${boundedIdSql} FROM entities WHERE kind='attempt' AND project_id=? AND json_extract(body,'$.candidateId')=? ORDER BY json_extract(body,'$.ordinal') DESC LIMIT 1`)
        .get(view.projectId, candidateId) as { id: string | null } | undefined;
      let beforeDispatch = !row;
      if (row) {
        invariant(validId(row.id), "PROPOSAL_UNAVAILABLE", "Recording attempt identity is unavailable");
        const attempt = view.get<Attempt>("attempt", row.id)!;
        const phases: Attempt["phase"][] = ["submitting", "preparing", "submission_unknown", "remote_pending", "ingesting", "succeeded", "failed"];
        invariant(attempt && attempt.id === row.id && attempt.projectId === view.projectId && phases.includes(attempt.phase)
          && assertOwnedTranscriptionAttemptInput(view.reader, attempt)?.application.id === candidateId,
          "PROPOSAL_UNAVAILABLE", "Recording attempt differs from its application");
        assertTranscriptionPreparationAttemptState(view.reader, attempt);
        result.execution = { state: attempt.phase, generationCandidateId: candidateId, attemptId: attempt.id, code: attempt.phase === "failed" ? "EXECUTION_FAILED" : null };
        beforeDispatch = (attempt.phase === "submitting" || attempt.phase === "preparing")
          && !view.get("transcription_execution_dispatch", attempt.id) && !view.get("transcription_execution_result", attempt.id);
      }
      if (beforeDispatch) {
        result.execution.code = executionBlocker(view, resolved);
        if (result.execution.code === "SUBMISSION_PREPARATION_OBSOLETE") result.execution.state = "unavailable";
      }
    }
  } catch (error) {
    if (error instanceof ProjectionLimit) throw error;
    if (!(error instanceof DomainError)) throw error;
    result.execution = { state: "unavailable", generationCandidateId: result.application?.candidateId ?? null, attemptId: null, code: "PROPOSAL_UNAVAILABLE" };
  }
  result.eligibility = result.execution.state === "unavailable" && result.application === null ? { current: false, code: "PROPOSAL_UNAVAILABLE" }
    : eligibility(view, proposal, result.application !== null);
  return result;
}
export function projectOwnedTranscriptionProposal(store: Store, projectId: string, proposalId: string): OwnedTranscriptionProposalDetail {
  return read(store, () => { const view = new ProjectionReader(store, projectId); view.project(); return response(detail(view, proposalId)); });
}

/** Offset advances over unavailable rows. On cumulative exhaustion it stops before the next row;
 * if that row alone exhausts the budget it is explicitly unavailable, so pagination cannot loop forever.
 * Invalid stored IDs use an unavailable row token, never an actionable proposal identity.
 * Inventory includes unavailable/oversized rows and is stable across application, jobs and unrelated edits.
 */
export function projectOwnedTranscriptionProposals(store: Store, projectId: string, offset = 0, expectedDigest?: string): OwnedTranscriptionProposalPage {
  invariant(Number.isSafeInteger(offset) && offset >= 0 && offset <= OWNED_TRANSCRIPTION_PROJECTION_LIMITS.maximumOffset,
    "VALIDATION_ERROR", "Invalid recording proposal offset");
  return read(store, () => {
    const view = new ProjectionReader(store, projectId); view.project();
    const where = "kind='owned_transcription_proposal' AND project_id=?";
    const inventory = store.db.prepare(`SELECT COUNT(*) total,COALESCE(MAX(rowid),0) newest FROM entities WHERE ${where}`).get(projectId) as { total: number; newest: number };
    const dataDigest = digest({ projectId, ...inventory });
    invariant(expectedDigest === undefined || expectedDigest === dataDigest, "REVISION_CONFLICT", "Recording proposal library changed; refresh its first page");
    invariant(offset <= inventory.total, "VALIDATION_ERROR", "Recording proposal offset exceeds the library");
    const rows = store.db.prepare(`SELECT ${boundedIdSql},rowid,length(CAST(body AS BLOB)) bytes FROM entities WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`)
      .all(projectId, OWNED_TRANSCRIPTION_PROJECTION_LIMITS.rows, offset) as { id: string | null; rowid: number; bytes: number }[];
    const proposals: OwnedTranscriptionProposalPage["proposals"] = [];
    for (const row of rows) {
      let item: OwnedTranscriptionProposalPage["proposals"][number];
      const displayId = row.id ?? `unavailable-row-${row.rowid}`;
      try {
        invariant(validId(row.id), "PROPOSAL_UNAVAILABLE", "Recording proposal identity is unavailable");
        if (row.bytes > OWNED_TRANSCRIPTION_PROJECTION_LIMITS.recordBytes) throw new ProjectionLimit("record");
        item = { id: row.id, proposal: summary(view, row.id), unavailableCode: null };
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        if (error instanceof ProjectionLimit && error.reason === "budget" && proposals.length) break;
        item = { id: displayId, proposal: null, unavailableCode: error instanceof ProjectionLimit ? "PROPOSAL_TOO_LARGE" : "PROPOSAL_UNAVAILABLE" };
      }
      if (size([...proposals, item]) > OWNED_TRANSCRIPTION_PROJECTION_LIMITS.responseBytes - 1024) {
        if (proposals.length) break;
        item = { id: displayId, proposal: null, unavailableCode: "PROPOSAL_TOO_LARGE" };
      }
      proposals.push(item);
    }
    const scanned = proposals.length;
    return response({ proposals, coverage: { offset, scanned, total: inventory.total,
      nextOffset: offset + scanned < inventory.total ? offset + scanned : null, dataDigest, readBytes: view.readBytes } });
  });
}
