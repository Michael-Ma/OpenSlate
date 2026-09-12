# OpenAI image application execution

This is an **offline-tested bridge**, not a production activation. The local launcher still registers fake execution only. No real image API request has been made by this validation, and no credential is read from the contributor's environment by its fixtures.

`OpenAIImageExecution` connects the registered `openai-image/1` execution contract to the standalone [GPT Image transport](OPENAI-IMAGE.md), the environment credential resolver, and the [owned output store](SPOOL-COMPLETIONS.md). The application remains responsible for human grants, candidate admission, spending permission, leases, exact artifact ingestion, and current-output selection.

```mermaid
sequenceDiagram
    participant Engine
    participant Bridge
    participant DB as SQLite
    participant Transport as Image transport
    participant Spool as Owned output store
    Engine->>DB: Admit exact request, grant, reservation and allowance correlation
    Engine->>Bridge: Request and original call cancellation / lease fence
    Bridge->>Bridge: Verify pinned settings and exact owned PNG references
    Bridge->>DB: Immutable application-to-transport digest mapping
    Bridge->>Bridge: Resolve fixed credential alias at use time
    Bridge->>DB: Claim one-use dispatch marker under caller lease
    Bridge->>Transport: One synchronous generation or edit POST
    Transport-->>Bridge: Redacted result, usage and optional PNG bytes
    Bridge->>DB: Immutable result plus output-byte receipt
    Bridge->>Spool: Persist exact returned bytes
    Spool-->>Engine: Winning V2 completion; vendor task is null
    Engine->>Engine: Fully decode PNG and publish exact artifact under lease
```

## Pinned request and inputs

The bridge accepts an already persisted image attempt with an exact full request, a matching reservation, and the `externalAllowanceId` issued by the trusted Engine admission policy. This ID is a correlation with the host's spending decision, not independent authority. Without an installed admission policy the Engine denies external execution before creating an attempt. No allowance policy or HTTP activation is installed by this module.

The profile explicitly pins `model` plus `settings.width`, `settings.height`, and `settings.quality`. Supported model names are the transport's exact GPT Image 2 snapshot and explicitly selected family alias; the bridge does not substitute or infer a resolved model. The compiled width and height must equal the profile. A shot may repeat the same quality, but cannot override it. No other transport options, URLs, paths, credentials, or profile overrides are accepted in the execution arguments.

No-input requests generate an image. Edit requests carry at most eight ordered image artifact references. Every source must already be an owned, fully validated, nonfixture PNG with the exact saved hash and byte length. The bridge checks same-project ownership, validation evidence, canonical path containment, no-follow regular-file access, the bounded byte count and the current content hash. Inputs are limited to **4 MiB each and 24 MiB combined**. Oversize references fail explicitly; reviewed bytes are never resized to fit. The standalone transport repeats its PNG/header/hash and documented dimension validation before HTTP.

Request fields and the original cancellation signal are captured before asynchronous preparation. The mapping records ordered source IDs, hashes, types and lengths, but no host paths or embedded image bytes. Its transport digest uses the pinned V1 semantic envelope and is intentionally different from the digest of the complete admitted application request.

## Durable dispatch and recovery

Three immutable same-project record families bind the lifecycle:

| Record | Identity and purpose |
|---|---|
| `image_execution_mapping` | One per attempt; full application request digest, profile digest, allowance correlation, and exact prepared transport description/digest |
| `image_execution_dispatch` | One per attempt; mapping/transport digests and creation time; persisted before the single network dispatch |
| `image_execution_result` | One per attempt; exact mapping and dispatch digests plus a bounded redacted local/provider observation |

The dispatch transaction checks the original caller's lease and current reserved state. Concurrent callers can produce only one marker. A caller that sees a marker or result performs recovery immediately, without resolving another credential or sending another POST. Native/provider diagnostic request IDs are kept only as receipt evidence: they never become a vendor task ID or a polling target.

Credential resolution happens after local preparation and before claiming the marker. Missing credentials, cancelled preparation and invalid local inputs can therefore produce a definite `not_dispatched` result. That result is final for the attempt even if configuration later changes. The module never automatically retries it. A new application-authorized request can use corrected configuration.

A completed provider result and its `execution_output_receipt` are committed together before any asynchronous spool write. The result retains exact output metadata, declared usage, optional reported model and the sanitized diagnostic receipt. It never retains a bearer credential, vendor error text, request body, host path or inline output bytes. Usage is evidence; it does not establish actual billing or update the estimate used by the Engine reservation.

Returned bytes are written in bounded chunks to the output store. The completion returned to Engine is the immutable winning V2 output slot with `vendorTaskId: null`. PNG decoding and artifact publication still belong to the configured ingestion boundary. A successful HTTP response alone cannot make media usable.

If a spool SQL write is interrupted after immutable byte publication, restart can recover the blob and receipt locally. If bytes were lost before durable publication, the saved successful provider observation remains unresolved; no POST is repeated to replace them. A lost response or failed outcome transaction similarly leaves the dispatch marker unresolved. `lookup` only inspects/reconstructs local evidence; `poll` reports that synchronous images have no pollable task. There is no claim of vendor idempotency.

Cancellation or lease loss does not erase observed provider outcomes. Completed immutable bytes may remain for later recovery, while cancellation prevents a successful current storage result. Unknown submissions retain the application's existing liability/reservation rules. Completed and rejected observations explicitly disable automatic generation retries.

## Verification and limits

The focused run passed **81 tests with zero failures/skips**, including 20 new bridge tests plus the transport, credentials, output store and Engine spool regressions. Provider/server builds passed. It uses injected HTTP responses, synthetic PNGs, real SQLite and real local PNG decoding. It exercises generation/edit payload conformance, application-versus-transport digests, exact ordered input bytes, changed configuration/input/project rejection, aggregate input limits, concurrent single dispatch, use-time missing credentials, original cancellation, missing/pre-entry/late lease fences, redacted observations, unknown restart without resubmission, interrupted receipt/spool persistence and exact Engine artifact publication.

Source: `apps/server/src/execution/openai-image-execution.ts`, `openai-image-receipts.ts`; focused tests: `apps/server/test/openai-image-execution.test.mjs`.

Remaining activation work includes a trusted installed profile catalog, explicit human profile/spending selection, credential readiness, a durable allowance policy, launcher wiring and an explicitly allowed real-media validation. The bridge adds no UI, network endpoint, automatic worker activation, image resizing or new retry policy.
