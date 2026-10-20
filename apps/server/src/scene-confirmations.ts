import { sceneConfirmationGuard, type ConfirmationFramePin } from "./scene-confirmation-state.js";
import type { FastifyInstance } from "fastify";
import { digest, DomainError, invariant } from "@openslate/core";
import type { ActorContext, ConfirmSceneInput, SceneConfirmationView } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import { requiredCommandKey } from "./application/command-key.js";
import { generateScene, sceneGenerationView, sceneView, type SceneGenerationInput } from "./scene-generation.js";
import { generationTargets } from "./scene-row.js";
import { quote } from "./generation-quotes.js";
import type { NarrationService } from "./narration/service.js";
import type { NarrationCanonicalService } from "./narration/canonical.js";
import type { NarrationSpeechService } from "./narration/narration-speech-service.js";
import type { PrepareNarrationSpeech } from "./narration/narration-speech-types.js";
import { createShotNarrationSession, shotSessionHeadId } from "./narration/narration-scope.js";
import { createShotAudioWorkspace, type AcceptShotAudio } from "./narration/shot-audio-routes.js";
import { resolveGeneratedNarrationAudio } from "./narration/generated-audio.js";

export interface SceneAudioPorts { narration: NarrationService; canonical: NarrationCanonicalService; narrationSpeech?: NarrationSpeechService }
type AttachInput = Parameters<NarrationService["attachGeneratedAudio"]>[2];
export interface SceneAudioStep {
  shotId: string; step: "speech" | "attach" | "accept" | "done";
  /** Freeze the effective voice at the human press; later defaults apply to new commands only. */
  voice?: string;
  sessionId?: string; speechInput?: PrepareNarrationSpeech;
  speechResult?: Awaited<ReturnType<NarrationSpeechService["request"]>>;
  attachInput?: AttachInput; acceptInput?: AcceptShotAudio;
  results?: { attached?: boolean; accepted?: unknown };
}
export interface SceneConfirmationRecord {
  id: string; projectId: string; sceneId: string; kind: "keyframes" | "video";
  actor: ActorContext; state: SceneConfirmationView["state"]; createdAt: string;
  sceneIntentDigest: string; guardDigest: string; framePins: ConfirmationFramePin[]; frames: ConfirmSceneInput["reviewedFrames"];
  /** Per-shot dispatch guards. Older scene-wide checkpoints require a fresh confirmation. */
  shotGuardDigests?: Record<string, string>;
  steps: SceneAudioStep[]; videoInput?: SceneGenerationInput; videoResult?: unknown;
  blocker?: SceneConfirmationView["blocker"];
}
export function confirmationView(row: SceneConfirmationRecord): SceneConfirmationView {
  const step = row.steps.find(s => s.step !== "done");
  return { confirmationId: row.id, state: row.state,
    ...(step ? { currentShotId: step.shotId, currentStep: step.step as "speech" | "attach" | "accept" } : row.state === "running" && row.kind === "video" ? { currentStep: "video" as const } : {}),
    ...(row.blocker ? { blocker: row.blocker } : {}) };
}
const stepKey = (row: SceneConfirmationRecord, shotId: string, action: string) => digest({ confirmationId: row.id, shotId, action });

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
  enqueueKeyframes = (projectId: string, sceneId: string, shotIds: string[], actor: ActorContext): void => {
    const view = sceneGenerationView(this.production, projectId, sceneId, this.audio?.narration);
    const rows = view.narrationEvidence.filter(r => shotIds.includes(r.shotId) && r.narration.mode === "generated" && !r.narration.ready);
    if (!rows.length) return;
    invariant(this.audio?.narrationSpeech, "NARRATION_SPEECH_UNAVAILABLE", "Configure narration before generating keyframes with voice lines");
    this.assertNoOpen(projectId, sceneId, rows.map(r => r.shotId));
    this.assertNoVoiceInFlight(projectId, rows.map(r => r.shotId));
    const project = this.store.getProject(projectId), lock = this.store.get("capability_lock", project.capabilityLockId);
    const shotGuardDigests = Object.fromEntries(shotIds.map(shotId => [shotId, sceneConfirmationGuard(project, shotId, lock)]));
    this.save({ id: actor.requestId, actor, projectId, sceneId, kind: "keyframes", state: "running", createdAt: new Date().toISOString(),
      sceneIntentDigest: view.sceneIntentDigest, guardDigest: digest(shotGuardDigests), shotGuardDigests, framePins: [], frames: [], steps: rows.map(r => ({ shotId: r.shotId, step: r.narration.recordingCurrent ? "accept" : "speech", ...(r.narration.voice ? { voice: r.narration.voice } : {}) })) });
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
      const estimate = quote(captured.lock, targets, "confirmVideo");
      invariant(input.expectedEstimateMicros === undefined || input.expectedEstimateMicros === estimate.micros, "ESTIMATE_CHANGED", "Review the scene's current estimate");
      this.assertNoVoiceInFlight(projectId, targets.map(r => r.shotId));
      const actor = this.production.beginRequest(projectId, "local-user", "Confirm the reviewed scene frames, narration and video recipe.",
        { source: "app", concurrency: "alongside", holdScopeIds: [], scopeIds: [sceneId], key: `scene-confirm:${key}` });
      this.production.authorize(projectId, actor, targets.map(r => ({ scopeId: r.shotId, kind: "video" as const })), `confirm:${key}`);
      const project = this.store.getProject(projectId), lock = this.store.get("capability_lock", project.capabilityLockId);
      const framePins = targets.map(r => ({ shotId: r.shotId, artifactId: r.image!.artifactId, sha256: r.image!.sha256, nodeId: r.frameNodeId }));
      const shotGuardDigests = Object.fromEntries(framePins.map(pin => [pin.shotId, sceneConfirmationGuard(project, pin.shotId, lock, pin)]));
      const row: SceneConfirmationRecord = { id: actor.requestId, actor, projectId, sceneId, kind: "video", state: "running", createdAt: new Date().toISOString(),
        sceneIntentDigest: view.sceneIntentDigest, guardDigest: digest(shotGuardDigests), shotGuardDigests, framePins, frames: input.reviewedFrames,
        steps: targets.filter(r => !r.narration.ready).map(r => ({ shotId: r.shotId,
          step: r.narration.mode === "generated" && !r.narration.recordingCurrent ? "speech" : "accept", ...(r.narration.voice ? { voice: r.narration.voice } : {}) })) };
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
            this.save({ ...current, state: "blocked", blocker: { code: error instanceof DomainError ? error.code : "CONFIRMATION_FAILED", ...(current.steps.find(s => s.step !== "done") ? { shotId: current.steps.find(s => s.step !== "done")!.shotId } : {}) } });
          }
        }
      }
    } finally { this.running = false; }
  }
  private fresh(row: SceneConfirmationRecord) {
    const latest = this.store.get<SceneConfirmationRecord>("scene_confirmation", row.id);
    invariant(latest?.state === "running" && !this.store.get<{ paused: boolean }>("execution_control", row.projectId)?.paused, "EXECUTION_PAUSED", "This confirmation was stopped");
    const shotIds = [...row.framePins.map(pin => pin.shotId), ...row.steps.map(step => step.shotId)];
    invariant(row.shotGuardDigests && shotIds.every(shotId => typeof row.shotGuardDigests![shotId] === "string"),
      "SCENE_REVIEW_STALE", "Review this scene again to refresh its dispatch confirmation");
    this.production.assertActor(row.projectId, row.actor, true);
    const view = sceneGenerationView(this.production, row.projectId, row.sceneId, this.audio?.narration);
    invariant(view.sceneIntentDigest === row.sceneIntentDigest && row.frames.every(f => view.rows.some(r => r.shotId === f.shotId && r.image?.artifactId === f.artifactId && r.image.sha256 === f.sha256)), "SCENE_REVIEW_STALE", "The reviewed scene changed");
    return view;
  }
  private async advanceOne(row: SceneConfirmationRecord) {
    // Publication may have committed just before a crash. Resolve its exact command before checking changed state.
    if (row.videoInput) {
      const replay = this.store.commandReplay(`local-user:${row.projectId}:scene-generation`, stepKey(row, "scene", "video"), digest({ sceneId: row.sceneId, ...row.videoInput }));
      if (replay) { this.save({ ...row, state: "done", videoResult: replay.result }); return; }
    }
    const view = this.fresh(row), step = row.steps.find(s => s.step !== "done");
    if (!step) {
      if (row.kind === "keyframes") { this.save({ ...row, state: "done" }); return; }
      if (!row.videoInput) {
        row.videoInput = { headVersion: view.headVersion, revisionId: view.revisionId, kind: "video", reviewedFrames: row.frames,
          reviewedHoldDigest: view.reviewedHoldDigest, reviewedControlAuthorityId: view.reviewedControlAuthorityId };
        this.save(row);
      }
      const result = await generateScene(this.production, row.projectId, row.sceneId, row.videoInput, stepKey(row, "scene", "video"), this.audio?.narration, { actor: row.actor });
      this.save({ ...row, state: "done", videoResult: result }); return;
    }
    const workspace = this.workspace(), projectId = row.projectId, shotId = step.shotId, audio = view.narrationEvidence.find(r => r.shotId === shotId)!.narration;
    if (!step.sessionId) {
      this.store.transaction(() => {
        this.fresh(row);
        const previous = this.store.get<{ sessionId: string }>("narration_shot_session_head", shotSessionHeadId(projectId, shotId));
        const session = createShotNarrationSession(this.production, projectId, shotId, stepKey(row, shotId, "session"), previous?.sessionId, { holdScopeIds: [] });
        step.sessionId = session.id;
        this.store.put("scene_confirmation_request", session.requestId, projectId, { confirmationId: row.id });
        this.save(row);
      });
    }
    const actor = workspace.actorForShot(projectId, step.sessionId!, shotId);
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
      this.fresh(row); step.speechResult = result; step.step = "attach"; this.save(row); return;
    }
    if (step.step === "attach") {
      const attempts = this.production.engine.attempts(projectId).filter(a => a.candidateId === step.speechResult!.receipt.candidateId);
      const attempt = attempts.at(-1);
      invariant(attempt?.phase !== "failed", "NARRATION_SPEECH_FAILED", "The voice job failed; review before buying another");
      invariant(attempt?.phase !== "submission_unknown", "SUBMISSION_UNKNOWN", "The voice provider did not confirm the result");
      if (attempt?.phase !== "succeeded") return;
      const selected = resolveGeneratedNarrationAudio(this.store, projectId, attempt.outputs.audio!.artifactId);
      if (!step.attachInput) {
        step.attachInput = { expectedVersion: this.audio!.narration.workspaceSnapshot(projectId).state.version, segmentId: step.speechInput!.segmentId,
          segmentRevisionId: step.speechInput!.segmentRevisionId, artifactId: selected.artifact.id, artifactDigest: selected.artifactDigest,
          generationEvidenceDigest: selected.generationEvidenceDigest, key: stepKey(row, shotId, "attach") };
        this.save(row);
      }
      await this.audio!.narration.attachGeneratedAudio(projectId, actor, step.attachInput);
      this.fresh(row); step.results = { ...step.results, attached: true }; step.step = "accept"; this.save(row); return;
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
    const result = await workspace.accept(projectId, shotId, step.acceptInput, stepKey(row, shotId, "accept"));
    this.fresh(row);
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
