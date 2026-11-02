import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import type { ActorContext } from "@openslate/core";
import { invariant } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { NarrationService } from "./service.js";
import type { NarrationCanonicalService } from "./canonical.js";
import type { NarrationAudio } from "./types.js";
import { ManagedUploadStore } from "./managed-upload.js";
import type { OwnedTranscriptionService } from "./owned-transcription-service.js";
import { registerOwnedTranscriptionRoutes } from "./owned-transcription-routes.js";

import type { NarrationSpeechService } from "./narration-speech-service.js";
import { registerShotAudioRoutes } from "./shot-audio-routes.js";
import { registerNarrationSpeechRoutes } from "./narration-speech-routes.js";
import { assertNarrationAuthority, shotSessionHeadId } from './narration-scope.js';
import type { NarrationSession } from './narration-scope.js';
import { registerAudioLibraryRoutes } from './audio-library-routes.js';
import { registerShotRecordingRoutes } from './shot-recording-routes.js';

type Session = NarrationSession;
interface Params { projectId: string }
/** Register only under the application's inherited authenticated local HTTP boundary. */
export function registerNarrationRoutes(app: FastifyInstance, options: { production: ProductionService; narration: NarrationService; canonical: NarrationCanonicalService; uploadDirectory: string; ownedTranscription?: OwnedTranscriptionService; narrationSpeech?: NarrationSpeechService }): void {
  const { production, narration, canonical } = options, store = production.store;
  const uploads = new ManagedUploadStore({ rootDir: options.uploadDirectory });
  const actorFor = (projectId: string, sessionId: string): ActorContext => {
    const session = store.get<Session>("narration_session", sessionId);
    invariant(session?.projectId === projectId && session.principalId === "local-user", "NARRATION_SESSION_STALE", "Open or explicitly continue this project's narration session");
    const head = session.shotId ? store.get<{ sessionId: string }>("narration_shot_session_head", shotSessionHeadId(projectId, session.shotId))
      : store.get<{ sessionId: string }>("narration_session_head", projectId);
    invariant(head?.sessionId === session.id, "NARRATION_SESSION_STALE", "This narration session was explicitly continued; use its current session identity");
    const actor: ActorContext = { kind: "human", principalId: "local-user", requestId: session.requestId };
    try { production.assertActor(projectId, actor, true); } catch { invariant(false, "NARRATION_SESSION_STALE", "Narration session was superseded; explicitly continue it before editing"); }
    const scope = assertNarrationAuthority(production, projectId, actor);
    invariant(scope ? scope.sessionId === session.id && scope.shotId === session.shotId : !session.shotId, 'NARRATION_SESSION_STALE', 'Narration session no longer matches its issued scope'); return actor;
  };
  app.register(async scoped => {
    const base = "/api/projects/:projectId/narration";
    registerShotAudioRoutes(scoped, { production, narration, canonical, actorFor, ...(options.narrationSpeech ? { narrationSpeech: options.narrationSpeech } : {}) });
    registerNarrationSpeechRoutes(scoped, { production, narration, ...(options.narrationSpeech ? { narrationSpeech: options.narrationSpeech } : {}), actorFor });
    registerOwnedTranscriptionRoutes(scoped, { production, narration, ownedTranscription: options.ownedTranscription, actorFor });
    // Authentication inherited from createApp runs before a handler consumes this stream.
    scoped.addContentTypeParser("application/octet-stream", (_request, payload, done) => done(null, payload));
    registerShotRecordingRoutes(scoped, { production, narration, canonical, actorFor, uploads });
    registerAudioLibraryRoutes(scoped, { production, narration, uploads });
    scoped.get<{ Params: Params & { audioId: string } }>(`${base}/audio/:audioId/content`, async (request, reply) => {
      const recording = store.get<NarrationAudio>("narration_audio", request.params.audioId);
      invariant(recording?.projectId === request.params.projectId, "NOT_FOUND", "Recording does not belong to this project");
      const verified = await narration.media.verifiedSource(recording.media);
      invariant(verified.source.kind === "audio", "MEDIA_INTEGRITY_ERROR", "Recording is not normalized audio");
      const file = await open(verified.path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat(); invariant(stat.isFile() && stat.size <= 80 * 1024 * 1024, "ARTIFACT_TOO_LARGE", "Recording preview exceeds its limit");
        const bytes = await file.readFile(); invariant(bytes.length === stat.size && createHash("sha256").update(bytes).digest("hex") === recording.media.sha256, "ARTIFACT_CORRUPT", "Recording bytes changed");
        return reply.header("X-Content-Type-Options", "nosniff").header("Cache-Control", "private, no-store").header("X-Content-SHA256", recording.media.sha256).type("audio/wav").send(bytes);
      } finally { await file.close(); }
    });
  });
}
