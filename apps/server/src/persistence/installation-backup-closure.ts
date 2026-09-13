import Database from "better-sqlite3";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { canonical, digest, invariant } from "@openslate/core";
import { assertVideoDerivationIntent, assertVideoDerivationReceipt } from "../execution/video-derivation.js";
import type { VideoDerivationIntent, VideoDerivationReceipt } from "../execution/video-derivation.js";
import type { Attempt } from "../execution/engine.js";
import type { BackupFile } from "./installation-backup.js";

type RecordValue = Record<string, any>;
const object = (value: unknown): value is RecordValue => value !== null && typeof value === "object" && !Array.isArray(value);
const HASH = /^[a-f0-9]{64}$/;
function fail(condition: unknown, message: string): asserts condition { invariant(condition, "BACKUP_REFERENCE_INVALID", message); }

/** Validate published ownership references without creating Store/media/provider objects. */
export async function verifyBackupClosure(bundle: string, originalRoot: string, files: ReadonlyMap<string, BackupFile>, read: (path: string) => Promise<Buffer>): Promise<void> {
  const required = (path: string, sha256?: unknown, byteLength?: unknown): BackupFile => {
    const file = files.get(path); fail(file, `Required published file is missing: ${path}`);
    if (sha256 !== undefined) fail(typeof sha256 === "string" && HASH.test(sha256) && file.sha256 === sha256, `Recorded content differs: ${path}`);
    if (byteLength !== undefined) fail(Number.isSafeInteger(byteLength) && file.byteLength === byteLength, `Recorded length differs: ${path}`);
    return file;
  };
  const absoluteReference = (path: unknown, sha256?: unknown, byteLength?: unknown): void => {
    fail(typeof path === "string" && isAbsolute(path) && resolve(path) === path, "Owned artifact path must be absolute and normalized");
    const sub = relative(originalRoot, path);
    fail(sub !== "" && sub !== ".." && !isAbsolute(sub) && !sub.startsWith(`..${sep}`), "Owned artifact lies outside this installation");
    required(sub.split(sep).join("/"), sha256, byteLength);
  };
  const json = async (path: string): Promise<RecordValue> => {
    required(path); const bytes = await read(path); let value: unknown;
    try { value = JSON.parse(bytes.toString("utf8")); } catch { fail(false, `Invalid owned metadata: ${path}`); }
    fail(object(value), `Owned metadata must be an object: ${path}`); return value;
  };
  const source = async (value: unknown): Promise<void> => {
    fail(object(value) && HASH.test(value.id) && (value.kind === "video" || value.kind === "audio"), "Invalid media source descriptor");
    const { id, ...body } = value;
    fail(digest(body) === id, "Media source descriptor digest differs");
    const saved = await json(`media/sources/${id}.json`); fail(canonical(saved) === canonical(value), "Media source differs from its saved descriptor");
    required(`media/blobs/${value.originalSha256}.source`, value.originalSha256, value.originalByteLength);
    required(`media/blobs/${value.sha256}.${value.kind === "video" ? "mp4" : "wav"}`, value.sha256, value.byteLength);
  };
  const renderManifest = async (value: unknown): Promise<void> => {
    fail(object(value) && HASH.test(value.digest) && Array.isArray(value.clips) && Array.isArray(value.audio), "Invalid frozen render manifest");
    const { digest: identity, ...body } = value; fail(digest(body) === identity, "Frozen render manifest digest differs");
    fail(canonical(await json(`media/manifests/${identity}.json`)) === canonical(value), "Frozen render manifest differs from its published file");
    for (const placement of [...value.clips, ...value.audio]) { fail(object(placement), "Invalid media placement"); await source(placement.source); }
  };
  const artifact = (value: unknown): void => {
    fail(object(value) && object(value.artifact) && value.id === value.artifact.artifactId, "Invalid owned artifact record");
    absoluteReference(value.path, value.artifact.sha256, value.byteLength);
  };
  const db = new Database(join(bundle, "openslate.sqlite"), { readonly: true, fileMustExist: true });
  try {
    for (const table of ["entities", "projects"]) fail(!db.prepare(`SELECT 1 FROM ${table} WHERE length(CAST(body AS BLOB)) > ? LIMIT 1`).get(16 * 1024 ** 2), "Database record exceeds backup verification bound");
    const get = (kind: string, id: string): RecordValue => {
      const row = db.prepare("SELECT body FROM entities WHERE kind=? AND id=?").get(kind, id) as { body: string } | undefined;
      fail(row && Buffer.byteLength(row.body) <= 16 * 1024 ** 2, `Required database identity is missing: ${kind}`);
      const value: unknown = JSON.parse(row.body); fail(object(value), "Invalid saved record"); return value;
    };
    let storageId: string | undefined;
    if (files.has("execution-output/identity.json")) {
      const identity = await json("execution-output/identity.json");
      fail(identity.version === 1 && typeof identity.id === "string" && /^[a-f0-9-]{36}$/.test(identity.id), "Invalid execution storage identity"); storageId = identity.id;
    }
    fail(storageId || ![...files.keys()].some(path => path.startsWith("execution-output/")), "Execution output storage identity is missing");
    for (const [path, file] of files) {
      // Binary objects and timeline documents use the exact byte hash as the name.
      const named = /^(?:artifacts\/(?:images\/blobs|local-timelines\/documents|[^/]+)|media\/blobs|execution-output\/blobs)\/([a-f0-9]{64})\.[a-z]+$/.exec(path)
        ?? /^native\/[^/]+\/workspace\/image-attachments\/[a-f0-9]{64}\/[0-3]-([a-f0-9]{64})\.jpg$/.exec(path);
      if (named) fail(file.sha256 === named[1], `Content-addressed filename differs: ${path}`);
      if (path.startsWith("media/sources/")) { const value = await json(path); fail(path === `media/sources/${value.id}.json`, "Source descriptor filename differs"); await source(value); }
      else if (path.startsWith("media/manifests/")) { const value = await json(path); fail(path === `media/manifests/${value.digest}.json`, "Render manifest filename differs"); await renderManifest(value); }
      else if (path.startsWith("media/completions/")) {
        const receipt = await json(path); await renderManifest(receipt.manifest);
        fail(object(receipt.artifact) && receipt.artifact.manifestDigest === receipt.manifest.digest
          && path === `media/completions/${receipt.manifest.digest}-${receipt.artifact.sha256}.json`, "Render receipt identity differs");
        fail(receipt.artifact.path === join(originalRoot, "media", "blobs", `${receipt.artifact.sha256}.mp4`), "Render receipt output is outside its exact media blob path");
        absoluteReference(receipt.artifact.path, receipt.artifact.sha256, receipt.artifact.byteLength);
      } else if (path.startsWith("execution-output/manifests/")) {
        const spool = await json(path), receipt = get("execution_output_receipt", spool.receiptId), attempt = get("attempt", spool.attemptId);
        fail(spool.version === 1 && spool.storageId === storageId && spool.id === spool.receiptId && path === `execution-output/manifests/${spool.id}.json`
          && spool.projectId === receipt.projectId && spool.projectId === attempt.projectId && spool.attemptId === receipt.attemptId
          && spool.requestDigest === receipt.requestDigest && spool.requestDigest === digest(attempt.request) && spool.port === receipt.port
          && spool.blobKey === `${spool.sha256}.blob`, "Output spool ownership differs");
        const { id, ...body } = receipt; fail(id === digest(body), "Output receipt digest differs");
        fail(receipt.source?.kind === "protected_locator" || (receipt.source?.kind === "returned_bytes"
          && receipt.source.sha256 === spool.sha256 && receipt.source.byteLength === spool.byteLength), "Spool differs from its returned byte receipt");
        required(`execution-output/blobs/${spool.blobKey}`, spool.sha256, spool.byteLength);
      } else if (path.startsWith("execution-output/slots/")) {
        const slot = await json(path), spool = await json(`execution-output/manifests/${slot.spoolId}.json`);
        fail(slot.version === 1 && slot.storageId === storageId && slot.id === digest({ projectId: slot.projectId, attemptId: slot.attemptId, port: slot.port })
          && path === `execution-output/slots/${slot.id}.json` && slot.projectId === spool.projectId && slot.attemptId === spool.attemptId
          && slot.port === spool.port && slot.sha256 === spool.sha256 && slot.byteLength === spool.byteLength, "Winning output slot differs");
      } else if (path.startsWith("video-derivations/completions/")) {
        const receipt = await json(path), intent = get("video_derivation_intent", receipt.id);
        fail(path === `video-derivations/completions/${receipt.id}.json`, "Video derivation filename differs");
        assertVideoDerivationReceipt(intent as VideoDerivationIntent, receipt as VideoDerivationReceipt, false); await source(receipt.source);
        const spool = await json(`execution-output/manifests/${intent.spoolId}.json`);
        fail(spool.sha256 === intent.rawSha256 && spool.byteLength === intent.rawByteLength && spool.attemptId === intent.attemptId, "Video derivation raw source differs");
        const slot = await json(`execution-output/slots/${intent.slotId}.json`);
        fail(slot.spoolId === intent.spoolId, "Video derivation differs from its winning raw slot");
        assertVideoDerivationIntent(intent as VideoDerivationIntent, get("attempt", intent.attemptId) as Attempt,
          { port: "video", kind: "video", mimeType: "video/mp4", extension: "mp4", sha256: spool.sha256, byteLength: spool.byteLength, fixture: false, storage: { type: "spool", spoolId: spool.id } });
      }
    }
    for (const row of db.prepare("SELECT kind,id,body FROM entities").iterate() as Iterable<{ kind: string; id: string; body: string }>) {
      fail(Buffer.byteLength(row.body) <= 16 * 1024 ** 2, "Saved record exceeds backup verification bound");
      const value: RecordValue = JSON.parse(row.body);
      if (row.kind === "artifact") artifact(value);
      else if (row.kind === "media_source") await source(value.source);
      else if (row.kind === "narration_audio") await source(value.media);
      else if (row.kind === "media_render") { await renderManifest(value.manifest); if (value.artifact) {
        const saved = get("artifact", value.artifact.artifactId); fail(canonical(saved.artifact) === canonical(value.artifact), "Render artifact identity differs"); }
      }
      else if (row.kind === "execution_output_spool" || row.kind === "execution_output_slot") {
        const path = `execution-output/${row.kind === "execution_output_spool" ? "manifests" : "slots"}/${row.id}.json`;
        fail(canonical(await json(path)) === canonical(value), "Saved output metadata differs from its published receipt");
      } else if (row.kind === "video_derivation_receipt") {
        fail(canonical(await json(`video-derivations/completions/${row.id}.json`)) === canonical(value), "Saved derivation differs from its published receipt");
      } else if (row.kind === "request_image_projection") {
        fail(Array.isArray(value.images), "Invalid saved image projection");
        for (const [index, image] of value.images.entries()) required(`native/${value.projectId}/workspace/image-attachments/${digest({ requestId: value.requestId })}/${index}-${image.thumbnailSha256}.jpg`, image.thumbnailSha256, image.byteLength);
      } else if (row.kind === "skill_activation") {
        for (const skill of value.activation?.skills ?? []) absoluteReference(skill.entryPath, skill.entrySha256);
      } else if (row.kind === "director_skill_lock") {
        fail(Array.isArray(value.lock?.skills), "Invalid saved skill lock");
        for (const skill of value.lock.skills) fail(files.has(`skill-snapshots/${skill.packageDigest}/SKILL.md`)
          || files.has(`native/${value.projectId}/workspace/.agents/skills/${skill.packageDigest}/SKILL.md`), "A locked skill snapshot is missing");
      }
    }
    // Current canonical references must retain their owned artifact identity too.
    for (const row of db.prepare("SELECT body FROM projects").iterate() as Iterable<{ body: string }>) {
      fail(Buffer.byteLength(row.body) <= 16 * 1024 ** 2, "Project exceeds backup verification bound");
      const project = JSON.parse(row.body) as RecordValue;
      for (const ref of project.artifacts ?? []) {
        const saved = get("artifact", ref.artifactId); fail(saved.projectId === project.id && canonical(saved.artifact) === canonical(ref), "Canonical artifact ownership differs");
      }
    }
  } finally { db.close(); }
}
