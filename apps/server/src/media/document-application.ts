import { createHash } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { link, mkdtemp, open, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { digest, invariant, newId } from "@openslate/core";
import type { ActorContext, ArtifactRef } from "@openslate/core";
import type { DocumentUploadResult } from "@openslate/core/public";
import type { ProductionService } from "../application/service.js";
import type { ArtifactRecord } from "../execution/engine.js";
import { DOCUMENT_TEXT_MAX_CHARACTERS, extractPdfText } from "./document-extraction.js";
import type { PdfTextExtractor } from "./document-extraction.js";

export const DOCUMENT_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
export { DOCUMENT_TEXT_MAX_CHARACTERS } from "./document-extraction.js";
type DocumentMimeType = "application/pdf" | "text/plain" | "text/markdown";
export interface SuppliedDocumentArtifact extends ArtifactRecord {
  mimeType: DocumentMimeType; fixture: false; attemptId: null; origin: "supplied_document"; physicalDurationSeconds: null;
  byteLength: number; name: string; originalName: string; text: string; characters: number; pages?: number; truncated: boolean;
  validationDigest: string; importId: string;
}
export interface ImportDocumentInput { expectedHeadVersion: number; key: string; name: string; bytes: Uint8Array; sha256: string }
export interface ImportedDocument extends DocumentUploadResult { revisionId: string; headVersion: number }
interface DocumentImportIntent { id: string; projectId: string; artifactId: string; requestId: string; expectedHeadVersion: number; sha256: string; byteLength: number; name: string; mimeType: DocumentMimeType }
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const receipt = (value: ImportedDocument): ImportedDocument => ({ artifact: structuredClone(value.artifact), name: value.name, characters: value.characters, truncated: value.truncated,
  ...(value.pages !== undefined ? { pages: value.pages } : {}), revisionId: value.revisionId, headVersion: value.headVersion });

/** Owns the exact uploaded bytes and a bounded, inert text extraction alongside them. */
export class DocumentApplicationService {
  readonly rootDir: string;
  private readonly extractor: PdfTextExtractor;
  private readonly timeoutMs: number;
  constructor(readonly production: ProductionService, options: { extractionTimeoutMs?: number; extractPdf?: PdfTextExtractor } = {}) {
    const artifactRoot = realpathSync(production.engine.artifactDir), root = join(artifactRoot, "documents");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    invariant(realpathSync(root) === root, "DOCUMENT_CONFIGURATION_INVALID", "Document storage must stay inside owned artifact storage");
    this.rootDir = root;
    for (const name of ["tmp", "blobs"]) {
      const directory = join(root, name); mkdirSync(directory, { recursive: true, mode: 0o700 });
      invariant(realpathSync(directory) === directory, "DOCUMENT_CONFIGURATION_INVALID", "Document storage cannot use linked directories");
    }
    this.timeoutMs = options.extractionTimeoutMs ?? 15_000;
    invariant(Number.isSafeInteger(this.timeoutMs) && this.timeoutMs >= 50 && this.timeoutMs <= 120_000, "DOCUMENT_CONFIGURATION_INVALID", "Document extraction needs a bounded deadline");
    this.extractor = options.extractPdf ?? extractPdfText;
  }
  private get store() { return this.production.store; }
  private authorize(projectId: string, actor: ActorContext): void {
    invariant(actor.kind === "human", "ACTOR_DENIED", "Only a human can import a document");
    this.production.assertActor(projectId, actor, true);
    invariant(this.store.get<{ scopeIds: string[] }>("message", actor.requestId)?.scopeIds.includes(projectId), "SCOPE_DENIED", "Document import requires project scope");
  }
  async importDocument(projectId: string, actor: ActorContext, input: ImportDocumentInput, options: { signal?: AbortSignal } = {}): Promise<ImportedDocument> {
    const authority = structuredClone(actor), signal = options.signal;
    this.authorize(projectId, authority);
    const current = () => { invariant(!signal?.aborted, "MEDIA_CANCELLED", "Document import cancelled"); this.authorize(projectId, authority); };
    current();
    invariant(input && typeof input === "object" && Object.keys(input).every(key => ["expectedHeadVersion", "key", "name", "bytes", "sha256"].includes(key)) &&
      Number.isSafeInteger(input.expectedHeadVersion) && input.expectedHeadVersion >= 0 && typeof input.key === "string" && input.key.length > 0 && input.key.length <= 160 &&
      typeof input.name === "string" && input.name.trim().length > 0 && input.name.length <= 200,
    "VALIDATION_ERROR", "Choose a named document and a bounded import command");
    invariant(input.bytes instanceof Uint8Array && input.bytes.byteLength > 0 && input.bytes.byteLength <= DOCUMENT_IMPORT_MAX_BYTES, "UPLOAD_TOO_LARGE", "Documents must be nonempty and at most 32 MiB");
    const bytes = Buffer.from(input.bytes), expectedHeadVersion = input.expectedHeadVersion, key = input.key, hash = input.sha256;
    const name = basename(input.name.replaceAll("\\", "/")).replace(/[\u0000-\u001f\u007f]/g, "").trim();
    invariant(name.length > 0 && /\.(pdf|txt|md)$/i.test(name), "DOCUMENT_FORMAT_UNSUPPORTED", "Choose a PDF, TXT or MD document");
    const mimeType: DocumentMimeType = /\.pdf$/i.test(name) ? "application/pdf" : /\.md$/i.test(name) ? "text/markdown" : "text/plain";
    invariant(typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash) && sha(bytes) === hash, "DOCUMENT_DIGEST_MISMATCH", "Document bytes differ from the upload receipt");
    const request = { expectedHeadVersion, sha256: hash, byteLength: bytes.length, name, mimeType };
    const intent = this.store.transaction(() => {
      current();
      const reserved = this.store.command<DocumentImportIntent>(`${authority.principalId}:${projectId}:document_import`, key, digest({ authority, request }), () => {
        invariant(this.store.getProject(projectId).headVersion === expectedHeadVersion, "REVISION_CONFLICT", "Project changed before document import");
        const value = { id: newId(), projectId, artifactId: newId(), requestId: authority.requestId, ...request };
        this.store.insert("document_import", value.id, projectId, value); return value;
      });
      if (!this.store.get("document_import_receipt", reserved.id)) invariant(this.store.getProject(projectId).headVersion === expectedHeadVersion, "REVISION_CONFLICT", "Project changed before document import could resume");
      return reserved;
    });
    const prior = this.store.get<ImportedDocument>("document_import_receipt", intent.id); if (prior) return receipt(prior);
    let extracted: { text: string; pages?: number; truncated: boolean };
    if (mimeType === "application/pdf") {
      invariant(bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")), "DOCUMENT_INVALID", "Choose a valid PDF document");
      extracted = await this.extractor(bytes, { timeoutMs: this.timeoutMs, ...(signal ? { signal } : {}) });
      invariant(Number.isSafeInteger(extracted.pages) && extracted.pages! > 0, "DOCUMENT_INVALID", "PDF extraction must include its page count");
    } else {
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
      catch { invariant(false, "DOCUMENT_INVALID", "TXT and MD documents must use valid UTF-8 text"); }
      invariant(!text.includes("\u0000"), "DOCUMENT_INVALID", "Choose a text document without binary content");
      extracted = { text: text.slice(0, DOCUMENT_TEXT_MAX_CHARACTERS), truncated: text.length > DOCUMENT_TEXT_MAX_CHARACTERS };
    }
    current();
    invariant(typeof extracted.text === "string" && extracted.text.length <= DOCUMENT_TEXT_MAX_CHARACTERS && typeof extracted.truncated === "boolean", "DOCUMENT_INVALID", "Document extraction exceeded its text limit");
    const path = await this.publish(bytes, hash); current();
    return this.store.transaction(() => {
      current();
      const completed = this.store.get<ImportedDocument>("document_import_receipt", intent.id); if (completed) return receipt(completed);
      const project = this.store.getProject(projectId);
      invariant(project.headVersion === expectedHeadVersion, "REVISION_CONFLICT", "Project changed while reading the document");
      const artifact: ArtifactRef & { kind: "document" } = { artifactId: intent.artifactId, sha256: hash, kind: "document" };
      const record: SuppliedDocumentArtifact = { id: intent.artifactId, projectId, artifact, path, mimeType, fixture: false, attemptId: null, physicalDurationSeconds: null,
        origin: "supplied_document", byteLength: bytes.length, name, originalName: name, text: extracted.text, characters: extracted.text.length,
        ...(extracted.pages !== undefined ? { pages: extracted.pages } : {}), truncated: extracted.truncated, importId: intent.id,
        validationDigest: digest({ version: 1, sha256: hash, mimeType, text: extracted.text, pages: extracted.pages ?? null, truncated: extracted.truncated }) };
      this.store.insert("artifact", record.id, projectId, record);
      const saved = this.store.saveProject({ ...project, revisionId: newId(), artifacts: [...project.artifacts, artifact] }, project.headVersion);
      this.store.insert("project_revision", saved.revisionId, projectId, { project: saved });
      const result: ImportedDocument = { artifact, name, characters: record.characters, truncated: record.truncated,
        ...(record.pages !== undefined ? { pages: record.pages } : {}), revisionId: saved.revisionId, headVersion: saved.headVersion };
      this.store.insert("document_import_receipt", intent.id, projectId, result);
      this.store.appendEvent(projectId, "document.imported", { artifactId: artifact.artifactId, revisionId: saved.revisionId, sha256: hash });
      return receipt(result);
    });
  }
  private async publish(bytes: Buffer, hash: string): Promise<string> {
    const directory = await mkdtemp(join(this.rootDir, "tmp", "import-")), temporary = join(directory, "source"), path = join(this.rootDir, "blobs", hash);
    try {
      const output = await open(temporary, "wx", 0o600);
      try { await output.writeFile(bytes); await output.chmod(0o444); await output.sync(); } finally { await output.close(); }
      try { await link(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await handle.stat(); invariant(info.isFile() && info.size === bytes.length, "DOCUMENT_INTEGRITY_ERROR", "Stored document size changed");
        const stored = await handle.readFile(); invariant(stored.length === bytes.length && sha(stored) === hash, "DOCUMENT_INTEGRITY_ERROR", "Stored document bytes changed");
      } finally { await handle.close(); }
      const parent = await open(join(this.rootDir, "blobs"), "r"); try { await parent.sync(); } finally { await parent.close(); }
      return path;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
}
