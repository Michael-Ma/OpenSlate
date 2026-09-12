# GPT Image 2 transport: offline implementation

Verified against official documentation on 2026-09-12. This component implements the synchronous Images HTTP protocol. It is **not connected to the execution engine, application routes, grants or billing**. Tests inject responses; no OpenAI image request or paid generation was made.

Implementation: `packages/providers/src/openai-image.ts`. Offline contracts and faults: `packages/providers/test/openai-image.test.mjs`.

## Model and supported subset

`OPENAI_IMAGE_MODEL` is `gpt-image-2-2026-04-21`, the documented dated snapshot. Each request explicitly supplies a model; `gpt-image-2` is also accepted when the host deliberately chooses the alias. There is no implicit model substitution. The response's reported model remains null if undisclosed. [Official model page](https://developers.openai.com/api/docs/models/gpt-image-2).

The adapter sends one image per request with explicit quality (`low`, `medium`, `high`), dimensions, PNG format, opaque background, standard moderation and no streaming. Dimensions use multiples of 16, edges at most 3840, an aspect ratio at most 3:1, and 655,360–8,294,400 pixels. This allows both portrait and landscape. The official reference labels resolutions above 2560×1440 experimental; syntactic validation does not establish their quality or latency. [Generation reference](https://developers.openai.com/api/reference/resources/images/methods/generate), [GPT Image 2 settings](https://developers.openai.com/api/docs/guides/image-generation#earlier-gpt-image-models).

Generation uses `POST https://api.openai.com/v1/images/generations`. Editing uses the documented JSON `images` array on `/v1/images/edits`; each item contains a data URL constructed from the exact supplied bytes. The API supports up to 16 references; this implementation intentionally limits that to eight. It sends neither `input_fidelity` nor `response_format`: GPT Image 2 fixes input fidelity and returns base64 images. [Edit reference](https://developers.openai.com/api/reference/resources/images/methods/edit), [Input fidelity](https://developers.openai.com/api/docs/guides/image-generation#image-input-fidelity).

Masks, transparent output, batches, output JPEG/WebP, automatic sizing/quality, the Responses API, Files API and remote image URLs are outside this slice. Unsupported request properties are rejected, so callers cannot silently ask for one behavior and receive another.

## Host-facing contract

```ts
const adapter = new OpenAIImageAdapter({
  apiKey: hostResolvedCredential,
  fetch: hostFetch, // optional; defaults to global fetch
});
const request: OpenAIImageRequest = {
  mode: "generate",
  model: OPENAI_IMAGE_MODEL,
  prompt: exactSavedPrompt,
  width: 1536,
  height: 864,
  quality: "medium",
};
const description = adapter.describe(request);
// Application transaction commits intent, authority and allowance before this call.
const result = await adapter.submit(request, {
  attemptId: persistedAttemptId,
  expectedRequestDigest: description.requestDigest,
  signal: workerAbortSignal,
});
```

`describeOpenAIImageRequest` is the standalone equivalent of `describe`. Both are synchronous and perform no filesystem or network operations. The digest binds adapter contract version, model, exact prompt, all output settings, and ordered artifact identities/hashes. `submit` validates and recomputes it before network access. A changed request cannot borrow the recorded digest. The digest is distinct from the compiler's node fingerprint and is not a provider idempotency key.

An edit adds `images: [{artifactId, sha256, mimeType, bytes}, ...]`. Accepted input MIME types are PNG, JPEG and WebP. The host must already have decoded, inspected and authorized those artifacts. The transport verifies SHA-256, basic format signatures and byte bounds, then copies bytes before its first await. It does not resize, recompress or reorder references. A new reference preparation/normalization step must create its own immutable artifact before submitting that identity.

Limits are eight references, 4 MiB per reference, 24 MiB total input, 48 MiB response JSON and 32 MiB decoded output bytes. Prompt length is at most 32,000 JavaScript string units. Hosts can lower response/output limits and the 600-second deadline; they cannot raise them through configuration. These are data limits, not a measured peak-memory guarantee: JSON and base64 create temporary copies. Enforce host concurrency separately.

`completed` returns a diagnostic receipt, optional structured token usage, the provider timestamp and one PNG byte buffer with SHA-256 and dimensions. This means base64 decoding and transport/header validation passed. It does **not** mean the PNG has been fully decoded or durably ingested. The host must perform bounded image decoding, verify dimensions/color/alpha requirements, install the immutable artifact and persist provenance before making it available for review. `fixture: false` describes the real transport's output contract; offline injected responses are synthetic test data, not live provider results.

## Uncertainty and retries

There is no retry loop. Every call to `submit`, including repeating the same attempt ID and digest, can create another paid request. The transport does not claim OpenAI deduplication. Durable single-attempt admission must happen above it.

| Result | Meaning and host treatment |
| --- | --- |
| Local `rejected`, `not_accepted` | Invalid request/digest or an already-aborted signal; no HTTP dispatch occurred. |
| Provider `rejected`, `not_accepted` | Recognized pre-generation protocol/authentication/permission/rate-limit rejection. Persist the receipt and classification. This is not a promise of zero billed usage, nor automatic retry authorization. |
| `unknown` | Timeout, cancellation after dispatch, network/body loss, 408/409/5xx, unrecognized error, moderation/generation failure, or unusable success. Keep attempt liability unresolved. |
| `completed` | Bytes returned; durable ingestion and exact human keyframe review remain application work. |

Output moderation can follow generation, so an image-generation user error is not treated as proof that nothing happened. The adapter conservatively leaves these cases unknown, including blocked-input cases it cannot settle with this narrow protocol. [Official error guidance](https://developers.openai.com/api/docs/guides/image-generation#handling-blocked-requests-and-other-errors).

Receipts include local attempt ID, digest, requested model, HTTP status and a bounded `x-request-id` when present. There is no fabricated remote task ID, polling, cancellation API or request-ID lookup. `unknown` is deliberately not automatically recoverable here. The host needs provider-supported reconciliation or explicit human handling; a replacement must retain old liability. Aborting local fetch cannot prove remote cancellation. Deadlines also cover stalled response bodies; response streams are canceled locally on timeout/size failure.

## Integration boundary and verification

Before dispatch, the application must pin the project profile, resolve credentials in the trusted host, verify artifact ownership, persist the exact prompt and request digest, admit a current candidate/grant, check holds/epochs, reserve the authorized allowance, and record submission intent. No network operation belongs inside that transaction. After dispatch, retain receipts even when revisions or leases become stale; only a current guarded projector may select the output. Every video still requires approval of its exact resulting keyframe and video setup.

The adapter accepts no configurable endpoint or filesystem path. Redirect following is disabled. Constructor credentials are private fields; outcomes do not contain raw vendor errors, response bodies, prompts or authentication headers. The injected fetch is trusted host code and inherently sees the credential. Do not instrument it with raw request logging or retrying middleware. The adapter itself makes no filesystem writes.

The existing fake executor is unchanged. Connecting this transport requires a real provider profile/credential resolver, durable attempt/result mapping, bounded artifact ingestion, review binding, and an explicit live-test allowance. Generic `not_accepted` is not a trusted technical retry authority; the host must decide whether the original failure is retryable without changing creative intent. Token usage here is evidence, not a price quote or hard monetary cap.

Validation under Node 24: provider compilation passed and 23 offline tests passed, zero failures/skips. Tests cover exact generation/edit payloads, input mutation/digest guards, geometry and bounds, malformed output, definite versus ambiguous rejection, output moderation, request/body timeout and cancellation, late responses, redacted errors and repeated-call behavior. They do not establish account/model availability, vendor acceptance of a real request, image quality, pricing or live latency.
