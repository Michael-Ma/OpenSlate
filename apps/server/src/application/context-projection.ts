import { canonical, digest, invariant, workflowReadiness } from "@openslate/core";
import type { ActorContext, CompiledPlan, ProjectRecord, ProviderProfile } from "@openslate/core";
import type { ProductionService } from "./service.js";

export const DIRECTOR_PROJECTION_LIMITS = Object.freeze({ bytes: 512 * 1024, records: 20, sourceCharacters: 64 * 1024, maximumOffset: 10_000_000 });
export type DirectorContextSection = "overview" | "shots" | "scenes" | "plan" | "aliases" | "grants" | "receipts";
export interface DirectorContextQuery { section?: DirectorContextSection; offset?: number }
interface Message { id: string; projectId: string; principalId: string; text: string; scopeIds: string[]; editing: boolean; state: string; contextDigest: string | null }
interface Hold { id: string; scopeId: string; ownerId: string; active: boolean }
interface Grant { id: string; scopeId: string; kind: string; authorityId: string; origin: string }
interface ToolSummary { id: string; requestId: string; epochId: string; callId: string; tool: string; state: string; resultDigest: string | null }
interface PlanMetadata {
  planId: string | null; graphDigest: string | null; sourceDigest: string | null;
  sourceLength: number; sourceBytes: number; sourceSection: "plan"; aliasCount: number; aliasSection: "aliases";
  nodeCount: number; reviewGateCount: number; sourceKind: "canonical";
}
type ProjectMetadata = Pick<ProjectRecord, "id" | "headVersion" | "revisionId" | "name" | "brief" | "story" | "narration" | "activePlanId" | "capabilityLockId" | "maxFrames"> & {
  shots: Pick<ProjectRecord["shots"][number], "id" | "revisionId" | "sceneId" | "desiredFrames">[];
  scenes: Pick<ProjectRecord["scenes"][number], "id" | "revisionId">[];
};
export interface DirectorContextProjection {
  section: DirectorContextSection;
  project: ProjectMetadata;
  headVersion: number; revisionId: string; activePlanId: string | null; cursor: number;
  guard: { projectId: string; headVersion: number; revisionId: string; activePlanId: string | null; graphDigest: string | null; capabilityLockId: string; domainCursor: number; dataDigest: string };
  request: { id: string; scopeIds: string[]; editing: boolean; state: string };
  plan: PlanMetadata;
  profiles: ProviderProfile[];
  page: { offset: number; returned: number; total: number; nextOffset: number | null; offsetUnit: "records" | "utf16_characters" };
  items: unknown[];
  messages: Message[];
  assistantMessages?: { id: string; requestId: string; turnId: string; text: string; phase: string }[];
  questions?: unknown[];
  holds: Hold[];
  toolCalls: ToolSummary[];
  workflow: unknown;
  work: unknown;
  coverage: Record<string, unknown>;
  source?: string;
}
function query(input: DirectorContextQuery): { section: DirectorContextSection; offset: number } {
  invariant(input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).every(key => ["section", "offset"].includes(key)), "VALIDATION_ERROR", "Context query supports only section and offset");
  const section = input.section ?? "overview"; const offset = input.offset ?? 0;
  invariant(["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts"].includes(section), "VALIDATION_ERROR", "Unknown context section");
  invariant(Number.isSafeInteger(offset) && offset >= 0 && offset <= DIRECTOR_PROJECTION_LIMITS.maximumOffset, "VALIDATION_ERROR", "Invalid context offset");
  return { section, offset };
}
function bytes(value: unknown): number { return Buffer.byteLength(canonical(value)); }
function withinBudget<T>(value: T): T { invariant(bytes(value) <= DIRECTOR_PROJECTION_LIMITS.bytes, "CONTEXT_ITEM_TOO_LARGE", "Context metadata or one complete record exceeds 512 KiB; no content was silently clipped"); return value; }
function page(offset: number, returned: number, total: number, unit: "records" | "utf16_characters" = "records") {
  return { offset, returned, total, nextOffset: offset + returned < total ? offset + returned : null, offsetUnit: unit };
}
function adaptive<T>(offset: number, total: number, build: (count: number) => T): T {
  let count = Math.min(DIRECTOR_PROJECTION_LIMITS.records, Math.max(0, total - offset));
  while (count > 1) { const value = build(count); if (bytes(value) <= DIRECTOR_PROJECTION_LIMITS.bytes) return value; count--; }
  return withinBudget(build(count));
}
function toolSummaries(service: ProductionService, projectId: string): ToolSummary[] {
  // Read selected JSON fields, never the previous context result nested in a receipt.
  return service.store.db.prepare(`SELECT id, json_extract(body,'$.requestId') AS requestId,
    json_extract(body,'$.epochId') AS epochId, json_extract(body,'$.callId') AS callId,
    json_extract(body,'$.tool') AS tool, json_extract(body,'$.state') AS state,
    json_extract(body,'$.resultDigest') AS resultDigest
    FROM entities WHERE kind='tool_invocation' AND project_id=? AND json_extract(body,'$.tool')!='read_context' ORDER BY rowid DESC`).all(projectId) as ToolSummary[];
}
function receipts(service: ProductionService, projectId: string): unknown[] {
  const tool = service.store.db.prepare(`SELECT id, json_extract(body,'$.requestId') AS requestId,
    json_extract(body,'$.epochId') AS epochId, json_extract(body,'$.callId') AS callId,
    json_extract(body,'$.tool') AS tool, json_extract(body,'$.state') AS state,
    json_extract(body,'$.argumentsDigest') AS argumentsDigest, json_extract(body,'$.resultDigest') AS resultDigest,
    json_extract(body,'$.error.code') AS errorCode,
    coalesce(json_extract(body,'$.result.preparedId'),json_extract(body,'$.result.id')) AS preparedId,
    json_extract(body,'$.result.proposalDigest') AS proposalDigest,
    json_extract(body,'$.result.revisionId') AS revisionId, json_extract(body,'$.result.headVersion') AS headVersion,
    json_extract(body,'$.result.activePlanId') AS activePlanId,
    coalesce(json_extract(body,'$.result.graphDigest'),json_extract(body,'$.result.plan.graphDigest')) AS graphDigest,
    json_extract(body,'$.result.cursor') AS cursor
    FROM entities WHERE kind='tool_invocation' AND project_id=? AND json_extract(body,'$.tool')!='read_context' ORDER BY rowid DESC`).all(projectId) as Record<string, unknown>[];
  const commands = service.store.db.prepare(`SELECT actor_scope AS actorScope, key, digest AS requestDigest,
    json_type(result) AS resultType,
    CASE WHEN json_type(result)='array' THEN json_array_length(result) ELSE NULL END AS resultCount,
    json_extract(result,'$.preparedId') AS preparedId, json_extract(result,'$.revisionId') AS revisionId,
    json_extract(result,'$.headVersion') AS headVersion, json_extract(result,'$.activePlanId') AS activePlanId,
    json_extract(result,'$.cursor') AS cursor
    FROM commands WHERE instr(actor_scope, ':' || ? || ':') > 0 ORDER BY rowid DESC`).all(projectId) as Record<string, unknown>[];
  const reconciled = service.store.list<Record<string, unknown>>("tool_reconciliation", projectId).reverse();
  return [...reconciled.map(row => ({ kind: "tool_reconciliation", ...row })), ...tool.map(row => ({ kind: "tool", ...row, resultProjection: "identities_and_digests_only" })), ...commands.map(row => ({ kind: "command", ...row, resultProjection: "identities_and_counts_only" }))];
}
function workSummary(service: ProductionService, projectId: string, planId: string | null) {
  const phaseCounts = service.store.db.prepare("SELECT json_extract(body,'$.phase') AS phase,count(*) AS count FROM entities WHERE kind='attempt' AND project_id=? GROUP BY phase").all(projectId);
  const nodeCounts = service.store.db.prepare("SELECT json_extract(body,'$.node.kind') AS kind,count(*) AS count FROM entities WHERE kind='node_binding' AND project_id=? AND json_extract(body,'$.planId')=? AND json_extract(body,'$.state')='active' GROUP BY kind").all(projectId, planId);
  const outputs = service.store.db.prepare("SELECT count(*) AS count FROM entities, json_each(json_extract(entities.body,'$.outputs')) WHERE entities.kind='node_binding' AND entities.project_id=? AND json_extract(entities.body,'$.planId')=? AND json_extract(entities.body,'$.state')='active'").get(projectId, planId) as { count: number };
  return { planId, nodeCounts, attemptPhaseCounts: phaseCounts, currentOutputCount: outputs.count, fixtureOnly: true };
}

/** Read-only projection. The server owns context freshness; compare guards across paged reads. */
export function projectDirectorContext(service: ProductionService, projectId: string, actor: ActorContext, input: DirectorContextQuery = {}): DirectorContextProjection {
  const { section, offset } = query(input);
  service.assertActor(projectId, actor);
  return service.store.transaction(() => {
    service.assertActor(projectId, actor);
    const saved = service.store.getProject(projectId);
    const active = saved.activePlanId ? service.store.get<{ projectId: string; compiled: CompiledPlan }>("plan", saved.activePlanId) : undefined;
    invariant(!saved.activePlanId || active?.projectId === projectId, "CONTEXT_STATE_INVALID", "Active plan is missing or belongs to another project");
    const lock = service.store.get<{ projectId: string; profiles: ProviderProfile[] }>("capability_lock", saved.capabilityLockId);
    invariant(lock?.projectId === projectId && Array.isArray(lock.profiles), "CONTEXT_STATE_INVALID", "Project capability lock is missing");
    const logical = service.store.get<{ projectId: string; aliases: Record<string, string> }>("logical_ids", projectId);
    invariant(!logical || logical.projectId === projectId, "CONTEXT_STATE_INVALID", "Alias registry belongs to another project");
    const aliases = Object.entries(logical?.aliases ?? {}).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([alias, nodeId]) => ({ alias, nodeId, current: !!active && [...active.compiled.nodes, ...active.compiled.gates].some(node => node.id === nodeId) }));
    const source = active?.compiled.canonicalSource ?? "";
    const plan: PlanMetadata = { planId: saved.activePlanId, graphDigest: active?.compiled.graphDigest ?? null, sourceDigest: active ? digest(source) : null, sourceLength: source.length, sourceBytes: Buffer.byteLength(source), sourceSection: "plan", aliasCount: aliases.length, aliasSection: "aliases", nodeCount: active?.compiled.nodes.length ?? 0, reviewGateCount: active?.compiled.gates.length ?? 0, sourceKind: "canonical" };
    const request = service.store.get<Message>("message", actor.requestId)!;
    const { id, headVersion, revisionId, name, brief, story, narration, activePlanId, capabilityLockId, maxFrames } = saved;
    const cursor = service.store.cursor(projectId);
    const domainCursor = (service.store.db.prepare("SELECT coalesce(max(sequence),0) AS cursor FROM events WHERE project_id=? AND json_extract(body,'$.kind') NOT IN ('tool.started','tool.finished','director.context_captured')").get(projectId) as { cursor: number }).cursor;
    const base: DirectorContextProjection = {
      section, project: { id, headVersion, revisionId, name, brief, story, narration, activePlanId, capabilityLockId, maxFrames, shots: [], scenes: [] },
      headVersion, revisionId, activePlanId, cursor,
      guard: { projectId, headVersion, revisionId, activePlanId, graphDigest: plan.graphDigest, capabilityLockId, domainCursor, dataDigest: "" },
      request: { id: request.id, scopeIds: request.scopeIds, editing: request.editing, state: request.state }, plan, profiles: lock.profiles,
      page: page(offset, 0, 0), items: [], messages: [], holds: [], toolCalls: [], workflow: null, work: null,
      coverage: { sections: ["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts"], maxResponseBytes: DIRECTOR_PROJECTION_LIMITS.bytes, projectShotCount: saved.shots.length, projectSceneCount: saved.scenes.length, pageGuard: "Compare guard headVersion, revisionId, activePlanId, capabilityLockId and domainCursor across sections; compare dataDigest within one section. Raw cursor is for SSE only. Restart changed pages.", recordPolicy: "Complete records or an explicit size error; receipt results are summaries. Read-context invocations remain in the audit log but are excluded from model-facing receipt pages. Context reads do not authorize mutations or spending." },
    };
    const itemsPage = (items: unknown[]): DirectorContextProjection => {
      base.guard.dataDigest = digest(items);
      return adaptive(offset, items.length, count => ({ ...base, items: items.slice(offset, offset + count), page: page(offset, count, items.length) }));
    };
    if (section === "aliases") return itemsPage(aliases);
    if (section === "plan") {
      base.guard.dataDigest = plan.sourceDigest ?? digest(null);
      let length = Math.min(DIRECTOR_PROJECTION_LIMITS.sourceCharacters, Math.max(0, source.length - offset));
      const build = (): DirectorContextProjection => ({ ...base, source: source.slice(offset, offset + length), page: page(offset, length, source.length, "utf16_characters") });
      while (length > 1 && bytes(build()) > DIRECTOR_PROJECTION_LIMITS.bytes) length = Math.floor(length / 2);
      return withinBudget(build());
    }
    if (section === "shots") return itemsPage(saved.shots.map(shot => ({ ...shot, cue: saved.cues.find(cue => cue.id === shot.cueId) ?? null, referenceArtifacts: saved.artifacts.filter(artifact => shot.referenceArtifactIds.includes(artifact.artifactId)) })));
    if (section === "scenes") return itemsPage(saved.scenes);
    if (section === "receipts") return itemsPage(receipts(service, projectId));
    if (section === "grants") {
      const used = new Set(service.store.list<{ grantId: string }>("candidate", projectId).map(candidate => candidate.grantId));
      const authorities = new Set([actor.requestId]);
      const continuations = service.store.list<{ fromRequestId: string; toRequestId: string }>("request_continuation", projectId);
      for (let round = 0; round < continuations.length; round++) for (const continuation of continuations) if (authorities.has(continuation.toRequestId)) authorities.add(continuation.fromRequestId);
      return itemsPage(service.store.list<Grant>("grant", projectId).filter(grant => !used.has(grant.id)).map(grant => ({ ...grant, unused: true, authorityRelation: authorities.has(grant.authorityId) ? "current_or_explicitly_continued_request" : "other_request", authorization: "informational_only_service_rechecks_scope_origin_and_current_authority" })));
    }
    const messages = service.store.list<Message>("message", projectId).reverse();
    const assistantMessages = service.store.list<{ id: string; requestId: string; turnId: string; text: string; phase: string }>("director_output", projectId).reverse();
    const questions = service.store.list("director_question", projectId).reverse();
    const holds = service.store.list<Hold>("hold", projectId).filter(hold => hold.active).reverse();
    const toolCalls = toolSummaries(service, projectId);
    const readiness = workflowReadiness(saved);
    const total = Math.max(saved.shots.length, saved.scenes.length, messages.length, assistantMessages.length, questions.length, holds.length, toolCalls.length, readiness.scopes.length, readiness.narration.acceptedMeasuredCues.length);
    base.guard.dataDigest = digest({ shots: saved.shots, scenes: saved.scenes, messages, assistantMessages, questions, holds, toolCalls, readiness });
    base.work = workSummary(service, projectId, activePlanId);
    return adaptive(offset, total, count => {
      const slice = <T>(values: T[]) => values.slice(offset, offset + count);
      return {
        ...base,
        project: { ...base.project, shots: slice(saved.shots).map(({ id, revisionId, sceneId, desiredFrames }) => ({ id, revisionId, sceneId, desiredFrames })), scenes: slice(saved.scenes).map(({ id, revisionId }) => ({ id, revisionId })) },
        messages: slice(messages), assistantMessages: slice(assistantMessages), questions: slice(questions), holds: slice(holds), toolCalls: slice(toolCalls),
        workflow: { ...readiness, scopes: slice(readiness.scopes), narration: { ...readiness.narration, acceptedMeasuredCues: slice(readiness.narration.acceptedMeasuredCues) } },
        page: page(offset, count, total),
        coverage: { ...base.coverage, overview: { pagination: "The same record window applies to each listed collection; follow nextOffset until null. Messages and tool calls are newest first.", messages: { total: messages.length, returned: slice(messages).length }, holds: { total: holds.length, returned: slice(holds).length }, toolCalls: { total: toolCalls.length, returned: slice(toolCalls).length }, scopes: { total: readiness.scopes.length, returned: slice(readiness.scopes).length }, shots: { total: saved.shots.length, returned: slice(saved.shots).length, detailsSection: "shots" }, scenes: { total: saved.scenes.length, returned: slice(saved.scenes).length, detailsSection: "scenes" }, acceptedMeasuredCues: { total: readiness.narration.acceptedMeasuredCues.length, returned: slice(readiness.narration.acceptedMeasuredCues).length } } },
      };
    });
  });
}
