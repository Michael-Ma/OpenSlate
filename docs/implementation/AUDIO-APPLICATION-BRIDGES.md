# Audio execution bridges

September 12, 2026. **Accepted next implementation plan; bridges are not yet connected.** This follows [audio ingestion](GENERATED-AUDIO-INGESTION.md), [transcription preparation](TRANSCRIPTION-AUDIO-PREPARATION.md) and the standalone transport contracts. It precedes [transcript candidate ingestion](TRANSCRIPT-CANDIDATES.md), because a candidate must know exactly which recording was uploaded.

Implement speech first, then transcription, then candidates. Keep activation, narration adoption and user-facing generation controls separate. All initial verification uses injected HTTP and synthetic audio; no real media API calls or API keys are needed.

## Components and identities

Add explicit `OpenAISpeechExecution` and `OpenAITranscriptionExecution` adapters using the established image bridge and execution registry. Share small receipt/authority validators where the contracts are genuinely identical; avoid a generic runner refactor. Keep each operation's mapping, dispatch and result as separate immutable entity families.

A mapping binds project/attempt, the complete admitted request digest, consumed allowance ID/digest, execution-profile digest and full profile-definition digest. The full definition includes configured cost and concurrency, beyond the transport's model/settings snapshot. Resolve it from the exact consumed allowance and retained capability lock, preserving historical bindings rather than reading current defaults. Validate same-project candidate, reservation, consumption and request identities before dispatch.

| Operation | Additional frozen mapping |
|---|---|
| Speech | Exact model, unchanged text/instructions, explicit supported voice, WAV/speed-one contract, `utf8-cap-v1`, semantic request digest and exact JSON-body hash/length |
| Transcription | Exact derivative intent/receipt IDs and digests, original source provenance, measured derivative hash/length/geometry, language, word timing, multipart semantic/body identities, parser version and limits |

The first speech configuration accepts the existing fixed transport options. No silent splitting, rewriting, trimming, voice fallback or ignored custom settings. A longer narration needs explicit later chunk planning, with exact segment-revision/chunk membership frozen before each attempt. The present byte policy is not an exact tokenizer or an acceptance guarantee.

Transcription resolves its already admitted audio input through `TranscriptionAudioService`. Read only the verified derivative store's exact bytes, under the original signal and lease. The derivative ID is an internal transport correlation ID, not a replacement canonical artifact. Freeze the parser's version/limits for deterministic later reparse; supported source-language decisions remain explicit.

## One dispatch and durable results

Capture the original cancellation signal and owner/epoch before any await. Prepare and validate input, resolve the existing host `openai-media` credential and construct the strict transport before inserting a dispatch marker. Credential values never enter mappings, results, events or backups.

Immediately before the unique dispatch marker, transactionally recheck the admitted request, reserved liability, exact consumption, original unexpired submitting lease and installation recovery fences. The marker binds the mapping, both transport hashes and the allowance. Only its winning writer may call `submit`, once, passing both expected semantic and body hashes. A mapping or credential never grants spending authority.

Save the redacted provider result and returned-byte receipt atomically before spooling. Preserve exact WAV up to 32 MiB or raw JSON up to 4 MiB, streaming chunks no larger than the output store permits. Synchronous completions use `vendorTaskId:null`; request headers are diagnostics only. Existing local spools are checked before provider code. `lookup` recovers saved observations and bytes; `poll` performs no HTTP.

A dispatch marker without a durable response, or completed response metadata whose bytes were lost, remains unknown. No inferred task ID, refund, repeated POST or new allowance can resolve it automatically. A known pre-dispatch local failure may be recorded as not dispatched; uncertain transport outcomes retain liability. Unsupported returned WAV can remain raw evidence when normalization fails. The existing transcription transport does not expose malformed response bytes, so do not claim those are preserved.

For speech, the existing normalized-audio ingester completes publication. For transcription, first complete the exact mapping/result/raw-spool chain; candidate ingestion then validates that chain and the derivative receipt before publishing an unreviewed raw data artifact/candidate. Until that ingester ships, retained JSON is incomplete local processing, not accepted narration.

## Recovery and verification

Add narrow Store and backup closure validation for the new immutable records. Preserve historical profiles and raw/derived source closure. Quarantine blocks application work. After release, imported attempts may recover existing local results; they permanently cannot make a first POST or create missing pre-submit preparation. Completed recovery must work with unavailable credentials/transports/tools where no new local conversion is needed.

Verify actual Engine admission with configured fixture estimates, one-use consumption and exact request/profile binding. Test duplicate workers, original lease loss/replacement, pre/post-marker cancellation, secret redaction, missing/changed inputs, response loss, receipt/spool/SQL failure, conflicting winners and restart. Speech needs an injected transport → real normalization → SQL rollback/reopen proof. Transcription needs exact multipart upload-byte comparison and derivative/result recovery before candidate ingestion. Include restoration fences and immutable closure checks. Reported usage and fixture estimates are not actual billing or verified live provider prices.
