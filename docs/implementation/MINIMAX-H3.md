# MiniMax H3 cloud transport

September 12, 2026. `packages/providers/src/minimax-h3.ts` implements a standalone transport adapter. A separate opt-in [application execution bridge](MINIMAX-H3-EXECUTION.md) is implemented offline; the launcher still does not activate H3, and no real H3 request has been made. The user's API key, account access, embedded-image acceptance, output quality and billing remain unverified.

## Contract and supported slice

The current official contract uses `POST https://api.minimax.io/v2/video_generation`. H3 supports 4–15 integer seconds at 768P/2K; H3-Max supports 5–15 seconds at 480P/768P and excludes reference-media generation. Frame conditioning and reference-media conditioning cannot be mixed; image-to-video geometry follows the source image. [Create contract](https://platform.minimax.io/docs/api-reference/video-generation-v2-create)

This adapter deliberately supports a narrower profile: a required first frame, optional last frame, explicit model/resolution/duration, and a nonempty prompt. It sends `ratio: "adaptive"` and rejects unrecognized fields rather than dropping them. Text-only, reference-media, callback and video-regeneration modes are not implemented. No model substitution occurs.

Inputs contain a transport URL plus immutable image SHA-256, media type, dimensions and byte length. HTTPS references require trusted host validation that the published bytes are the approved artifact. Embedded data URLs are checked against their declared hash, length, MIME and canonical Base64. Measurements must come from actual artifact ingestion; this transport does not decode images or fetch URLs. Invalid limits fail before submission. The adapter additionally caps prompts at 32 KiB, requests at 64 million bytes, and responses at 1 MiB.

```ts
const provider = new MiniMaxH3Provider({
  apiKey: resolvedBackendCredential,
  model: "MiniMax-H3", // or the separately selected MiniMax-H3-Max profile
});
const validated = provider.validate(request);
// Persist admission, exact request identity and liability before this call.
const outcome = await provider.submit(validated, { signal });
// Persist any returned task ID immediately; poll it on the host's schedule.
```

The constructor accepts an injected `fetch` and bounded timeout for tests/trusted hosts. It performs no I/O. The production API origin is fixed; redirects are never followed. API keys, raw provider error messages and response bodies do not appear in diagnostics. Provider output URLs remain protected operational data and must not enter ordinary browser responses or logs.

## Outcomes and recovery

| Observation | Adapter result | Host responsibility |
|---|---|---|
| Invalid local request or signal already aborted | `rejected`, `not_accepted` | Correct the request; no network call occurred |
| HTTP 200 with a valid task receipt | `accepted` | Persist task identity against the admitted attempt |
| Intact documented 400/401/402/422/429 rejection envelope | `rejected`, `not_accepted` | Apply the corresponding invalid-input, auth, quota, policy or throttling rule |
| Lost response, timeout after dispatch, malformed response, redirect, 5xx or contradictory envelope | `unknown` | Retain uncertain liability; do not submit again automatically |
| Known task queued/running | `pending` | Schedule another GET independently of the director |
| Known task succeeded | `completed` with locator | Download, hash, decode/probe and ingest before claiming usable media |
| Known task failed/cancelled | Terminal observation | Preserve the receipt; the result does not itself authorize technical retry or refund |
| Missing, expired, mismatching or unrecognized query response | `unknown` | Preserve existing acceptance evidence and investigate |

Polling uses `GET /v2/query/video_generation/{task_id}`. The documented query window is seven days; a successful response contains a direct output URL and usage rather than the older Hailuo file-ID workflow. The adapter reports missing measurements/usage as null and leaves output expiry unknown. Provider usage is not a price or settled charge. [Query contract](https://platform.minimax.io/docs/api-reference/video-generation-v2-query)

Every method makes at most one HTTP request. There is no POST retry, hidden polling loop, attempt lookup by prompt, or invented idempotency header. `reconcile({ taskId })` polls that task; without a task ID it returns unknown without network I/O. Calling `submit` again is a new provider request: this stateless adapter does not replace the engine's durable attempt ownership and fencing.

Remote cancellation is intentionally absent. MiniMax's delete route cancels queued work, rejects cancellation while running, and deletes completed task records; a poll-then-delete sequence can race completion. Continue monitoring accepted work when local dispatch stops. [Cancel/delete contract](https://platform.minimax.io/docs/api-reference/video-generation-v2-delete)

## Required application integration

Before enabling a live profile, the host must provide:

1. A backend credential resolver and immutable adapter/model/profile identity. Credentials never belong in plans, director context, or persisted request bodies.
2. Trusted transfer of the exact reviewed keyframe; perform normalization before human approval. Resolve URLs from owned artifacts or explicitly configured transport, never arbitrary model URLs. Embedded transfer still needs a small authorized live compatibility test.
3. Engine admission, exact review binding, durable submission intent, reservations and a conservative cost or job allowance. Map these outcomes into engine contracts without treating generic task failure as automatic technical retry authority.
4. Immediate receipt persistence and scheduled polling with shared throttling/backoff. Do not assume missing task history proves absence or frees uncertain liability.
5. Bounded output ingestion with destination/redirect checks, no API bearer forwarding to a CDN, immutable storage and measured media validation. A successful query is not an artifact or current shot selection.

The standalone transport cannot simply replace Engine's execution contract. The subsequent [H3 execution bridge](MINIMAX-H3-EXECUTION.md) implements the request mapping, single-POST marker, task receipts, durable polling cooldown and protected output ingestion boundary. It remains an explicit host component with no default activation or claim of live compatibility.

## Offline verification

The provider build and **30 adapter tests passed**, using injected HTTP responses and no network/key. They exercise exact wire shape, incompatible inputs/model capabilities, immutable embedded bytes, documented rejections, lost acceptance, malformed/oversized/contradictory responses, stalled streams, cancellation timing, no-retry behavior, known-receipt reconciliation, mismatched task identity, protected locators and diagnostic secret omission. These fixtures verify adapter behavior; they do not establish MiniMax's live guarantees.

Run with Node 24:

```sh
pnpm --filter @openslate/providers build
node --test packages/providers/test/minimax-h3.test.mjs
```
