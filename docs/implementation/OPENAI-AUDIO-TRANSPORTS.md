# OpenAI audio transports

September 12, 2026. **Accepted implementation plan; transports are in progress.** This document does not establish account access, live audio generation or an enabled application workflow. Protocol facts were checked against the linked official documentation.

## First slice

Add two standalone, injected-HTTP transports in `packages/providers`: OpenAI speech generation and timestamp transcription. Follow the separation already used by `OpenAIImageAdapter`: a pure request description, one bounded POST, a sanitized receipt and a discriminated outcome. They do not implement or register `ExecutionProvider`, create application attempts, obtain allowances, write files or change narration.

Use explicit `gpt-4o-mini-tts` / `gpt-4o-mini-tts-2025-12-15` speech identities and `whisper-1` timestamp transcription. Export a recommended pinned speech snapshot constant, but never rewrite an explicitly requested alias into that snapshot or silently switch models. Built-in voices only. No prices, automatic retry, custom voices, realtime sessions, Files API, arbitrary endpoints, remote URL inputs, forced alignment or creative regeneration in this slice.

```mermaid
flowchart LR
  App[Future leased application operation] --> Describe[Pure exact request description]
  Describe --> Admit[Persist request, allowance and dispatch marker]
  Admit --> Transport[One injected HTTP POST]
  Transport --> Raw[Bounded WAV or timestamp result]
  Raw --> Own[Future durable raw-output receipt]
  Own --> Normalize[Local decode or timestamp mapping]
  Normalize --> Review[Draft narration and human acceptance]
```

Only the description and transport boxes are implementation scope now. The diagram's application boxes are prerequisites for later app activation, not a new direct service route.

## Verified protocol inputs

- Speech is `POST https://api.openai.com/v1/audio/speech`. The request reference caps `input` at 4,096 characters and supports built-in voices, delivery instructions, WAV and the ordinary audio response stream. Pin `response_format:"wav"`, `stream_format:"audio"` and `speed:1` in the first transport. Do not add an undocumented language field. [Speech request reference](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create)
- The chosen speech model separately documents a 2,000-input-token maximum and the alias/snapshot above. The fetched model page does not specify its exact tokenizer or internal prompt overhead. [TTS model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)
- File transcription accepts uploads up to 25 MB. The current guide still explicitly selects `whisper-1` for word/segment timestamps and demonstrates `response_format:"verbose_json"`, `timestamp_granularities:["word"]`. Its newer recommended general transcription model is not a reason to change the selected timing contract. [File transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text)
- Use `POST https://api.openai.com/v1/audio/transcriptions`, multipart file bytes with an extension-bearing filename and appropriate MIME. Pin `model:"whisper-1"`, `response_format:"verbose_json"` and the word granularity; optional ISO-639-1 language is an explicit request choice. Omit prompting, sampling controls, chunking, streaming and speaker options in v1. [Transcription reference](https://developers.openai.com/api/reference/cli/resources/audio/subresources/transcriptions/methods/create)
- Later generated-audio review must identify the voice as generated; preserve that fact in export provenance. [Speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)

## Exact proposed contracts

These are target contracts; final exported names and verification will be recorded when implementation is complete. Both constructors take trusted `apiKey`, optional injected `fetch`, and limits that may only lower fixed maximums. Invalid credentials/options fail before transport use; keys remain private fields and never enter a description or receipt.

```ts
interface AudioSubmitContext {
  attemptId: string;
  expectedRequestDigest: string;
  expectedBodySha256: string;
  signal?: AbortSignal;
}
interface AudioTransportReceipt {
  adapter: "openai-speech-v1" | "openai-transcription-v1";
  attemptId: string;
  requestDigest: string;
  bodySha256: string;
  requestedModel: string;
  requestId: string | null; // bounded x-request-id diagnostic, never a task ID
  httpStatus: number | null;
}
type AudioTransportOutcome<T> =
  | { kind: "completed"; receipt: AudioTransportReceipt;
      reportedModel: string | null; result: T }
  | { kind: "rejected"; certainty: "not_accepted";
      source: "local" | "provider"; code: string;
      receipt: AudioTransportReceipt; retryAfterMs: number | null }
  | { kind: "unknown"; code: string; receipt: AudioTransportReceipt;
      retryAfterMs: number | null };
```

Speech request: exact model, nonempty well-formed Unicode text, built-in voice and explicit instructions string (empty is valid). Description includes adapter version, exact settings, text/instructions hashes and byte counts, request digest, body digest and budget-policy version. No prompt trimming, Unicode normalization or silent text splitting. A pure `describeOpenAISpeechRequest` and `OpenAISpeechAdapter.submit` use the same serializer. Speech result is `{ bytes, sha256, byteLength, mimeType:"audio/wav", extension:"wav", fixture:false }`; no claimed measured duration, sample count or resolved model when undisclosed. Byte hashing proves transport identity, not usable audio.

Transcription request: exact model, language `null | ISO-639-1`, required timing `"word"`, and `{ artifactId, sha256, mimeType:"audio/wav", bytes }` for the provider-input derivative. The adapter verifies and copies these bytes; `artifactId` is correlation, not proof of application ownership. The future application must resolve it through owned storage. Description records the exact derivative hash/length, waveform properties validated from its PCM header, settings, request digest and body digest. It does not pretend the uploaded derivative hash is the normalized 48 kHz narration source hash.

Transcription result should retain bounded raw response bytes plus `rawResponseSha256`, and a detached normalized projection: `{ text, reportedLanguage, reportedDurationSeconds, words:[{word,startSeconds,endSeconds}], timingIssues, resultDigest }`. Hash the result projection separately from raw JSON bytes. Missing usage remains `null`; neither duration nor the absence of usage establishes a monetary charge. Retain only explicitly supported, bounded usage fields if present; do not infer zero billing.

## Request identity and multipart

1. Validate plain exact-key request/context objects, bounded IDs and hashes; snapshot strings, byte arrays, limits, attempt identity and the original abort signal before the first await. No caller `toJSON`, getters from nonplain objects, path values or later buffer mutation may change sent identity.
2. Compute a versioned canonical semantic digest over the exact supported request, including input artifact ID/hash/length. Credentials and incidental HTTP headers are excluded. Distinguish this digest from the full application request/profile digest.
3. For speech, hash the actual UTF-8 JSON body. For transcription, use a fixed-order, bounded multipart encoder with filename `audio.wav`; derive its boundary deterministically from the semantic digest. Check for boundary collision in all parts before dispatch, with deterministic bounded suffix selection if necessary. Hash the exact encoded body and include the multipart content type in the description. Do not claim an arbitrary `FormData` boundary has reproducible wire bytes.
4. `submit` reconstructs the owned snapshot and checks both expected digests before touching fetch. The future application persists both plus its own frozen request/profile and derivative mapping. Exact-body validation is a transport responsibility; SQL cannot reconstruct it from an audio hash alone.
5. One POST with `redirect:"error"`. No retrying SDK or invisible preliminary upload. A client correlation value is not provider idempotency support. The transport has no durable single-use ledger; the future application dispatch marker supplies that boundary.

## Speech text budget

Use a deliberately smaller, documented first-version host policy rather than `characters / 4` or a model-authored token count:

- Enforce `input.length <= 4096` in UTF-16 code units after rejecting ill-formed surrogate sequences. This is conservative for Unicode scalar characters.
- Limit instructions to 256 UTF-8 bytes, and the sum of UTF-8 bytes for input, instructions, voice and model to **1,792 bytes**. The description names `utf8-cap-v1` and records exact counts. This is a conservative first-version host byte cap, not an exact token measurement or guaranteed vendor acceptance.
- The fetched official sources do not establish this hosted model's exact tokenizer or internal prompt overhead. Do not claim a proven token upper bound or a specific amount of token headroom from the byte restriction.
- Before widening this policy, verify model/tokenizer conformance with multilingual and instruction-heavy fixtures. Any provider token-limit rejection is definite only when its envelope meets the rejection rules below; never split or retry paid text automatically after dispatch.

This restriction is useful offline now and needs no user decision. Later chunk planning packs compatible whole sentences into the budget before allowance review, preserving exact segment membership. A longer script is multiple separately authorized chunks; the transport itself never buys those chunks.

## Transcription input derivative and timestamps

Accept only a narrow first input format: complete little-endian PCM signed-16, 16 kHz, mono RIFF/WAVE, with structurally consistent `fmt`/`data` sizes, bounded ancillary chunks, positive sample count and at most 360 seconds. Reject compressed, multichannel, malformed and unknown-length input variants before HTTP. This is a host subset, not a claim that the API supports only this format. Use an absolute file bound of **25,000,000 bytes**, no larger than either interpretation of the documented 25 MB limit.

The existing local media service normalizes working audio to 48 kHz stereo PCM, not mono. Six minutes is approximately **69.12 MB** of samples, too large for direct transcription upload. A 16 kHz mono PCM derivative of the same span is approximately **11.52 MB**, excluding its small WAV header. Derivation must be explicit, preserve silence and duration, and never overwrite the source. No resampling, downmixing, trimming or path reading happens inside the HTTP transport.

The later local derivative receipt must pin source descriptor ID/SHA/sample count, source range, derivative SHA/length/sample count, transform recipe and toolchain. Initially use the complete source, fixed downmix and 48→16 kHz resampling with no tempo change. Record any actual endpoint resampling difference; do not manufacture a perfect sample-count relation.

Parser rules: require a bounded object, no top-level error, bounded UTF-8 text/language, finite nonnegative duration, and an actual bounded words array when nonempty text is returned. Every word must have bounded text and finite nonnegative ordered endpoints. Empty text with an empty words array is a valid no-speech result, not permission to retry. Ignore unknown nonauthoritative fields within the overall response bound; never copy them into receipts.

Out-of-source-range, overlapping or nonmonotone word times should produce explicit `timingIssues` and retain the completed candidate rather than silently sorting, clamping or converting it to approved cues. A text/word mismatch is a review/alignment concern. Structurally missing words, malformed JSON or contradictory success/error envelopes remain unknown transport outcomes. Keep original response bytes for debugging under private storage later.

Transport timestamps remain in seconds relative to the exact derivative. The future application converts each absolute boundary once using a versioned rounding rule and the derivative mapping, then validates against decoded 48 kHz source samples. Project `atSample` is a separate placement; never add it to artifact-local cue coordinates. Provider word timing is not acoustic forced alignment or human acceptance. No confidence is invented from an absent field or a segment log-probability.

## Bounds, uncertainty and cancellation

Proposed hard maximums, lowerable by trusted host: 25,000,000-byte transcription input; 32 MiB speech response; 4 MiB transcription JSON; 64 KiB error body; 256 KiB transcript text; 8,192 word entries with at most 1,024 UTF-8 bytes per word; 120-second speech and 180-second transcription deadlines. Multipart body adds a separately checked maximum 16 KiB overhead. These are OpenSlate restrictions, not vendor maxima.

Read response streams incrementally with observed-byte bounds, regardless of `Content-Length`; reject oversized declared lengths before allocation. Validate MIME and bounded RIFF/WAVE signature for speech, then leave full waveform decode to ingestion. Do not mistake a header-only WAV for verified playable narration. If the response contains JSON/error content in an audio-success response, preserve uncertainty. Avoid one allocation per one-byte stream chunk: use bounded growing storage or compact fixed blocks so a byte cap also bounds bookkeeping.

Outcome rules:

| Observation | Result |
|---|---|
| Local validation/hash/body-digest failure or original signal aborted before fetch | Rejected, local, definitely not accepted; zero HTTP calls |
| Recognized auth/permission/invalid-input/throttle error with expected error envelope, and no audio/transcript/usage success evidence | Rejected, provider, definitely not accepted; sanitized code |
| Timeout, disconnect, redirect failure, 408/409/5xx, malformed/oversized success, contradictory success/error data, or abort after fetch began | Unknown; retain possible cost; no auto retry |
| Complete bounded raw WAV / validated timestamp result | Completed transport result; still needs local durable publication and review |

Do not copy error messages or fetch exceptions into returned objects; they can contain input text, credentials or URLs. Bounded sanitized `x-request-id` is diagnostic only. `Retry-After` may be parsed to a bounded delay for later scheduling, but creates neither a retry loop nor spending authority. Missing/invalid values are `null`.

Capture the original signal once and keep its listener/deadline active through all awaited local response cleanup. Recheck after cleanup before successful return. On late cancellation retain any already durable future output and report cancellation/unknown as appropriate; never delete a published receipt. For an injected fetch or stream that ignores abort, return an unknown outcome at the deadline and cancel any late body best-effort. Document that this does not guarantee remote cancellation or bound outstanding socket cleanup; transport concurrency is not application dispatch authority.

## Integration boundaries found in current code

- Core already has `speech` and `transcription` operation kinds. Compiler speech arguments carry text/voice/instructions; transcription carries audio, language and requested timing. Legacy fake outputs must remain byte-compatible.
- `ExecutionSpoolOutput`, output-store ports and current ingestion composition admit real image/video only. They must not receive audio by disguising it as image/video or falling back to inline fixture decoding. Additive audio/data spool and ingestion contracts are a later slice.
- `NarrationAudio.declaredOrigin` is a human description of a supplied file, not proof of a provider call. Generated provenance needs a separate immutable attempt/raw-output/derivative linkage. Do not call human `importAudio` from the agent to bypass the paid operation.
- `NarrationCue.method` currently admits only `human`. Timestamp results need separate transcript/mapping records and explicitly reviewed successor cues; leave current accepted cues untouched.
- `LocalMediaService.importMedia({kind:"audio"})` already decodes and measures 48 kHz stereo output while preserving original bytes and source metadata. Its public normalization recipe identity and durable attempt completion reuse are currently video-specific. Audio needs its own stable recipe/receipt/recovery extension before generation is wired.
- The installed catalog intentionally admits only fixed image/H3 production profiles today. Do not add audio switches, credential-driven readiness or registrations in the transport slice. Reuse generic immutable profile revisions later, with operation-specific supported settings and capabilities.

Later app bridge order must remain: resolve exact narration/chunk/derivative and profile → current target/hold/quarantine checks → one-use human allowance and conservative liability → durable attempt/mapping → original owner+epoch fence → one-use POST marker → transport → durable raw receipt → local decode/mapping → atomic historical publication/current selection. Restart checks durable output first. With no recoverable synchronous response, an unknown speech/transcription POST stays unknown; neither diagnostic request ID supports polling. Restored authorities never become fresh audio permission.

## Concrete files and verification plan

First implementation files: `packages/providers/src/openai-speech.ts`, `openai-transcription.ts`, a small `audio-http.ts` helper only for identical bounded/cancellation/sanitization behavior, and explicit exports in `index.ts`. Tests: corresponding provider test files with injected fetch/streams and in-memory synthetic PCM WAV bytes. Component documentation: `docs/implementation/OPENAI-AUDIO-TRANSPORTS.md`. No existing image/H3 transport refactor in this slice.

Focused tests must cover:

1. Exact endpoint/body/settings; deterministic multipart bytes; a preserved Unicode text fixture; any supported-field/input/profile change changes the digest, and object property order does not.
2. Bad hashes, unsupported/custom voices/models/fields, malformed PCM, mismatched header/sample counts, 25,000,000-byte boundaries, UTF-8 budget edges including emoji/non-Latin text and instruction overhead; all before fetch.
3. Mutating the exact request byte array/context/options objects after submission starts does not change wire bytes, attempt identity or the original cancellation listener. Null/nonplain/malformed objects fail with controlled errors.
4. Complete raw speech and timestamp fixtures; empty speech transcription; missing words; unrecognized resolved model; absent usage; malformed numbers and oversized entry/text counts. Timing issues remain visible, without invented confidence or silent correction.
5. Recognized rejection vs contradictory envelope, 5xx/timeout/body loss, oversized/invalid MIME/invalid JSON, and sanitized secret-bearing diagnostic headers/errors. Assert one POST and zero retries in every case.
6. Pre-abort, abort while waiting for headers, abort during body, late response after deadline and abort during delayed stream cleanup. Verify bounded settlement and released local listeners; do not claim server cancellation.
7. Future application tests are separately required: no submit without exact allowance/original lease, crash after raw publication before SQL, unknown restart with no repeat POST, normalization/mapping recovery, stale target/historical result, restored authority denial and unchanged existing human acceptance.

Self-review: protocol limits are distinguished from host restrictions; the unverified tokenizer is explicit; source/derivative/result identities stay separate; timestamp quality is not mistaken for transport rejection or approval; no synchronous task ID is invented; current application capabilities are not overstated. The offline transport subset is within the authorized development scope. Keys, a finite live audio test allowance, model/tokenizer conformance and production bridge readiness remain later validation requirements.
