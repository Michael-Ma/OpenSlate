# Providers and artifacts

Provider adapters implement exact transport contracts. OpenSlate owns planning, admission, credentials, attempts, receipt recovery, owned output validation and selection. An adapter cannot change canonical project state or silently choose another model/account.

## Current integrations

| Route | Authentication/account | Current boundary |
|---|---|---|
| Demo image/video/speech/transcription | None | Explicit fake fixtures; no paid media |
| Codex images | Pinned local Codex with existing ChatGPT login | Automatic native image turn; quota/internal image-call amount is not estimated |
| OpenAI images | Server-side OpenAI key | Exact configured image contract and PNG ingestion |
| Viggle H3 | Separate server-side Viggle key | Fixed video request/task/poll/download bridge |
| Direct MiniMax H3 | Separate MiniMax key | Fixed H3 request/task/poll/download bridge |
| OpenAI speech | Server-side OpenAI key | Exact script/voice/instructions and owned PCM audio |
| OpenAI transcription | Server-side OpenAI key | Exact owned audio request with required word timing; candidate evidence for Director attachments |

Each route needs an installed supported profile, explicit host enablement, credentials/tools, current project compatibility and in-app authority. Credential presence is not a live access/eligibility check. Prices in example profiles are configured estimates, not verified charges. One real Codex-image/Viggle six-second export is established; other media paths retain their [live acceptance limits](../implementation/STATUS.md).

## Profiles and dispatch

A saved profile pins ID/revision/kind, adapter/version, exact model/settings, concurrency/retry/duration limits and estimated unit cost. Catalog changes cannot redefine that saved identity. Existing model changes preview/apply a new lock and eligible pending graph while preserving completed, in-flight and separately reviewed audio work. Compact settings auto-apply only an explicit Save's current zero-impact preview; real pending impact remains human-reviewed. Director/media save identities and account setup remain separate.

Registered execution identities bind requests to the compiled-in adapter. Credentials resolve only through fixed backend aliases. No browser/model-supplied endpoint, key or arbitrary adapter code is accepted. There is no automatic provider fallback.

Runtime configuration explicitly supplies every route switch and download-host array, with `false` switches and empty arrays when no routes or hosts are configured. Only optional Codex binary/home paths may be omitted. Viggle preparation and backup validation reproduce the current centre-crop recipe; crop metadata is absent only for inputs that already need no crop.

## Experimental code-plan use

Code projects expose the installed image/video/speech profiles in their saved lock by profile id through `read_film.models`. Exact definitions, registered adapters, explicit host enablement, required media tools and credentials are checked before admission. Codex image authentication remains the existing native ChatGPT prepare check. A missing or changed installation definition never selects a demo or alternate route. The same server composition supplies registry, credential resolver, protected download allowlists, output store and ingesters to both execution modes.

The code-plan journal substitutes its own immutable attempt/request/version/price reservation for graph candidate/grant/node admission; graph authority remains unchanged. Codex and speech retain their full original profile/receipt lineage. Viggle's first-frame receipt has an alternate code-plan intent pin, keeping exact artifact identity and the shared F1 centre crop without inventing a human review. Unknown outcomes use only retained tasks/receipts and lookup; no failed or unknown code step automatically resubmits. In particular, the existing Viggle/MiniMax policy can close an unresolvable lost POST as `SUBMISSION_RESPONSE_LOST`, retaining charge liability and refusing retries; it cannot discover a job from the application's attempt id.

P4a code-plan prices use `unitCostMicros` per call for images, speech and clips alike (the graph quote's basis). Codex subscription images count $0; other zero estimates remain unknown. This explicit card rule differs from this checkout's flat Viggle/MiniMax graph quote; it changes no graph pricing. These host estimates bound known liability under the film's $1 circuit breaker, not actual vendor charges or unpriced usage.

Real local rendering reuses measured `media_source` descriptors, timeline documents, frozen manifests, FFmpeg, probing and managed installation. Artifact publication follows retained completion evidence; spooled raw bytes and normalized media retain distinct hashes. Demo projects keep fixture media and fixture renders. Offline adapter fixtures and synthetic MP4/WAV checks establish plumbing and recovery, not live account access or subjective output quality. See the [P4a report](../ai/code-plan/reports/P4a-report.md).

## Output boundary

1. Retain a provider effect/receipt and exact task identity where available.
2. Spool bounded raw bytes to owned storage with hashes/completion manifests.
3. Validate full image decoding, video/audio probing and normalization or transcript structure.
4. Publish an immutable artifact with fixture/source provenance and compatible selection.

Video output downloads require exact allowed HTTPS hostnames, bounded network behavior and protected locators. A download failure recovers the known job; it does not justify another create. Raw and normalized videos/audio retain distinct content identities.

## Source and checks

- [Execution registry/contracts](../../packages/providers/src/execution.ts)
- Adapter files in `packages/providers/src/`; [activation composition](../../apps/server/src/application/media-execution-runtime.ts), [credential resolver](../../apps/server/src/application/provider-credentials.ts)
- [Catalog](../implementation/PROVIDER-CATALOG.md), [activation](../implementation/MEDIA-EXECUTION-LAUNCHER.md), [output store](../implementation/OUTPUT-SPOOL.md)
- Provider transport and server execution tests cover exact wire inputs, receipt identity, no-dispatch proof, unknown responses, cancellation and result recovery.

Same-machine Python H3 inference remains a future provider implementation. Offline transport tests do not establish account access, subjective quality or vendor billing semantics.
