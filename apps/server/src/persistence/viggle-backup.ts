import { canonical, digest, invariant } from "@openslate/core";
import { describeViggleH3Request } from "@openslate/providers";
import type { ExecutionSpoolOutput } from "@openslate/providers";
import type { Attempt, ArtifactRecord } from "../execution/engine.js";
import type { ViggleAuthorityStore } from "../execution/viggle-h3-authority.js";
import type { ViggleH3ExecutionMapping } from "../execution/viggle-h3-receipts.js";
import { assertViggleRecords, assertViggleSpoolLineage } from "../execution/viggle-h3-lineage.js";
import { assertVideoDerivationIntent, assertVideoDerivationReceipt, assertNormalizedVideoIngestion } from "../execution/video-derivation.js";
import type { VideoDerivationIntent, VideoDerivationReceipt } from "../execution/video-derivation.js";
import type { OutputSpool } from "../execution/output-store.js";

type Row = Record<string, any>;
/** Extra closure for the new adapter only. Reads owned backup bytes; never opens a provider or changes SQL. */
export function viggleBackupClosure(reader: ViggleAuthorityStore, readJson: (path: string) => Promise<Row>,
  readArtifact: (artifact: ArtifactRecord) => Promise<Buffer>) {
  const checked = new Set<string>();
  const get = <T>(kind: string, id: string): T => {
    const value = reader.get<T>(kind, id);
    invariant(value, "BACKUP_REFERENCE_INVALID", `Viggle backup is missing ${kind}`); return value;
  };
  const applicable = (attempt: Attempt): boolean => attempt.request.execution?.adapter === "viggle-h3";
  const records = async (attemptId: string): Promise<void> => {
    if (checked.has(attemptId)) return;
    const attempt = get<Attempt>("attempt", attemptId);
    invariant(applicable(attempt), "BACKUP_REFERENCE_INVALID", "Viggle receipts belong to another execution adapter");
    assertViggleRecords(reader, attemptId);
    const mapping = reader.get<ViggleH3ExecutionMapping>("viggle_h3_execution_mapping", attemptId);
    if (mapping) {
      const frame = get<ArtifactRecord>("artifact", mapping.firstFrame.artifactId);
      const bytes = await readArtifact(frame), transport = mapping.transport;
      invariant(transport.firstFrame && !transport.lastFrame && transport.mode === "first_frame",
        "BACKUP_REFERENCE_INVALID", "Initial Viggle application mapping requires its reviewed first frame");
      const reconstructed = describeViggleH3Request({ prompt: String(attempt.request.args.prompt), quality: transport.quality,
        durationSeconds: transport.durationSeconds, resolution: transport.resolution, aspectRatio: transport.aspectRatio,
        watermark: false, ...(transport.seed === undefined ? {} : { seed: transport.seed }), firstFrame: { ...transport.firstFrame, bytes } });
      invariant(canonical(reconstructed) === canonical(transport), "BACKUP_REFERENCE_INVALID", "Viggle multipart bytes differ from the retained request");
    }
    checked.add(attemptId);
  };
  const winning = async (attempt: Attempt, spoolId: string): Promise<ExecutionSpoolOutput> => {
    await records(attempt.id);
    const spool = await readJson(`execution-output/manifests/${spoolId}.json`) as OutputSpool;
    const slotId = digest({ projectId: attempt.projectId, attemptId: attempt.id, port: "video" });
    const slot = await readJson(`execution-output/slots/${slotId}.json`);
    for (const [kind, id, file] of [["execution_output_spool", spoolId, spool], ["execution_output_slot", slotId, slot]] as const) {
      const saved = reader.get(kind, id);
      invariant(!saved || canonical(saved) === canonical(file), "BACKUP_REFERENCE_INVALID", "Viggle SQL output differs from owned metadata");
    }
    // A completed file can precede SQL publication. Overlay only exact owned metadata, never fabricate a provider observation.
    const overlay: ViggleAuthorityStore = { db: reader.db, getProject: id => reader.getProject(id),
      get<T>(kind: string, id: string): T | undefined {
        if (kind === "execution_output_spool" && id === spoolId) return spool as T;
        if (kind === "execution_output_slot" && id === slotId) return slot as T;
        return reader.get<T>(kind, id);
      } };
    assertViggleSpoolLineage(overlay, attempt, spoolId);
    return { port: "video", kind: "video", mimeType: "video/mp4", extension: "mp4", sha256: spool.sha256,
      byteLength: spool.byteLength, fixture: false, storage: { type: "spool", spoolId } };
  };
  const derivation = async (intent: VideoDerivationIntent, receipt?: VideoDerivationReceipt, published = false): Promise<void> => {
    const attempt = get<Attempt>("attempt", intent.attemptId); if (!applicable(attempt)) return;
    const output = await winning(attempt, intent.spoolId); assertVideoDerivationIntent(intent, attempt, output);
    if (receipt) assertVideoDerivationReceipt(intent, receipt, published);
    if (published) {
      invariant(receipt, "BACKUP_REFERENCE_INVALID", "Published Viggle video lost its normalized completion");
      assertNormalizedVideoIngestion(intent, attempt, output, { type: "normalized_video", derivation: receipt,
        artifact: get("artifact", intent.artifactId), mediaSource: get("media_source", intent.artifactId) });
    }
  };
  return { applicable, records, winning, derivation };
}
