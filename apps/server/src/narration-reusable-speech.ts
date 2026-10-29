import { digest, DomainError, invariant } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { SceneConfirmationRecord } from "./scene-confirmations.js";
import type { AttachGeneratedNarrationAudio } from "./narration/service.js";
import type { NarrationSpeechService } from "./narration/narration-speech-service.js";
import type { PrepareNarrationSpeech } from "./narration/narration-speech-types.js";
import { projectNarrationSpeechProposal } from "./narration/narration-speech-projection.js";
import { narrationAuthorScope, shotDraftId } from "./narration/narration-scope.js";

export interface SpeechIntent {
  segmentId: string | null; segmentRevisionId: string | null; text: string; voice: string;
  profileId: string | null; profileRevisionId: string | null;
}

/** Read only: a completed exact take is usable even when its original request is superseded. */
export function reusableNarrationSpeech(production: ProductionService, projectId: string, intent: SpeechIntent):
  { speechInput: PrepareNarrationSpeech; speechResult: Awaited<ReturnType<NarrationSpeechService["request"]>> } | undefined {
  if (!intent.segmentId || !intent.segmentRevisionId || !intent.profileId || !intent.profileRevisionId) return;
  const ids = production.store.db.prepare("SELECT id FROM entities WHERE kind='narration_speech_proposal' AND project_id=? AND json_extract(body,'$.section.segmentId')=? AND json_extract(body,'$.section.segmentRevisionId')=? ORDER BY rowid DESC")
    .all(projectId, intent.segmentId, intent.segmentRevisionId) as { id: string }[];
  for (const { id } of ids) {
    const proposal = production.store.get<Awaited<ReturnType<NarrationSpeechService["request"]>>["proposal"]>("narration_speech_proposal", id);
    if (!proposal || proposal.operation.text !== intent.text || proposal.operation.voice !== intent.voice ||
      proposal.profile.id !== intent.profileId || proposal.profile.revision !== intent.profileRevisionId) continue;
    let detail;
    try { detail = projectNarrationSpeechProposal(production.store, projectId, id); }
    catch (error) { if (error instanceof DomainError) continue; throw error; }
    if (!detail.application || !detail.recording || detail.execution.state !== "succeeded") continue;
    return { speechInput: { key: proposal.id, expectedHeadVersion: proposal.baseProject.headVersion,
      segmentId: intent.segmentId, segmentRevisionId: intent.segmentRevisionId, profileId: intent.profileId,
      voice: intent.voice, instructions: proposal.operation.instructions }, speechResult: { proposal, receipt: detail.application } };
  }
}

export interface CompletedSceneAttachment { confirmationId: string; shotId: string }

/**
 * A host-only storage completion, not a new edit or generation grant. The exact paid take may
 * finish attaching under its original human scope after chat supersedes that request. It may
 * neither accept timing nor replace a changed line/voice/section or a newer recording.
 */
export function completedSceneAttachmentScope(production: ProductionService, projectId: string, actor: ActorContext,
  input: AttachGeneratedNarrationAudio, completion: CompletedSceneAttachment) {
  const store = production.store;
  production.recovery.assertWritable(projectId, actor.requestId);
  production.assertActor(projectId, actor);
  const run = store.get<SceneConfirmationRecord>("scene_confirmation", completion.confirmationId);
  const step = run?.steps.find(step => step.shotId === completion.shotId);
  const session = step?.sessionId ? store.get<{ requestId: string }>("narration_session", step.sessionId) : undefined;
  const project = store.getProject(projectId), shot = project.shots.find(shot => shot.id === completion.shotId);
  const scope = narrationAuthorScope(store, projectId, actor.requestId, actor.principalId, input.segmentId);
  invariant(actor.kind === "human" && actor.principalId === "local-user" && run?.projectId === projectId && run.state === "running" &&
    !store.get<{ paused: boolean }>("execution_control", projectId)?.paused && run.actor.kind === "human" && run.actor.principalId === actor.principalId &&
    step?.step === "attach" && session?.requestId === actor.requestId && scope?.shotId === completion.shotId && scope.sessionId === step.sessionId &&
    shot?.sceneId === run.sceneId && step.intentDigest === digest({ shotId: shot.id, narration: shot.narration ?? null }) &&
    step.speechInput?.segmentId === input.segmentId && step.speechInput.segmentRevisionId === input.segmentRevisionId,
  "NARRATION_SPEECH_STALE", "The paid voice line no longer matches this shot's narration");
  if (step.attachmentCursor !== undefined) invariant(!store.readEvents(projectId, step.attachmentCursor).some(event =>
    event.kind === "narration.generated_audio_attached" && event.payload.segmentId === input.segmentId &&
    !(event.payload.requestId === actor.requestId && event.payload.artifactId === input.artifactId)),
  "NARRATION_SPEECH_STALE", "A later recording selection owns this voice line");
  const draft = store.get<{ segmentId: string }>("narration_shot_draft", shotDraftId(projectId, shot.id));
  const current = production.store.get<{ entries: { segmentId: string; segmentRevisionId: string; audioId: string | null }[] }>("narration_state", projectId)?.entries.find(entry => entry.segmentId === input.segmentId);
  const proposal = step.speechResult?.proposal;
  const lock = store.get<{ profiles: { id: string; revision: string }[]; preferredProfileIds?: { speech?: string | null } }>("capability_lock", project.capabilityLockId);
  const attempt = production.engine.attempts(projectId).find(attempt => attempt.phase === "succeeded" &&
    attempt.candidateId === step.speechResult?.receipt.candidateId && attempt.outputs.audio?.artifactId === input.artifactId);
  invariant(draft?.segmentId === input.segmentId && current?.segmentRevisionId === input.segmentRevisionId &&
    (!current.audioId || current.audioId === input.artifactId || Object.hasOwn(step, "attachmentAudioId") && current.audioId === step.attachmentAudioId) && attempt && proposal?.section.segmentId === input.segmentId &&
    proposal.section.segmentRevisionId === input.segmentRevisionId && proposal.operation.text === shot.narration?.text &&
    proposal.operation.voice === step.voice && proposal.profile.id === step.profileId && proposal.profile.revision === step.profileRevisionId &&
    lock?.profiles.some(profile => profile.id === proposal.profile.id && profile.revision === proposal.profile.revision) &&
    (!lock.preferredProfileIds || !Object.hasOwn(lock.preferredProfileIds, "speech") || lock.preferredProfileIds.speech === proposal.profile.id),
  "NARRATION_SPEECH_STALE", "The paid voice line's section, voice or recording changed");
  return scope;
}
