import { assertCodexImageSpoolLineage } from "./codex-image-lineage.js";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { digest, invariant } from "@openslate/core";
import { EXECUTION_SPOOL_LIMITS, isSpoolOutput } from "@openslate/providers";
import type { ArtifactRecord, ExecutionOutputIngestor } from "./engine.js";
import { ExecutionOutputStore } from "./output-store.js";
import { LocalImageStore } from "../media/local-images.js";

/** Exact PNG only. Video normalization requires a separate derivation contract. */
export class SpoolImageIngestor implements ExecutionOutputIngestor {
  constructor(readonly outputs: ExecutionOutputStore, readonly images: LocalImageStore) {}

  async ingest(input: Parameters<ExecutionOutputIngestor["ingest"]>[0]): Promise<ArtifactRecord> {
    const attempt = structuredClone(input.attempt), output = structuredClone(input.output), signal = input.signal;
    invariant(isSpoolOutput(output), "OUTPUT_INGESTION_UNSUPPORTED", "This ingester requires an owned spool");
    invariant(output.kind === "image" && output.port === "image" && output.mimeType === "image/png" && output.extension === "png",
      "OUTPUT_INGESTION_UNSUPPORTED", "Generated video requires explicit normalization provenance before publication");
    invariant(!signal.aborted, "OUTPUT_STORE_CANCELLED", "Image ingestion cancelled");
    const owned = await this.outputs.resolveOutput(attempt.projectId, attempt.id, output, { signal });
    assertCodexImageSpoolLineage(this.outputs.store, attempt, owned.spool.id);
    const file = await open(owned.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      invariant(stat.isFile() && stat.size > 32 && stat.size === output.byteLength && stat.size <= EXECUTION_SPOOL_LIMITS.image,
        "IMAGE_INPUT_INVALID", "Owned PNG exceeds its exact admitted size");
      // Allocate only the already bounded size; growing files cannot enlarge this allocation.
      bytes = Buffer.alloc(stat.size); let offset = 0;
      while (offset < bytes.length) {
        invariant(!signal.aborted, "OUTPUT_STORE_CANCELLED", "Image ingestion cancelled");
        const read = await file.read(bytes, offset, bytes.length - offset, null);
        invariant(read.bytesRead > 0, "ARTIFACT_CORRUPT", "Owned image was truncated during ingestion"); offset += read.bytesRead;
      }
      const tail = await file.read(Buffer.alloc(1), 0, 1, null);
      invariant(tail.bytesRead === 0, "ARTIFACT_CORRUPT", "Owned image grew during ingestion");
    } finally { await file.close(); }
    const image = await this.images.ingest({ bytes, sha256: output.sha256, mimeType: "image/png",
      width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }, { signal });
    invariant(!signal.aborted, "OUTPUT_STORE_CANCELLED", "Image ingestion cancelled");
    assertCodexImageSpoolLineage(this.outputs.store, attempt, owned.spool.id);
    const id = digest({ version: 1, projectId: attempt.projectId, attemptId: attempt.id, port: output.port, spoolId: owned.spool.id });
    return { id, projectId: attempt.projectId, attemptId: attempt.id,
      artifact: { artifactId: id, sha256: image.sha256, kind: "image" }, path: image.path,
      mimeType: "image/png", fixture: false, physicalDurationSeconds: null, outputReceiptId: owned.spool.receiptId,
      outputSpoolId: owned.spool.id, byteLength: image.byteLength, width: image.width, height: image.height,
      validationDigest: image.validationDigest };
  }
}
