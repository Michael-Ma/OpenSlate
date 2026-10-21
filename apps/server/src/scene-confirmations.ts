import { confirmationFramesCurrent, sceneConfirmationGuard, type ConfirmationFramePin } from "./scene-confirmation-state.js";
import type { FastifyInstance } from "fastify";
import { digest, DomainError, invariant } from "@openslate/core";
import type { ActorContext, ConfirmSceneInput, SceneConfirmationView } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import { requiredCommandKey } from "./application/command-key.js";
import { generateScene, sceneGenerationCommandDigest, sceneGenerationView, sceneView, type SceneGenerationInput } from "./scene-generation.js";
import { generationTargets } from "./scene-row.js";
import { quote } from "./generation-quotes.js";
import type { NarrationService } from "./narration/service.js";
import type { NarrationCanonicalService } from "./narration/canonical.js";
import type { NarrationSpeechService } from "./narration/narration-speech-service.js";
import type { PrepareNarrationSpeech } from "./narration/narration-speech-types.js";
import { createShotNarrationSession, shotSessionHeadId } from "./narration/narration-scope.js";
import { createShotAudioWorkspace, type AcceptShotAudio } from "./narration/shot-audio-routes.js";
import { resolveGeneratedNarrationAudio } from "./narration/generated-audio.js";
import { reusableNarrationSpeech, type SpeechIntent } from "./narration-reusable-speech.js";

export interface SceneAudioPorts { narration: NarrationService; canonical: NarrationCanonicalService; narrationSpeech?: NarrationSpeechService }
type AttachInput = Parameters<NarrationService["attachGeneratedAudio"]>[2];
export interface SceneAudioStep {
  shotId: string; step: "speech" | "attach" | "accept" | "done";
  /** Freeze the effective voice at the human press; later defaults apply to new commands only. */
  voice?: string;
  intentDigest?: string; profileId?: string; profileRevisionId?: string;
  /** Exact recording present when this run began; a later selection cannot be replaced. */
  attachmentAudioId?: string | null;
  attachmentCursor?: number;
  blocker?: { code: string; shotId: string };
  sessionId?: string; speechInput?: PrepareNarrationSpeech;
  speechResult?: Awaited<ReturnType<NarrationSpeechService["request"]>>;
  attachInput?: AttachInput; acceptInput?: AcceptShotAudio; acceptKey?: string;
  results?: { attached?: boolean; accepted?: unknown };
}
export interface SceneConfirmationRecord {
  id: string; projectId: string; sceneId: string; kind: "keyframes" | "video";
  actor: ActorContext; state: SceneConfirmationView["state"]; createdAt: string;
  sceneIntentDigest: string; guardDigest: string; framePins: ConfirmationFramePin[]; frames: ConfirmSceneInput["reviewedFrames"];
  /** Per-shot dispatch guards. Older scene-wide checkpoints require a fresh confirmation. */
  shotGuardDigests?: Record<string, string>;
  steps: SceneAudioStep[];
  /** Legacy receipt lookup only. New runs never persist film-head tokens. */
  videoInput?: SceneGenerationInput; videoResult?: unknown;
  blocker?: SceneConfirmationView["blocker"];
}
export function confirmationView(row: SceneConfirmationRecord): SceneConfirmationView {
  const step = row.steps.find(s => s.step !== "done" && !s.blocker) ?? row.steps.find(s => s.blocker);
  return { confirmationId: row.id, state: row.state,
    ...(step ? { currentShotId: step.shotId, currentStep: step.step as "speech" | "attach" | "accept" } : row.state === "running" && row.kind === "video" ? { currentStep: "video" as const } : {}),
    ...(row.blocker ? { blocker: row.blocker } : {}) };
}
const stepKey = (row: SceneConfirmationRecord, shotId: string, action: string) => digest({ confirmationId: row.id, shotId, action });

function audioStep(production: ProductionService, projectId: string, row: { shotId: string; narration: SpeechIntent & { recordingCurrent: boolean; intentDigest: string } }): SceneAudioStep {
  const audio = row.narration;
  const reusable = !audio.recordingCurrent ? reusableNarrationSpeech(production, projectId, audio) : undefined;
  const entry = production.store.get<{ entries: { segmentId: string; audioId: string | null }[] }>("narration_state", projectId)?.entries.find(entry => entry.segmentId === audio.segmentId);
  return { shotId: row.shotId, attachmentAudioId: entry?.audioId ?? null, attachmentCursor: production.store.cursor(projectId), step: audio.recordingCurrent ? "accept" : reusable ? "attach" : "speech",
    intentDigest: audio.intentDigest, ...(audio.voice ? { voice: audio.voice } : {}),
    ...(audio.profileId ? { profileId: audio.profileId } : {}), ...(audio.profileRevisionId ? { profileRevisionId: audio.profileRevisionId } : {}),
    ...reusable };
}

/** One installation runner. Each advance checkpoints at most one step per record. No provider call lives in HTTP. */
export class SceneConfirmationRunner {
  private running = false;
  constructor(readonly production: ProductionService, readonly audio?: SceneAudioPorts) {}
  private get store() { return this.production.store; }
  workspace() {
    invariant(this.audio, "NARRATION_SPEECH_UNAVAILABLE", "Configure narration before generating voice lines");
    return createShotAudioWorkspace({ production: this.production, ...this.audio,
      actorFor: (projectId, sessionId) => {
        const session = this.store.get<{ projectId: string; requestId: string }>("narration_session", sessionId);
        invariant(session?.projectId === projectId, "NARRATION_SESSION_STALE", "The narration session changed");
        return { kind: "human", principalId: "local-user", requestId: session.requestId };
      } });
  }
  private save(row: SceneConfirmationRecord) {
    this.store.transaction(() => {
      this.store.put("scene_confirmation", row.id, row.projectId, row);
      this.store.appendEvent(row.projectId, "scene.confirmation_changed", { ...confirmationView(row), sceneId: row.sceneId });
    });
  }
  enqueueKeyframes = (projectId: string, sceneId: string, shotIds: string[], actor: ActorContext, runId?: string): void => {
    const view = sceneGenerationView(this.production, projectId, sceneId, this.audio?.narration);
    const rows = view.narrationEvidence.filter(r => shotIds.includes(r.shotId) && r.narration.mode === "generated" && !r.narration.ready);
    if (!rows.length) return;
    invariant(this.audio?.narrationSpeech, "NARRATION_SPEECH_UNAVAILABLE", "Configure narration before generating keyframes with voice lines");
    this.assertNoOpen(projectId, sceneId, rows.map(r => r.shotId));
    this.assertNoVoiceInFlight(projectId, rows.map(r => r.shotId));
    const project = this.store.getProject(projectId), lock = this.store.get("capability_lock", project.capabilityLockId);
    const shotGuardDigests = Object.fromEntries(shotIds.map(shotId => [shotId, sceneConfirmationGuard(project, shotId, lock)]));
    this.store.transaction(() => {
      const id = runId ?? actor.requestId;
      this.save({ id, actor, projectId, sceneId, kind: "keyframes", state: "running", createdAt: new Date().toISOString(),
        sceneIntentDigest: view.sceneIntentDigest, guardDigest: digest(shotGuardDigests), shotGuardDigests, framePins: [], frames: [], steps: rows.map(r => audioStep(this.production, projectId, r)) });
      // Conversation scenes share their human request, but each voice run owns its
      // own dispatch guards and retry policy. Keep grants under that human request.
      const action = this.store.get<{ imageNodes?: { candidateId: string | null }[] }>("scene_generation_action", id);
      for (const pin of action?.imageNodes ?? []) if (pin.candidateId)
        this.store.insert("scene_confirmation_candidate", pin.candidateId, projectId, { candidateId: pin.candidateId, confirmationId: id });
    });
  };
  private assertNoVoiceInFlight(projectId: string, shotIds: string[]) {
    const segments = new Set(this.store.list<{ shotId: string; segmentId: string }>("narration_shot_draft", projectId).filter(d => shotIds.includes(d.shotId)).map(d => d.segmentId));
    for (const attempt of this.production.engine.attempts(projectId)) {
      if (!attempt.narrationSpeech || attempt.released || ["succeeded", "failed"].includes(attempt.phase)) continue;
      const application = this.store.get<{ review: { id: string } }>("narration_speech_application", attempt.narrationSpeech.application.id);
      const review = application ? this.store.get<{ requestId: string; section: { segmentId: string } }>("narration_speech_review", application.review.id) : undefined;
      const request = review ? this.store.get<{ scopeIds: string[] }>("message", review.requestId) : undefined;
      invariant(!review || !(segments.has(review.section.segmentId) || shotIds.some(id => request?.scopeIds.includes(id))),
        attempt.phase === "submission_unknown" ? "SUBMISSION_UNKNOWN" : "ATTEMPT_EXISTS", "Resolve this shot's existing voice job before buying another");
    }
  }
  private assertNoOpen(projectId: string, sceneId: string, shotIds?: string[]) {
    invariant(!this.store.list<SceneConfirmationRecord>("scene_confirmation", projectId).some(r => r.sceneId === sceneId && r.state === "running" &&
      (!shotIds || r.kind === "video" || r.steps.some(s => s.step !== "done" && shotIds.includes(s.shotId)))),
    "CONFIRMATION_RUNNING", "Follow the scene's existing confirmation");
  }
  confirm(projectId: string, sceneId: string, input: ConfirmSceneInput, key: string): SceneConfirmationView {
    this.production.recovery.assertWritable(projectId);
    return this.store.command(`local-user:${projectId}:scene-confirm`, key, digest({ sceneId, ...input }), () => {
      const captured = sceneView(this.production, projectId, sceneId), view = sceneGenerationView(this.production, projectId, sceneId, this.audio?.narration, captured);
      invariant(input.confirmationDigest === view.confirmationDigest && view.confirmationDigest !== null, "SCENE_REVIEW_STALE", "Review this scene's current frames and recipe");
      invariant(!view.paused, "EXECUTION_PAUSED", "Continue the film before confirming");
      // Refuse before any voice line is bought: an open blocking note would stop the chain at the video step.
      invariant(view.blockingNotes.length === 0, "RECOMMENDATION_OPEN", "Settle the blocking Director notes before confirming");
      invariant(!view.busy, "WAITING_USER", "Finish the current conversation before confirming");
      this.assertNoOpen(projectId, sceneId);
      const targets = generationTargets(view.rows, "video");
      invariant(targets.length, "ALREADY_COMPLETE", "This scene already has its clips");
      invariant(targets.every(r => !r.imagePending && !r.videoPending && !r.blockedCode && r.image && r.motionPrompt.trim()), "SCENE_REVIEW_STALE", "Finish the current frames before confirming");
      invariant(input.reviewedFrames.length === targets.length && new Set(input.reviewedFrames.map(f => f.shotId)).size === targets.length && targets.every(r =>
        input.reviewedFrames.some(f => f.shotId === r.shotId && f.artifactId === r.image!.artifactId && f.sha256 === r.image!.sha256)), "SCENE_REVIEW_STALE", "Confirm the exact current frames");
      const opened = this.store.list<{ principal: string; shotId: string; artifactId: string; sha256: string }>("frame_view", projectId);
      invariant(input.reviewedFrames.every(f => opened.some(v => v.principal === "local-user" && v.shotId === f.shotId && v.artifactId === f.artifactId && v.sha256 === f.sha256)), "SCENE_REVIEW_STALE", "Open every current frame before confirming");
      const framePins = targets.map(r => ({ shotId: r.shotId, artifactId: r.image!.artifactId, sha256: r.image!.sha256, nodeId: r.frameNodeId }));
      invariant(confirmationFramesCurrent(this.store, this.store.getProject(projectId), framePins), "SCENE_REVIEW_STALE", "The reviewed frame must be a current output of its image binding");
      const estimate = quote(captured.lock, targets, "confirmVideo");
      invariant(input.expectedEstimateMicros === undefined || input.expectedEstimateMicros === estimate.micros, "ESTIMATE_CHANGED", "Review the scene's current estimate");
      this.assertNoVoiceInFlight(projectId, targets.map(r => r.shotId));
      const actor = this.production.beginRequest(projectId, "local-user", "Confirm the reviewed scene frames, narration and video recipe.",
        { source: "app", concurrency: "alongside", holdScopeIds: [], scopeIds: [sceneId], key: `scene-confirm:${key}` });
      this.production.authorize(projectId, actor, targets.map(r => ({ scopeId: r.shotId, kind: "video" as const })), `confirm:${key}`);
      const project = this.store.getProject(projectId), lock = this.store.get("capability_lock", project.capabilityLockId);
      const shotGuardDigests = Object.fromEntries(framePins.map(pin => [pin.shotId, sceneConfirmationGuard(project, pin.shotId, lock, pin)]));
      const row: SceneConfirmationRecord = { id: actor.requestId, actor, projectId, sceneId, kind: "video", state: "running", createdAt: new Date().toISOString(),
        sceneIntentDigest: view.sceneIntentDigest, guardDigest: digest(shotGuardDigests), shotGuardDigests, framePins, frames: input.reviewedFrames,
        steps: targets.filter(r => !r.narration.ready).map(r => ({ ...audioStep(this.production, projectId, r), ...(r.narration.mode !== "generated" ? { step: "accept" as const } : {}) })) };
      this.production.engine.setHold(projectId, { scopeId: sceneId, ownerId: row.id });
      this.save(row);
      return confirmationView(row);
    });
  }
  async advance(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const project of this.store.listProjects()) {
        if (this.store.get<{ paused: boolean }>("execution_control", project.id)?.paused) continue;
        for (const row of this.store.list<SceneConfirmationRecord>("scene_confirmation", project.id).filter(r => r.state === "running")) {
          try { await this.advanceOne(row); }
          catch (error) {
            const current = this.store.get<SceneConfirmationRecord>("scene_confirmation", row.id);
            if (current?.state !== "running") continue;
            const step = current.steps.find(s => s.step !== "done" && !s.blocker);
            const blocker = { code: error instanceof DomainError ? error.code : "CONFIRMATION_FAILED", ...(step ? { shotId: step.shotId } : {}) };
            if (blocker.code === "NARRATION_CUE_OUT_OF_RANGE" && step?.step === "accept") {
              step.blocker = { code: blocker.code, shotId: step.shotId };
              const remaining = current.steps.some(s => s.step !== "done" && !s.blocker);
              this.save({ ...current, state: remaining ? "running" : "blocked", blocker: current.blocker ?? blocker });
            } else this.save({ ...current, state: "blocked", blocker });
          }
        }
      }
    } finally { this.running = false; }
  }
  private fresh(row: SceneConfirmationRecord, step?: SceneAudioStep) {
    const latest = this.store.get<SceneConfirmationRecord>("scene_confirmation", row.id);
    invariant(latest?.state === "running" && !this.store.get<{ paused: boolean }>("execution_control", row.projectId)?.paused, "EXECUTION_PAUSED", "This confirmation was stopped");
    const view = sceneGenerationView(this.production, row.projectId, row.sceneId, this.audio?.narration);
    if (step && ["attach", "accept"].includes(step.step)) {
      const audio = view.narrationEvidence.find(r => r.shotId === step.shotId)?.narration;
      if (step.intentDigest === undefined && audio) {
        const proposal = step.speechResult?.proposal;
        const original = proposal ? this.store.get<{ project: import("@openslate/core").ProjectRecord }>("project_revision", proposal.baseProject.revisionId)?.project : undefined;
        const shot = original?.shots.find(shot => shot.id === step.shotId);
        // Older rows have no per-shot intent pin. Paid publication supplies immutable
        // evidence; accept-only rows must still match their original complete scene.
        invariant(proposal ? shot && digest(original) === proposal.baseProject.digest :
          view.sceneIntentDigest === row.sceneIntentDigest && confirmationFramesCurrent(this.store, this.store.getProject(row.projectId), row.framePins),
        "SCENE_REVIEW_STALE", "Review this legacy confirmation's changed narration again");
        step.intentDigest = shot ? digest({ shotId: step.shotId, narration: shot.narration ?? null }) : audio.intentDigest;
        const profileId = proposal?.profile.id ?? audio.profileId, profileRevisionId = proposal?.profile.revision ?? audio.profileRevisionId;
        if (profileId) step.profileId = profileId;
        if (profileRevisionId) step.profileRevisionId = profileRevisionId;
        step.voice ??= proposal?.operation.voice ?? audio.voice;
        this.save(row);
      }
      invariant(audio && (step.intentDigest === undefined || audio.intentDigest === step.intentDigest) &&
        (audio.mode !== "generated" || (!step.profileId || audio.profileId === step.profileId) && (!step.profileRevisionId || audio.profileRevisionId === step.profileRevisionId)) &&
        (!step.speechInput || audio.segmentId === step.speechInput.segmentId && audio.segmentRevisionId === step.speechInput.segmentRevisionId),
      "NARRATION_SPEECH_STALE", "The voice line's own narration changed");
      return view;
    }
    // Speech and video steps are dispatched under per-shot guards; a checkpoint without them needs a new confirm.
    const shotIds = [...row.framePins.map(pin => pin.shotId), ...row.steps.map(step => step.shotId)];
    invariant(row.shotGuardDigests && shotIds.every(shotId => typeof row.shotGuardDigests![shotId] === "string"),
      "SCENE_REVIEW_STALE", "Review this scene again to refresh its dispatch confirmation");
    this.production.assertActor(row.projectId, row.actor, true);
    invariant(view.sceneIntentDigest === row.sceneIntentDigest && confirmationFramesCurrent(this.store, this.store.getProject(row.projectId), row.framePins) && row.frames.every(f => view.rows.some(r => r.shotId === f.shotId && r.image?.artifactId === f.artifactId && r.image.sha256 === f.sha256)), "SCENE_REVIEW_STALE", "The reviewed scene changed");
    return view;
  }
  private async advanceOne(row: SceneConfirmationRecord) {
    // Publication may have committed just before a crash. Resolve its exact command before checking changed state.
    const videoCommand = { kind: "video" as const, reviewedFrames: row.frames };
    if (row.kind === "video" && !row.videoInput) {
      const replay = this.store.commandReplay(`local-user:${row.projectId}:scene-generation`, stepKey(row, "scene", "video"), sceneGenerationCommandDigest(row.sceneId, videoCommand, row.actor));
      if (replay) { this.save({ ...row, state: "done", videoResult: replay.result }); return; }
    }
    if (row.videoInput) {
      const replay = this.store.commandReplay(`local-user:${row.projectId}:scene-generation`, stepKey(row, "scene", "video"), digest({ sceneId: row.sceneId, ...row.videoInput }));
      if (replay) { this.save({ ...row, state: "done", videoResult: replay.result }); return; }
      // A historic pre-publication checkpoint may carry obsolete film-head tokens.
      delete row.videoInput;
      this.save(row);
    }
    const step = row.steps.find(s => s.step !== "done" && !s.blocker);
    if (!step && row.blocker) { this.save({ ...row, state: "blocked" }); return; }
    const view = this.fresh(row, step);
    if (!step) {
      if (row.kind === "keyframes") { this.save({ ...row, state: "done" }); return; }
      const input = { ...videoCommand, headVersion: view.headVersion, revisionId: view.revisionId,
        reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId };
      const result = await generateScene(this.production, row.projectId, row.sceneId, input, stepKey(row, "scene", "video"), this.audio?.narration, { actor: row.actor });
      this.save({ ...row, state: "done", videoResult: result }); return;
    }
    const workspace = this.workspace(), projectId = row.projectId, shotId = step.shotId, audio = view.narrationEvidence.find(r => r.shotId === shotId)!.narration;
    if (!step.sessionId) {
      this.store.transaction(() => {
        this.fresh(row, step);
        const previous = this.store.get<{ sessionId: string }>("narration_shot_session_head", shotSessionHeadId(projectId, shotId));
        const session = createShotNarrationSession(this.production, projectId, shotId, stepKey(row, shotId, "session"), previous?.sessionId, { holdScopeIds: [] });
        step.sessionId = session.id;
        this.store.put("scene_confirmation_request", session.requestId, projectId, { confirmationId: row.id });
        this.save(row);
      });
    }
    const session = this.store.get<{ requestId: string }>("narration_session", step.sessionId!);
    invariant(session, "NARRATION_SESSION_STALE", "The narration session changed");
    const actor: ActorContext = step.step === "attach" ? { kind: "human", principalId: "local-user", requestId: session.requestId } : workspace.actorForShot(projectId, step.sessionId!, shotId);
    if (step.step === "speech") {
      const voice = step.voice ?? audio.voice; // Existing checkpoints retain their saved speechInput.
      invariant(this.audio?.narrationSpeech && audio.mode === "generated" && audio.profileId && voice, "NARRATION_SPEECH_UNAVAILABLE", "Configure a voice for this shot");
      if (!step.speechInput) {
        this.store.transaction(() => {
          this.fresh(row);
          const saved = workspace.saveWriting(projectId, shotId, { sessionId: step.sessionId!, expectedHeadVersion: this.store.getProject(projectId).headVersion,
            expectedVersion: this.audio!.narration.workspaceSnapshot(projectId).state.version, text: audio.text, language: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(audio.text) ? "zh" : "en", mode: "generated", voice, profileRevisionId: audio.profileRevisionId }, stepKey(row, shotId, "writing"), { preserveAuthoredVoice: true });
          invariant(saved.segment, "NARRATION_SPEECH_INVALID", "The saved voice line is unavailable");
          step.speechInput = { key: stepKey(row, shotId, "speech"), expectedHeadVersion: saved.headVersion, segmentId: saved.segment.entry.segmentId,
            segmentRevisionId: saved.segment.script.id, profileId: audio.profileId!, voice, instructions: "" };
          this.save(row);
        });
      }
      const result = await this.audio.narrationSpeech.request(projectId, actor, step.speechInput!);
      step.speechResult = result; step.step = "attach"; this.save(row); return;
    }
    if (step.step === "attach") {
      const attempts = this.production.engine.attempts(projectId).filter(a => a.candidateId === step.speechResult!.receipt.candidateId);
      const attempt = attempts.at(-1);
      invariant(attempt?.phase !== "failed", "NARRATION_SPEECH_FAILED", "The voice job failed; review before buying another");
      invariant(attempt?.phase !== "submission_unknown", "SUBMISSION_UNKNOWN", "The voice provider did not confirm the result");
      if (attempt?.phase !== "succeeded") {
        // A refused admission creates no attempt. Recheck its scene fences instead of waiting forever.
        if (!attempt) this.fresh(row);
        return;
      }
      const selected = resolveGeneratedNarrationAudio(this.store, projectId, attempt.outputs.audio!.artifactId);
      if (!step.attachInput) {
        step.attachInput = { expectedVersion: this.audio!.narration.workspaceSnapshot(projectId).state.version, segmentId: step.speechInput!.segmentId,
          segmentRevisionId: step.speechInput!.segmentRevisionId, artifactId: selected.artifact.id, artifactDigest: selected.artifactDigest,
          generationEvidenceDigest: selected.generationEvidenceDigest, key: stepKey(row, shotId, "attach") };
        this.save(row);
      }
      const { expectedVersion, key, ...selection } = step.attachInput;
      const attached = this.store.commandReplay(`${actor.principalId}:${projectId}:${actor.requestId}:narration`, key,
        digest({ action: "attach_generated_audio", expectedVersion, arguments: selection }));
      if (!attached) {
        // No storage write happened under this key. Its global version can move
        // with another section; the exact own section/take pins remain frozen.
        step.attachInput.expectedVersion = this.audio!.narration.workspaceSnapshot(projectId).state.version;
        this.save(row);
      }
      await this.audio!.narration.attachGeneratedAudio(projectId, actor, step.attachInput, { completedSceneAttachment: { confirmationId: row.id, shotId } });
      this.fresh(row, step); step.results = { ...step.results, attached: true }; step.step = "accept"; this.save(row); return;
    }
    if (!step.acceptInput) {
      const detail = workspace.detail(projectId, shotId), segment = detail.segment;
      invariant(segment?.audio, "NARRATION_RECORDING_REQUIRED", "Attach this shot's recording before confirming");
      const samples = segment.audio.media.probe.audio?.samples;
      invariant(samples && samples <= detail.plannedFrames * 1600, "NARRATION_CUE_OUT_OF_RANGE", "Choose how to fit the measured narration before video");
      step.acceptInput = { sessionId: step.sessionId!, expectedHeadVersion: detail.headVersion, expectedVersion: detail.narrationVersion,
        segmentId: segment.entry.segmentId, segmentRevisionId: segment.script.id, audioId: segment.audio.id, sha256: segment.audio.media.sha256,
        startSample: 0, endSample: samples, durationMode: "keep" };
      this.save(row);
    }
    let acceptKey = step.acceptKey ?? stepKey(row, shotId, "accept");
    const prepared = this.store.commandReplay<{ preparedId: string }>(`local-user:${projectId}:shot-audio-accept`, acceptKey, digest({ shotId, ...step.acceptInput }));
    const committed = prepared && this.store.get("narration_commit_receipt", prepared.result.preparedId);
    const detail = workspace.detail(projectId, shotId);
    if (!prepared || !committed && (step.acceptInput.expectedHeadVersion !== detail.headVersion ||
      this.store.get<{ expectedNarrationVersion: number }>("narration_prepared", prepared.result.preparedId)?.expectedNarrationVersion !== detail.narrationVersion)) {
      // A committed preparation keeps its exact original body for replay. Only
      // a free, unpublished acceptance may reprepare against unrelated changes.
      if (prepared) {
        acceptKey = digest({ previousKey: acceptKey, preparedId: prepared.result.preparedId,
          headVersion: detail.headVersion, narrationVersion: detail.narrationVersion });
        step.acceptKey = acceptKey;
      }
      step.acceptInput.expectedHeadVersion = detail.headVersion;
      step.acceptInput.expectedVersion = detail.narrationVersion;
      this.save(row);
    }
    const result = await workspace.accept(projectId, shotId, step.acceptInput, acceptKey);
    this.fresh(row, step);
    const project = this.store.getProject(projectId);
    row.shotGuardDigests = { ...row.shotGuardDigests, [shotId]: sceneConfirmationGuard(project, shotId, this.store.get("capability_lock", project.capabilityLockId), row.framePins.find(pin => pin.shotId === shotId)) };
    row.guardDigest = digest(row.shotGuardDigests); step.results = { ...step.results, accepted: result.receipt }; step.step = "done"; this.save(row);
  }
}

export function registerSceneConfirmations(app: FastifyInstance, runner: SceneConfirmationRunner) {
  app.post<{ Params: { projectId: string; sceneId: string }; Body: ConfirmSceneInput }>("/api/projects/:projectId/scenes/:sceneId/confirm", {
    schema: { body: { type: "object", additionalProperties: false, required: ["confirmationDigest", "reviewedFrames"], properties: {
      confirmationDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, expectedEstimateMicros: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 32 },
      reviewedFrames: { type: "array", maxItems: 64, items: { type: "object", additionalProperties: false, required: ["shotId", "artifactId", "sha256"], properties: {
        shotId: { type: "string", minLength: 1, maxLength: 160 }, artifactId: { type: "string", minLength: 1, maxLength: 160 }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
      } } },
    } } },
  }, async request => runner.confirm(request.params.projectId, request.params.sceneId, request.body, requiredCommandKey(request)));
}
