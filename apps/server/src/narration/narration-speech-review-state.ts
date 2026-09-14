import { canonical, digest, invariant } from "@openslate/core";
import type { ActorContext, CompiledPlan, ProjectRecord, ProviderProfile } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { assertNarrationSpeechProposal, resolveNarrationSpeechSection } from "./narration-speech-records.js";
import { snapshotOwnedTranscriptionData } from "./owned-transcription-records.js";
import type { NarrationSpeechProposal, ReviewNarrationSpeech } from "./narration-speech-types.js";
import type { NarrationState } from "./types.js";

export const narrationSpeechReviewScope = (projectId: string, actor: ActorContext): string =>
  `${actor.principalId}:${projectId}:${actor.requestId}:narration-speech-review`;
export const narrationSpeechPrepareScope = (projectId: string, actor: ActorContext): string =>
  `${actor.principalId}:${projectId}:${actor.requestId}:narration-speech:${actor.kind === "director" ? actor.epochId : "human"}`;

export function captureNarrationSpeechReviewInput(input: ReviewNarrationSpeech): ReviewNarrationSpeech {
  const value = snapshotOwnedTranscriptionData(input, 16384);
  invariant(value && Object.keys(value).sort().join("\0") === ["key", "proposalDigest", "proposalId"].join("\0")
    && [value.key, value.proposalId].every(id => typeof id === "string" && id.length > 0 && Buffer.byteLength(id) <= 160)
    && typeof value.proposalDigest === "string" && /^[a-f0-9]{64}$/.test(value.proposalDigest),
  "NARRATION_SPEECH_INVALID", "Review one exact saved speech proposal");
  return value;
}

/** Current publication checks are separate from the historical evidence used by result recovery. */
export function currentNarrationSpeechReview(store: Store, projectId: string, input: ReviewNarrationSpeech) {
  const row = store.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='narration_speech_proposal' AND id=?")
    .get(input.proposalId) as { project_id: string; bytes: number } | undefined;
  invariant(row?.project_id === projectId && row.bytes <= 16 * 1024 * 1024, "NARRATION_SPEECH_INVALID", "The saved speech proposal is unavailable");
  const proposal = snapshotOwnedTranscriptionData(store.get<NarrationSpeechProposal>("narration_speech_proposal", input.proposalId)!);
  invariant(digest(proposal) === input.proposalDigest, "NARRATION_SPEECH_STALE", "The saved speech proposal differs from the human review");
  const before = store.getProject(projectId);
  invariant(before.revisionId === proposal.baseProject.revisionId && before.headVersion === proposal.baseProject.headVersion
    && digest(before) === proposal.baseProject.digest && before.activePlanId === (proposal.basePlan?.id ?? null),
  "REVISION_CONFLICT", "Project changed since the speech proposal was prepared");
  const lock = store.get<{ projectId: string; profiles: ProviderProfile[]; recipeDigest: string; stageContractsDigest: string; localExecution?: unknown }>("capability_lock", before.capabilityLockId);
  invariant(lock && before.capabilityLockId === proposal.capabilityLock.id && digest(lock) === proposal.capabilityLock.digest,
    "CAPABILITY_MISMATCH", "Project capability lock changed since speech preparation");
  const entry = store.get<NarrationState>("narration_state", projectId)?.entries.find(item => item.segmentId === proposal.section.segmentId);
  invariant(entry?.segmentRevisionId === proposal.section.segmentRevisionId, "NARRATION_SPEECH_STALE", "The selected narration section changed");
  const script = resolveNarrationSpeechSection(store, projectId, proposal.section);
  for (const [id, version] of Object.entries(proposal.stageVersions)) invariant((store.get<{ bindingVersion: number }>("stage", id)?.bindingVersion ?? 0) === version,
    "STAGE_BINDING_CONFLICT", "Stage binding changed since speech preparation");
  const expectedAliases = { ...proposal.logicalIds }; delete expectedAliases[proposal.operation.alias];
  invariant(canonical(store.get<{ aliases: Record<string, string> }>("logical_ids", projectId)?.aliases ?? {}) === canonical(expectedAliases),
    "REVISION_CONFLICT", "Logical identity mapping changed since speech preparation");
  const base = before.activePlanId ? store.get<{ id: string; projectId: string; compiled: CompiledPlan }>("plan", before.activePlanId) : null;
  invariant(!proposal.basePlan || base?.projectId === projectId && digest(base.compiled) === proposal.basePlan.digest,
    "REVISION_CONFLICT", "The active plan changed since speech preparation");
  assertNarrationSpeechProposal(store, projectId, proposal);
  return { proposal, before: before as ProjectRecord, lock, script, base };
}
