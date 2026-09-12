import { createHash } from "node:crypto";
import { mkdirSync, existsSync, openSync, writeFileSync, fsyncSync, closeSync, renameSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { invariant, newId } from "@openslate/core";
import { isSpoolOutput } from "@openslate/providers";
import type { ArtifactRecord, ExecutionOutputIngestor } from "./engine.js";

/** Historical fixture publication, shared by the default executor and explicit ingestion composition. */
export function materializeFixtureOutput(input: Parameters<ExecutionOutputIngestor["ingest"]>[0]): ArtifactRecord {
  const { attempt, output, artifactDir, signal } = input;
  invariant(!signal.aborted, "OUTPUT_STORE_CANCELLED", "Fixture ingestion cancelled");
  invariant(!isSpoolOutput(output), "INVALID_PROVIDER_OUTPUT", "Default ingestion cannot materialize owned provider spools");
  invariant(output.fixture === true && /^[a-f0-9]{64}$/.test(output.sha256) && /^(svg|wav|mp4|json)$/.test(output.extension), "INVALID_PROVIDER_OUTPUT", "Default ingestion accepts only fixture descriptors");
  invariant(output.bytesBase64.length <= Math.ceil(2_000_000 / 3) * 4, "INVALID_PROVIDER_OUTPUT", "Fixture output exceeds its byte limit");
  const bytes = Buffer.from(output.bytesBase64, "base64");
  invariant(bytes.length > 0 && bytes.length <= 2_000_000 && bytes.toString("base64") === output.bytesBase64
    && createHash("sha256").update(bytes).digest("hex") === output.sha256, "INVALID_PROVIDER_OUTPUT", "Fixture output digest mismatch");
  const directory = join(artifactDir, attempt.projectId); mkdirSync(directory, { recursive: true });
  const rootDirectory = openSync(artifactDir, "r"); try { fsyncSync(rootDirectory); } finally { closeSync(rootDirectory); }
  const path = join(directory, `${output.sha256}.${output.extension}`);
  if (!existsSync(path)) {
    const temporary = join(directory, `${newId()}.partial`); const fd = openSync(temporary, "wx");
    try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    try { renameSync(temporary, path); const dir = openSync(directory, "r"); try { fsyncSync(dir); } finally { closeSync(dir); } }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  invariant(createHash("sha256").update(readFileSync(path)).digest("hex") === output.sha256, "ARTIFACT_CORRUPT", "Published artifact hash mismatch");
  const id = newId();
  return { id, projectId: attempt.projectId, artifact: { artifactId: id, sha256: output.sha256, kind: output.kind }, path, mimeType: output.mimeType, fixture: output.fixture, attemptId: attempt.id, physicalDurationSeconds: output.kind === "video" || output.kind === "audio" ? 1 : null };
}
