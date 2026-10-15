import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonical, digest, invariant } from "@openslate/core";
import type { ArtifactRef } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import type { LocalMediaService } from "./local-media.js";

/** Read only an exact owned fixture, bounded before allocation. Never widen the user-upload roots. */
export async function fixtureSource(store: Store, media: LocalMediaService, projectId: string, artifact: ArtifactRef, frames: number) {
  const row = store.get<{ projectId: string; artifact: ArtifactRef; fixture: boolean; path: string }>("artifact", artifact.artifactId);
  invariant(row?.projectId === projectId && row.fixture && canonical(row.artifact) === canonical(artifact), "MEDIA_ARTIFACT_UNAVAILABLE", "Fixture is not owned by this project");
  invariant(artifact.kind === "video" || artifact.kind === "audio", "MEDIA_INVALID_INPUT", "Unsupported fixture kind");
  const file = await open(row.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes: Buffer;
  try {
    const stat = await file.stat();
    invariant(stat.isFile() && stat.size > 0 && stat.size <= media.limits.maxInputBytes, "MEDIA_INPUT_LIMIT", "Fixture exceeds its byte limit");
    bytes = Buffer.alloc(stat.size + 1); let at = 0;
    while (at < bytes.length) { const read = await file.read(bytes, at, bytes.length - at, null); if (!read.bytesRead) break; at += read.bytesRead; }
    invariant(at === stat.size, "MEDIA_INTEGRITY_ERROR", "Fixture size changed"); bytes = bytes.subarray(0, at);
  } finally { await file.close(); }
  invariant(createHash("sha256").update(bytes).digest("hex") === artifact.sha256, "MEDIA_INTEGRITY_ERROR", "Fixture bytes changed");
  return media.importFixture({ artifactId: `demo_${digest({ artifact, frames })}`, bytes, kind: artifact.kind, durationFrames: frames });
}
