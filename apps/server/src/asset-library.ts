import type { FastifyInstance } from "fastify";
import type { ProductionService } from "./application/service.js";
import type { ArtifactRecord } from "./execution/engine.js";
/** Read-only project library. Return public media references, never storage paths or provider receipts. */
export function registerAssetLibrary(app: FastifyInstance, service: () => ProductionService) {
  app.get<{ Params: { projectId: string }; Querystring: { offset?: string; kind?: "all" | "image" | "video"; source?: "all" | "uploaded" | "generated" | "export"; search?: string } }>("/api/projects/:projectId/assets", {
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      offset: { type: "string", pattern: "^(0|[1-9][0-9]{0,6})$" }, kind: { enum: ["all", "image", "video"] },
      source: { enum: ["all", "uploaded", "generated", "export"] }, search: { type: "string", maxLength: 160 },
    } } },
  }, async request => {
    const production = service(), project = production.store.getProject(request.params.projectId), query = request.query, offset = Number(query.offset ?? 0);
    const items = production.store.list<ArtifactRecord>("artifact", project.id).filter(record => ["image", "video"].includes(record.artifact.kind)).reverse().map(record => {
      const source = record.origin === "supplied_image" || record.origin === "supplied_video" ? "uploaded" : record.origin === "local_render" ? "export" : "generated";
      const label = `${source === "uploaded" ? "Uploaded" : source === "export" ? "Exported" : record.fixture ? "Demo" : "Generated"} ${record.artifact.kind} · ${record.id.slice(0, 8)}`;
      return { artifact: record.artifact, label, source, fixture: record.fixture, width: record.width ?? null, height: record.height ?? null, durationSeconds: record.physicalDurationSeconds, byteLength: record.byteLength ?? null };
    }).filter(item => (!query.kind || query.kind === "all" || item.artifact.kind === query.kind) && (!query.source || query.source === "all" || item.source === query.source) && (!query.search || `${item.label} ${item.artifact.artifactId}`.toLowerCase().includes(query.search.toLowerCase())));
    const assets = items.slice(offset, offset + 40);
    return { assets, total: items.length, offset, nextOffset: offset + assets.length < items.length ? offset + assets.length : null };
  });
}
