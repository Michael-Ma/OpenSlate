import type { FastifyInstance } from "fastify";
import { invariant } from "@openslate/core";
import type { ProductionService } from "./service.js";
import { InstallationRecoveryGuard, releaseRecovery } from "./installation-recovery.js";
import type { RecoveryReleaseInput } from "./installation-recovery.js";

export const RECOVERY_STATUS_PATH = "/api/installation/recovery";
export const RECOVERY_RELEASE_PATH = `${RECOVERY_STATUS_PATH}/release`;
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };

/** Register beneath the application's ordinary authenticated local-human boundary. */
export function registerRecoveryRoutes(app: FastifyInstance, service: ProductionService): void {
  const guard = new InstallationRecoveryGuard(service.store);
  app.get(RECOVERY_STATUS_PATH, async (_request, reply) => reply.header("Cache-Control", "private, no-store")
    .send(service.store.transaction(() => guard.snapshot())));
  app.post<{ Body: RecoveryReleaseInput }>(RECOVERY_RELEASE_PATH, {
    schema: { body: { type: "object", additionalProperties: false,
      properties: { restoreId: { type: "string", minLength: 1, maxLength: 160 }, expectedReceiptDigest: hash, expectedSummaryDigest: hash },
      required: ["restoreId", "expectedReceiptDigest", "expectedSummaryDigest"] } },
  }, async (request, reply) => {
    const commandId = request.headers["idempotency-key"];
    invariant(typeof commandId === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(commandId),
      "VALIDATION_ERROR", "A recovery release requires its exact saved command identity");
    // This endpoint cannot inherit a model actor, old project request, or a body-provided principal.
    const receipt = releaseRecovery(service.store, request.body, { principalId: "local-user", commandId });
    return reply.header("Cache-Control", "private, no-store").send({ receipt, recovery: guard.snapshot() });
  });
}

const INSPECTION_ROUTES = new Set([
  RECOVERY_STATUS_PATH, "/api/projects", "/api/providers", "/api/projects/:projectId",
  "/api/projects/:projectId/providers", "/api/projects/:projectId/director",
  "/api/projects/:projectId/director/setup", "/api/projects/:projectId/director/tools",
  "/api/projects/:projectId/review", "/api/projects/:projectId/events",
  "/api/projects/:projectId/artifacts/:artifactId/content", "/api/projects/:projectId/images",
  "/api/projects/:projectId/narration", "/api/projects/:projectId/narration/audio/:audioId/content",
  "/api/projects/:projectId/narration/transcription-options", "/api/projects/:projectId/narration/transcription-proposals",
  "/api/projects/:projectId/narration/transcription-proposals/:proposalId",
  "/api/projects/:projectId/narration/generated-recordings", "/api/projects/:projectId/narration/audio/:audioId/transcripts",
  "/api/projects/:projectId/narration/transcripts/:candidateId/words", "/api/projects/:projectId/narration/transcripts/:candidateId/selection",
  "/api/projects/:projectId/media", "/api/projects/:projectId/media/renders/:jobId",
  "/api/projects/:projectId/spending",
]);

/** Route patterns, not user-supplied URL strings. Public assets/health are handled before this check. */
export function recoveryInspectionAllowed(method: string, route: string | undefined): boolean {
  return (method === "GET" || method === "HEAD") && typeof route === "string" && INSPECTION_ROUTES.has(route);
}
