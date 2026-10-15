import type { FastifyInstance } from "fastify";
import { digest, invariant, newId } from "@openslate/core";
import type { ProjectRecord } from "@openslate/core";
import { OPENAI_SPEECH_VOICES } from "@openslate/providers";
import { requiredCommandKey } from "../application/command-key.js";
import { recordHumanFields } from "../application/human-fields.js";
import { captureMediaUndo, type MediaUndo } from "../storyboard-history.js";
import type { NodeBinding } from "../execution/engine.js";
import { createShotAudioWorkspace, type AcceptShotAudio, type ShotAudioOptions } from "./shot-audio-routes.js";
import { createShotNarrationSession, shotDraftId, shotSessionHeadId } from "./narration-scope.js";
import type { ManagedUploadStore } from "./managed-upload.js";
import type { ProductionService } from "../application/service.js";

interface RecordingIntent { before: ProjectRecord; sessionId: string; commandId: string }
interface RecordingStage { accept: AcceptShotAudio; fits: boolean; measuredSeconds: number; samples: number; undo: MediaUndo }

/** Stock metadata is available even when local audio tools could not be configured. */
export function registerStockVoices(app: FastifyInstance, production: () => ProductionService): void {
  app.get<{ Querystring: { projectId?: string } }>("/api/narration/voices", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: { projectId: { type: "string", minLength: 1, maxLength: 160 } } } },
  }, request => {
    const defaultNarratorVoice = request.query.projectId ? production().store.getProject(request.query.projectId).narratorVoice ?? "cedar" : "cedar";
    return { defaultNarratorVoice, voices: OPENAI_SPEECH_VOICES.map(id => ({ id, default: id === defaultNarratorVoice })) };
  });
}

/** A local import and its exact acceptance are one human command, with no provider dispatch. */
export function registerShotRecordingRoutes(app: FastifyInstance, options: ShotAudioOptions & { uploads: ManagedUploadStore }): void {
  const { production, narration, uploads } = options, store = production.store, workspace = createShotAudioWorkspace(options);
  const inFlight = new Map<string, { inputDigest: string; result: Promise<unknown> }>();
  const check = (projectId: string) => { production.recovery.assertWritable(projectId); store.getProject(projectId); };
  app.post<{ Params: { projectId: string; shotId: string }; Querystring: { expectedHeadVersion: string }; Body: AsyncIterable<Uint8Array> }>(
    "/api/projects/:projectId/shots/:shotId/narration/recording", {
      bodyLimit: uploads.maxBytes,
      onRequest: async request => invariant(request.headers["content-type"]?.split(";")[0] === "application/octet-stream", "VALIDATION_ERROR", "Upload recording bytes as application/octet-stream"),
      schema: { querystring: { type: "object", additionalProperties: false, required: ["expectedHeadVersion"], properties: {
        expectedHeadVersion: { type: "string", pattern: "^(0|[1-9][0-9]{0,15})$" },
      } } },
    }, async request => {
      invariant(narration.mediaAvailable, "NARRATION_MEDIA_UNAVAILABLE", "Recording import requires local FFmpeg and ffprobe");
      invariant(request.body && typeof request.body[Symbol.asyncIterator] === "function", "VALIDATION_ERROR", "Choose a nonempty recording");
      const { projectId, shotId } = request.params, key = requiredCommandKey(request), expectedHeadVersion = Number(request.query.expectedHeadVersion);
      invariant(Number.isSafeInteger(expectedHeadVersion), "VALIDATION_ERROR", "Use the displayed project version");
      const scope = `local-user:${projectId}:shot-recording`, identity = digest({ projectId, shotId, key, operation: "shot-recording" });
      const upload = await uploads.receive(request.body, identity, () => check(projectId));
      try {
        const inputDigest = digest({ shotId, expectedHeadVersion, sha256: upload.sha256, byteLength: upload.byteLength });
        const replay = store.commandReplay<unknown>(scope, key, inputDigest);
        if (replay) return replay.result;
        const running = inFlight.get(identity);
        if (running) {
          invariant(running.inputDigest === inputDigest, "IDEMPOTENCY_CONFLICT", "This recording key already identifies different bytes or a different project version");
          return await running.result;
        }
        const result = (async () => {
        const intent = store.command<RecordingIntent>(`${scope}:intent`, key, inputDigest, () => {
          const before = store.getProject(projectId), shot = before.shots.find(value => value.id === shotId);
          invariant(shot, "NOT_FOUND", "Choose a shot in this film");
          invariant(before.headVersion === expectedHeadVersion, "REVISION_CONFLICT", "Reload the shot before adding its recording");
          invariant(!store.list<{ sceneId: string; state: string }>("scene_confirmation", projectId).some(row => row.sceneId === shot.sceneId && row.state === "running"),
            "CONFIRMATION_RUNNING", "Wait for the current scene confirmation");
          const previous = store.get<{ sessionId: string }>("narration_shot_session_head", shotSessionHeadId(projectId, shotId));
          const session = createShotNarrationSession(production, projectId, shotId, digest({ key, action: "recording-session" }), previous?.sessionId, { holdScopeIds: [] });
          return { before, sessionId: session.id, commandId: newId() };
        });
        const actor = workspace.actorForShot(projectId, intent.sessionId, shotId);
        const audio = await narration.importAudio(projectId, actor, { path: upload.path, declaredOrigin: "uploaded", key: digest({ key, action: "recording-import" }) });
        invariant(audio.media.originalSha256 === upload.sha256 && audio.media.originalByteLength === upload.byteLength, "UPLOAD_CORRUPT", "Imported recording differs from uploaded bytes");
        const stage = store.command<RecordingStage>(`${scope}:attach`, key, inputDigest, () => {
          const current = store.getProject(projectId), shot = current.shots.find(value => value.id === shotId);
          invariant(shot && current.headVersion === expectedHeadVersion, "REVISION_CONFLICT", "The shot changed while importing its recording");
          // Import is async. Capture drafts here so Undo retains unrelated edits made while it ran.
          const undo = captureMediaUndo(production, projectId);
          undo.canonicalId = store.get<{ canonicalId: string }>("narration_canonical_head", projectId)?.canonicalId ?? null;
          undo.bindings = store.list<NodeBinding>("node_binding", projectId).filter(binding => binding.state === "active" && binding.planId === current.activePlanId &&
            (binding.node.shotId === shotId || ["timeline", "render"].includes(binding.node.kind)));
          undo.narrationWorkspace = { shotId, state: narration.workspaceSnapshot(projectId).state,
            draft: store.get<{ segmentId: string; intentDigest?: string }>("narration_shot_draft", shotDraftId(projectId, shotId)) ?? null, expectedVersion: -1 };
          const saved = workspace.saveWriting(projectId, shotId, { sessionId: intent.sessionId, expectedHeadVersion,
            expectedVersion: narration.workspaceSnapshot(projectId).state.version, text: shot.narration?.text.trim() || "Uploaded narration recording",
            language: workspace.detail(projectId, shotId).segment?.script.language ?? "en", mode: "uploaded", voice: null, profileRevisionId: null,
          }, digest({ key, action: "recording-writing" }));
          invariant(saved.segment, "NARRATION_RECORDING_REQUIRED", "The shot recording needs its own narration section");
          const bound = narration.bindAudio(projectId, actor, saved.narrationVersion, digest({ key, action: "recording-bind" }), saved.segment.entry.segmentId, audio.id);
          let attached = store.getProject(projectId);
          const attachedShot = attached.shots.find(value => value.id === shotId)!;
          if (!attachedShot.narrationPending || attachedShot.narrationFit) {
            const beforePending = structuredClone(attached);
            attachedShot.narrationPending = true;
            delete attachedShot.narrationFit;
            attached = store.saveProject({ ...attached, revisionId: newId() }, attached.headVersion);
            recordHumanFields(store, beforePending, attached, actor);
            store.insert("project_revision", attached.revisionId, projectId, { project: attached });
          }
          const samples = audio.media.probe.audio?.samples ?? 0;
          invariant(samples > 0, "NARRATION_RECORDING_REQUIRED", "Choose a measured recording");
          return { fits: samples <= shot.desiredFrames * 1600, measuredSeconds: samples / 48000, samples, undo,
            accept: { sessionId: intent.sessionId, expectedHeadVersion: attached.headVersion, expectedVersion: bound.state.version,
              segmentId: saved.segment.entry.segmentId, segmentRevisionId: saved.segment.script.id, audioId: audio.id,
              sha256: audio.media.sha256, startSample: 0, endSample: samples, durationMode: "keep" } };
        });
        const accepted = stage.fits ? await workspace.accept(projectId, shotId, stage.accept, digest({ key, action: "recording-accept" })) : null;
        return store.command(scope, key, inputDigest, () => {
          const shot = workspace.detail(projectId, shotId);
          invariant(shot.segment?.audio?.id === audio.id && shot.segment.script.id === stage.accept.segmentRevisionId &&
            shot.narrationVersion === (accepted?.receipt.narrationVersion ?? stage.accept.expectedVersion) &&
            (accepted ? shot.committed && shot.headVersion === accepted.receipt.headVersion : shot.headVersion === stage.accept.expectedHeadVersion),
          "REVISION_CONFLICT", "Narration changed while accepting the recording");
          stage.undo.narrationWorkspace!.expectedVersion = shot.narrationVersion;
          store.insert("storyboard_edit", intent.commandId, projectId, { id: intent.commandId, before: intent.before, headVersion: shot.headVersion,
            requestId: actor.requestId, input: { kind: "narration", id: shotId, field: "recording", expectedHeadVersion }, undo: stage.undo });
          store.appendEvent(projectId, "storyboard.edited", { commandId: intent.commandId, kind: "narration-recording", shotId });
          return { shotId, headVersion: shot.headVersion, commandId: intent.commandId, fits: stage.fits, measuredSeconds: stage.measuredSeconds,
            recording: { id: audio.id, sha256: audio.media.sha256, samples: stage.samples }, shot };
        });
        })();
        inFlight.set(identity, { inputDigest, result });
        try { return await result; } finally { if (inFlight.get(identity)?.result === result) inFlight.delete(identity); }
      } finally { await upload.release(); }
    });
}
