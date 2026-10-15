import type { FastifyInstance } from "fastify";
import { digest, invariant, newId } from "@openslate/core";
import type { ProjectListItem } from "@openslate/core/public";
import type { ProductionService } from "./application/service.js";
import type { NodeBinding } from "./execution/engine.js";
import { requiredCommandKey } from "./application/command-key.js";
import { assertPersonalVoiceCurrent } from "./narration/personal-voices.js";
import { OPENAI_SPEECH_VOICES } from "@openslate/providers";

/** All unresolved paid work counts, including human-released unknown submissions. */
export function assertNoRunningAttempts(service: ProductionService, projectId: string, shotIds?: Set<string>) {
  const bindings = new Map(service.store.list<NodeBinding>("node_binding", projectId).map(x => [x.id, x]));
  const segmentShots = new Map<string, Set<string>>();
  const associate = (segmentId: string, shotId: string) => {
    const ids = segmentShots.get(segmentId) ?? new Set<string>();
    ids.add(shotId); segmentShots.set(segmentId, ids);
  };
  for (const kind of ["narration_shot_draft", "narration_requested_shot_scope", "narration_shot_scope_target"])
    for (const row of service.store.list<{ segmentId: string; shotId: string }>(kind, projectId)) associate(row.segmentId, row.shotId);
  for (const row of service.store.list<{ shotMappings: { segmentId: string | null; shotId: string }[] }>("narration_canonical", projectId))
    for (const mapping of row.shotMappings ?? []) if (mapping.segmentId) associate(mapping.segmentId, mapping.shotId);
  const speechShots = new Map<string, Set<string>>();
  for (const row of service.store.list<{ section: { segmentId: string }; compiled: { nodes: { id: string }[] } }>("narration_speech_proposal", projectId)) {
    const ids = segmentShots.get(row.section.segmentId);
    if (ids) for (const node of row.compiled.nodes) speechShots.set(node.id, ids);
  }
  const running = service.engine.attempts(projectId).filter(x => !["succeeded", "failed"].includes(x.phase)
    && (!shotIds || shotIds.has(bindings.get(x.nodeId)?.node.shotId ?? "") || [...(speechShots.get(x.nodeId) ?? [])].some(id => shotIds.has(id))));
  invariant(!running.length, "ATTEMPTS_RUNNING", "Wait for running or unknown jobs to settle before removing this work.");
  if (!shotIds) invariant(!service.store.list<{ state: string }>("media_render", projectId).some(x => ["prepared", "running", "interrupted"].includes(x.state)),
    "ATTEMPTS_RUNNING", "Wait for the export to finish before archiving this film.");
}

export function registerProjectLibrary(app: FastifyInstance, service: () => ProductionService) {
  app.get<{ Querystring: { includeArchived?: string } }>("/api/projects", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: { includeArchived: { enum: ["true", "false"] } } } },
  }, async request => {
    const s = service();
    const projects: ProjectListItem[] = s.store.listProjects().filter(p => request.query.includeArchived === "true" || !p.archived).map(p => {
      const videos = new Set(s.store.list<NodeBinding>("node_binding", p.id).filter(b => b.state === "active" && b.planId === p.activePlanId
        && b.node.kind === "video" && Object.values(b.outputs).some(x => x.kind === "video")).map(b => b.node.shotId));
      return { id: p.id, name: p.name, archived: p.archived ?? false, scenes: p.scenes.length, shots: p.shots.length,
        seconds: p.shots.reduce((n, x) => n + x.desiredFrames, 0) / 30, videosReady: p.shots.filter(x => videos.has(x.id)).length,
        updatedAt: p.updatedAt ?? s.store.readEvents(p.id).at(-1)?.occurredAt ?? new Date(0).toISOString() };
    });
    return { projects };
  });
  const version = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
  for (const action of ["rename", "archive", "unarchive", "narratorVoice"] as const) {
    type Input = { expectedHeadVersion?: number; name?: string; narratorVoice?: string };
    const setting = action === "narratorVoice";
    app.post<{ Params: { projectId: string }; Body: Input }>(`/api/projects/:projectId/${setting ? "settings/voice" : action}`, {
      preValidation: async request => {
        if ((action === "archive" || action === "unarchive") && request.body === undefined) request.body = {};
      },
      schema: { body: { type: "object", additionalProperties: false,
        required: action === "rename" ? ["name", "expectedHeadVersion"] : setting ? ["narratorVoice", "expectedHeadVersion"] : [],
        properties: { expectedHeadVersion: version, ...(action === "rename" ? { name: { type: "string", minLength: 1, maxLength: 160 } }
          : setting ? { narratorVoice: { type: "string", minLength: 1, maxLength: 160 } } : {}) } } },
    }, async request => {
      const s = service(), projectId = request.params.projectId, input = request.body, key = requiredCommandKey(request);
      s.recovery.assertWritable(projectId);
      return s.store.command(`local-user:${projectId}:${action}`, key, digest(input), () => {
        const before = s.store.getProject(projectId);
        invariant(input.expectedHeadVersion === undefined || input.expectedHeadVersion === before.headVersion, "REVISION_CONFLICT", "The film changed; reload before saving.");
        if (action === "archive") assertNoRunningAttempts(s, projectId);
        if (setting) {
          const voice = input.narratorVoice!;
          invariant((OPENAI_SPEECH_VOICES as readonly string[]).includes(voice) || voice.startsWith("openai-custom:"), "VALIDATION_ERROR", "Choose a stock or ready personal voice.");
          assertPersonalVoiceCurrent(s.store, projectId, voice);
        }
        if (action === "rename") invariant(input.name?.trim(), "VALIDATION_ERROR", "Enter a film name.");
        const project = s.store.saveProject({ ...before, revisionId: newId(),
          ...(action === "rename" ? { name: input.name!.trim() } : setting ? { narratorVoice: input.narratorVoice! } : { archived: action === "archive" }) }, before.headVersion);
        s.store.insert("project_revision", project.revisionId, projectId, { project });
        s.store.appendEvent(projectId, `project.${action}`, { headVersion: project.headVersion });
        return { headVersion: project.headVersion, project };
      });
    });
  }
  app.get<{ Params: { projectId: string } }>("/api/projects/:projectId/settings/voice", async request => {
    const project = service().store.getProject(request.params.projectId);
    return { headVersion: project.headVersion, narratorVoice: project.narratorVoice ?? "cedar" };
  });
}
