# Unreviewed transcript candidates

September 12, 2026. **Follow-on implementation plan.** The transport parser and source-sample mapping helpers are verified alongside [owned transcription audio](TRANSCRIPTION-AUDIO-PREPARATION.md). Candidate persistence and Engine ingestion follow [exact audio execution mapping](AUDIO-APPLICATION-BRIDGES.md); human adoption and activation remain subsequent work.

A transcript is evidence about one exact recording. It cannot prove that the user accepted its wording, that its timestamps are accurate, or that it aligns an already written script. Preserve those distinctions through the data model and later UI.

## Data boundary

The first parser handles the OpenAI `whisper-1` verbose JSON word response. Expose its existing projection version and pure parser from the provider package, preserving transport result hashes. Other adapters can supply their own versioned response parser and the same provider-neutral timed-word input. Do not interpret arbitrary JSON as a transcript merely because its output port is named `cues`.

Persist the winning raw JSON spool unchanged. A candidate binds project/attempt/full request digest, raw receipt and spool IDs/hash/length, exact transcription-input derivative receipt/digest, complete original source descriptor/hash, parser identity/version, semantic transcript digest and source-sample mapping policy. The raw data artifact's hash is the raw response hash; candidate projection identity is separate. A vendor response cannot select these application identities.

The later application bridge must persist the exact derivative/wire request mapping before its one-use dispatch marker. Candidate ingestion must verify that mapping against the admitted attempt and saved derivative, rather than infer what was uploaded from a matching response shape. The standalone parser and a prepared derivative do not supply that missing dispatch evidence.

Keep candidates immutable and unreviewed. SQL publication of the raw data artifact and candidate must be atomic under the current original ingestion lease, while the spool remains recoverable if SQL fails. Add an explicit data ingester only for a supported exact parser/adapter contract. No default JSON-to-cue conversion. A successful candidate may have no speech or unresolved timing issues; neither is automatic retry permission.

## Timing algorithm

`mapTranscriptWordSamples` uses the provider-neutral policy `seconds-to-48k-half-up-v1`. It maps each original timestamp exactly once with `floor(seconds * 48000 + 0.5)`. The derivative and full source have the same time origin. Never first round to 16 kHz, add project placement, stretch for endpoint differences, clamp to source duration or sort provider words.

The projection keeps original text and seconds, nullable source-local integer coordinates and explicit issue codes. Numbers beyond safe integer mapping retain their raw finite seconds and receive `unsafe_sample_coordinate`; no invented coordinate replaces them. A timestamp past the source endpoint receives `source_range_exceeded` even when integer rounding happens to land on the endpoint. Zero/sub-sample intervals, nested overlaps and nonmonotone order remain visible. Preserve the parser's separate issues, including transcript/word text mismatch and reported duration. Do not invent confidence or label this forced alignment.

The mapper accepts at most 8,192 words of at most 1,024 UTF-8 bytes and a measured positive source duration of at most six minutes. Its output is a suggestion, not `NarrationCue` or canonical state. The five initial helper checks cover one-round fractional boundaries, six-minute endpoint behavior, nested overlap, unsafe numbers and malformed/no-speech inputs. Full candidate/adoption integration needs its own verification.

## Human review and later integration

A paged candidate view should show recording identity, unedited transcript, timing issues and stale-source status. Let the user edit wording and choose exact words/ranges to use. Applying a selection needs a fresh current narration request, expected narration version and exact source/script revisions. It creates new human-selected cues with an audit link to the candidate; script, recording and timing acceptance remain independent. Accepted existing segments remain untouched unless explicitly changed.

This integration must also preserve generated-audio provenance. Historical `NarrationAudio.declaredOrigin` is a human label for a supplied recording. Add a separate verified generated-source variant; never replace provider/derivation evidence with an invented upload request. Canonical provenance must carry that variant through narration-only and scoped shot changes.

Include all actual candidate records/files in backup closure from their first shipped slice. Restored candidates stay historical suggestions and grant no new paid submission or adoption. Verify exact raw/semantic identities, forged source/dispatch rejection, SQL failure/reopen, quarantine/restore, empty speech, difficult timestamps, stale selection and unchanged human acceptance before exposing this path in tools or the browser.
