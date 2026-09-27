# Audio execution bridges

Both application bridges are implemented and composed into the opt-in local runtime. See [speech execution](OPENAI-SPEECH-EXECUTION.md), [transcription execution](OPENAI-TRANSCRIPTION-EXECUTION.md), and [conversational audio](CONVERSATIONAL-AUDIO.md). The contract discussion below records the original adapter design; live-provider acceptance is tracked in [status](STATUS.md).

## Components and identities

Add explicit `OpenAISpeechExecution` and `OpenAITranscriptionExecution` adapters using the established image bridge and execution registry. Share small receipt/authority validators where the contracts are genuinely identical; avoid a generic runner refactor. Keep each operation's mapping, dispatch and result as separate immutable entity families.

A mapping binds project/attempt, the complete admitted request digest, consumed allowance ID/digest, execution-profile digest and full profile-definition digest. The full definition includes configured cost and concurrency, beyond the transport's model/settings snapshot. Resolve it from the exact consumed allowance and retained capability lock, preserving historical bindings rather than reading current defaults. Validate same-project candidate, reservation, consumption and request identities before dispatch.

An allowance ID alone is insufficient: require its actual `external_allowance_consumption` row. Match profile unit cost, consumption estimate and reservation amount exactly. Consumption does not retain a capability-lock ID, so matching a retained lock proves the approved definition, not which historical lock originally supplied it. Pin the chosen matching lock ID/digest and full profile in the new mapping. Prefer a current exact match, use a bounded historical search only when creating the mapping, and use keyed pinned evidence on replay. Existing expiry/revocation semantics stop future admissions; they do not refund or retroactively cancel already consumed work. A first POST requires reserved liability, while historical replay may verify charged/released reservations.

| Operation | Additional frozen mapping |
|---|---|
| Speech | Exact model, unchanged text/instructions, explicit supported voice, WAV/speed-one contract, `utf8-cap-v1`, semantic request digest and exact JSON-body hash/length |
| Transcription | Exact derivative intent/receipt IDs and digests, original source provenance, measured derivative hash/length/geometry, language, word timing, multipart semantic/body identities, parser version and limits |

The first speech configuration accepts the existing fixed transport options. No silent splitting, rewriting, trimming, voice fallback or ignored custom settings. A longer narration needs explicit later chunk planning, with exact segment-revision/chunk membership frozen before each attempt. The present byte policy is not an exact tokenizer or an acceptance guarantee.

Transcription resolves its already admitted audio input through `TranscriptionAudioService`. Read only the verified derivative store's exact bytes, under the original signal and lease. The derivative ID is an internal transport correlation ID, not a replacement canonical artifact. Freeze the parser's version/limits for deterministic later reparse; supported source-language decisions remain explicit.

The first transcription profile is `{model:"whisper-1",settings:{}}`, with empty operation settings and explicit `timing:"word"`. Preserve the existing compiler's historical `timing:"segment"` default; unsupported timing fails before HTTP. Map the existing explicit `language:"auto"` value to the transport's `null`, while retaining both application and transport identities. Do not change legacy plan fingerprints to accommodate this adapter.

Freeze `preparation:{intentId,intentDigest,receiptId,receiptDigest}`, original source record/descriptor/hash/sample count/full range, measured derivative geometry/hash/length and the exact multipart description. A private derivative-store read returns only verified owned bytes and receipt to the host, with no-follow access, exact size/hash checks, the original signal and a maximum of the smaller recipe limit and 25,000,000 bytes.

Pin parser adapter/version plus the concrete limits: 4 MiB raw response, 256 KiB transcript text, 8,192 words and 1,024 bytes per word. Keep the execution result small: raw receipt/hash/length, parser/result digest, bounded reported model/usage and summary counts. Full text/words are deterministically reparsed from exact raw JSON during later ingestion; they do not belong in the bridge's bounded metadata record.

## One dispatch and durable results

Capture the original cancellation signal and owner/epoch before any await. Prepare and validate input, resolve the existing host `openai-media` credential and construct the strict transport before inserting a dispatch marker. Credential values never enter mappings, results, events or backups.

Immediately before the unique dispatch marker, transactionally recheck the admitted request, reserved liability, exact consumption, original unexpired submitting lease and installation recovery fences. The marker binds the mapping, both transport hashes and the allowance. Only its winning writer may call `submit`, once, passing both expected semantic and body hashes. A mapping or credential never grants spending authority.

Save the redacted provider result and returned-byte receipt atomically before spooling. Preserve exact WAV up to 32 MiB or raw JSON up to 4 MiB, streaming chunks no larger than the output store permits. Synchronous completions use `vendorTaskId:null`; request headers are diagnostics only. Existing local spools are checked before provider code. `lookup` recovers saved observations and bytes; `poll` performs no HTTP.

A dispatch marker without a durable response, or completed response metadata whose bytes were lost, remains unknown. No inferred task ID, refund, repeated POST or new allowance can resolve it automatically. A known pre-dispatch local failure may be recorded as not dispatched; uncertain transport outcomes retain liability. Unsupported returned WAV can remain raw evidence when normalization fails. The existing transcription transport does not expose malformed response bytes, so do not claim those are preserved.

Local pre-marker failure publication also requires the original current lease. An obsolete worker must not install a terminal not-dispatched decision after awaiting preparation and preempt its replacement. This differs from an actual provider response after the irreversible POST, which may be retained as late evidence without selecting current work. Do not copy an unfenced local-failure path from another adapter.

For speech, the existing normalized-audio ingester completes publication. For transcription, first complete the exact mapping/result/raw-spool chain; candidate ingestion then validates that chain and the derivative receipt before publishing an unreviewed raw data artifact/candidate. Retained JSON alone is not accepted narration; the implemented candidate ingester and separate human adoption preserve this boundary.

Engine may recover a winning raw spool before calling provider lookup. Therefore each new adapter's ingester must independently validate the exact admission/mapping/dispatch/result-to-winning-receipt chain before conversion or publication. Matching bytes alone cannot substitute another receipt. Backup and published derivation closure preserve the same link. This constraint is specific to the new adapter contracts and does not reinterpret legacy fixture identities.

## Recovery and verification

Add narrow Store and backup closure validation for the new immutable records. Preserve historical profiles and raw/derived source closure. Quarantine blocks application work. After release, imported attempts may recover existing local results; they permanently cannot make a first POST or create missing pre-submit preparation. Completed recovery must work with unavailable credentials/transports/tools where no new local conversion is needed.

Transcription replay reads keyed pinned preparation records and existing derivative/output evidence. It must not call `TranscriptionAudioService.prepare()` for a completed historical result: that service requires an active preparation lease and may need permission for missing local conversion. Completed evidence does not acquire those permissions merely because a provider bridge is reopened.

In the initial bridge, an owned pre-marker preparation failure, including shared-worker contention, is a definite local `not_dispatched` outcome. Reservation settlement follows that outcome; consumed allowance-start capacity stays consumed and no automatic new attempt is permitted. Do not call it an uncertain submission merely to retry local preparation: existing unknown reconciliation does not grant permission to create a missing derivative. Transparent pre-dispatch deferral requires a separate explicit Engine protocol before concurrent activated narration batches rely on it.

The first actual Engine fixture can consume generated speech output or canonical accepted audio. A draft imported `NarrationAudio` is not automatically a compiler-visible project artifact. Exposing unaccepted recording selection in application planning belongs to later narration integration; tests must not claim it is already wired.

Verify actual Engine admission with configured fixture estimates, one-use consumption and exact request/profile binding. Test duplicate workers, original lease loss/replacement, pre/post-marker cancellation, secret redaction, missing/changed inputs, response loss, receipt/spool/SQL failure, conflicting winners and restart. Speech needs an injected transport → real normalization → SQL rollback/reopen proof. Transcription needs exact multipart upload-byte comparison and derivative/result recovery before candidate ingestion. Include restoration fences and immutable closure checks. Reported usage and fixture estimates are not actual billing or verified live provider prices.
