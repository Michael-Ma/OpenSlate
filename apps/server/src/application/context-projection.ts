import { canonical, digest, invariant, workflowReadiness } from "@openslate/core";
import type { ActorContext, CompiledPlan, ProjectRecord, ProviderProfile } from "@openslate/core";
import type { ProductionService } from "./service.js";
import type { NarrationAudio, NarrationState, SegmentRevision } from "../narration/types.js";
import { NarrationService } from "../narration/service.js";
import { isVerifiedGeneratedNarrationAudio, summarizeGeneratedNarrationAudio } from "../narration/generated-audio.js";
import { projectApplicationCapabilities } from "./application-capabilities.js";
import type { DirectorApplicationCapabilities } from "./application-capabilities.js";

export const DIRECTOR_PROJECTION_LIMITS = Object.freeze({ bytes: 512 * 1024, records: 20, sourceCharacters: 64 * 1024, maximumOffset: 10_000_000 });
export type DirectorContextSection = "overview" | "shots" | "scenes" | "plan" | "aliases" | "grants" | "receipts" | "narration";
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
  guard: { projectId: string; headVersion: number; revisionId: string; activePlanId: string | null; graphDigest: string | null; capabilityLockId: string; applicationCapabilitiesDigest: string; domainCursor: number; dataDigest: string };
  request: { id: string; scopeIds: string[]; editing: boolean; state: string };
  plan: PlanMetadata;
  profiles: ProviderProfile[];
  applicationCapabilities: DirectorApplicationCapabilities;
  page: { offset: number; returned: number; total: number; nextOffset: number | null; offsetUnit: "records" | "utf16_characters" };
  items: unknown[];
  messages: Message[];
  assistantMessages?: { id: string; requestId: string; turnId: string; text: string; phase: string }[];
  questions?: unknown[];
  holds: Hold[];
  execution: { globallyPaused: boolean; scopedHoldSemantics: string };
  toolCalls: ToolSummary[];
  workflow: unknown;
  work: unknown;
  assets?: unknown[];
  cues?: ProjectRecord["cues"];
  narrationDraft?: { version: number; revisionId?: string | null; segments: unknown[]; readiness?: unknown; authority: string };
  audioLibrary?: unknown[];
  coverage: Record<string, unknown>;
  source?: string;
}
function query(input: DirectorContextQuery): { section: DirectorContextSection; offset: number } {
  invariant(input && typeof input === "object" && !Array.isArray(input) && Object.keys(input).every(key => ["section", "offset"].includes(key)), "VALIDATION_ERROR", "Context query supports only section and offset");
  const section = input.section ?? "overview"; const offset = input.offset ?? 0;
  invariant(["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts", "narration"].includes(section), "VALIDATION_ERROR", "Unknown context section");
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
  // Aggregate every current output in SQL. Do not hydrate artifact bodies or
  // infer their provenance from a provider, profile or mutable attempt phase.
  const outputs = service.store.db.prepare(`WITH current_outputs AS (
    SELECT CASE WHEN output.type='object' AND typeof(output.key)='text' THEN output.value ELSE '{}' END AS ref
    FROM entities AS binding, json_each(binding.body,'$.outputs') AS output
    WHERE binding.kind='node_binding' AND binding.project_id=? AND json_type(binding.body,'$.projectId')='text' AND json_extract(binding.body,'$.projectId')=?
      AND json_type(binding.body,'$.id')='text' AND json_extract(binding.body,'$.id')=binding.id AND json_type(binding.body,'$.planId')='text' AND json_extract(binding.body,'$.planId')=?
      AND json_extract(binding.body,'$.state')='active'
  ), classified AS (
    SELECT CASE WHEN
      (SELECT count(*) FROM json_each(ref))=3
      AND json_type(ref,'$.artifactId')='text' AND length(json_extract(ref,'$.artifactId')) BETWEEN 1 AND 160
      AND json_type(ref,'$.sha256')='text' AND length(json_extract(ref,'$.sha256'))=64
      AND json_extract(ref,'$.sha256') NOT GLOB '*[^0-9a-f]*'
      AND json_type(ref,'$.kind')='text' AND json_extract(ref,'$.kind') IN ('image','audio','video','data')
      AND json_type(artifact.body,'$.id')='text' AND json_extract(artifact.body,'$.id')=artifact.id
      AND json_type(artifact.body,'$.projectId')='text' AND json_extract(artifact.body,'$.projectId')=artifact.project_id
      AND json_type(artifact.body,'$.artifact')='object'
      AND (SELECT count(*) FROM json_each(CASE WHEN json_type(artifact.body,'$.artifact')='object' THEN json_extract(artifact.body,'$.artifact') ELSE '{}' END))=3
      AND json_type(artifact.body,'$.artifact.artifactId')='text' AND json_extract(artifact.body,'$.artifact.artifactId')=json_extract(ref,'$.artifactId')
      AND json_type(artifact.body,'$.artifact.sha256')='text' AND json_extract(artifact.body,'$.artifact.sha256')=json_extract(ref,'$.sha256')
      AND json_type(artifact.body,'$.artifact.kind')='text' AND json_extract(artifact.body,'$.artifact.kind')=json_extract(ref,'$.kind')
      THEN CASE json_type(artifact.body,'$.fixture') WHEN 'true' THEN 'fixture' WHEN 'false' THEN 'nonfixture' ELSE 'unknown' END
      ELSE 'unknown' END AS provenance
    FROM current_outputs LEFT JOIN entities AS artifact ON artifact.kind='artifact' AND artifact.project_id=?
      AND artifact.id=json_extract(ref,'$.artifactId')
  ) SELECT count(*) AS count, coalesce(sum(provenance='fixture'),0) AS fixture,
    coalesce(sum(provenance='nonfixture'),0) AS nonfixture, coalesce(sum(provenance='unknown'),0) AS unknown FROM classified`)
    .get(projectId, projectId, planId, projectId) as { count: number; fixture: number; nonfixture: number; unknown: number };
  const currentOutputProvenance = { fixture: outputs.fixture, nonfixture: outputs.nonfixture, unknown: outputs.unknown };
  const fixtureOnly = outputs.nonfixture > 0 ? false : outputs.count === 0 || outputs.unknown > 0 ? null : true;
  return { planId, nodeCounts, attemptPhaseCounts: phaseCounts, currentOutputCount: outputs.count, currentOutputProvenance,
    fixtureOnly, fixtureOnlyScope: "current_active_plan_outputs" };
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
    const applicationCapabilities = projectApplicationCapabilities();
    const base: DirectorContextProjection = {
      section, project: { id, headVersion, revisionId, name, brief, story, narration, activePlanId, capabilityLockId, maxFrames, shots: [], scenes: [] },
      headVersion, revisionId, activePlanId, cursor,
      guard: { projectId, headVersion, revisionId, activePlanId, graphDigest: plan.graphDigest, capabilityLockId, applicationCapabilitiesDigest: digest(applicationCapabilities), domainCursor, dataDigest: "" },
      request: { id: request.id, scopeIds: request.scopeIds, editing: request.editing, state: request.state }, plan, profiles: lock.profiles,
      applicationCapabilities,
      page: page(offset, 0, 0), items: [], messages: [], holds: [], toolCalls: [], workflow: null, work: null,
      execution: { globallyPaused: service.store.get<{ paused: boolean }>("execution_control", projectId)?.paused ?? false,
        scopedHoldSemantics: "Director pause creates a request-owned scope hold. Applying a matching plan releases that request's hold. This is separate from the human global pause. Read current context after mutations before describing execution state." },
      coverage: { sections: ["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts"], maxResponseBytes: DIRECTOR_PROJECTION_LIMITS.bytes, projectShotCount: saved.shots.length, projectSceneCount: saved.scenes.length, pageGuard: "Compare guard headVersion, revisionId, activePlanId, capabilityLockId, applicationCapabilitiesDigest and domainCursor across sections; compare dataDigest within one section. Raw cursor is for SSE only. Restart changed pages.", recordPolicy: "Complete records or an explicit size error; receipt results are summaries. Read-context invocations remain in the audit log but are excluded from model-facing receipt pages. Context reads do not authorize mutations or spending." },
    };
    const itemsPage = (items: unknown[]): DirectorContextProjection => {
      base.guard.dataDigest = digest(items);
      return adaptive(offset, items.length, count => ({ ...base, items: items.slice(offset, offset + count), page: page(offset, count, items.length) }));
    };
    if (section === "narration") {
      const snapshot = new NarrationService(service).snapshot(projectId, actor);
      const recording = (audio: NarrationAudio) => isVerifiedGeneratedNarrationAudio(audio) ? (() => {
        const summary = summarizeGeneratedNarrationAudio(audio);
        return { id: audio.id, sha256: audio.media.sha256, samples: audio.media.probe.audio?.samples ?? null,
          sampleRate: audio.media.probe.audio?.sampleRate ?? null, originEvidence: summary.originEvidence,
          generation: summary.generation, selection: summary.selection };
      })() : ({ id: audio.id, declaredOrigin: audio.declaredOrigin,
        sha256: audio.media.sha256, samples: audio.media.probe.audio?.samples ?? null,
        sampleRate: audio.media.probe.audio?.sampleRate ?? null, originEvidence: "human_declared_supplied_recording" });
      const segments = snapshot.segments.map(({ entry, script, audio, cue, accepted }) => {
        const writing = "transcriptSelectionId" in script && typeof script.transcriptSelectionId === "string" ? script.transcriptSelectionId : null;
        const timing = cue && "transcriptSelectionId" in cue && typeof cue.transcriptSelectionId === "string" ? cue.transcriptSelectionId : null;
        return { entry, script, audio: audio ? recording(audio) : null, cue, accepted,
          ...(writing || timing ? { transcriptAdoption: { writingSelectionId: writing, timingSelectionId: timing, authority: "Human editorial selection from existing recognition; acceptance remains separate." } } : {}) };
      });
      const audioLibrary = service.store.list<NarrationAudio>("narration_audio", projectId).reverse().map(recording);
      const gaps = snapshot.readiness.gaps;
      const total = Math.max(segments.length, audioLibrary.length, gaps.length);
      base.guard.dataDigest = digest({ state: snapshot.state, segments, audioLibrary, readiness: snapshot.readiness });
      return adaptive(offset, total, count => ({ ...base,
        narrationDraft: { version: snapshot.state.version, revisionId: snapshot.state.revisionId, segments: segments.slice(offset, offset + count),
          readiness: { ...snapshot.readiness, gaps: gaps.slice(offset, offset + count) },
          authority: "Draft text and source intent only. Recording metadata does not prove its words. Human exact script, audio and timing acceptance and reviewed canonical application remain separate. This tool cannot synthesize, transcribe, attach recordings or accept anything." },
        audioLibrary: audioLibrary.slice(offset, offset + count), page: page(offset, count, total),
        coverage: { ...base.coverage, narration: { pagination: "The same record window applies to segments, recordings and gaps. Follow nextOffset until null; compare guard/dataDigest across pages.",
          segments: { total: segments.length, returned: segments.slice(offset, offset + count).length },
          recordings: { total: audioLibrary.length, returned: audioLibrary.slice(offset, offset + count).length },
          gaps: { total: gaps.length, returned: gaps.slice(offset, offset + count).length } } },
      }));
    }
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
    const assets = saved.artifacts.map(artifact => ({ ...artifact, metadata: service.store.get("artifact", artifact.artifactId) ? service.inspectArtifact(projectId, actor, artifact.artifactId) : null }));
    const draft = service.store.get<NarrationState>("narration_state", projectId);
    const segments = (draft?.entries ?? []).map(entry => ({ ...entry, script: service.store.get<SegmentRevision>("narration_segment", entry.segmentRevisionId) ?? null }));
    const total = Math.max(saved.shots.length, saved.scenes.length, assets.length, saved.cues.length, segments.length, messages.length, assistantMessages.length, questions.length, holds.length, toolCalls.length, readiness.scopes.length, readiness.narration.acceptedMeasuredCues.length);
    base.guard.dataDigest = digest({ shots: saved.shots, scenes: saved.scenes, messages, assistantMessages, questions, holds, toolCalls, readiness, assets, cues: saved.cues, draft: draft ?? null });
    base.work = workSummary(service, projectId, activePlanId);
    return adaptive(offset, total, count => {
      const slice = <T>(values: T[]) => values.slice(offset, offset + count);
      return {
        ...base,
        project: { ...base.project, shots: slice(saved.shots).map(({ id, revisionId, sceneId, desiredFrames }) => ({ id, revisionId, sceneId, desiredFrames })), scenes: slice(saved.scenes).map(({ id, revisionId }) => ({ id, revisionId })) },
        messages: slice(messages), assistantMessages: slice(assistantMessages), questions: slice(questions), holds: slice(holds), toolCalls: slice(toolCalls),
        assets: slice(assets), cues: slice(saved.cues),
        narrationDraft: { version: draft?.version ?? 0, segments: slice(segments), authority: "Draft records are context, not canonical cues or permission. Human script, recording and timing acceptance is required in narration review before a canonical commit. Use current canonical cues/assets for executable planning." },
        workflow: { ...readiness, scopes: slice(readiness.scopes), narration: { ...readiness.narration, acceptedMeasuredCues: slice(readiness.narration.acceptedMeasuredCues) } },
        page: page(offset, count, total),
        coverage: { ...base.coverage, overview: { pagination: "The same record window applies to each listed collection; follow nextOffset until null. Messages and tool calls are newest first.", messages: { total: messages.length, returned: slice(messages).length }, holds: { total: holds.length, returned: slice(holds).length }, toolCalls: { total: toolCalls.length, returned: slice(toolCalls).length }, scopes: { total: readiness.scopes.length, returned: slice(readiness.scopes).length }, shots: { total: saved.shots.length, returned: slice(saved.shots).length, detailsSection: "shots" }, scenes: { total: saved.scenes.length, returned: slice(saved.scenes).length, detailsSection: "scenes" }, assets: { total: assets.length, returned: slice(assets).length }, cues: { total: saved.cues.length, returned: slice(saved.cues).length }, narrationSegments: { total: segments.length, returned: slice(segments).length }, acceptedMeasuredCues: { total: readiness.narration.acceptedMeasuredCues.length, returned: slice(readiness.narration.acceptedMeasuredCues).length } } },
      };
    });
  });
}
