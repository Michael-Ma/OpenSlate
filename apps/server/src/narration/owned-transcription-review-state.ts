import { canonical, digest, invariant } from "@openslate/core";
import type { ActorContext, CompiledPlan, ProjectRecord, ProviderProfile } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import type { ArtifactRecord } from "../execution/engine.js";
import { assertOwnedTranscriptionProposal, assertOwnedTranscriptionSource, snapshotOwnedTranscriptionData } from "./owned-transcription-records.js";
import type { OwnedTranscriptionProposal, OwnedTranscriptionSource, ReviewOwnedTranscription } from "./owned-transcription-types.js";
import type { NarrationState } from "./types.js";

export const ownedTranscriptionReviewScope = (projectId: string, actor: ActorContext): string =>
  `${actor.principalId}:${projectId}:${actor.requestId}:owned-transcription-review`;

export function captureOwnedTranscriptionReviewInput(input: ReviewOwnedTranscription): ReviewOwnedTranscription {
  const value = snapshotOwnedTranscriptionData(input, 16384);
  invariant(value && Object.keys(value).sort().join("\0") === ["key", "proposalDigest", "proposalId"].join("\0")
    && [value.key, value.proposalId].every(id => typeof id === "string" && id.length > 0 && Buffer.byteLength(id) <= 160)
    && typeof value.proposalDigest === "string" && /^[a-f0-9]{64}$/.test(value.proposalDigest),
  "OWNED_TRANSCRIPTION_INVALID", "Review one exact saved recording proposal");
  return value;
}

/** Current publication checks are separate from the historical evidence used by result recovery. */
export function currentOwnedTranscriptionReview(store: Store, projectId: string, input: ReviewOwnedTranscription) {
  const row = store.db.prepare("SELECT project_id,length(CAST(body AS BLOB)) bytes FROM entities WHERE kind='owned_transcription_proposal' AND id=?")
    .get(input.proposalId) as { project_id: string; bytes: number } | undefined;
  invariant(row?.project_id === projectId && row.bytes <= 16 * 1024 * 1024, "OWNED_TRANSCRIPTION_INVALID", "The saved recording proposal is unavailable");
  const proposal = snapshotOwnedTranscriptionData(store.get<OwnedTranscriptionProposal>("owned_transcription_proposal", input.proposalId)!);
  invariant(digest(proposal) === input.proposalDigest, "OWNED_TRANSCRIPTION_STALE", "The saved recording proposal differs from the human review");
  const before = store.getProject(projectId);
  invariant(before.revisionId === proposal.baseProject.revisionId && before.headVersion === proposal.baseProject.headVersion
    && digest(before) === proposal.baseProject.digest && before.activePlanId === (proposal.basePlan?.id ?? null),
  "REVISION_CONFLICT", "Project changed since the recording proposal was prepared");
  const lock = store.get<{ projectId: string; profiles: ProviderProfile[]; recipeDigest: string; stageContractsDigest: string; localExecution?: unknown }>("capability_lock", before.capabilityLockId);
  invariant(lock && before.capabilityLockId === proposal.capabilityLock.id && digest(lock) === proposal.capabilityLock.digest,
    "CAPABILITY_MISMATCH", "Project capability lock changed since recording preparation");
  const source = store.get<OwnedTranscriptionSource>("owned_transcription_source", proposal.sourceBinding.id);
  invariant(source && digest(source) === proposal.sourceBinding.digest
    && digest(store.get("narration_audio", source.sourceRecord.id) ?? null) === source.sourceRecord.digest,
  "OWNED_TRANSCRIPTION_STALE", "The selected recording changed since preparation");
  const artifact = store.get<ArtifactRecord>("artifact", source.artifact.artifactId);
  invariant(artifact && digest(artifact) === source.artifactRecordDigest, "OWNED_TRANSCRIPTION_STALE", "The recording artifact changed since preparation");
  const target = source.target;
  if (target.kind === "section") {
    const entry = store.get<NarrationState>("narration_state", projectId)?.entries.find(item => item.segmentId === target.segmentId);
    invariant(entry?.segmentRevisionId === target.segmentRevisionId && entry.audioId === target.audioId,
      "OWNED_TRANSCRIPTION_STALE", "The selected narration section or recording changed");
  }
  for (const [id, version] of Object.entries(proposal.stageVersions)) invariant((store.get<{ bindingVersion: number }>("stage", id)?.bindingVersion ?? 0) === version,
    "STAGE_BINDING_CONFLICT", "Stage binding changed since recording preparation");
  const expectedAliases = { ...proposal.logicalIds }; delete expectedAliases[proposal.operation.alias];
  invariant(canonical(store.get<{ aliases: Record<string, string> }>("logical_ids", projectId)?.aliases ?? {}) === canonical(expectedAliases),
    "REVISION_CONFLICT", "Logical identity mapping changed since recording preparation");
  const base = before.activePlanId ? store.get<{ id: string; projectId: string; compiled: CompiledPlan }>("plan", before.activePlanId) : null;
  invariant(!proposal.basePlan || base?.projectId === projectId && digest(base.compiled) === proposal.basePlan.digest,
    "REVISION_CONFLICT", "The active plan changed since recording preparation");
  assertOwnedTranscriptionSource(store, projectId, source); assertOwnedTranscriptionProposal(store, projectId, proposal);
  return { proposal, before: before as ProjectRecord, lock, source, artifact, base };
}
