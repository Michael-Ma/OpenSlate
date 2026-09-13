import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { invariant, newId } from "@openslate/core";
import type { LocalMediaService, SuppliedMedia } from "../media/index.js";
import type { CanonicalNarrationArtifact } from "./canonical-types.js";

const HASH = /^[a-f0-9]{64}$/;
const stopped = (signal?: AbortSignal): void => invariant(!signal?.aborted, "NARRATION_ARTIFACT_CANCELLED", "Narration artifact installation cancelled");
async function syncDirectory(path: string, signal?: AbortSignal): Promise<void> {
  stopped(signal); const directory = await open(path, "r");
  try { stopped(signal); await directory.sync(); stopped(signal); }
  finally { try { await directory.close(); } finally { stopped(signal); } }
}
async function hashFile(path: string, maxBytes: number, signal?: AbortSignal): Promise<{ sha256: string; byteLength: number }> {
  stopped(signal);
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    stopped(signal); const stat = await file.stat(); stopped(signal);
    invariant(stat.isFile() && stat.size <= maxBytes, "NARRATION_ARTIFACT_INVALID", "Audio file is absent or exceeds its bound");
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let size = 0;
    for (;;) { stopped(signal); const { bytesRead } = await file.read(buffer, 0, buffer.length, null); stopped(signal); if (!bytesRead) break; size += bytesRead;
      invariant(size <= maxBytes, "NARRATION_ARTIFACT_INVALID", "Audio exceeds its byte limit"); hash.update(buffer.subarray(0, bytesRead)); }
    invariant(size === stat.size, "NARRATION_ARTIFACT_INVALID", "Audio changed during verification");
    return { sha256: hash.digest("hex"), byteLength: size };
  } finally { try { await file.close(); } finally { stopped(signal); } }
}

/** Verify the service-issued descriptor and install immutable bytes before the SQL commit. */
export async function installNarrationAudio(media: LocalMediaService, artifactRoot: string, projectId: string, source: SuppliedMedia,
  options: { signal?: AbortSignal } = {}): Promise<CanonicalNarrationArtifact> {
  const signal = options.signal;
  try {
  stopped(signal);
  source = structuredClone(source); const maxBytes = media.limits.maxOutputBytes;
  invariant(source.kind === "audio" && HASH.test(source.id) && HASH.test(source.sha256), "NARRATION_ARTIFACT_INVALID", "Invalid normalized audio descriptor");
  const verified = await (signal ? media.verifiedSource(source, { signal }) : media.verifiedSource(source)); stopped(signal);
  const sourcePath = verified.path;
  source = structuredClone(verified.source);
  invariant(source.probe.audio?.sampleRate === 48000 && source.probe.audio.channels === 2 && Number.isSafeInteger(source.probe.audio.samples) && source.probe.audio.samples! > 0,
    "NARRATION_ARTIFACT_INVALID", "Narration requires measured normalized audio");
  artifactRoot = await realpath(artifactRoot); stopped(signal);
  const directory = join(artifactRoot, projectId); await mkdir(directory, { recursive: true }); stopped(signal);
  const currentRoot = await realpath(artifactRoot); stopped(signal); const currentDirectory = await realpath(directory); stopped(signal);
  invariant(currentRoot === artifactRoot && currentDirectory === directory, "NARRATION_ARTIFACT_INVALID", "Artifact storage directories cannot be links");
  await syncDirectory(artifactRoot, signal); stopped(signal);
  const path = join(directory, `${source.sha256}.wav`), temporary = join(directory, `.narration-${newId()}.tmp`);
  const input = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    stopped(signal); const stat = await input.stat(); stopped(signal);
    invariant(stat.isFile() && stat.size === source.byteLength && stat.size <= maxBytes, "NARRATION_ARTIFACT_INVALID", "Normalized audio size changed");
    const output = await open(temporary, "wx", 0o600);
    try {
      stopped(signal);
      const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let size = 0;
      for (;;) { stopped(signal); const { bytesRead } = await input.read(buffer, 0, buffer.length, null); stopped(signal); if (!bytesRead) break; size += bytesRead;
        invariant(size <= source.byteLength, "NARRATION_ARTIFACT_INVALID", "Normalized audio grew during installation");
        const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); await output.writeFile(chunk); stopped(signal); }
      invariant(size === source.byteLength && hash.digest("hex") === source.sha256, "NARRATION_ARTIFACT_INVALID", "Normalized audio bytes changed");
      stopped(signal); await output.chmod(0o444); stopped(signal); await output.sync(); stopped(signal);
    } finally { try { await output.close(); } finally { stopped(signal); } }
    stopped(signal);
    try { await link(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    stopped(signal); const installed = await hashFile(path, maxBytes, signal); stopped(signal);
    invariant(installed.sha256 === source.sha256 && installed.byteLength === source.byteLength, "NARRATION_ARTIFACT_INVALID", "Existing artifact does not match accepted audio");
    await syncDirectory(directory, signal); stopped(signal);
    return { id: source.artifactId, projectId, artifact: { artifactId: source.artifactId, sha256: source.sha256, kind: "audio" }, path,
      mimeType: "audio/wav", fixture: false, attemptId: null, origin: "narration_audio", byteLength: source.byteLength,
      physicalDurationSeconds: source.probe.audio.samples! / 48000, sourceDescriptorId: source.id };
  } finally {
    try { await input.close(); }
    finally { try { await unlink(temporary).catch(() => {}); } finally { stopped(signal); } }
  }
  } finally { stopped(signal); }
}
