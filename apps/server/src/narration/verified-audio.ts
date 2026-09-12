import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { link, mkdir, open, realpath, unlink } from "node:fs/promises";
import { join } from "node:path";
import { invariant, newId } from "@openslate/core";
import type { LocalMediaService, SuppliedMedia } from "../media/index.js";
import type { CanonicalNarrationArtifact } from "./canonical-types.js";

const HASH = /^[a-f0-9]{64}$/;
async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, "r"); try { await directory.sync(); } finally { await directory.close(); }
}
async function hashFile(path: string, maxBytes: number): Promise<{ sha256: string; byteLength: number }> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat(); invariant(stat.isFile() && stat.size <= maxBytes, "NARRATION_ARTIFACT_INVALID", "Audio file is absent or exceeds its bound");
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let size = 0;
    for (;;) { const { bytesRead } = await file.read(buffer, 0, buffer.length, null); if (!bytesRead) break; size += bytesRead;
      invariant(size <= maxBytes, "NARRATION_ARTIFACT_INVALID", "Audio exceeds its byte limit"); hash.update(buffer.subarray(0, bytesRead)); }
    invariant(size === stat.size, "NARRATION_ARTIFACT_INVALID", "Audio changed during verification");
    return { sha256: hash.digest("hex"), byteLength: size };
  } finally { await file.close(); }
}

/** Verify the service-issued descriptor and install immutable bytes before the SQL commit. */
export async function installNarrationAudio(media: LocalMediaService, artifactRoot: string, projectId: string, source: SuppliedMedia): Promise<CanonicalNarrationArtifact> {
  invariant(source.kind === "audio" && HASH.test(source.id) && HASH.test(source.sha256), "NARRATION_ARTIFACT_INVALID", "Invalid normalized audio descriptor");
  const verified = await media.verifiedSource(source);
  source = verified.source;
  invariant(source.probe.audio?.sampleRate === 48000 && source.probe.audio.channels === 2 && Number.isSafeInteger(source.probe.audio.samples) && source.probe.audio.samples! > 0,
    "NARRATION_ARTIFACT_INVALID", "Narration requires measured normalized audio");
  artifactRoot = await realpath(artifactRoot);
  const directory = join(artifactRoot, projectId); await mkdir(directory, { recursive: true });
  invariant(await realpath(artifactRoot) === artifactRoot && await realpath(directory) === directory, "NARRATION_ARTIFACT_INVALID", "Artifact storage directories cannot be links");
  await syncDirectory(artifactRoot);
  const path = join(directory, `${source.sha256}.wav`), temporary = join(directory, `.narration-${newId()}.tmp`);
  const input = await open(verified.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await input.stat(); invariant(stat.isFile() && stat.size === source.byteLength && stat.size <= media.limits.maxOutputBytes, "NARRATION_ARTIFACT_INVALID", "Normalized audio size changed");
    const output = await open(temporary, "wx", 0o600);
    try {
      const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let size = 0;
      for (;;) { const { bytesRead } = await input.read(buffer, 0, buffer.length, null); if (!bytesRead) break; size += bytesRead;
        invariant(size <= source.byteLength, "NARRATION_ARTIFACT_INVALID", "Normalized audio grew during installation");
        const chunk = buffer.subarray(0, bytesRead); hash.update(chunk); await output.writeFile(chunk); }
      invariant(size === source.byteLength && hash.digest("hex") === source.sha256, "NARRATION_ARTIFACT_INVALID", "Normalized audio bytes changed");
      await output.chmod(0o444); await output.sync();
    } finally { await output.close(); }
    try { await link(temporary, path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const installed = await hashFile(path, media.limits.maxOutputBytes);
    invariant(installed.sha256 === source.sha256 && installed.byteLength === source.byteLength, "NARRATION_ARTIFACT_INVALID", "Existing artifact does not match accepted audio");
    await syncDirectory(directory);
    return { id: source.artifactId, projectId, artifact: { artifactId: source.artifactId, sha256: source.sha256, kind: "audio" }, path,
      mimeType: "audio/wav", fixture: false, attemptId: null, origin: "narration_audio", byteLength: source.byteLength,
      physicalDurationSeconds: source.probe.audio.samples! / 48000, sourceDescriptorId: source.id };
  } finally { await input.close(); await unlink(temporary).catch(() => {}); }
}
