import { canonical, digest, effectiveNodeDigest, invariant } from "@openslate/core";
import type { CompiledPlan, PlanNode, ProjectRecord } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import type { Attempt, Candidate, NodeBinding } from "./engine.js";
import type { OwnedTranscriptionAttemptInput, OwnedTranscriptionProposal, OwnedTranscriptionReview, OwnedTranscriptionSource } from "../narration/owned-transcription-types.js";
import { assertOwnedTranscriptionAttemptInput, assertOwnedTranscriptionReview, resolveOwnedTranscriptionApplication } from "../narration/owned-transcription-authorization.js";
import { snapshotOwnedTranscriptionData } from "../narration/owned-transcription-records.js";
import type { NarrationState } from "../narration/types.js";

type Reader = Pick<Store, "get" | "getProject" | "db">;
type Resolved = ReturnType<typeof resolveOwnedTranscriptionApplication>;
const fail = (value: unknown): void => invariant(value, "APPLICATION_INPUT_UNAVAILABLE", "Recording execution requires its exact reviewed application input");
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
function hasLink(node: PlanNode): boolean {
  const field = Object.getOwnPropertyDescriptor(node, "applicationInput");
  fail(field || !("applicationInput" in node));
  if (field) {
    fail(Object.hasOwn(field, "value") && field.enumerable && node.kind === "transcription");
    let value: { kind?: unknown; id?: unknown; digest?: unknown } | undefined;
    try { value = snapshotOwnedTranscriptionData(field.value, 1024); } catch { fail(false); }
    fail(value && typeof value === "object" && value.kind === "owned_transcription" && typeof value.id === "string" && value.id.length > 0
      && Buffer.byteLength(value.id) <= 160 && typeof value.digest === "string" && /^[a-f0-9]{64}$/.test(value.digest)
      && equal(value, { kind: "owned_transcription", id: value.id, digest: value.digest }));
  }
  return !!field;
}
function reviewedNode(resolved: Pick<Resolved, "proposal" | "review">): PlanNode {
  const node = resolved.proposal.compiled.nodes.find(item => item.id === resolved.review.nodeId); fail(node); return node!;
}
function candidateReview(reader: Reader, candidateId: string | null): OwnedTranscriptionReview | undefined {
  const candidate = candidateId ? reader.get<Candidate>("candidate", candidateId) : undefined;
  return candidate ? reader.get<OwnedTranscriptionReview>("owned_transcription_review", candidate.grantId) : undefined;
}
function metadata(resolved: Resolved): OwnedTranscriptionAttemptInput {
  return { version: 1, binding: { kind: "owned_transcription", id: resolved.source.id, digest: digest(resolved.source) },
    application: { id: resolved.application.id, digest: digest(resolved.application) } };
}

/** Literal input authority is separate from resolving historical upstream outputs. */
export function assertOwnedTranscriptionLiteralInputs(project: ProjectRecord, node: PlanNode, source?: OwnedTranscriptionSource): void {
  for (const input of node.inputs) if (input.source.kind === "artifact")
    fail(project.artifacts.some(artifact => equal(artifact, input.source.kind === "artifact" ? input.source.artifact : null))
      || source && node.kind === "transcription" && equal(node.inputs, [{ destinationPort: "audio", role: "audio", order: 0,
        source: { kind: "artifact", artifact: source.artifact } }]));
}

/** Validate every purpose-bound grant before saved-plan replay or candidate insertion. */
export function assertOwnedTranscriptionInstallation(reader: Reader, project: ProjectRecord, planId: string, compiled: CompiledPlan,
  grantBindings: Record<string, string>): void {
  const ids = new Set(compiled.nodes.map(node => node.id));
  fail(Object.keys(grantBindings).every(id => ids.has(id)));
  const newReviews = new Map<string, { review: OwnedTranscriptionReview; proposal: OwnedTranscriptionProposal; source: OwnedTranscriptionSource }>();
  for (const [nodeId, grantId] of Object.entries(grantBindings)) {
    const review = reader.get<OwnedTranscriptionReview>("owned_transcription_review", grantId); if (!review) continue;
    assertOwnedTranscriptionReview(reader, project.id, review);
    const proposal = reader.get<OwnedTranscriptionProposal>("owned_transcription_proposal", review.proposal.id)!;
    const source = reader.get<OwnedTranscriptionSource>("owned_transcription_source", review.sourceBinding.id)!;
    fail(Object.keys(grantBindings).length === 1 && review.nodeId === nodeId && digest(compiled) === review.compiledDigest
      && equal(compiled, proposal.compiled));
    const base = reader.get<{ project: ProjectRecord }>("project_revision", proposal.baseProject.revisionId)?.project;
    fail(base && project.headVersion === base.headVersion + 1 && project.revisionId !== base.revisionId && project.activePlanId === planId
      && equal({ ...project, headVersion: base.headVersion, revisionId: base.revisionId, activePlanId: base.activePlanId }, base));
    newReviews.set(nodeId, { review, proposal, source });
  }
  for (const node of compiled.nodes) {
    const linked = hasLink(node), fresh = newReviews.get(node.id), previous = reader.get<NodeBinding>("node_binding", node.id);
    const priorReview = previous?.projectId === project.id ? candidateReview(reader, previous.candidateId) : undefined;
    let source: OwnedTranscriptionSource | undefined;
    if (fresh) { fail(linked && equal(node, reviewedNode(fresh))); source = fresh.source; }
    else if (linked || priorReview) {
      fail(linked && !Object.hasOwn(grantBindings, node.id) && previous?.projectId === project.id && previous.state === "active"
        && previous.candidateId && equal(previous.node, node));
      const retained = resolveOwnedTranscriptionApplication(reader, project.id, previous!.candidateId!);
      fail(equal(node, reviewedNode(retained))); source = retained.source;
    }
    assertOwnedTranscriptionLiteralInputs(project, node, source);
  }
}

/** Current node admission requires its completed application, including when a caller drops its link. */
export function resolveOwnedTranscriptionNode(reader: Reader, project: ProjectRecord, node: PlanNode, candidateId: string | null):
  { resolved: Resolved; input: OwnedTranscriptionAttemptInput } | null {
  const linked = hasLink(node), review = candidateReview(reader, candidateId);
  if (!linked && !review) { assertOwnedTranscriptionLiteralInputs(project, node); return null; }
  fail(linked && candidateId && review);
  const resolved = resolveOwnedTranscriptionApplication(reader, project.id, candidateId!);
  fail(equal(node, reviewedNode(resolved)));
  assertOwnedTranscriptionLiteralInputs(project, node, resolved.source);
  return { resolved, input: metadata(resolved) };
}

/** Immutable history only: no current section, lease or project-head requirement. */
export function resolveOwnedTranscriptionAttempt(reader: Reader, attempt: Readonly<Attempt>): Resolved | null {
  const resolved = assertOwnedTranscriptionAttemptInput(reader, attempt);
  if (!resolved) return null;
  const node = reviewedNode(resolved);
  fail(attempt.fingerprint === effectiveNodeDigest(node, [{ destinationPort: "audio", role: "audio", order: 0, sha256: resolved.source.artifact.sha256 }]));
  return resolved;
}

/** This check is deliberately pre-marker only; a completed historical recording remains recoverable. */
export function assertOwnedTranscriptionCurrent(reader: Reader, project: ProjectRecord, node: PlanNode, candidateId: string | null,
  resolved: Resolved): void {
  const current = reader.get<NodeBinding>("node_binding", node.id), target = resolved.source.target;
  let selected = true;
  if (target.kind === "section") {
    const entry = reader.get<NarrationState>("narration_state", project.id)?.entries.find(item => item.segmentId === target.segmentId);
    selected = entry?.segmentRevisionId === target.segmentRevisionId && entry.audioId === target.audioId;
  }
  invariant(current?.projectId === project.id && current.state === "active" && current.planId === project.activePlanId
    && current.candidateId === candidateId && equal(current.node, node) && selected,
  "SUBMISSION_PREPARATION_OBSOLETE", "The reviewed recording operation or selected section changed");
}
export function assertOwnedTranscriptionAttemptCurrent(reader: Reader, attempt: Readonly<Attempt>): void {
  const resolved = resolveOwnedTranscriptionAttempt(reader, attempt); if (!resolved) return;
  assertOwnedTranscriptionCurrent(reader, reader.getProject(attempt.projectId), reviewedNode(resolved), attempt.candidateId, resolved);
}
