import Database from "better-sqlite3";
import { mkdirSync, existsSync, openSync, closeSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonical, digest, DomainError, invariant, newId } from "@openslate/core";
import type { JsonObject, ProjectEvent, ProjectRecord } from "@openslate/core";
import { verifySchema } from "./schema.js";
import { initializeDatabase } from "./migrations.js";
import { flushSnapshot, prepareSnapshotDirectory, snapshotDatabase, verifyDatabase } from "./database-snapshot.js";
import { assertVideoDerivationIntent, assertVideoDerivationReceipt } from "../execution/video-derivation.js";
import type { VideoDerivationIntent, VideoDerivationReceipt } from "../execution/video-derivation.js";
import { assertAudioDerivationIntent, assertAudioDerivationReceipt, assertNormalizedAudioIngestion } from "../execution/audio-derivation.js";
import type { AudioDerivationIntent, AudioDerivationReceipt } from "../execution/audio-derivation.js";
import { assertTranscriptionAudioIntent, assertTranscriptionAudioReceipt, resolveTranscriptionAudioSource, transcriptionAudioInput } from "../execution/transcription-audio.js";
import type { TranscriptionAudioIntent, TranscriptionAudioReceipt, TranscriptionAudioSourceRecord } from "../execution/transcription-audio.js";
import { assertSpeechMappingAdmission, resolveSpeechAdmission } from "../execution/audio-execution-authority.js";
import { assertSpeechSpoolLineage } from "../execution/audio-execution-lineage.js";
import { assertSpeechExecutionDispatch, assertSpeechExecutionResult } from "../execution/audio-execution-receipts.js";
import type { SpeechExecutionMapping, SpeechExecutionDispatch, SpeechExecutionResult } from "../execution/audio-execution-receipts.js";
import { assertTranscriptionMappingAdmission, resolveTranscriptionAdmission, resolveTranscriptionPreparation } from "../execution/transcription-execution-authority.js";
import { assertTranscriptionExecutionDispatch, assertTranscriptionExecutionResult } from "../execution/transcription-execution-receipts.js";
import type { TranscriptionExecutionMapping, TranscriptionExecutionDispatch, TranscriptionExecutionResult } from "../execution/transcription-execution-receipts.js";
import { assertTranscriptionPreparationIntent, resolveTranscriptionPreparationIntent } from "../execution/transcription-preparation.js";
import type { TranscriptionPreparationIntent } from "../execution/transcription-preparation.js";
import { assertTranscriptionPreparationAttemptState, assertTranscriptionPreparationMapping, assertTranscriptionPreparationTransition } from "./transcription-preparation-state.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import { assertTranscriptCandidateIngestion, resolveTranscriptionSpoolLineage } from "../execution/transcript-candidate.js";
import type { TranscriptCandidate } from "../execution/transcript-candidate.js";
import { assertOutputReceiptIdentity } from "../execution/output-store.js";
import type { OutputReceipt } from "../execution/output-store.js";
import type { Attempt, ArtifactRecord } from "../execution/engine.js";
import { assertImageExecutionDispatch, assertImageExecutionMapping, assertImageExecutionResult } from "../execution/openai-image-receipts.js";
import type { ImageExecutionDispatch, ImageExecutionMapping, ImageExecutionResult } from "../execution/openai-image-receipts.js";
import { assertH3ExecutionMapping, assertH3ExecutionDispatch, assertH3ExecutionSubmit, assertH3ExecutionObservation, assertH3PollSchedule } from "../execution/minimax-h3-receipts.js";
import type { H3ExecutionMapping, H3ExecutionDispatch, H3ExecutionSubmit, H3ExecutionObservation, H3PollSchedule } from "../execution/minimax-h3-receipts.js";
import { assertExternalAllowance, assertExternalAllowanceConsumption, assertExternalAllowanceRevocation } from "../execution/external-allowance-records.js";
import type { AllowanceHumanRequest, ExternalAllowance, ExternalAllowanceConsumption, ExternalAllowanceRevocation } from "../execution/external-allowance-records.js";
import { assertProjectBudgetRevision } from "../application/project-budget.js";
import type { ProjectBudgetRevision } from "../application/project-budget.js";
import { assertLocalExecutionDispatch, assertLocalExecutionIntent, assertLocalExecutionResult, assertPreparedLocalExecution } from "../execution/local-execution.js";
import type { LocalExecutionBinding, LocalExecutionCompletion, LocalExecutionDispatch, LocalExecutionIntent } from "../execution/local-execution.js";
import { assertRecoveryFence, assertRecoveryReceipt, assertRecoveryRelease, recoveryBodyHash } from "./recovery-records.js";
import type { InstallationRecoveryRow, RecoveryFence, RecoveryReceipt, RecoveryReleaseReceipt } from "./recovery-records.js";
import { assertGeneratedCanonicalNarrationSegment, assertGeneratedNarrationAudio } from "../narration/generated-audio.js";
import { assertTranscriptCanonicalSegment, assertTranscriptSelection, assertTranscriptSelectionOutput, transcriptCanonicalProvenance } from "../narration/transcript-selection.js";
import type { CanonicalNarration, PreparedNarrationCommit } from "../narration/canonical-types.js";
import type { NarrationAudio } from "../narration/types.js";
import { assertOwnedTranscriptionSource, assertOwnedTranscriptionProposal } from "../narration/owned-transcription-records.js";

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
      assertTranscriptionPreparationAttemptState(this, { ...body, id, projectId } as unknown as Attempt);
    }
    if (kind === "reservation") reference("attempt", body.attemptId);
    if (kind === "owned_transcription_source") assertOwnedTranscriptionSource(this, projectId, { ...body, id, projectId });
    if (kind === "owned_transcription_proposal") assertOwnedTranscriptionProposal(this, projectId, { ...body, id, projectId });
    if (kind === "narration_transcript_selection") assertTranscriptSelection(this, projectId, { ...body, id, projectId });
    if (kind === "narration_segment" || kind === "narration_cue")
      assertTranscriptSelectionOutput(this, projectId, kind, { ...body, id, projectId });
    if (kind === "narration_audio" && (Object.hasOwn(body, "originEvidence") || Object.hasOwn(body, "generation"))) {
      const audio = { ...body, id, projectId };
      assertGeneratedNarrationAudio(this, projectId, audio);
      reference("artifact", id); reference("media_source", id);
    }
    if (kind === "narration_prepared") {
      const prepared = body as unknown as PreparedNarrationCommit;
      for (const view of prepared.snapshot?.segments ?? []) {
        transcriptCanonicalProvenance(this, projectId, view.script, view.cue);
        const saved = view.audio ? this.get<NarrationAudio>("narration_audio", view.audio.id) : undefined;
        if (!view.audio || !(Object.hasOwn(view.audio, "originEvidence") || Object.hasOwn(view.audio, "generation") || saved && Object.hasOwn(saved, "generation"))) continue;
        reference("narration_audio", view.audio.id); assertGeneratedNarrationAudio(this, projectId, view.audio);
        invariant(canonical(saved) === canonical(view.audio), "NARRATION_INTEGRITY_ERROR", "Prepared generated recording differs from its saved provenance");
      }
    }
    if (kind === "narration_canonical") {
      const value = body as unknown as CanonicalNarration;
      for (const segment of value.segments ?? []) {
        assertTranscriptCanonicalSegment(this, projectId, segment,
          { narrationRevisionId: value.narrationRevisionId, narrationVersion: value.narrationVersion });
        const provenance = segment.provenance;
        const saved = provenance ? this.get<NarrationAudio>("narration_audio", provenance.audioId) : undefined;
        if (!provenance || provenance.originEvidence === "human_declared_supplied_recording" && !Object.hasOwn(provenance, "generation") && !(saved && Object.hasOwn(saved, "generation"))) continue;
        assertGeneratedCanonicalNarrationSegment(this, projectId, segment,
          { narrationRevisionId: value.narrationRevisionId, narrationVersion: value.narrationVersion });
      }
    }
    if (kind === "installation_recovery_fence") {
      const fence = { ...body, id, projectId } as unknown as RecoveryFence; assertRecoveryFence(fence);
      reference(fence.kind, fence.recordId);
      const recovery = this.installationRecoveries().find(row => row.receipt.restoreId === fence.restoreId);
      invariant(recovery?.receipt.projectIds.includes(projectId), "RECOVERY_INVALID", "Fence has no matching recovery receipt");
      // The first insert must capture the exact original row before restoration transitions.
      if (!this.get(kind, id)) {
        const original = this.db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(fence.kind, fence.recordId) as { body: string };
        invariant(recoveryBodyHash(original.body) === fence.originalBodySha256 && (fence.originalBody === null || fence.originalBody === original.body),
          "RECOVERY_INVALID", "Fence does not match the exact original record");
      }
    }
    if (kind === "local_execution_intent") {
      reference("attempt", id); reference("capability_lock", body.capabilityLockId);
      const intent = { ...body, id, projectId } as unknown as LocalExecutionIntent;
      assertLocalExecutionIntent(intent, this.get<Attempt>("attempt", id)!);
      const lock = this.get<{ localExecution?: unknown }>("capability_lock", intent.capabilityLockId);
      invariant(canonical(lock?.localExecution) === canonical(intent.execution), "LOCAL_EXECUTION_CONFLICT", "Local intent requires its exact saved execution lock");
    }
    if (kind === "local_execution_dispatch") {
      reference("local_execution_intent", id);
      assertLocalExecutionDispatch({ ...body, id, projectId } as unknown as LocalExecutionDispatch, this.get<LocalExecutionIntent>("local_execution_intent", id)!);
    }
    if (kind === "local_execution_completion") {
      reference("local_execution_intent", id);
      const completion = { ...body, id, projectId } as unknown as LocalExecutionCompletion;
      invariant(Object.keys(completion).length === 5 && completion.version === 1 && completion.attemptId === id,
        "LOCAL_EXECUTION_CONFLICT", "Invalid local completion fields");
      const intent = this.get<LocalExecutionIntent>("local_execution_intent", id)!;
      assertLocalExecutionResult(completion.result, intent); reference("artifact", completion.result.artifact.id);
      invariant(canonical(this.get("artifact", completion.result.artifact.id)) === canonical(completion.result.artifact),
        "LOCAL_EXECUTION_CONFLICT", "Local receipt differs from the published artifact");
    }
    if (kind === "local_execution_binding") {
      reference("node_binding", id); reference("local_execution_completion", body.attemptId);
      const selection = { ...body, id, projectId } as unknown as LocalExecutionBinding;
      invariant(Object.keys(selection).length === 4, "LOCAL_EXECUTION_CONFLICT", "Invalid local selection fields");
      assertPreparedLocalExecution(selection.prepared);
      const intent = this.get<LocalExecutionIntent>("local_execution_intent", selection.attemptId)!;
      invariant(selection.prepared.projectId === projectId && selection.prepared.nodeId === id
        && selection.prepared.nodeId === intent.prepared.nodeId && selection.prepared.kind === intent.prepared.kind
        && selection.prepared.specDigest === intent.prepared.specDigest && selection.prepared.contentDigest === intent.prepared.contentDigest,
      "LOCAL_EXECUTION_CONFLICT", "Local selection differs from the verified completed work");
    }
    if (kind === "project_budget_revision") {
      reference("message", body.requestId);
      assertProjectBudgetRevision({ ...body, id, projectId } as unknown as ProjectBudgetRevision,
        this.get<AllowanceHumanRequest & { editing: boolean }>("message", String(body.requestId))!);
    }
    if (kind === "external_allowance") {
      reference("message", body.requestId);
      const allowance = { ...body, id, projectId } as unknown as ExternalAllowance;
      assertExternalAllowance(allowance, this.get<AllowanceHumanRequest>("message", String(body.requestId))!);
      for (const selected of allowance.selections) {
        reference("candidate", selected.candidateId);
        const candidate = this.get<{ nodeId: string }>("candidate", selected.candidateId)!;
        invariant(candidate.nodeId === selected.nodeId, "ALLOWANCE_INVALID", "Allowance candidate must belong to its selected node");
      }
    }
    if (kind === "external_allowance_revocation") {
      reference("message", body.requestId); reference("external_allowance", body.allowanceId);
      assertExternalAllowanceRevocation({ ...body, id, projectId } as unknown as ExternalAllowanceRevocation,
        this.get<ExternalAllowance>("external_allowance", String(body.allowanceId))!, this.get<AllowanceHumanRequest>("message", String(body.requestId))!);
    }
    if (kind === "external_allowance_consumption") {
      reference("attempt", id); reference("external_allowance", body.allowanceId);
      const attempt = this.get<Attempt>("attempt", id)!;
      reference("reservation", attempt.reservationId);
      assertExternalAllowanceConsumption({ ...body, id, projectId } as unknown as ExternalAllowanceConsumption,
        this.get<ExternalAllowance>("external_allowance", String(body.allowanceId))!, attempt,
        this.get("reservation", attempt.reservationId!)!);
    }
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
      const attempt = this.get<Attempt>("attempt", String(body.attemptId))!;
      invariant(body.requestDigest === digest(attempt.request), "IDENTITY_MISMATCH", "Output receipt must bind its immutable attempt request");
      if (attempt.request.kind === "speech" || attempt.request.kind === "transcription" || body.kind === "audio" || body.kind === "data")
        assertOutputReceiptIdentity({ ...body, id, projectId } as unknown as OutputReceipt, attempt);
    }
    if (kind === "execution_output_spool") {
      reference("execution_output_receipt", body.receiptId);
      const receipt = this.get<Record<string, unknown>>("execution_output_receipt", String(body.receiptId))!;
      invariant(id === body.receiptId && body.attemptId === receipt.attemptId && body.requestDigest === receipt.requestDigest && body.port === receipt.port,
        "IDENTITY_MISMATCH", "Output spool must match its receipt and attempt");
      if (receipt.kind === "audio" || receipt.kind === "data") {
        const source = receipt.source as { kind: string; sha256: string; byteLength: number };
        invariant(body.version === 1 && source.kind === "returned_bytes" && body.sha256 === source.sha256 && body.byteLength === source.byteLength
          && body.blobKey === `${source.sha256}.blob` && typeof body.storageId === "string" && /^[a-f0-9-]{36}$/.test(body.storageId),
        "IDENTITY_MISMATCH", "Audio/data spool must preserve its exact returned-byte receipt");
      }
    }
    if (kind === "execution_output_slot") {
      reference("execution_output_spool", body.spoolId);
      const spool = this.get<Record<string, unknown>>("execution_output_spool", String(body.spoolId))!;
      invariant(id === digest({ projectId, attemptId: body.attemptId, port: body.port }) && body.attemptId === spool.attemptId
        && body.port === spool.port && body.storageId === spool.storageId && body.sha256 === spool.sha256 && body.byteLength === spool.byteLength,
      "IDENTITY_MISMATCH", "Output slot must match its owned spool identity");
    }
    if (["image_execution_mapping", "image_execution_dispatch", "image_execution_result"].includes(kind)) {
      reference("attempt", id);
      const attempt = this.get<Attempt>("attempt", id)!;
      const value = { ...body, id, projectId };
      const mapping = this.get<ImageExecutionMapping>("image_execution_mapping", id);
      const dispatch = this.get<ImageExecutionDispatch>("image_execution_dispatch", id);
      if (kind === "image_execution_mapping") {
        // A failed local preparation freezes its absence of a mapping as well.
        invariant(!this.get("image_execution_result", id) || !!mapping, "IMAGE_EXECUTION_CONFLICT", "Terminal image preparation cannot acquire a new mapping");
        assertImageExecutionMapping(attempt, value as unknown as ImageExecutionMapping);
        for (const input of (value as unknown as ImageExecutionMapping).transport.inputs) reference("artifact", input.artifactId);
      } else if (kind === "image_execution_dispatch") {
        reference("image_execution_mapping", id);
        invariant(!this.get("image_execution_result", id) || !!dispatch, "IMAGE_EXECUTION_CONFLICT", "Terminal image preparation cannot acquire a dispatch");
        assertImageExecutionDispatch(attempt, mapping!, value as unknown as ImageExecutionDispatch);
      } else {
        const result = value as unknown as ImageExecutionResult;
        const outputId = result.observation?.kind === "completed" ? result.observation.outputReceiptId : undefined;
        if (outputId !== undefined) reference("execution_output_receipt", outputId);
        assertImageExecutionResult(attempt, mapping, dispatch, result, outputId ? this.get("execution_output_receipt", outputId) : undefined);
      }
    }
    if (["speech_execution_mapping", "speech_execution_dispatch", "speech_execution_result"].includes(kind)) {
      reference("attempt", id);
      const attempt = this.get<Attempt>("attempt", id)!, value = { ...body, id, projectId };
      const mapping = this.get<SpeechExecutionMapping>("speech_execution_mapping", id);
      const dispatch = this.get<SpeechExecutionDispatch>("speech_execution_dispatch", id);
      const pin = kind === "speech_execution_mapping" ? value as unknown as SpeechExecutionMapping : mapping;
      const admission = resolveSpeechAdmission(this, attempt.request, pin);
      if (pin) { reference("capability_lock", pin.capabilityLockId); assertSpeechMappingAdmission(admission, pin); }
      if (kind === "speech_execution_mapping") {
        invariant(!this.get("speech_execution_result", id) || !!mapping, "SPEECH_EXECUTION_CONFLICT", "A terminal speech preparation cannot acquire another mapping");
      } else if (kind === "speech_execution_dispatch") {
        reference("speech_execution_mapping", id);
        invariant(!this.get("speech_execution_result", id) || !!dispatch, "SPEECH_EXECUTION_CONFLICT", "A terminal speech preparation cannot acquire a dispatch");
        assertSpeechExecutionDispatch(attempt, mapping!, value as unknown as SpeechExecutionDispatch);
      } else {
        const result = value as unknown as SpeechExecutionResult;
        const outputId = result.observation?.kind === "completed" ? result.observation.outputReceiptId : undefined;
        if (outputId !== undefined) reference("execution_output_receipt", outputId);
        assertSpeechExecutionResult(attempt, mapping, dispatch, result, outputId ? this.get<OutputReceipt>("execution_output_receipt", outputId) : undefined);
      }
    }
    if (kind === "transcription_preparation_intent") {
      reference("attempt", id);
      const attempt = this.get<Attempt>("attempt", id)!, proof = { ...body, id, projectId } as unknown as TranscriptionPreparationIntent;
      assertTranscriptionPreparationIntent(this, attempt, proof);
      if (!this.get(kind, id)) {
        new InstallationRecoveryGuard(this).assertFirstSubmit(projectId, id);
        invariant(attempt.phase === "submitting" && attempt.leaseExpiresAt > Date.now() && !Object.hasOwn(attempt, "preparation")
          && !this.get("transcription_execution_mapping", id) && !this.get("transcription_execution_dispatch", id)
          && !this.get("transcription_execution_result", id), "SUBMISSION_PREPARATION_INVALID", "Preparation proof requires an undispatched original admission");
        invariant(this.get<{ state: string }>("reservation", proof.reservation.id)?.state === "reserved",
          "SUBMISSION_PREPARATION_INVALID", "Preparation proof requires its original reserved liability");
      }
    }
    if (["transcription_execution_mapping", "transcription_execution_dispatch", "transcription_execution_result"].includes(kind)) {
      reference("attempt", id);
      const attempt = this.get<Attempt>("attempt", id)!, value = { ...body, id, projectId };
      const mapping = this.get<TranscriptionExecutionMapping>("transcription_execution_mapping", id);
      const dispatch = this.get<TranscriptionExecutionDispatch>("transcription_execution_dispatch", id);
      const protocol = Object.hasOwn(attempt, "preparation") || this.get("transcription_preparation_intent", id)
        ? resolveTranscriptionPreparationIntent(this, attempt) : undefined;
      const pin = kind === "transcription_execution_mapping" ? value as unknown as TranscriptionExecutionMapping : mapping;
      const admission = resolveTranscriptionAdmission(this, attempt.request, pin);
      const preparation = pin ? resolveTranscriptionPreparation(this, attempt, pin) : undefined;
      if (pin) {
        reference("capability_lock", pin.capabilityLockId); reference("transcription_audio_intent", pin.preparation.intentId);
        reference("transcription_audio_receipt", pin.preparation.receiptId); assertTranscriptionMappingAdmission(admission, pin, preparation!);
        if (protocol) assertTranscriptionPreparationMapping(protocol, pin);
      }
      if (kind === "transcription_execution_mapping") {
        invariant(!this.get("transcription_execution_result", id) || !!mapping, "TRANSCRIPTION_EXECUTION_CONFLICT", "A terminal transcription preparation cannot acquire another mapping");
      } else if (kind === "transcription_execution_dispatch") {
        reference("transcription_execution_mapping", id);
        invariant(!this.get("transcription_execution_result", id) || !!dispatch, "TRANSCRIPTION_EXECUTION_CONFLICT", "A terminal transcription preparation cannot acquire a dispatch");
        if (!dispatch && Object.hasOwn(attempt, "preparation")) {
          new InstallationRecoveryGuard(this).assertFirstSubmit(projectId, id);
          invariant(attempt.phase === "preparing" && attempt.leaseExpiresAt > Date.now()
            && attempt.reservationId !== null && this.get<{ state: string }>("reservation", attempt.reservationId)?.state === "reserved",
          "SUBMISSION_PREPARATION_INVALID", "A preparation dispatch requires the original active waiting phase and liability");
        }
        assertTranscriptionExecutionDispatch(attempt, mapping!, value as unknown as TranscriptionExecutionDispatch, preparation!);
      } else {
        const result = value as unknown as TranscriptionExecutionResult;
        const outputId = result.observation?.kind === "completed" ? result.observation.outputReceiptId : undefined;
        if (outputId !== undefined) reference("execution_output_receipt", outputId);
        assertTranscriptionExecutionResult(attempt, mapping, dispatch, result, preparation, outputId ? this.get<OutputReceipt>("execution_output_receipt", outputId) : undefined);
      }
    }
    if (kind === "transcript_candidate") {
      const candidate = { ...body, id, projectId } as unknown as TranscriptCandidate;
      reference("attempt", candidate.attemptId); reference("artifact", candidate.artifactId);
      reference("execution_output_receipt", candidate.raw?.receiptId); reference("execution_output_spool", candidate.raw?.spoolId);
      reference("transcription_execution_mapping", candidate.attemptId); reference("transcription_execution_dispatch", candidate.attemptId);
      reference("transcription_execution_result", candidate.attemptId); reference("transcription_audio_intent", candidate.preparation?.intentId);
      reference("transcription_audio_receipt", candidate.preparation?.receiptId);
      const lineage = resolveTranscriptionSpoolLineage(this, this.get<Attempt>("attempt", candidate.attemptId)!, candidate.raw.spoolId);
      const artifact = this.get<ArtifactRecord>("artifact", candidate.artifactId)!;
      assertTranscriptCandidateIngestion(lineage, { port: "cues", kind: "data", mimeType: "application/json", extension: "json",
        sha256: lineage.spool.sha256, byteLength: lineage.spool.byteLength, fixture: false,
        storage: { type: "spool", spoolId: lineage.spool.id } }, { type: "transcript_candidate", artifact, candidate });
    }
    if (["h3_execution_mapping", "h3_execution_dispatch", "h3_execution_submit", "h3_execution_observation", "h3_poll_schedule"].includes(kind)) {
      reference("attempt", body.attemptId);
      const attempt = this.get<Attempt>("attempt", String(body.attemptId))!;
      const mapping = this.get<H3ExecutionMapping>("h3_execution_mapping", attempt.id), dispatch = this.get<H3ExecutionDispatch>("h3_execution_dispatch", attempt.id);
      const submit = this.get<H3ExecutionSubmit>("h3_execution_submit", attempt.id), value = { ...body, id, projectId };
      if (kind === "h3_execution_mapping") {
        invariant(!submit || !!mapping, "H3_EXECUTION_CONFLICT", "Closed H3 preparation cannot acquire a mapping");
        assertH3ExecutionMapping(attempt, value as unknown as H3ExecutionMapping); reference("artifact", body.firstFrameArtifactId);
      } else if (kind === "h3_execution_dispatch") {
        reference("h3_execution_mapping", attempt.id);
        invariant(!submit || !!dispatch, "H3_EXECUTION_CONFLICT", "Closed H3 preparation cannot acquire a dispatch");
        assertH3ExecutionDispatch(attempt, mapping!, value as unknown as H3ExecutionDispatch);
      } else if (kind === "h3_execution_submit") assertH3ExecutionSubmit(attempt, mapping, dispatch, value as unknown as H3ExecutionSubmit);
      else {
        reference("h3_execution_mapping", attempt.id); reference("h3_execution_dispatch", attempt.id); reference("h3_execution_submit", attempt.id);
        if (kind === "h3_execution_observation") {
          const observation = value as unknown as H3ExecutionObservation, outputId = observation.observation?.kind === "completed" ? observation.observation.outputReceiptId : undefined;
          if (outputId !== undefined) reference("execution_output_receipt", outputId);
          assertH3ExecutionObservation(attempt, mapping!, dispatch!, submit!, observation, outputId ? this.get("execution_output_receipt", outputId) : undefined);
        } else {
          const schedule = value as unknown as H3PollSchedule; assertH3PollSchedule(attempt, submit!, schedule);
          if (schedule.lastObservationId !== null) {
            reference("h3_execution_observation", schedule.lastObservationId);
            invariant(this.get<H3ExecutionObservation>("h3_execution_observation", schedule.lastObservationId)!.attemptId === attempt.id,
              "H3_EXECUTION_CONFLICT", "Polling schedule cannot adopt another attempt's observation");
          }
        }
      }
    }
    if (kind === "video_derivation_intent") {
      reference("attempt", body.attemptId); reference("execution_output_slot", body.slotId); reference("execution_output_spool", body.spoolId);
      const attempt = this.get<Attempt>("attempt", String(body.attemptId))!;
      const slot = this.get<{ spoolId: string; attemptId: string; port: string }>("execution_output_slot", String(body.slotId))!;
      const spool = this.get<{ sha256: string; byteLength: number }>("execution_output_spool", String(body.spoolId))!;
      invariant(slot.spoolId === body.spoolId && slot.attemptId === body.attemptId && slot.port === "video", "IDENTITY_MISMATCH", "Video derivation must bind the exact winning raw slot");
      assertVideoDerivationIntent({ ...body, id, projectId } as unknown as VideoDerivationIntent, attempt,
        { port: "video", kind: "video", mimeType: "video/mp4", extension: "mp4", sha256: spool.sha256, byteLength: spool.byteLength,
          fixture: false, storage: { type: "spool", spoolId: String(body.spoolId) } });
    }
    if (kind === "video_derivation_receipt") {
      reference("video_derivation_intent", id);
      const intent = this.get<VideoDerivationIntent>("video_derivation_intent", id)!;
      const receipt = { ...body, id, projectId } as unknown as VideoDerivationReceipt;
      assertVideoDerivationReceipt(intent, receipt); reference("artifact", receipt.source.artifactId);
      const artifact = this.get<ArtifactRecord>("artifact", receipt.source.artifactId)!;
      invariant(artifact.attemptId === intent.attemptId && artifact.origin === "generated_video" && artifact.derivationId === id
        && artifact.artifact.sha256 === receipt.source.sha256 && artifact.artifact.kind === "video"
        && artifact.sourceDescriptorId === receipt.source.id && artifact.byteLength === receipt.source.byteLength
        && artifact.outputSpoolId === intent.spoolId && artifact.outputReceiptId === intent.spoolId,
      "IDENTITY_MISMATCH", "Derivation receipt must bind its normalized owned artifact");
    }
    if (kind === "media_source" && body.origin === "generated_video") {
      reference("artifact", id); reference("attempt", body.attemptId); reference("video_derivation_receipt", body.derivationId);
      const receipt = this.get<VideoDerivationReceipt>("video_derivation_receipt", String(body.derivationId))!;
      invariant(receipt.source.artifactId === id && receipt.attemptId === body.attemptId && canonical(receipt.source) === canonical(body.source)
        && body.requestId === undefined, "IDENTITY_MISMATCH", "Generated media source must retain its exact derivation without upload authority");
    }
    if (kind === "audio_derivation_intent") {
      reference("attempt", body.attemptId); reference("execution_output_slot", body.slotId); reference("execution_output_spool", body.spoolId);
      const attempt = this.get<Attempt>("attempt", String(body.attemptId))!;
      const slot = this.get<{ spoolId: string; attemptId: string; port: string }>("execution_output_slot", String(body.slotId))!;
      const spool = this.get<{ sha256: string; byteLength: number }>("execution_output_spool", String(body.spoolId))!;
      invariant(slot.spoolId === body.spoolId && slot.attemptId === body.attemptId && slot.port === "audio",
        "IDENTITY_MISMATCH", "Audio derivation must bind the exact winning raw slot");
      assertSpeechSpoolLineage(this, attempt, String(body.spoolId));
      assertAudioDerivationIntent({ ...body, id, projectId } as unknown as AudioDerivationIntent, attempt,
        { port: "audio", kind: "audio", mimeType: "audio/wav", extension: "wav", sha256: spool.sha256, byteLength: spool.byteLength,
          fixture: false, storage: { type: "spool", spoolId: String(body.spoolId) } });
    }
    if (kind === "transcription_audio_intent") {
      reference("attempt", body.attemptId);
      const intent = { ...body, id, projectId } as unknown as TranscriptionAudioIntent;
      invariant(intent.sourceRecord?.kind === "media_source" || intent.sourceRecord?.kind === "narration_audio",
        "IDENTITY_MISMATCH", "Transcription preparation requires owned media provenance");
      reference(intent.sourceRecord.kind, intent.sourceRecord.id);
      const attempt = this.get<Attempt>("attempt", String(body.attemptId))!;
      const input = transcriptionAudioInput(attempt);
      const records = (["media_source", "narration_audio"] as const).flatMap(sourceKind => {
        const record = this.get<TranscriptionAudioSourceRecord["record"]>(sourceKind, input.artifactId); return record ? [{ kind: sourceKind, record }] : [];
      });
      assertTranscriptionAudioIntent(intent, attempt, resolveTranscriptionAudioSource(attempt, records, intent.sourceRecord));
    }
    if (kind === "transcription_audio_receipt") {
      reference("transcription_audio_intent", id);
      assertTranscriptionAudioReceipt(this.get<TranscriptionAudioIntent>("transcription_audio_intent", id)!,
        { ...body, id, projectId } as unknown as TranscriptionAudioReceipt);
    }
    if (kind === "audio_derivation_receipt") {
      reference("audio_derivation_intent", id);
      const intent = this.get<AudioDerivationIntent>("audio_derivation_intent", id)!;
      const receipt = { ...body, id, projectId } as unknown as AudioDerivationReceipt;
      const attempt = this.get<Attempt>("attempt", intent.attemptId)!;
      assertSpeechSpoolLineage(this, attempt, intent.spoolId);
      assertAudioDerivationReceipt(intent, receipt); reference("artifact", receipt.source.artifactId);
      const artifact = this.get<ArtifactRecord>("artifact", receipt.source.artifactId)!;
      assertNormalizedAudioIngestion(intent, attempt,
        { port: "audio", kind: "audio", mimeType: "audio/wav", extension: "wav", sha256: intent.rawSha256,
          byteLength: intent.rawByteLength, fixture: false, storage: { type: "spool", spoolId: intent.spoolId } },
        { type: "normalized_audio", artifact, derivation: receipt, mediaSource: { id: intent.artifactId, projectId, source: receipt.source,
          origin: "generated_audio", attemptId: intent.attemptId, derivationId: id } });
    }
    if (kind === "media_source" && body.origin === "generated_audio") {
      reference("artifact", id); reference("attempt", body.attemptId); reference("audio_derivation_receipt", body.derivationId);
      const receipt = this.get<AudioDerivationReceipt>("audio_derivation_receipt", String(body.derivationId))!;
      const intent = this.get<AudioDerivationIntent>("audio_derivation_intent", receipt.id)!;
      assertSpeechSpoolLineage(this, this.get<Attempt>("attempt", receipt.attemptId)!, intent.spoolId);
      invariant(canonical({ ...body, id, projectId }) === canonical({ id: receipt.source.artifactId, projectId: receipt.projectId,
        source: receipt.source, origin: "generated_audio", attemptId: receipt.attemptId, derivationId: receipt.id }),
      "IDENTITY_MISMATCH", "Generated audio source must retain its exact derivation without human upload authority");
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
      if (["h3_execution_mapping", "h3_execution_dispatch", "h3_execution_submit", "h3_execution_observation"].includes(kind))
        invariant(old.body === encoded, "IMMUTABLE_RECORD", "H3 execution receipts are immutable");
      if (kind === "h3_poll_schedule") {
        const previous = JSON.parse(old.body) as Record<string, unknown>, next = JSON.parse(encoded) as Record<string, unknown>;
        for (const field of ["version", "attemptId", "requestDigest", "taskId", "policy"])
          invariant(canonical(previous[field]) === canonical(next[field]), "IMMUTABLE_RECORD", "H3 poll identity and host policy are immutable");
        invariant(Number(next.count) >= Number(previous.count), "H3_EXECUTION_CONFLICT", "H3 poll backoff cannot rewind");
      }
      if (["external_allowance", "external_allowance_revocation", "external_allowance_consumption", "project_budget_revision"].includes(kind))
        invariant(old.body === encoded, "IMMUTABLE_RECORD", `${kind} records are immutable`);
      if (["local_execution_intent", "local_execution_dispatch", "local_execution_completion", "installation_recovery_fence"].includes(kind))
        invariant(old.body === encoded, "IMMUTABLE_RECORD", "Local execution receipts are immutable");
      if (["audio_derivation_intent", "audio_derivation_receipt", "transcription_audio_intent", "transcription_audio_receipt",
        "speech_execution_mapping", "speech_execution_dispatch", "speech_execution_result",
        "transcription_execution_mapping", "transcription_execution_dispatch", "transcription_execution_result", "transcription_preparation_intent", "transcript_candidate", "narration_transcript_selection", "owned_transcription_source", "owned_transcription_proposal"].includes(kind))
        invariant(old.body === encoded, "IMMUTABLE_RECORD", "Audio derivation records are immutable");
      if (["grant", "candidate", "artifact", "plan", "review_snapshot", "approval", "execution_evidence", "execution_output_receipt", "execution_output_spool", "execution_output_slot", "image_execution_mapping", "image_execution_dispatch", "image_execution_result", "video_derivation_intent", "video_derivation_receipt", "capability_lock", "director_skill_lock", "director_epoch_lock", "director_context", "skill_activation", "skill_read", "director_output", "tool_reconciliation", "native_model_start", "request_image_selection", "request_image_projection", "media_source", "media_import", "media_import_receipt", "image_import", "image_import_receipt", "narration_session", "narration_segment", "narration_audio", "narration_cue", "narration_acceptance", "narration_revision", "narration_prepared", "narration_canonical", "narration_commit_receipt"].includes(kind))
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
        assertTranscriptionPreparationTransition(previous as unknown as Attempt, next as unknown as Attempt);
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

  /** Read an exact completed command without beginning new asynchronous work. Caller owns authorization. */
  commandReplay<T>(actorScope: string, key: string, requestDigest: string): { result: T } | undefined {
    const old = this.db.prepare("SELECT digest,result FROM commands WHERE actor_scope=? AND key=?").get(actorScope, key) as { digest: string; result: string } | undefined;
    if (!old) return undefined;
    invariant(old.digest === requestDigest, "IDEMPOTENCY_CONFLICT", "Command key was used with different content");
    return { result: JSON.parse(old.result) as T };
  }

  command<T>(actorScope: string, key: string, requestDigest: string, fn: () => T): T {
    invariant(fn.constructor.name !== "AsyncFunction", "ASYNC_TRANSACTION", "Command mutations must be synchronous");
    return this.transaction(() => {
      const old = this.commandReplay<T>(actorScope, key, requestDigest);
      if (old) return old.result;
      const result = fn();
      this.db.prepare("INSERT INTO commands(actor_scope,key,digest,result) VALUES(?,?,?,?)").run(actorScope, key, requestDigest, canonical(result));
      return result;
    });
  }

  installationRecoveries(): InstallationRecoveryRow[] {
    const rows = this.db.prepare("SELECT generation,restore_id,receipt,release_receipt FROM installation_recoveries ORDER BY generation").all() as
      { generation: number; restore_id: string; receipt: string; release_receipt: string | null }[];
    return rows.map(row => {
      const receipt = JSON.parse(row.receipt) as RecoveryReceipt; assertRecoveryReceipt(receipt);
      invariant(receipt.generation === row.generation && receipt.restoreId === row.restore_id, "RECOVERY_INVALID", "Recovery row identity differs");
      const release = row.release_receipt === null ? null : JSON.parse(row.release_receipt) as RecoveryReleaseReceipt;
      if (release) assertRecoveryRelease(release, receipt);
      return { generation: row.generation, receipt, release };
    });
  }

  insertInstallationRecovery(receipt: RecoveryReceipt): RecoveryReceipt {
    const snapshot = JSON.parse(canonical(receipt)) as RecoveryReceipt; assertRecoveryReceipt(snapshot);
    return this.transaction(() => {
      const rows = this.installationRecoveries(), previous = rows.find(row => row.receipt.restoreId === snapshot.restoreId);
      if (previous) { invariant(canonical(previous.receipt) === canonical(snapshot), "IMMUTABLE_RECORD", "Recovery receipt is immutable"); return previous.receipt; }
      invariant(snapshot.generation === (rows.at(-1)?.generation ?? 0) + 1, "RECOVERY_CONFLICT", "Recovery generation changed");
      for (const projectId of snapshot.projectIds) this.getProject(projectId);
      this.db.prepare("INSERT INTO installation_recoveries(generation,restore_id,receipt) VALUES(?,?,?)").run(snapshot.generation, snapshot.restoreId, canonical(snapshot));
      return snapshot;
    });
  }

  releaseInstallationRecovery(value: RecoveryReleaseReceipt): RecoveryReleaseReceipt {
    const snapshot = JSON.parse(canonical(value)) as RecoveryReleaseReceipt;
    return this.transaction(() => {
      const current = this.installationRecoveries().at(-1);
      invariant(current?.receipt.restoreId === snapshot.restoreId, "RECOVERY_CONFLICT", "Release refers to another restoration");
      assertRecoveryRelease(snapshot, current.receipt);
      if (current.release) { invariant(canonical(current.release) === canonical(snapshot), "IMMUTABLE_RECORD", "Recovery release is immutable"); return current.release; }
      const result = this.db.prepare("UPDATE installation_recoveries SET release_receipt=? WHERE restore_id=? AND release_receipt IS NULL")
        .run(canonical(snapshot), snapshot.restoreId);
      invariant(result.changes === 1, "RECOVERY_CONFLICT", "Recovery release changed"); return snapshot;
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
