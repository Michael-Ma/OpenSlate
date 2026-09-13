import type { FastifyInstance, FastifyRequest } from "fastify";
import { digest, invariant } from "@openslate/core";
import type { ProductionService } from "./service.js";
import { ExternalAllowanceService, allowanceIssueContextDigest, allowanceRevokeContextDigest } from "./external-allowances.js";
import type { AllowanceIssueInput } from "../execution/external-allowance-records.js";
import { projectSpendingProjection } from "./allowance-projection.js";
import { ProjectBudgetService, projectBudgetContextDigest } from "./project-budget.js";
import type { ProjectBudgetInput } from "./project-budget.js";

export interface AllowanceRouteOptions { service: ProductionService; allowances: ExternalAllowanceService }
const id = { type: "string", minLength: 1, maxLength: 160, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$" };
const hash = { type: "string", pattern: "^[a-f0-9]{64}$" };
const object = (properties: object, required: string[] = []) => ({ type: "object", additionalProperties: false, properties, required });
const offset = { type: "string", pattern: "^(0|[1-9][0-9]{0,6})$" };
const issueSchema = object({ profileDigest: hash, profileDefinitionDigest: hash,
  selections: { type: "array", minItems: 1, maxItems: 800, items: object({ candidateId: id, nodeId: id, specDigest: hash }, ["candidateId", "nodeId", "specDigest"]) },
  maxAttempts: { type: "integer", minimum: 1, maximum: 10000 }, maxEstimatedMicros: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$" },
  expiresAt: { type: "string", minLength: 24, maxLength: 24 } }, ["profileDigest", "profileDefinitionDigest", "selections", "maxAttempts", "maxEstimatedMicros", "expiresAt"]);
function commandKey(request: FastifyRequest): string {
  const key = request.headers["idempotency-key"];
  invariant(typeof key === "string" && key.length > 0 && key.length <= 160, "VALIDATION_ERROR", "Use one bounded spending command identity"); return key;
}

/** Opt-in paths under createApp's loopback/origin/local-session protection, never under /internal. */
export function registerAllowanceRoutes(app: FastifyInstance, options: AllowanceRouteOptions): void {
  const { service, allowances } = options;
  invariant(service.store === allowances.store, "ALLOWANCE_CONFIGURATION_INVALID", "Spending routes and application must share one Store");
  const budgets = new ProjectBudgetService(service);
  app.get<{ Params: { projectId: string }; Querystring: { candidateOffset?: string; allowanceOffset?: string } }>("/api/projects/:projectId/spending", {
    schema: { params: object({ projectId: id }, ["projectId"]), querystring: object({ candidateOffset: offset, allowanceOffset: offset }) },
  }, async (request, reply) => reply.header("Cache-Control", "private, no-store").send(projectSpendingProjection(service, request.params.projectId,
    { candidateOffset: Number(request.query.candidateOffset ?? 0), allowanceOffset: Number(request.query.allowanceOffset ?? 0) })));
  app.post<{ Params: { projectId: string }; Body: ProjectBudgetInput }>("/api/projects/:projectId/spending/budget", {
    schema: { params: object({ projectId: id }, ["projectId"]), querystring: object({}), body: object({
      expectedRevision: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 1 },
      expectedCapMicros: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$" },
      capMicros: { type: "string", pattern: "^(0|[1-9][0-9]{0,18})$" },
    }, ["expectedRevision", "expectedCapMicros", "capMicros"]) },
  }, async request => {
    const projectId = request.params.projectId, key = commandKey(request), input = structuredClone(request.body);
    return service.store.command(`local-user:${projectId}:spending:budget`, key, digest(input), () => {
      const actor = service.beginRequest(projectId, "local-user", "Change the project spending limit", {
        editing: false, scopeIds: [projectId], contextDigest: projectBudgetContextDigest(projectId, input),
        key: digest({ purpose: "project_budget.revise", key }) });
      return { requestId: actor.requestId, revision: budgets.revise(projectId, actor, input) };
    });
  });
  app.post<{ Params: { projectId: string }; Body: AllowanceIssueInput }>("/api/projects/:projectId/spending/allowances", {
    schema: { params: object({ projectId: id }, ["projectId"]), querystring: object({}), body: issueSchema },
  }, async request => {
    const projectId = request.params.projectId, key = commandKey(request), input = structuredClone(request.body);
    return service.store.command(`local-user:${projectId}:spending:issue`, key, digest(input), () => {
      const actor = service.beginRequest(projectId, "local-user", "Authorize bounded spending for the selected work", {
        editing: false, scopeIds: [projectId], contextDigest: allowanceIssueContextDigest(projectId, input),
        key: digest({ purpose: "external_allowance.issue", key }) });
      return { requestId: actor.requestId, allowance: allowances.issue(projectId, actor, input) };
    });
  });
  app.post<{ Params: { projectId: string; allowanceId: string }; Body: Record<string, never> }>("/api/projects/:projectId/spending/allowances/:allowanceId/revoke", {
    schema: { params: object({ projectId: id, allowanceId: id }, ["projectId", "allowanceId"]), querystring: object({}), body: object({}) },
  }, async request => {
    const { projectId, allowanceId } = request.params, key = commandKey(request), input = { allowanceId };
    return service.store.command(`local-user:${projectId}:spending:revoke`, key, digest(input), () => {
      const actor = service.beginRequest(projectId, "local-user", "Revoke the selected spending allowance", {
        editing: false, scopeIds: [projectId], contextDigest: allowanceRevokeContextDigest(projectId, input),
        key: digest({ purpose: "external_allowance.revoke", key }) });
      return { requestId: actor.requestId, revocation: allowances.revoke(projectId, actor, input) };
    });
  });
}
