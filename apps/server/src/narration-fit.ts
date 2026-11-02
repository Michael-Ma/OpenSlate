import { captureMediaUndo, type MediaUndo } from "./storyboard-history.js";
import type { NodeBinding } from "./execution/engine.js";
import type { FastifyInstance } from "fastify";
import { digest, invariant, newId } from "@openslate/core";
import type { NarrationFitInput, NarrationFitReceipt, ProjectRecord, ProviderProfile } from "@openslate/core";
import { requiredCommandKey } from "./application/command-key.js";
import { editStoryboard } from "./storyboard.js";
import { SceneConfirmationRunner } from "./scene-confirmations.js";
import { createShotAudioWorkspace, type AcceptShotAudio } from "./narration/shot-audio-routes.js";
import { createShotNarrationSession, shotSessionHeadId } from "./narration/narration-scope.js";

/** Whole-second picture duration, bounded by both the studio and the actual locked video model. */
export function narrationFitFrames(currentFrames: number, samples: number, profile: ProviderProfile, fit: NarrationFitInput["fit"]): number {
  invariant(Number.isSafeInteger(samples) && samples > 0, "NARRATION_RECORDING_REQUIRED", "Choose a measured recording");
  const frames = fit === "cut_to_shot" ? currentFrames : Math.ceil(Math.max(currentFrames / 30, samples / 48000, (profile.minFrames ?? 90) / 30)) * 30;
  invariant(frames >= Math.max(90, profile.minFrames ?? 90) && frames <= Math.min(450, profile.maxFrames ?? 450), "PROFILE_INCOMPATIBLE", "This voice line cannot fit the selected video model's duration range");
  return frames;
}
interface FitIntent { undo: MediaUndo; before: ProjectRecord; commandId: string; durationFrames: number; accept: AcceptShotAudio }
export async function fitNarration(runner: SceneConfirmationRunner, projectId: string, shotId: string, input: NarrationFitInput, key: string): Promise<NarrationFitReceipt> {
  const production = runner.production, store = production.store, ports = runner.audio;
  production.recovery.assertWritable(projectId);
  const scope = `local-user:${projectId}:narration-fit`, inputDigest = digest({ shotId, ...input });
  const replay = store.commandReplay<NarrationFitReceipt>(scope, key, inputDigest);
  if (replay) return replay.result;
  invariant(ports, "NARRATION_RECORDING_REQUIRED", "Configure narration and attach a voice line");
  const workspace = createShotAudioWorkspace({ production, ...ports, actorFor: (id, sessionId) => {
    const session = store.get<{ projectId: string; requestId: string }>("narration_session", sessionId);
    invariant(session?.projectId === id, "NARRATION_SESSION_STALE", "The shot narration session changed");
    return { kind: "human", principalId: "local-user", requestId: session.requestId };
  } });
  const intent = store.command<FitIntent>(`${scope}:intent`, key, inputDigest, () => {
    const undo = captureMediaUndo(production, projectId);
    undo.canonicalId = store.get<{ canonicalId: string }>("narration_canonical_head", projectId)?.canonicalId ?? null;
    const before = store.getProject(projectId), shot = before.shots.find(s => s.id === shotId);
    invariant(shot, "NOT_FOUND", "Choose a shot in this film");
    invariant(before.headVersion === input.expectedHeadVersion, "REVISION_CONFLICT", "Reload the shot before choosing a narration fit");
    invariant(!store.list<{ sceneId: string; state: string }>("scene_confirmation", projectId).some(r => r.sceneId === shot.sceneId && r.state === "running"), "CONFIRMATION_RUNNING", "Wait for the current scene confirmation");
    const detail = workspace.detail(projectId, shotId), segment = detail.segment;
    invariant(segment?.audio && detail.intentCurrent && segment.script.text === shot.narration?.text, "NARRATION_RECORDING_REQUIRED", "Make a voice line for the current narration first");
    const lock = store.get<{ profiles: ProviderProfile[]; preferredProfileIds?: { video?: string } }>("capability_lock", before.capabilityLockId)!;
    const profile = lock.profiles.find(p => p.id === lock.preferredProfileIds?.video && p.kind === "video") ?? lock.profiles.find(p => p.kind === "video");
    invariant(profile, "PROFILE_INCOMPATIBLE", "Choose a video model");
    const samples = segment.audio.media.probe.audio?.samples ?? 0;
    const durationFrames = narrationFitFrames(shot.desiredFrames, samples, profile, input.fit);
    undo.bindings = store.list<NodeBinding>("node_binding", projectId).filter(b => b.state === "active" && b.planId === before.activePlanId &&
      (b.node.shotId === shotId || ["timeline", "render"].includes(b.node.kind)));
    if (durationFrames !== shot.desiredFrames) editStoryboard(production, projectId, { kind: "shot", id: shotId, field: "desiredFrames", value: String(durationFrames), expectedHeadVersion: before.headVersion }, digest({ key, action: "extend" }));
    const previous = store.get<{ sessionId: string }>("narration_shot_session_head", shotSessionHeadId(projectId, shotId));
    const session = createShotNarrationSession(production, projectId, shotId, digest({ key, action: "fit-session" }), previous?.sessionId, { holdScopeIds: [] });
    return { undo, before, commandId: newId(), durationFrames, accept: { sessionId: session.id, expectedHeadVersion: store.getProject(projectId).headVersion,
      expectedVersion: detail.narrationVersion, segmentId: segment.entry.segmentId, segmentRevisionId: segment.script.id,
      audioId: segment.audio.id, sha256: segment.audio.media.sha256, startSample: 0,
      endSample: input.fit === "cut_to_shot" ? Math.min(samples, durationFrames * 1600) : samples, durationMode: "keep" } };
  });
  const accepted = await workspace.accept(projectId, shotId, intent.accept, digest({ key, action: "fit-accept" }));
  return store.command(scope, key, inputDigest, () => {
    const project = store.getProject(projectId), shot = project.shots.find(s => s.id === shotId);
    invariant(project.headVersion === accepted.receipt.headVersion && shot && shot.desiredFrames === intent.durationFrames && !shot.narrationPending && shot.narration?.text === intent.before.shots.find(s => s.id === shotId)?.narration?.text,
      "REVISION_CONFLICT", "The shot changed while accepting narration");
    shot.narrationFit = input.fit;
    const saved = store.saveProject({ ...project, revisionId: newId() }, project.headVersion);
    store.insert("project_revision", saved.revisionId, projectId, { project: saved });
    store.insert("storyboard_edit", intent.commandId, projectId, { id: intent.commandId, before: intent.before, headVersion: saved.headVersion,
      requestId: workspace.actorForShot(projectId, intent.accept.sessionId, shotId).requestId, undo: intent.undo });
    store.appendEvent(projectId, "storyboard.edited", { commandId: intent.commandId, kind: "narration-fit", shotId, fit: input.fit });
    return { shotId, fit: input.fit, durationFrames: intent.durationFrames, commandId: intent.commandId };
  });
}
export function registerNarrationFit(app: FastifyInstance, runner: SceneConfirmationRunner) {
  app.post<{ Params: { projectId: string; shotId: string }; Body: NarrationFitInput }>("/api/projects/:projectId/shots/:shotId/narration-fit", {
    schema: { body: { type: "object", additionalProperties: false, required: ["fit", "expectedHeadVersion"], properties: {
      fit: { enum: ["extend_shot", "cut_to_shot"] }, expectedHeadVersion: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    } } },
  }, request => fitNarration(runner, request.params.projectId, request.params.shotId, request.body, requiredCommandKey(request)));
}
