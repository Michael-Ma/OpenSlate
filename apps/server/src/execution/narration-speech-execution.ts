import { canonical, digest, invariant } from "@openslate/core";
import type { CompiledPlan, PlanNode, ProjectRecord } from "@openslate/core";
import type { Attempt, Candidate, NodeBinding } from "./engine.js";
import type { NarrationSpeechReader } from "../narration/narration-speech-records.js";
import type { NarrationSpeechAttemptInput, NarrationSpeechProposal, NarrationSpeechReview } from "../narration/narration-speech-types.js";
import { assertNarrationSpeechAttemptInput, assertNarrationSpeechReview, resolveNarrationSpeechApplication } from "../narration/narration-speech-authorization.js";
import type { NarrationState } from "../narration/types.js";

type Reader = NarrationSpeechReader;
type Resolved = ReturnType<typeof resolveNarrationSpeechApplication>;
const same = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
const fail = (value: unknown): void => invariant(value, "NARRATION_SPEECH_AUTHORIZATION_INVALID", "Narration speech requires its exact human-reviewed application");
function nodeOf(value: Pick<Resolved, "proposal" | "review">): PlanNode {
  const node = value.proposal.compiled.nodes.find(item => item.id === value.review.nodeId); fail(node); return node!;
}
function reviewed(reader: Reader, candidateId: string | null): NarrationSpeechReview | undefined {
  const candidate = candidateId ? reader.get<Candidate>("candidate", candidateId) : undefined;
  return candidate ? reader.get<NarrationSpeechReview>("narration_speech_review", candidate.grantId) : undefined;
}
/** New purpose-bound grants only install their reviewed full plan; old nodes may survive exact whole-plan edits. */
export function assertNarrationSpeechInstallation(reader: Reader, project: ProjectRecord, planId: string, compiled: CompiledPlan, grants: Record<string, string>): void {
  const fresh = new Map<string, { proposal: NarrationSpeechProposal; review: NarrationSpeechReview }>();
  for (const [nodeId, grantId] of Object.entries(grants)) {
    const review = reader.get<NarrationSpeechReview>("narration_speech_review", grantId); if (!review) continue;
    assertNarrationSpeechReview(reader, project.id, review);
    const proposal = reader.get<NarrationSpeechProposal>("narration_speech_proposal", review.proposal.id)!;
    fail(Object.keys(grants).length === 1 && nodeId === review.nodeId && digest(compiled) === review.compiledDigest && same(compiled, proposal.compiled));
    const base = reader.get<{ project: ProjectRecord }>("project_revision", proposal.baseProject.revisionId)?.project;
    fail(base && project.headVersion === base.headVersion + 1 && project.revisionId !== base.revisionId && project.activePlanId === planId
      && same({ ...project, headVersion: base.headVersion, revisionId: base.revisionId, activePlanId: base.activePlanId }, base));
    fresh.set(nodeId, { proposal, review });
  }
  for (const node of compiled.nodes) {
    const prepared = fresh.get(node.id); if (prepared) { fail(same(node, nodeOf(prepared))); continue; }
    const old = reader.get<NodeBinding>("node_binding", node.id), prior = old?.projectId === project.id ? reviewed(reader, old.candidateId) : undefined;
    if (!prior) continue;
    fail(!Object.hasOwn(grants, node.id) && old?.state === "active" && old.candidateId && same(old.node, node));
    const resolved = resolveNarrationSpeechApplication(reader, project.id, old!.candidateId!); fail(same(node, nodeOf(resolved)));
  }
}
export function resolveNarrationSpeechNode(reader: Reader, project: ProjectRecord, node: PlanNode, candidateId: string | null):
  { resolved: Resolved; input: NarrationSpeechAttemptInput } | null {
  const review = reviewed(reader, candidateId), application = candidateId ? reader.get("narration_speech_application", candidateId) : undefined;
  if (!review && !application) return null;
  fail(review && candidateId); const resolved = resolveNarrationSpeechApplication(reader, project.id, candidateId!); fail(same(node, nodeOf(resolved)));
  return { resolved, input: { version: 1, application: { id: resolved.application.id, digest: digest(resolved.application) } } };
}
/** Current section matters only before the first dispatch. Exact historical outputs remain recoverable after edits. */
export function assertNarrationSpeechCurrent(reader: Reader, project: ProjectRecord, node: PlanNode, candidateId: string | null, resolved: Resolved): void {
  const binding = reader.get<NodeBinding>("node_binding", node.id), section = resolved.proposal.section;
  const entry = reader.get<NarrationState>("narration_state", project.id)?.entries.find(item => item.segmentId === section.segmentId);
  invariant(binding?.projectId === project.id && binding.state === "active" && binding.planId === project.activePlanId && binding.candidateId === candidateId
    && same(binding.node, node) && entry?.segmentRevisionId === section.segmentRevisionId,
  "NARRATION_SPEECH_STALE", "The human-reviewed narration section or operation changed before generation");
}
export function assertNarrationSpeechAttemptCurrent(reader: Reader, attempt: Readonly<Attempt>): void {
  const resolved = assertNarrationSpeechAttemptInput(reader, attempt); if (!resolved) return;
  const project = reader.getProject(attempt.projectId); assertNarrationSpeechCurrent(reader, project, nodeOf(resolved), attempt.candidateId, resolved);
  invariant(!reader.get<{ paused: boolean }>("execution_control", project.id)?.paused, "EXECUTION_PAUSED", "Execution is paused");
  // Speech is a project operation without upstream inputs; only project scope intersects it.
  const hold = reader.db.prepare("SELECT id FROM entities WHERE kind='hold' AND project_id=? AND json_extract(body,'$.active')=1 AND json_extract(body,'$.scopeId')=? LIMIT 1").get(project.id, project.id);
  invariant(!hold, "EXECUTION_HELD", "Narration generation is held by an editing request");
}
