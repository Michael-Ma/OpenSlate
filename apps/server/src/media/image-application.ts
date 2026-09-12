import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { digest, invariant, newId } from "@openslate/core";
import type { ActorContext, ArtifactRef } from "@openslate/core";
import type { ProductionService } from "../application/service.js";
import type { ArtifactRecord } from "../execution/engine.js";
import { LocalImageStore } from "./local-images.js";

export const PNG_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
export interface ImportImageInput { expectedHeadVersion: number; key: string; bytes: Uint8Array; sha256: string }
export interface ImportedImage { artifact: ArtifactRef; revisionId: string; headVersion: number; width: number; height: number; byteLength: number }
export interface SuppliedImageArtifact extends ArtifactRecord {
  mimeType: "image/png"; fixture: false; attemptId: null; origin: "supplied_image";
  byteLength: number; width: number; height: number; physicalDurationSeconds: null;
  validationDigest: string; importId: string;
}
interface ImportIntent { id: string; projectId: string; artifactId: string; requestId: string; expectedHeadVersion: number; sha256: string; byteLength: number; width: number; height: number }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const inside = (root: string, path: string) => { const rel = relative(root, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
const receipt = (value: ImportedImage): ImportedImage => ({ artifact: value.artifact, revisionId: value.revisionId, headVersion: value.headVersion, width: value.width, height: value.height, byteLength: value.byteLength });

/** Human-owned reference upload. Importing never selects a shot or approves generation. */
export class ImageApplicationService {
  readonly artifactRoot: string;
  constructor(readonly production: ProductionService, readonly images: LocalImageStore) {
    this.artifactRoot = realpathSync(production.engine.artifactDir);
    invariant(inside(this.artifactRoot, images.rootDir), "IMAGE_CONFIGURATION_INVALID", "Image storage must stay within managed artifact storage");
  }
  private get store() { return this.production.store; }
  private authorize(projectId: string, actor: ActorContext): void {
    invariant(actor.kind === "human", "ACTOR_DENIED", "Only a human can import a supplied reference image");
    this.production.assertActor(projectId, actor, true);
    const request = this.store.get<{ scopeIds: string[] }>("message", actor.requestId);
    invariant(request?.scopeIds.includes(projectId), "SCOPE_DENIED", "Reference import requires project scope");
  }

  async importImage(projectId: string, actor: ActorContext, input: ImportImageInput, options: { signal?: AbortSignal } = {}): Promise<ImportedImage> {
    const authority = structuredClone(actor), signal = options.signal;
    this.authorize(projectId, authority);
    invariant(!signal?.aborted, "MEDIA_CANCELLED", "Reference image import cancelled");
    invariant(input && typeof input === "object" && Object.keys(input).every(key => ["expectedHeadVersion", "key", "bytes", "sha256"].includes(key)) &&
      Number.isSafeInteger(input.expectedHeadVersion) && input.expectedHeadVersion >= 0 && typeof input.key === "string" && input.key.length > 0 && input.key.length <= 160,
    "VALIDATION_ERROR", "Use a bounded image import command and current project version");
    invariant(input.bytes instanceof Uint8Array && input.bytes.byteLength > 32 && input.bytes.byteLength <= PNG_IMPORT_MAX_BYTES, "IMAGE_INPUT_INVALID", "Choose a PNG image of at most 32 MiB");
    // Snapshot all mutable caller data before file validation yields.
    const bytes = Buffer.from(input.bytes), hash = input.sha256, key = input.key, expectedHeadVersion = input.expectedHeadVersion;
    invariant(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash) && sha(bytes) === hash, "IMAGE_DIGEST_MISMATCH", "Image bytes differ from the upload receipt");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    const request = { expectedHeadVersion, sha256: hash, byteLength: bytes.length, width, height };
    const intent = this.store.transaction(() => {
      this.authorize(projectId, authority);
      const reserved = this.store.command<ImportIntent>(`${authority.principalId}:${projectId}:image_import`, key, digest({ authority, request }), () => {
        invariant(this.store.getProject(projectId).headVersion === expectedHeadVersion, "REVISION_CONFLICT", "Project changed before image import");
        const value: ImportIntent = { id: newId(), projectId, artifactId: newId(), requestId: authority.requestId, ...request };
        this.store.insert("image_import", value.id, projectId, value); return value;
      });
      if (!this.store.get("image_import_receipt", reserved.id))
        invariant(this.store.getProject(projectId).headVersion === expectedHeadVersion, "REVISION_CONFLICT", "Project changed before image import could resume");
      return reserved;
    });
    const prior = this.store.get<ImportedImage>("image_import_receipt", intent.id);
    if (prior) return receipt(prior);
    const stored = await this.images.ingest({ bytes, sha256: hash, mimeType: "image/png", width, height }, signal ? { signal } : {});
    invariant(!signal?.aborted, "MEDIA_CANCELLED", "Reference image import cancelled");
    invariant(stored.sha256 === hash && stored.byteLength === bytes.length && stored.width === width && stored.height === height &&
      inside(this.artifactRoot, realpathSync(stored.path)), "IMAGE_INTEGRITY_ERROR", "Validated reference differs from its import intent or managed location");
    return this.store.transaction(() => {
      this.authorize(projectId, authority);
      invariant(!signal?.aborted, "MEDIA_CANCELLED", "Reference image import cancelled");
      const completed = this.store.get<ImportedImage>("image_import_receipt", intent.id); if (completed) return receipt(completed);
      const project = this.store.getProject(projectId);
      invariant(project.headVersion === expectedHeadVersion, "REVISION_CONFLICT", "Project changed while validating the image");
      const artifact: ArtifactRef = { artifactId: intent.artifactId, sha256: hash, kind: "image" };
      const record: SuppliedImageArtifact = { id: intent.artifactId, projectId, artifact, path: stored.path, mimeType: "image/png", fixture: false, attemptId: null,
        origin: "supplied_image", byteLength: stored.byteLength, width, height, physicalDurationSeconds: null, validationDigest: stored.validationDigest, importId: intent.id };
      this.store.insert("artifact", record.id, projectId, record);
      const saved = this.store.saveProject({ ...project, revisionId: newId(), artifacts: [...project.artifacts, artifact] }, project.headVersion);
      this.store.insert("project_revision", saved.revisionId, projectId, { project: saved });
      const result: ImportedImage = { artifact, revisionId: saved.revisionId, headVersion: saved.headVersion, width, height, byteLength: stored.byteLength };
      this.store.insert("image_import_receipt", intent.id, projectId, result);
      this.store.appendEvent(projectId, "image.imported", { artifactId: artifact.artifactId, revisionId: saved.revisionId, sha256: hash });
      return result;
    });
  }
}
