import { canonical, digest, invariant, moneyMicros } from "@openslate/core";
import type { ActorContext } from "@openslate/core";
import type { ProductionService } from "./service.js";

export interface ProjectBudgetInput { expectedRevision: number; expectedCapMicros: string; capMicros: string }
export interface ProjectBudgetRevision {
  id: string; projectId: string; version: 1; requestId: string; principalId: string; contextDigest: string; createdAt: string; currency: "USD";
  priorRevision: number; priorCapMicros: string; revision: number; capMicros: string;
}
interface HumanRequest { id: string; projectId: string; principalId: string; contextDigest: string | null; state: string; scopeIds: string[]; editing: boolean }
function fields(value: object, allowed: string[]): void {
  invariant(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === allowed.length && Object.keys(value).every(key => allowed.includes(key)),
  "PROJECT_BUDGET_INVALID", "Use the exact project budget contract");
}
function amount(value: string): void {
  invariant(typeof value === "string" && value.length <= 19, "PROJECT_BUDGET_INVALID", "Use decimal USD micros"); moneyMicros(value);
}
export function assertProjectBudgetInput(value: ProjectBudgetInput): void {
  fields(value, ["expectedRevision", "expectedCapMicros", "capMicros"]);
  invariant(Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 && value.expectedRevision < Number.MAX_SAFE_INTEGER,
    "PROJECT_BUDGET_INVALID", "Use the displayed budget revision");
  amount(value.expectedCapMicros); amount(value.capMicros);
}
export function projectBudgetContextDigest(projectId: string, input: ProjectBudgetInput): string {
  assertProjectBudgetInput(input); return digest({ purpose: "project_budget.revise", version: 1, projectId, input });
}
function revisionInput(value: ProjectBudgetRevision): ProjectBudgetInput {
  return { expectedRevision: value.priorRevision, expectedCapMicros: value.priorCapMicros, capMicros: value.capMicros };
}
/** Static receipt checks remain valid after later budget changes or request supersession. */
export function assertProjectBudgetRevision(value: ProjectBudgetRevision, request: HumanRequest): void {
  fields(value, ["id", "projectId", "version", "requestId", "principalId", "contextDigest", "createdAt", "currency",
    "priorRevision", "priorCapMicros", "revision", "capMicros"]);
  const input = revisionInput(value); assertProjectBudgetInput(input);
  invariant(value.version === 1 && value.id === value.requestId && value.currency === "USD" && value.revision === value.priorRevision + 1
    && typeof value.createdAt === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)
    && Number.isFinite(Date.parse(value.createdAt)) && new Date(value.createdAt).toISOString() === value.createdAt,
  "PROJECT_BUDGET_INVALID", "Budget audit must retain its prior and new revision, amounts and timestamp");
  invariant(request && request.id === value.requestId && request.projectId === value.projectId && request.principalId === value.principalId
    && request.editing === false && request.contextDigest === value.contextDigest && value.contextDigest === projectBudgetContextDigest(value.projectId, input),
  "PROJECT_BUDGET_AUTHORITY_INVALID", "Budget audit must retain its exact human request and purpose");
}

/** Read under the caller's snapshot/command transaction; no initial budget record is created. */
export function projectBudgetSnapshot(service: ProductionService, projectId: string) {
  service.store.getProject(projectId);
  const row = service.store.db.prepare("SELECT version,project_id FROM entities WHERE kind='budget' AND id=?").get(projectId) as { version: number; project_id: string } | undefined;
  invariant(!row || (row.project_id === projectId && Number.isSafeInteger(row.version) && row.version >= 1),
    "PROJECT_BUDGET_INVALID", "Project budget revision is unavailable");
  return { ...service.engine.budget(projectId), revision: row?.version ?? 0 };
}

/** Trusted human-only application boundary; never exposed as a director tool. */
export class ProjectBudgetService {
  constructor(readonly service: ProductionService) {}
  revise(projectId: string, actor: ActorContext, value: ProjectBudgetInput): ProjectBudgetRevision {
    const input = structuredClone(value), contextDigest = projectBudgetContextDigest(projectId, input), { store } = this.service;
    return store.transaction(() => {
      const request = store.get<HumanRequest>("message", actor.requestId);
      invariant(actor.kind === "human" && request?.projectId === projectId && request.principalId === actor.principalId
        && request.state === "active" && request.editing === false && request.contextDigest === contextDigest && Array.isArray(request.scopeIds) && request.scopeIds.includes(projectId),
      "PROJECT_BUDGET_AUTHORITY_INVALID", "Use a dedicated current project-scoped human request bound to this budget change");
      const existing = store.get<ProjectBudgetRevision>("project_budget_revision", actor.requestId);
      if (existing) {
        invariant(existing.projectId === projectId && canonical(revisionInput(existing)) === canonical(input),
          "IDEMPOTENCY_CONFLICT", "This human request already changed a different project budget"); return existing;
      }
      const before = projectBudgetSnapshot(this.service, projectId);
      invariant(before.revision === input.expectedRevision && before.capMicros === input.expectedCapMicros,
        "PROJECT_BUDGET_CONFLICT", "Project budget changed; refresh before reviewing another limit");
      // A lower cap blocks future admission; reservations and already admitted work remain untouched.
      this.service.engine.setBudget(projectId, input.capMicros);
      const after = projectBudgetSnapshot(this.service, projectId);
      invariant(after.revision === before.revision + 1 && after.capMicros === input.capMicros,
        "PROJECT_BUDGET_CONFLICT", "Project budget publication changed unexpectedly");
      const result = store.insert<ProjectBudgetRevision>("project_budget_revision", actor.requestId, projectId, {
        id: actor.requestId, projectId, version: 1, requestId: actor.requestId, principalId: actor.principalId, contextDigest,
        createdAt: new Date().toISOString(), currency: "USD", priorRevision: before.revision, priorCapMicros: before.capMicros,
        revision: after.revision, capMicros: after.capMicros });
      store.appendEvent(projectId, "project_budget.revised", { revisionId: result.id, revision: result.revision, capMicros: result.capMicros });
      return result;
    });
  }
}
