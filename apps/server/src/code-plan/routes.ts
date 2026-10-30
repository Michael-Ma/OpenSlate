import { digest, invariant, moneyMicros } from "@openslate/core";
import type { CodePlanAnswerInput, CodePlanCeilingInput, CodePlanReceipt, CodePlanSourceInput } from "@openslate/core/public";
import type { FastifyInstance } from "fastify";
import { requiredCommandKey } from "../application/command-key.js";
import type { ProductionService } from "../application/service.js";
import type { CodePlanPort } from "./port.js";

type ProjectParams = { projectId: string };
const object = (properties: object, required: string[]) => ({ type: "object", additionalProperties: false, properties, required });
const version = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };

/** Registered under the application's session, CSRF, command-key and recovery hooks. */
export function registerCodePlanRoutes(app: FastifyInstance, getService: () => ProductionService, codePlans: CodePlanPort): void {
  const base = "/api/projects/:projectId/code-plan";
  const sourceFlights = new Map<string, Promise<CodePlanReceipt>>();
  const writable = (projectId: string) => {
    const service = getService();
    service.recovery.assertWritable(projectId);
    invariant(service.store.getProject(projectId).planMode === "code", "CODE_PLAN_MODE", "This project does not use code plans");
    return service;
  };

  app.get<{ Params: ProjectParams }>(base, async request => codePlans.view(request.params.projectId));
  app.get<{ Params: ProjectParams & { version: string } }>(`${base}/versions/:version`, {
    schema: { params: object({ projectId: { type: "string", minLength: 1 }, version: { type: "string", pattern: "^[1-9][0-9]{0,15}$" } }, ["projectId", "version"]) },
  }, async request => {
    const value = Number(request.params.version);
    invariant(Number.isSafeInteger(value), "VALIDATION_ERROR", "Use a positive safe integer version");
    return codePlans.source(request.params.projectId, value);
  });
  app.post<{ Params: ProjectParams; Body: CodePlanAnswerInput }>(`${base}/choices`, {
    schema: { body: object({ choiceId: { type: "string", minLength: 1, maxLength: 200 },
      optionsDigest: { type: "string", pattern: "^[a-f0-9]{64}$" }, answer: {} }, ["choiceId", "optionsDigest", "answer"]) },
  }, async request => {
    const { projectId } = request.params, key = requiredCommandKey(request), service = writable(projectId);
    return service.store.command<CodePlanReceipt>(`local-user:${projectId}:code-plan-choices`, key, digest(request.body),
      () => ({ view: codePlans.answer(projectId, request.body) }));
  });
  app.post<{ Params: ProjectParams; Body: CodePlanCeilingInput }>(`${base}/ceiling`, {
    schema: { body: object({ ceilingMicros: { type: "string", pattern: "^(0|[1-9][0-9]*)$", maxLength: 19 } }, ["ceilingMicros"]) },
  }, async request => {
    const { projectId } = request.params, key = requiredCommandKey(request), service = writable(projectId);
    moneyMicros(request.body.ceilingMicros);
    return service.store.command<CodePlanReceipt>(`local-user:${projectId}:code-plan-ceiling`, key, digest(request.body),
      () => ({ view: codePlans.raiseCeiling(projectId, request.body.ceilingMicros) }));
  });
  app.post<{ Params: ProjectParams; Body: CodePlanSourceInput }>(`${base}/source`, {
    schema: { body: object({ source: { type: "string", minLength: 1, maxLength: 256 * 1024 },
      basedOnVersion: { anyOf: [version, { type: "null" }] } }, ["source", "basedOnVersion"]) },
  }, async request => {
    const { projectId } = request.params, key = requiredCommandKey(request), service = writable(projectId);
    invariant(Buffer.byteLength(request.body.source) <= 256 * 1024, "VALIDATION_ERROR", "Use a plan source of at most 256 KiB");
    const scope = `local-user:${projectId}:code-plan-source`, requestDigest = digest(request.body);
    const replay = service.store.commandReplay<CodePlanReceipt>(scope, key, requestDigest);
    if (replay) return replay.result;
    // Bind the body durably before awaiting the port. A lost response/restart must
    // not let this invocation identity acquire different source or a newer base.
    service.store.command(`${scope}:intent`, key, requestDigest, () => ({}));
    const flightId = digest({ projectId, key }), pending = sourceFlights.get(flightId);
    if (pending) return pending;
    const flight = (async () => {
      // submit owns asynchronous dry-run/version publication and deduplicates this
      // invocationId across restarts. Never keep a SQLite transaction across await.
      const { diff } = await codePlans.submit(projectId, { ...request.body, author: "user", invocationId: key });
      writable(projectId);
      return service.store.command<CodePlanReceipt>(scope, key, requestDigest, () => ({ view: codePlans.view(projectId), diff }));
    })();
    sourceFlights.set(flightId, flight);
    try { return await flight; }
    finally { sourceFlights.delete(flightId); }
  });
}
