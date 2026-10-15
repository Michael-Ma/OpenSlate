import { digest, invariant, moneyMicros } from "@openslate/core";

interface ProjectBudgetInput { expectedRevision: number; expectedCapMicros: string; capMicros: string }
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
function assertProjectBudgetInput(value: ProjectBudgetInput): void {
  fields(value, ["expectedRevision", "expectedCapMicros", "capMicros"]);
  invariant(Number.isSafeInteger(value.expectedRevision) && value.expectedRevision >= 0 && value.expectedRevision < Number.MAX_SAFE_INTEGER,
    "PROJECT_BUDGET_INVALID", "Use the displayed budget revision");
  amount(value.expectedCapMicros); amount(value.capMicros);
}
function projectBudgetContextDigest(projectId: string, input: ProjectBudgetInput): string {
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
