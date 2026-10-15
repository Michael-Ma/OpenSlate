import type { FastifyInstance } from "fastify";
import type { AssetItem, AssetRole, StudioArtifactRef } from "@openslate/core/public";
import type { ProjectRecord } from "@openslate/core";
import type { ProductionService } from "./application/service.js";
import type { ArtifactRecord, Attempt, NodeBinding } from "./execution/engine.js";
import type { CanonicalNarration } from "./narration/canonical-types.js";
import type { NarrationSpeechProposal } from "./narration/narration-speech-types.js";
import type { NarrationAudio } from "./narration/types.js";
import { audioLibraryRole, type AudioLabel } from "./narration/audio-library-role.js";

/** One project-scoped join per collection. Immutable history survives scene deletion and archive. */
export function projectAssets(production: ProductionService, project: ProjectRecord): AssetItem[] {
  const store = production.store, projectId = project.id;
  const bindings = new Map(store.list<NodeBinding>("node_binding", projectId).map(b => [b.id, b]));
  const attempts = new Map(store.list<Attempt>("attempt", projectId).map(a => [a.id, a]));
  const revisions = store.list<{ before: ProjectRecord }>("storyboard_edit", projectId).map(x => ({ project: x.before })).concat(store.list<{ project: ProjectRecord }>("project_revision", projectId));
  const shots = new Map(revisions.flatMap(r => r.project.shots).concat(project.shots).map(s => [s.id, s]));
  const scenes = new Map(revisions.flatMap(r => r.project.scenes).concat(project.scenes).map(s => [s.id, s]));
  const current = new Set([...bindings.values()].filter(b => b.state === "active" && b.planId === project.activePlanId && (!b.node.shotId || project.shots.some(s => s.id === b.node.shotId)))
    .flatMap(b => Object.values(b.outputs).map(a => a.artifactId)));
  const labels = new Map(store.list<AudioLabel>("audio_library_label", projectId).map(x => [x.id, x]));
  const metadata = new Map(store.list<{ id: string; createdAt: string }>("asset_metadata", projectId).map(x => [x.id, x.createdAt]));
  const audio = new Map(store.list<NarrationAudio>("narration_audio", projectId).map(a => [a.id, a]));
  const audioShots = new Map<string, string>();
  const head = store.get<{ canonicalId: string }>("narration_canonical_head", projectId);
  for (const canonical of store.list<CanonicalNarration>("narration_canonical", projectId)) {
    for (const segment of canonical.segments ?? []) {
      const shotId = canonical.shotMappings.find(m => m.segmentId === segment.segmentId)?.shotId;
      if (shotId) audioShots.set(segment.provenance.audioId, shotId);
      if (shotId) audioShots.set(segment.cue.audio.artifactId, shotId);
      if (canonical.id === head?.canonicalId && project.shots.some(s => s.id === shotId && s.cueId === segment.cue.id && !s.narrationPending) && project.cues.some(c => c.id === segment.cue.id && c.accepted)) {
        current.add(segment.provenance.audioId);
        current.add(segment.cue.audio.artifactId);
      }
    }
  }
  const segmentShots = new Map<string, string>();
  for (const kind of ["narration_shot_draft", "narration_requested_shot_scope", "narration_shot_scope_target"])
    for (const pin of store.list<{ segmentId: string; shotId: string }>(kind, projectId)) segmentShots.set(pin.segmentId, pin.shotId);
  const speechShots = new Map<string, string>();
  for (const proposal of store.list<NarrationSpeechProposal>("narration_speech_proposal", projectId)) {
    const shotId = segmentShots.get(proposal.section.segmentId);
    if (shotId) for (const node of proposal.compiled.nodes) speechShots.set(node.id, shotId);
  }
  const preview = store.get<{ artifact: { artifactId: string } }>("media_preview", projectId);
  if (preview) current.add(preview.artifact.artifactId);
  if (project.soundtrack) current.add(project.soundtrack.audioId);
  const records = store.list<ArtifactRecord>("artifact", projectId);
  const counts = new Map<string, number>();
  const items: AssetItem[] = [];
  const firstEvent = store.readEvents(projectId)[0]?.occurredAt ?? new Date(0).toISOString();
  for (const record of records) {
    if (!["image", "video", "audio"].includes(record.artifact.kind)) continue;
    const recording = audio.get(record.id);
    const attempt = record.attemptId ? attempts.get(record.attemptId) : undefined;
    const binding = attempt ? bindings.get(attempt.nodeId) : undefined;
    const shotId = binding?.node.shotId ?? (attempt ? speechShots.get(attempt.nodeId) : undefined) ?? audioShots.get(record.id);
    const shot = shotId ? shots.get(shotId) : undefined;
    const role: AssetRole = record.origin === "local_render" ? "export"
      : recording ? audioLibraryRole(project, recording, labels.get(record.id))
      : record.origin === "supplied_image" || record.origin === "supplied_video" ? "upload"
      : record.artifact.kind === "image" ? "keyframe" : record.artifact.kind === "video" ? "clip" : "voice";
    const group = `${shotId ?? ""}:${role}`, takeIndex = (counts.get(group) ?? 0) + 1;
    if (role === "keyframe" || role === "clip") counts.set(group, takeIndex);
    const source = record.fixture ? "demo" : role === "upload" || (recording && !("originEvidence" in recording)) ? "imported" : "generated";
    const scene = shot ? scenes.get(shot.sceneId) : undefined;
    const label = labels.get(record.id)?.label ?? (role === "export" ? `${record.fixture ? "Demo export" : "Export"} · ${project.name}` : `${scene?.title || scene?.purpose || project.name}${shot ? ` · ${shot.purpose}` : ""} · ${role}${role === "keyframe" || role === "clip" ? ` ${takeIndex}` : ""}`);
    items.push({ artifact: { artifactId: record.artifact.artifactId, sha256: record.artifact.sha256, kind: record.artifact.kind as StudioArtifactRef["kind"] }, role, ...(shotId ? { shotId } : {}), ...(shot ? { sceneId: shot.sceneId } : {}),
      ...(role === "keyframe" || role === "clip" ? { takeIndex } : {}), current: current.has(record.id), source, label,
      createdAt: metadata.get(`artifact:${record.id}`) ?? attempt?.createdAt ?? firstEvent,
      ...(record.physicalDurationSeconds !== null ? { durationSeconds: record.physicalDurationSeconds } : {}) });
    audio.delete(record.id);
  }
  for (const recording of audio.values()) {
    const shotId = audioShots.get(recording.id), shot = shotId ? shots.get(shotId) : undefined;
    const role = audioLibraryRole(project, recording, labels.get(recording.id));
    items.push({ artifact: { artifactId: recording.id, sha256: recording.media.sha256, kind: "audio" }, role,
      ...(shotId ? { shotId } : {}), ...(shot ? { sceneId: shot.sceneId } : {}), current: current.has(recording.id),
      source: "originEvidence" in recording ? "generated" : "imported", label: labels.get(recording.id)?.label ?? (role === "voice" ? "Voice line" : "Uploaded audio"),
      createdAt: metadata.get(`narration_audio:${recording.id}`) ?? firstEvent,
      ...(recording.media.probe?.audio?.samples ? { durationSeconds: recording.media.probe.audio.samples / 48000 } : {}) });
  }
  return items.reverse();
}
/** Public references only: no local paths, credentials or execution receipts. */
export function registerAssetLibrary(app: FastifyInstance, service: () => ProductionService) {
  type Query = { offset?: string; kind?: "all" | "image" | "video" | "audio"; source?: "all" | "uploaded" | "generated" | "export" | "imported" | "demo"; search?: string; sceneId?: string; shotId?: string; role?: AssetRole };
  app.get<{ Params: { projectId: string }; Querystring: Query }>("/api/projects/:projectId/assets", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      offset: { type: "string", pattern: "^(0|[1-9][0-9]{0,6})$" }, kind: { enum: ["all", "image", "video", "audio"] },
      source: { enum: ["all", "uploaded", "generated", "export", "imported", "demo"] }, search: { type: "string", maxLength: 160 },
      sceneId: { type: "string", minLength: 1, maxLength: 160 }, shotId: { type: "string", minLength: 1, maxLength: 160 },
      role: { enum: ["keyframe", "clip", "voice", "music", "upload", "export"] },
    } } },
  }, async request => {
    const production = service(), query = request.query, offset = Number(query.offset ?? 0);
    return production.store.transaction(() => {
      const items = projectAssets(production, production.store.getProject(request.params.projectId)).filter(item =>
        (!query.kind || query.kind === "all" || item.artifact.kind === query.kind) &&
        (!query.source || query.source === "all" || (query.source === "uploaded" ? item.source === "imported" : query.source === "export" ? item.role === "export" : item.source === query.source)) &&
        (!query.sceneId || item.sceneId === query.sceneId) && (!query.shotId || item.shotId === query.shotId) && (!query.role || item.role === query.role) &&
        (!query.search || `${item.label} ${item.artifact.artifactId}`.toLowerCase().includes(query.search.toLowerCase())));
      const assets = items.slice(offset, offset + 40);
      return { assets, total: items.length, offset, nextOffset: offset + assets.length < items.length ? offset + assets.length : null };
    });
  });
}
