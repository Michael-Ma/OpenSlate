import type { FastifyInstance } from "fastify";
import type { GeminiMusicListener } from "./music-enrichment.js";

const id = { type: "string", minLength: 1, maxLength: 160 };
const params = { type: "object", properties: { projectId: id, audioId: id }, required: ["projectId", "audioId"], additionalProperties: false };

/**
 * The person's song analysis, under the application's authenticated local HTTP boundary.
 * GET reads the cached result or what a press would cost; POST is the press (paid, sends the song to Google).
 * The Director has no route here: its analyze_music only reads.
 */
export function registerMusicEnrichmentRoutes(app: FastifyInstance, listener: GeminiMusicListener): void {
  const path = "/api/projects/:projectId/audio-library/:audioId/song-analysis";
  app.get<{ Params: { projectId: string; audioId: string } }>(path, { schema: { params } }, async (request, reply) =>
    reply.header("Cache-Control", "private, no-store").send(listener.enrichment(request.params.projectId, request.params.audioId)));
  app.post<{ Params: { projectId: string; audioId: string }; Body: { expectedSha256: string } }>(path, {
    schema: { params, body: { type: "object", properties: { expectedSha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["expectedSha256"], additionalProperties: false } },
  }, async (request, reply) =>
    reply.header("Cache-Control", "private, no-store").send(listener.listen(request.params.projectId, request.params.audioId, request.body.expectedSha256)));
}
