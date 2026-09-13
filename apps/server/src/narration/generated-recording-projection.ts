import { digest, DomainError, invariant } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import { resolveGeneratedNarrationAudio, summarizeGeneratedNarrationAudio } from "./generated-audio.js";

const PAGE_SIZE = 40;
/** Metadata only. Attachment separately verifies owned bytes; this read creates no recording or authority. */
export function projectGeneratedRecordings(store: Store, projectId: string, offset = 0, expectedDigest?: string) {
  invariant(Number.isSafeInteger(offset) && offset >= 0 && offset <= 1_000_000, "VALIDATION_ERROR", "Invalid generated recording offset");
  return store.transaction(() => {
    store.getProject(projectId);
    // Limit rows before resolving provenance. Ignore oversized/malformed records rather than parsing them into a page.
    const where = "kind='artifact' AND project_id=? AND length(CAST(body AS BLOB))<=65536 AND json_valid(body) AND json_extract(body,'$.origin')='generated_audio'";
    const inventory = store.db.prepare(`SELECT COUNT(*) AS total, COALESCE(MAX(rowid),0) AS newest FROM entities WHERE ${where}`).get(projectId) as { total: number; newest: number };
    const dataDigest = digest({ projectId, ...inventory });
    invariant(expectedDigest === undefined || expectedDigest === dataDigest, "REVISION_CONFLICT", "Generated recording library changed; refresh its first page");
    invariant(offset <= inventory.total, "VALIDATION_ERROR", "Generated recording offset exceeds the library");
    const rows = store.db.prepare(`SELECT id FROM entities WHERE ${where} ORDER BY rowid DESC LIMIT ? OFFSET ?`).all(projectId, PAGE_SIZE, offset) as Array<{ id: string }>;
    const recordings: ReturnType<typeof summarizeGeneratedNarrationAudio>[] = [];
    for (const row of rows) {
      try { recordings.push(summarizeGeneratedNarrationAudio(resolveGeneratedNarrationAudio(store, projectId, row.id).audio)); }
      catch (error) { if (!(error instanceof DomainError)) throw error; }
    }
    return { recordings, coverage: { offset, scanned: rows.length, total: inventory.total,
      nextOffset: offset + rows.length < inventory.total ? offset + rows.length : null, dataDigest } };
  });
}
