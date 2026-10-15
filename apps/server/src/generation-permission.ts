import type { FastifyInstance } from "fastify";
import { digest, invariant, newId } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { DirectorSupervisor } from "./application/director-supervisor.js";
import { continueEditsSchema, continuationCovers, pendingEditContinuations, continuationDigest } from './application/pending-edit-continuation.js';
import type { ContinueEdits } from './application/pending-edit-continuation.js';

type Permission = { headVersion: number; revisionId: string; cursor: number; reviewedControlAuthorityId?: string | null; reviewedHoldDigest?: string; shotIds: string[]; kinds: ("image" | "video")[]; continuationRequestId?: string; continueEdits?: ContinueEdits; continuationScope?: 'project' };
/** Human-only bounded creative permission. Paid admission and keyframe review stay separate. */
export function registerGenerationPermission(app: FastifyInstance, service: () => ProductionService,
  director?: Pick<DirectorSupervisor, "enqueue" | "tick">) {
  app.post<{ Params: { projectId: string }; Body: Permission }>("/api/projects/:projectId/generation-permission", {
    schema: { body: { type: "object", additionalProperties: false, required: ["headVersion", "revisionId", "cursor", "shotIds", "kinds"], dependencies: { reviewedControlAuthorityId: ["reviewedHoldDigest"], reviewedHoldDigest: ["reviewedControlAuthorityId"] }, properties: {
      headVersion: { type: "integer", minimum: 0 }, cursor: { type: "integer", minimum: 0 }, revisionId: { type: "string", minLength: 1, maxLength: 160 },
      shotIds: { type: "array", minItems: 1, maxItems: 64, uniqueItems: true, items: { type: "string", minLength: 1, maxLength: 160 } },
      kinds: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { enum: ["image", "video"] } },
      continuationRequestId: { type: "string", minLength: 1, maxLength: 160 },
      continueEdits: continueEditsSchema,
      reviewedHoldDigest: { type: "string", pattern: "^[a-f0-9]{64}$" },
      reviewedControlAuthorityId: { type: ["string", "null"], minLength: 1, maxLength: 160 },
      continuationScope: { const: 'project' },
    } } },
  }, async request => {
    const production = service(), projectId = request.params.projectId, body = request.body;
    const key = request.headers["idempotency-key"] as string | undefined ?? newId();
    production.recovery.assertWritable(projectId);
    const result = production.store.command(`local-user:${projectId}:generation-permission`, key, digest(body), () => {
      const snapshot = production.snapshot(projectId), project = snapshot.project;
      invariant(project.headVersion === body.headVersion && project.revisionId === body.revisionId && (Object.hasOwn(body, "reviewedControlAuthorityId") ? ("authorityId" in snapshot.control ? snapshot.control.authorityId : null) === body.reviewedControlAuthorityId : snapshot.cursor === body.cursor),
        "REVISION_CONFLICT", "Project changed. Review the current shot permissions again.");
      if (body.reviewedHoldDigest) {
        const scope = body.continuationScope === 'project' ? [projectId] : body.shotIds;
        const relevant = pendingEditContinuations(production.store,projectId,'local-user').filter(group => group.scopeIds.some(id => continuationCovers(project,scope,id) || scope.some(selected => continuationCovers(project,[id],selected))));
        invariant(continuationDigest(relevant) === body.reviewedHoldDigest, 'CONTINUATION_CHANGED', 'Saved edits changed while reviewing this generation scope. Review again.');
      }
      invariant(!snapshot.control.paused, "WAITING_USER", "Send a new direction to continue stopped work before authorizing generation.");
      invariant(body.shotIds.every(id => project.shots.some(shot => shot.id === id)), "SCOPE_DENIED", "Select only current shots from this project");
      invariant(body.shotIds.length * body.kinds.length <= 100, "VALIDATION_ERROR", "Review at most 100 generation operations at once");
      invariant(!body.continueEdits || !body.continuationRequestId, 'VALIDATION_ERROR', 'Review one continuation scope for the generation request.');
      invariant(!body.continuationScope || body.continueEdits, 'VALIDATION_ERROR', 'Project-wide continuation requires a current pending-edit review.');
      const shotNames = body.shotIds.map(id => { const index = project.shots.findIndex(shot => shot.id === id); return `Shot ${index + 1}: ${project.shots[index]!.purpose}`; }).join("; ");
      const actor = production.beginRequest(projectId, "local-user",
        `Prepare generation for the reviewed saved shots (${shotNames}). I authorize one ${body.kinds.join(" and one ")} operation per selected shot, including a replacement only where needed. Keep other shots and completed results. This is creative permission only: spending allowance and video keyframe review remain separate.`,
        { source: "app", scopeIds: body.continuationRequestId || body.continuationScope === 'project' ? [projectId] : body.shotIds, editing: true, key: `generation-permission:${key}`,
          ...(body.continueEdits ? { continueEdits: body.continueEdits } : {}),
          ...(body.continuationRequestId ? { continuationRequestId: body.continuationRequestId } : {}) });
      const grants = production.authorize(projectId, actor, body.shotIds.flatMap(scopeId => body.kinds.map(kind => ({ scopeId, kind }))), key, "user_change");
      director?.enqueue(projectId, actor);
      return { requestId: actor.requestId, grantIds: grants.map(grant => grant.id) };
    });
    director?.tick();
    return result;
  });
}
