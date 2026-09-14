import { canonical, digest, effectiveNodeDigest, invariant, parseChangeProposal } from "@openslate/core";
import type { ProjectEvent, ProjectRecord } from "@openslate/core";
import { executionProfileSnapshot } from "@openslate/providers";
import type { Attempt, Candidate, Grant, PlanRecord } from "../execution/engine.js";
import type { NarrationSpeechReader } from "./narration-speech-records.js";
import { assertNarrationSpeechProposal, NARRATION_SPEECH_LIMITS } from "./narration-speech-records.js";
import { snapshotOwnedTranscriptionData } from "./owned-transcription-records.js";
import type { NarrationSpeechApplication, NarrationSpeechAttemptInput, NarrationSpeechProposal, NarrationSpeechReview } from "./narration-speech-types.js";

type Reader = NarrationSpeechReader;
export interface ResolvedNarrationSpeechApplication {
  application: NarrationSpeechApplication; review: NarrationSpeechReview;
  proposal: NarrationSpeechProposal;
}
const fail = (condition: unknown): void => invariant(condition, "NARRATION_SPEECH_AUTHORIZATION_INVALID", "Narration speech approval or application differs from its retained evidence");
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 160;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function exact(value: unknown, fields: string[]): void {
  fail(value !== null && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join("\0") === fields.sort().join("\0"));
}
function get<T>(reader: Reader, projectId: string, kind: string, key: string): T {
  fail(id(key)); const row = reader.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind=? AND id=?").get(kind, key) as { project_id: string; bytes: number } | undefined;
  fail(row?.project_id === projectId && row.bytes <= NARRATION_SPEECH_LIMITS.proposalBytes);
  const value = reader.get<T>(kind, key); fail(value); return snapshotOwnedTranscriptionData(value!);
}
function pin(value: unknown): void {
  exact(value, ["id", "digest"]); const reference = value as { id: unknown; digest: unknown }; fail(id(reference.id) && hash(reference.digest));
}
function reviewEvidence(reader: Reader, projectId: string, input: unknown): Omit<ResolvedNarrationSpeechApplication, "application"> {
  const review = snapshotOwnedTranscriptionData(input, 16384) as NarrationSpeechReview;
  exact(review, ["id", "version", "projectId", "requestId", "principalId", "proposal", "grantDigest", "section", "nodeId", "specDigest", "compiledDigest"]);
  fail(review.version === 1 && review.projectId === projectId && id(review.id) && id(review.requestId) && id(review.principalId)
    && id(review.nodeId) && hash(review.specDigest) && hash(review.compiledDigest) && hash(review.grantDigest));
  pin(review.proposal);
  const proposal = get<NarrationSpeechProposal>(reader, projectId, "narration_speech_proposal", review.proposal.id);
  assertNarrationSpeechProposal(reader, projectId, proposal);
  fail(digest(proposal) === review.proposal.digest && same(review.section, proposal.section) && digest(proposal.compiled) === review.compiledDigest);
  const node = proposal.compiled.nodes.find(item => item.alias === proposal.operation.alias);
  fail(node?.id === review.nodeId && node.specDigest === review.specDigest);
  const grant = get<Grant>(reader, projectId, "grant", review.id);
  fail(digest(grant) === review.grantDigest && same(grant, { id: review.id, projectId, scopeId: projectId,
    kind: "speech", authorityId: review.requestId, origin: "user_change" }));
  const request = get<{ id: string; projectId: string; principalId: string; editing: boolean; scopeIds: string[] }>(reader, projectId, "message", review.requestId);
  fail(request.id === review.requestId && request.projectId === projectId && request.principalId === review.principalId
    && request.editing === true && Array.isArray(request.scopeIds) && request.scopeIds.length <= 400 && request.scopeIds.includes(projectId));
  // Every message is created by the human request channel. The review has no epoch: its live caller must be human.
  // A superseded historical human request remains evidence, never current execution authority.
  return { review, proposal };
}

export function assertNarrationSpeechReview(reader: Reader, projectId: string, input: unknown): asserts input is NarrationSpeechReview {
  reviewEvidence(reader, projectId, input);
}

function applicationEvidence(reader: Reader, projectId: string, input: unknown): ResolvedNarrationSpeechApplication {
  const application = snapshotOwnedTranscriptionData(input, 16384) as NarrationSpeechApplication;
  exact(application, ["id", "version", "projectId", "review", "candidateDigest", "prepared", "plan", "projectRevision", "receipt"]);
  fail(application.version === 1 && application.projectId === projectId && id(application.id) && hash(application.candidateDigest));
  for (const reference of [application.review, application.prepared, application.plan, application.projectRevision]) pin(reference);
  const savedReview = get<NarrationSpeechReview>(reader, projectId, "narration_speech_review", application.review.id);
  fail(digest(savedReview) === application.review.digest);
  const { review, proposal } = reviewEvidence(reader, projectId, savedReview);
  const candidate = get<Candidate>(reader, projectId, "candidate", application.id);
  fail(digest(candidate) === application.candidateDigest && same(candidate, { id: application.id, projectId, nodeId: review.nodeId, grantId: review.id, origin: "user_change" }));
  const base = get<{ project: ProjectRecord }>(reader, projectId, "project_revision", proposal.baseProject.revisionId).project;
  const prepared = get<Record<string, unknown>>(reader, projectId, "prepared", application.prepared.id);
  const change = parseChangeProposal({ variant: "plan", expectedHeadVersion: proposal.baseProject.headVersion, source: proposal.compiled.source });
  fail(digest(prepared) === application.prepared.digest && same(prepared, { id: application.prepared.id, projectId,
    requestId: review.requestId, principalId: review.principalId, epochId: null, proposal: change, proposalDigest: digest(change),
    baseVersion: proposal.baseProject.headVersion, next: base, compiled: proposal.compiled, logicalIds: proposal.logicalIds,
    impact: proposal.impact, stages: proposal.stages, stageVersions: proposal.stageVersions, grantBindings: { [review.nodeId]: review.id },
    semanticChange: false, capabilityDigest: proposal.capabilityLock.digest }));
  const plan = get<PlanRecord>(reader, projectId, "plan", application.plan.id);
  fail(digest(plan) === application.plan.digest && same(plan, { id: application.plan.id, projectId, compiled: proposal.compiled }));
  const revision = get<{ id: string; projectId: string; project: ProjectRecord }>(reader, projectId, "project_revision", application.projectRevision.id);
  fail(digest(revision) === application.projectRevision.digest && same(revision, { id: application.projectRevision.id, projectId,
    project: { ...base, revisionId: application.projectRevision.id, headVersion: base.headVersion + 1, activePlanId: application.plan.id } }));
  const receipt = application.receipt;
  exact(receipt, ["preparedId", "projectId", "revisionId", "headVersion", "activePlanId", "cursor"]);
  fail(receipt.preparedId === application.prepared.id && receipt.projectId === projectId && receipt.revisionId === revision.project.revisionId
    && receipt.headVersion === revision.project.headVersion && receipt.activePlanId === plan.id
    && Number.isSafeInteger(receipt.cursor) && receipt.cursor > 0);
  const eventSize = reader.db.prepare("SELECT length(CAST(body AS BLOB)) bytes FROM events WHERE project_id=? AND sequence=?").get(projectId, receipt.cursor) as { bytes: number } | undefined;
  fail(eventSize && eventSize.bytes <= 16384);
  const eventRow = reader.db.prepare("SELECT body FROM events WHERE project_id=? AND sequence=?").get(projectId, receipt.cursor) as { body: string };
  const event = snapshotOwnedTranscriptionData(JSON.parse(eventRow.body), 16384) as ProjectEvent;
  fail(event.projectId === projectId && event.sequence === receipt.cursor && event.kind === "change.applied"
    && same(event.payload, { preparedId: prepared.id, revisionId: revision.project.revisionId, planId: plan.id, headVersion: revision.project.headVersion }));
  return { application, review, proposal };
}

export function assertNarrationSpeechApplication(reader: Reader, projectId: string, input: unknown): asserts input is NarrationSpeechApplication {
  applicationEvidence(reader, projectId, input);
}

/** Historical keyed closure only. It never inspects current heads, leases, holds or section selections. */
export function resolveNarrationSpeechApplication(reader: Reader, projectId: string, candidateId: string): ResolvedNarrationSpeechApplication {
  const application = get<NarrationSpeechApplication>(reader, projectId, "narration_speech_application", candidateId);
  fail(application.id === candidateId); return applicationEvidence(reader, projectId, application);
}

/** Shared immutable admission check. A reviewed grant cannot fall back to the legacy metadata-free path. */
export function assertNarrationSpeechAttemptInput(reader: Reader, attempt: Readonly<Attempt>): ResolvedNarrationSpeechApplication | null {
  const metadata = Object.getOwnPropertyDescriptor(attempt, "narrationSpeech");
  fail(metadata || !("narrationSpeech" in attempt));
  const candidate = attempt.candidateId ? reader.get<Candidate>("candidate", attempt.candidateId) : undefined;
  const review = candidate ? reader.get<NarrationSpeechReview>("narration_speech_review", candidate.grantId) : undefined;
  const application = attempt.candidateId ? reader.get<NarrationSpeechApplication>("narration_speech_application", attempt.candidateId) : undefined;
  if (!metadata && !review && !application) return null;
  fail(metadata && Object.hasOwn(metadata, "value") && metadata.enumerable && candidate && candidate.projectId === attempt.projectId);
  const value = snapshotOwnedTranscriptionData(metadata!.value, 16384) as NarrationSpeechAttemptInput;
  const resolved = resolveNarrationSpeechApplication(reader, attempt.projectId, candidate!.id), { proposal } = resolved;
  fail(same(value, { version: 1, application: { id: resolved.application.id, digest: digest(resolved.application) } }));
  const node = proposal.compiled.nodes.find(item => item.id === resolved.review.nodeId)!;
  const fingerprint = effectiveNodeDigest(node, []);
  fail(attempt.nodeId === node.id && attempt.specDigest === node.specDigest && attempt.candidateId === resolved.application.id
    && attempt.workKey === null && attempt.request.attemptId === attempt.id && attempt.request.nodeId === node.id
    && attempt.request.kind === "speech" && attempt.request.fingerprint === attempt.fingerprint && attempt.fingerprint === fingerprint
    && same(attempt.request.args, node.args) && same(attempt.request.inputs, [])
    && same(attempt.request.execution, { adapter: "openai-speech", version: "1" })
    && same(attempt.request.profile, executionProfileSnapshot(proposal.profile)));
  return resolved;
}
