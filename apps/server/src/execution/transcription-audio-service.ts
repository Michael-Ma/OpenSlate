import { canonical, digest, invariant } from "@openslate/core";
import type { Attempt } from "./engine.js";
import type { Store } from "../persistence/store.js";
import { InstallationRecoveryGuard } from "../application/installation-recovery.js";
import type { LocalMediaService } from "../media/local-media.js";
import { inspectPcmWave } from "../media/pcm-wave.js";
import { TranscriptionAudioStore } from "../media/transcription-audio-store.js";
import type { StoredTranscriptionAudio } from "../media/transcription-audio-store.js";
import { assertTranscriptionAudioIntent, assertTranscriptionAudioReceipt, resolveTranscriptionAudioSource, transcriptionAudioId, transcriptionAudioInput } from "./transcription-audio.js";
import type { TranscriptionAudioIntent, TranscriptionAudioReceipt, TranscriptionAudioSourceRecord } from "./transcription-audio.js";
import type { SubmissionPreparationContext } from "./submission-preparation.js";
import { snapshotSubmissionPreparationContext } from "./submission-preparation.js";
import { assertOwnedTranscriptionPreparation, resolveTranscriptionPreparationIntent } from "./transcription-preparation.js";

export interface TranscriptionPreparationOptions {
  expectedLease: Readonly<{ owner: string; epoch: number }>; signal: AbortSignal;
  submissionPreparation?: SubmissionPreparationContext;
}
/** Prepares one admitted attempt's complete input. This never grants permission for a provider POST or narration adoption. */
export class TranscriptionAudioService {
  constructor(readonly store: Store, readonly media: LocalMediaService, readonly files: TranscriptionAudioStore) {}
  private sources(attempt: Attempt): TranscriptionAudioSourceRecord[] {
    const input = transcriptionAudioInput(attempt);
    return (["media_source", "narration_audio"] as const).flatMap(kind => {
      const record = this.store.get<TranscriptionAudioSourceRecord["record"]>(kind, input.artifactId); return record ? [{ kind, record }] : [];
    });
  }
  async prepare(input: Readonly<Attempt>, options: TranscriptionPreparationOptions): Promise<StoredTranscriptionAudio> {
    const attempt = structuredClone(input), expectedLease = options.expectedLease && { owner: options.expectedLease.owner, epoch: options.expectedLease.epoch }, signal = options.signal;
    const protocol = options.submissionPreparation ? snapshotSubmissionPreparationContext(options.submissionPreparation) : undefined;
    invariant(!protocol || (protocol.signal === signal && canonical(protocol.expectedLease) === canonical(expectedLease)),
      "SUBMISSION_PREPARATION_INVALID", "Preparation must retain its original caller signal and lease");
    invariant(protocol || !this.store.get("transcription_preparation_intent", attempt.id),
      "SUBMISSION_PREPARATION_INVALID", "Saved submission preparation requires the explicit Engine port");
    const recovery = new InstallationRecoveryGuard(this.store);
    const owned = (first = false): Attempt => {
      invariant(!signal?.aborted, "MEDIA_CANCELLED", "Transcription preparation cancelled"); recovery.assertWritable(attempt.projectId);
      const current = this.store.get<Attempt>("attempt", attempt.id);
      invariant(expectedLease && typeof expectedLease.owner === "string" && expectedLease.owner.length > 0 && Number.isSafeInteger(expectedLease.epoch)
        && current?.projectId === attempt.projectId && digest(current.request) === digest(attempt.request)
        && current.leaseOwner === expectedLease.owner && current.leaseEpoch === expectedLease.epoch && current.leaseExpiresAt > Date.now()
        && attempt.leaseOwner === expectedLease.owner && attempt.leaseEpoch === expectedLease.epoch
        && (protocol ? current.phase === "preparing" : current.phase === "submitting" || current.phase === "submission_unknown"),
      "TRANSCRIPTION_AUDIO_LEASE_LOST", "Preparation no longer owns its original active attempt lease");
      if (protocol) assertOwnedTranscriptionPreparation(this.store, attempt, protocol);
      else if (first) {
        invariant(current.phase === "submitting", "TRANSCRIPTION_AUDIO_LEASE_LOST", "Only an original submitting attempt can start preparation");
        recovery.assertFirstSubmit(attempt.projectId, attempt.id);
      }
      return current;
    };
    owned();
    const id = transcriptionAudioId(attempt.projectId, attempt.id);
    let intent = this.store.get<TranscriptionAudioIntent>("transcription_audio_intent", id);
    const proof = protocol ? resolveTranscriptionPreparationIntent(this.store, attempt) : undefined;
    const selected = resolveTranscriptionAudioSource(attempt, this.sources(attempt), proof?.sourceRecord ?? intent?.sourceRecord);
    const source = structuredClone((selected.kind === "media_source" ? selected.record.source : selected.record.media)!);
    if (intent) assertTranscriptionAudioIntent(intent, attempt, selected);
    const verified = await this.media.verifiedSource(source, { signal });
    const pcm = await inspectPcmWave(verified.path, intent?.recipe.maxInputBytes ?? 256 * 1024 ** 2, signal);
    invariant(pcm.sha256 === source.sha256 && pcm.byteLength === source.byteLength && pcm.pcm.sampleRate === 48000 && pcm.pcm.channels === 2
      && pcm.pcm.bitsPerSample === 16 && pcm.pcm.sampleCount === source.probe.audio!.samples,
    "TRANSCRIPTION_AUDIO_CONFLICT", "Original source bytes differ from the pinned complete recording");
    owned();
    if (!intent) {
      owned(true); const recipe = await this.media.describeTranscriptionAudio({ signal }); owned(true);
      const proposed: TranscriptionAudioIntent = { id, version: 1, projectId: attempt.projectId, attemptId: attempt.id, requestDigest: digest(attempt.request),
        sourceRecord: { kind: selected.kind, id: selected.record.id, digest: digest(selected.record) }, source,
        sourceStartSample: 0, sourceEndSample: pcm.pcm.sampleCount, recipe };
      assertTranscriptionAudioIntent(proposed, attempt, selected);
      intent = this.store.transaction(() => {
        owned(true); resolveTranscriptionAudioSource(attempt, this.sources(attempt), proposed.sourceRecord);
        return this.store.put("transcription_audio_intent", id, attempt.projectId, proposed) as TranscriptionAudioIntent;
      });
    }
    const pinned = intent;
    let completed = await this.files.read(pinned, { signal }); owned();
    const sqlReceipt = this.store.get<TranscriptionAudioReceipt>("transcription_audio_receipt", id);
    if (sqlReceipt) invariant(completed && canonical(completed.receipt) === canonical(sqlReceipt), "TRANSCRIPTION_AUDIO_CORRUPT", "Saved preparation lost its exact durable completion");
    if (!completed) {
      owned(true);
      const currentRecipe = await this.media.describeTranscriptionAudio({ signal }); owned(true);
      invariant(canonical(currentRecipe) === canonical(pinned.recipe), "TRANSCRIPTION_AUDIO_RECIPE_CHANGED", "Incomplete preparation requires its original toolchain and bounds");
      await this.media.deriveTranscriptionAudio({ source: pinned.source, recipe: pinned.recipe }, {
        signal, assertCanStart: () => { owned(true); resolveTranscriptionAudioSource(attempt, this.sources(attempt), pinned.sourceRecord); },
        persistCompletion: async (audio, temporaryPath) => {
          // A measured completion remains useful after lease loss. Only immutable filesystem evidence is retained here.
          await this.files.install(pinned, audio, temporaryPath, { signal });
        },
      });
      owned(); completed = await this.files.read(pinned, { signal });
      invariant(completed, "TRANSCRIPTION_AUDIO_CORRUPT", "Worker did not retain its exact derivative completion");
    }
    assertTranscriptionAudioReceipt(pinned, completed.receipt);
    // Restored submission_unknown attempts may recover completed evidence, but cannot create an intent or run conversion.
    this.store.transaction(() => {
      owned(); const record = resolveTranscriptionAudioSource(attempt, this.sources(attempt), pinned.sourceRecord);
      assertTranscriptionAudioIntent(pinned, attempt, record);
      this.store.put("transcription_audio_receipt", id, attempt.projectId, completed!.receipt);
    });
    owned(); return structuredClone(completed);
  }
}
