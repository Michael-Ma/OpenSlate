# Generated audio ingestion and transcript candidates

September 12, 2026. **Accepted plan; first ingestion slice is next.** File names are repository-relative. Proposed APIs below are not yet implemented; standalone transports are already verified offline. The accepted transport brief supplies protocol details, with the corrected speech policy name `utf8-cap-v1`: it is a host byte restriction, not an exact tokenizer or provider-acceptance guarantee.

## Smallest independently shippable slice

First ship **durable raw audio/data spools and normalized generated-audio artifacts**, exercised with injected transport results. Reuse the existing Engine attempt, output-slot and leased ingestion machinery. Do not register speech/ASR adapters in the launcher, change the installed profile catalog, create HTTP/tools, bind narration segments or mark application synthesis/transcription available. A verified playable artifact is a useful completed boundary without claiming a working narration-generation workflow.

Follow with the **16 kHz transcription-input derivative and unreviewed transcript candidate** slice. Human adoption and paid application bridges are subsequent work. Separating these keeps first delivery independent of narration editing, chunk orchestration, new spending UI and transcript acceptance.

```mermaid
flowchart LR
  Attempt[Previously admitted exact attempt] --> Raw[Raw receipt / winning spool]
  Raw --> Audio[48 kHz stereo audio + provenance]
  Audio --> Derivative[16 kHz mono derivative + source mapping]
  Derivative --> ASR[Future separately admitted transcription]
  ASR --> JSON[Raw JSON receipt / winning spool]
  JSON --> Candidate[Unreviewed transcript + sample mapping]
  Audio --> Human[Human script / recording / timing review]
  Candidate --> Human
  Human --> Canonical[Reviewed canonical narration]
```

The diagram shows future integration, not authorization to execute these stages automatically.

## Existing seams and exact file changes

| File | Additive responsibility |
|---|---|
| `packages/providers/src/execution.ts` | Extend V2 spool descriptors with `speech → port:audio, kind:audio, audio/wav, wav` and `transcription → port:cues, kind:data, application/json, json`. Share the exact request-kind/output-role mapping with storage; preserve existing image/video envelopes and all legacy inline fake bytes/digests. |
| `apps/server/src/execution/output-store.ts` | Extend receipt/spool/slot role unions and per-kind caps. Replace request-kind/output-kind equality and image/video-only recovery branches with the shared mapping. Audio/data support **returned bytes only** initially; do not add locator downloading. Keep receipt/manifest/slot IDs and existing V1 storage formats unchanged for existing roles. |
| `media/types.ts`, `media/local-media.ts` | Add `describeAudioNormalization()` returning its own recipe identity. Keep `describeNormalization()` and its video recipe/legacy descriptors unchanged; reuse `importMedia({kind:"audio"})` with detached inputs and captured signal. Retain the shared one-operation worker bound. The ingester owns its durable keyed completion index. |
| New `execution/audio-derivation.ts`, `execution/spool-audio-ingester.ts` | Pin raw slot → normalization intent → verified completion; return a tagged `normalized_audio` result carrying artifact, derivation receipt and generated media source. |
| New `media/managed-audio.ts` | Install an exact verified normalized WAV under `artifacts/<project>/<sha>.wav`, with streamed hash, no-follow checks, exclusive publication, fsync and original-signal handling. Reuse the physical copying pattern, not `installNarrationAudio`'s human-origin return value. Avoid refactoring the existing human path in the first slice. |
| `execution/engine.ts`, `execution/ingestion-router.ts`, `media/application-types.ts` | Optional explicit audio handler; `ArtifactRecord.origin:"generated_audio"`; tagged derivation validation allows normalized hash to differ from raw hash only with the exact verified linkage. Publish artifact, derivation receipt and `media_source` atomically before attempt completion. Default fixtures remain unchanged; no fallback for unsupported real audio/data. |
| `persistence/store.ts` | Immutable `audio_derivation_intent` / `audio_derivation_receipt`, same-project attempt/slot/artifact references, exact raw/normalized identities and generated `media_source` checks. Entity-family additions need no new table migration. |
| `persistence/installation-backup.ts`, `installation-backup-closure.ts` | Include the published `audio-derivations/completions` namespace and filesystem-only audio completions. Add derivative/transcript namespaces only when their actual producers and closure contracts ship. Validate new raw-role and derivation closure rather than merely copying unknown files. |

Current `LocalMediaService.importMedia({kind:"audio"})` already preserves original bytes at `media/blobs/<rawSha>.source`, installs decoded 48 kHz stereo PCM WAV plus `media/sources/<descriptorId>.json`, and verifies duration. Its public recipe descriptor and attempt-keyed outer completion index are currently video-specific. Its general 0.1-second compressed-audio tolerance is not a license to trim the new narrow PCM transcription derivative.

## Raw receipt and restart contract

The future bridge persists its exact application request/profile, transport request digest, wire-body hash and one-POST marker **before** dispatch, under the original owner/epoch fence. These are separate from this storage-only slice. Registration, credentials and returned correlation IDs never supply spending authority.

For both synchronous audio operations, use `vendorTaskId:null`; a bounded vendor request header is diagnostic only. Store the speech WAV or exact transcription JSON response bytes under the existing `execution-output/blobs/<sha>.blob`. The semantic transcript projection has a different digest from raw JSON. Never spool the normalized projection while calling its hash the raw response hash.

Persist `execution_output_receipt` with admitted attempt ID, full application request digest, exact role, execution identity and returned-byte hash/length. Then stream bytes, fsync the immutable blob, publish its manifest, claim the first `(project,attempt,port)` slot, and install SQL spool/slot records. Matching later observations may refer to the same bytes; different bytes cannot replace the winner. Late observations may preserve evidence after lease loss but cannot select a current result.

Restart checks the winning local slot before provider code. Blob/manifest/slot recovery must work after SQL publication failure. A receipt without recoverable bytes is still an uncertain synchronous result; it cannot trigger another POST, lookup by diagnostic request ID, refund or replacement generation. Reject request/role/hash mismatches and conflicting winners explicitly. Completed JSON is stored privately and never interpreted as instructions.

## Normalized generated audio and provenance

Proposed essential records (IDs/digests computed by the application):

```ts
interface AudioDerivationIntent {
  id: string; version: 1; projectId: string; attemptId: string;
  requestDigest: string; slotId: string; spoolId: string;
  rawSha256: string; rawByteLength: number; artifactId: string;
  rawPcm: { sampleRate: number; channels: 1 | 2; sampleCount: number; bitsPerSample: 16 };
  normalization: {
    version: 1; recipe: "pcm-s16le-48khz-stereo-v1";
    toolchainDigest: string; maxInputBytes: number;
    maxOutputBytes: number; maxSamples: number; timeoutMs: number;
  };
}
interface AudioDerivationReceipt {
  id: string; version: 1; projectId: string; attemptId: string;
  intentDigest: string; source: SuppliedMedia;
  normalizedSamples: number;
  // Difference in 48 kHz samples, expressed exactly over rawPcm.sampleRate.
  endpointDeltaNumerator: number;
}
```

Derivation ID is the digest of version/kind plus the exact winning audio slot. Artifact ID derives from that identity, not caller-chosen text. The intent pins the whole existing frozen attempt request; that request already contains exact speech text/voice/settings and profile. A later narration bridge must additionally freeze exact segment-revision/chunk membership before admission; mutable “current narration” must never define old generated provenance.

The first generated-audio path accepts complete PCM16 RIFF/WAVE only. Validate the exact raw hash, one unambiguous format/data region, positive sample count, mono/stereo channels and a supported sample-rate allowlist before conversion. The initial rates are 8, 16, 22.05, 24, 32, 44.1, 48 and 96 kHz. Unsupported, unknown-length or malformed paid outputs remain raw evidence with a local diagnostic; they do not cause another provider call. Pin the raw geometry in the intent, rather than inferring it from normalized output.

The shared worker defaults to a 256 MiB output cap. Record its actual configured limit in `describeAudioNormalization` and the intent; do not claim a 128 MiB worker bound without enforcing a real per-call override. A valid 360-second 48 kHz stereo PCM result contains at most 69,120,000 sample bytes. Before conversion, compare its expected full sample size plus a bounded header allowance with the actual cap and reject an insufficient limit. After conversion still verify exact measured samples, file size and endpoint difference. The existing human importer's 0.1-second tolerance cannot establish completeness for generated speech: equal-rate conversion requires the exact sample count; resampling needs a narrow, versioned rational endpoint allowance demonstrated by fixtures. No normalization, silence trimming or tempo change is added.

Verify full decode, positive measured samples, 48 kHz, two channels, `pcm_s16le`, no video, duration ≤360 seconds, raw original hash/length, normalized hash/length, descriptor digest and toolchain. No volume leveling, silence trimming, tempo change or invented word timing. Pin the exact FFmpeg normalization recipe and binary/version identity used by the worker. Record decoding duration/sample differences; a transport header is not evidence of playable duration.

Use `audio-derivations/completions/<intentId>.json` before SQL artifact publication, matching the existing video ingester boundary. Once this verified completion exists, restart reuses it even if the current toolchain changed; incomplete work may run only the pinned recipe/toolchain. Corrupt completed files fail closed rather than being overwritten or silently recreated. A crash between normalization and completion-index publication may repeat the **local** conversion under the same intent; it never repeats a provider call. Do not claim zero retranscodes across that earlier gap. Keyed source-descriptor recovery can be a later optimization rather than expanding this first slice.

The resulting artifact/media source records retain `origin:"generated_audio"`, real `attemptId`, raw receipt/spool IDs, derivation ID, source descriptor ID and measured duration. The Engine validates both raw and normalized hashes and commits all related SQL rows together. An obsolete plan or edit may retain historical evidence; it must not auto-bind a narration segment, change acceptance or become a fresh take. Missing tools/`MEDIA_BUSY` preserve the paid result and defer local work without consuming another allowance. Extend only Engine's existing known-local `MEDIA_BUSY` lease-release branch to the exact validated V2 audio/WAV completion; preserve phase, evidence, reservation and original owner/epoch. This is not permission to release leases on arbitrary errors or retry remote calls. Raw data spools have no default ingester until transcript candidates are implemented.

## Same-source 48 kHz →16 kHz derivative

The next slice adds `media/transcription-audio.ts` and `narration/transcription-records.ts`. Resolve a same-project owned audio source by ID and verify its descriptor and bytes; neither transport nor model supplies a filesystem path. Reuse a generated source or a human-supplied source identically after ownership checks.

`TranscriptionAudioIntent` pins source artifact/descriptor IDs, SHA, byte length, `sampleRate:48000`, `channels:2`, measured sample count, **complete range** `[0,sourceSamples)`, recipe/toolchain/limits. `TranscriptionAudioReceipt` pins intent digest, derivative hash/length, `sampleRate:16000`, `channels:1`, `pcm_s16le`, actual decoded sample count and `endDelta48kSamples = derivativeSamples*3-sourceSamples`.

Use an explicit fixed downmix (`0.5*left + 0.5*right`), pinned 48→16 kHz resampling and PCM16 encoding; preserve leading/intermediate/trailing silence and the entire source. No crop, concatenation, loudness normalization or tempo filter. Store a separate derivative WAV and completion at `audio-derivatives/blobs/<sha>.wav` and `audio-derivatives/completions/<intentId>.json`; do not label it a normal 48 kHz `SuppliedMedia`. First policy may reject endpoint differences exceeding one 16 kHz sample (three 48 kHz samples), but must record the actual difference and validate the chosen resampler fixtures rather than claim all counts are perfectly divisible by three.

Keep its own durable intent/completion and shared-worker ownership. Hash recipe/toolchain together with exact source range; old completion reuse is verified without requiring a current executable match. A transcript attempt freezes this receipt identity and exact uploaded derivative hash **before** its one POST. Complete-source-only mapping avoids seeking, offsets and chunk joins in v1. Six minutes of 48 kHz stereo PCM is about 69.12 MB of samples; the derivative is about 11.52 MB, plus WAV headers.

## Transcript candidates, not human cues

Add `narration/transcript-candidate.ts` and optionally `execution/spool-transcript-ingester.ts` after derivative support. Parse the exact winning raw JSON through the same versioned pure parser used by the transport. Bind `TranscriptCandidate` to attempt/request/raw-spool IDs, parser version, exact derivative receipt, source descriptor/hash, raw-response hash and a separately hashed detached text/word projection. Store original word seconds, mapped source-local sample intervals and explicit timing issues. Never derive application source identity from an ASR response field.

Map each absolute timestamp once with `seconds-to-48k-half-up-v1` (`floor(seconds*48000+0.5)` for finite nonnegative bounded seconds). The derivative and source share the same time origin; do not first round to a 16 kHz integer and then multiply, stretch timestamps to force endpoint equality, clamp to source bounds or add project `atSample`. Preserve out-of-range, overlapping and nonmonotone timings as candidate issues requiring review. No confidence is invented. Empty text/words is a completed no-speech candidate, never automatic retry permission.

The existing compiler's `cues` output port is only a data-artifact role: it must not create accepted `NarrationCue` records. Keep the raw JSON artifact's exact hash; candidate projection rows refer to that artifact and carry their own digest. If a tagged Engine result bundles the candidate, validate and publish its immutable row atomically with the artifact. Large raw responses stay private; future context/UI projections must page candidates rather than exceeding the current context budget. Transcript text limits also do not waive the separate 16,000-character canonical narration limit.

Human integration is deliberately later. Preserve historical `NarrationAudio` rows and `declaredOrigin` bytes. Add a distinct generated-provenance variant referencing the verified attempt/derivation instead of inventing a human `requestId` or treating `declaredOrigin:"generated"` as provider evidence. Resolve source choice through the variant. Human binding still requires current request/scope/version and exact source selection. Update `narration/canonical-types.ts` and `canonical.ts` to retain that provenance branch; today canonical provenance always says `human_declared_supplied_recording`. Reuse and verify an already generated artifact rather than relabeling its record as `attemptId:null`. Current canonical code already avoids replacing an existing matching artifact, but its provenance/type construction still needs the explicit branch.

A future explicit human “use these timings” command may create new `method:"human"` cues, with an audit link to selected candidate words/edits and exact source/script revisions. Script, recording and timing acceptance remain separate exact decisions. Existing accepted segments/cues stay unchanged; stale candidates are historical suggestions. No model callback silently adopts a transcript or turns its timestamps into acoustic forced alignment.

## Recovery, bounds and tests

Every worker checks the installation recovery guard and captured original signal; application mutations use current project/request/lease checks before and after awaits. While quarantined, no new conversion, parser publication or provider call runs. After human release, imported attempts may recover their **existing raw bytes** and local derivatives; `assertFirstSubmit` permanently denies a first audio POST using imported attempts/candidates/grants/allowances. Unknown synchronous submissions remain unknown. Evidence records are not authority; any new derivative or adoption request must bind existing fenced authority appropriately or require a fresh human request. Do not introduce an unfenced side ledger that can start paid work.

Include `audio-derivations/completions`, derivative blobs/completions and any private transcript projection files in same-root backup/inspection/restore closure from their first shipped slice. Preserve filesystem-only completions when SQL failed. Keep temporary files, uploads and credentials excluded. A restored completed artifact/candidate retains exact provenance and hashes but grants no new work.

Initial lowerable hard limits: raw speech 32 MiB; raw transcription JSON 4 MiB; normalization uses the actual configured shared-worker output cap, at most 256 MiB; ≤17,280,000 source samples (360 s at 48 kHz); derivative ≤25,000,000 bytes and ≤5,760,000 samples; transcript text ≤256 KiB, ≤8,192 words, ≤1,024 UTF-8 bytes/word; 32 KiB derivation metadata excluding transcript content. Reuse ≤1 MiB streamed copy/hash chunks, two output-store writers and one local conversion at a time. Conversion deadline ≤120 seconds initially; retain existing local media resource checks and account for raw/normalized/derivative/temp copies; no installation disk-quota guarantee is added. Strict local paths/protocol allowlists, fixed argument arrays, bounded output and no inherited credentials remain mandatory. These are host restrictions, not provider capabilities or performance guarantees.

Focused offline verification:

1. Audio/data role mapping, exact null-task completion, forged role/hash/project rejection, first-slot conflict and historical fake/image/video digest compatibility.
2. Crash at blob/manifest/slot/SQL publication boundaries; restart from each durable point with zero HTTP calls. Missing raw bytes stay unresolved; no refund or automatic retry.
3. A deliberately lowered output cap that could truncate less than 0.1 seconds must never produce an accepted prefix. Verify equal-rate exact samples, non-integer resampling endpoints, raw probe identity and completion reuse after toolchain changes. Real synthetic PCM at different input rates/channels, full decode and silence preservation; exact raw versus normalized hashes, measured samples and recipe/toolchain binding. Short/header-only/oversized media and truncated normalization fail explicitly.
4. Normalized completion followed by SQL rollback, restart without transcode; original-signal mutation, late cleanup abort, lease theft, held/stale plan and shared-worker busy preserve receipts without selecting stale work.
5. Stereo channel-distinct impulse/tone/silence fixture through 16 kHz derivative: decode exact format, downmix behavior, same-origin mapping, endpoint differences, non-divisible source lengths and no source replacement.
6. Raw JSON versus semantic digest; empty/no-speech, malformed words, out-of-range/overlap/nonmonotone timing and one-round boundary cases. Assert no cue/acceptance/canonical changes and no generated-provenance inference from a human label.
7. Backup/restore with filesystem-only audio completion and pending transcript candidate: read-only quarantine, known local-result recovery after release, imported first-POST denial, fresh human adoption isolation and unchanged uncertain liabilities.

Do not update the director's unavailable speech/transcription capability facts merely because these storage workers or standalone transports exist. A complete, reviewed application workflow and host readiness remain separate prerequisites.
