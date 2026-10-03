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
| OpenAI transcription | Server-side OpenAI key | Exact owned audio request with required word timing and reviewed adoption |

Each route needs an installed supported profile, explicit host enablement, credentials/tools, current project compatibility and in-app authority. Credential presence is not a live access/eligibility check. Prices in example profiles are configured estimates, not verified charges. One real Codex-image/Viggle six-second export is established; other media paths retain their [live acceptance limits](../implementation/STATUS.md).

## Profiles and dispatch

A saved profile pins ID/revision/kind, adapter/version, exact model/settings, concurrency/retry/duration limits and estimated unit cost. Catalog changes cannot redefine that saved identity. Existing model changes preview/apply a new lock and eligible pending graph while preserving completed, in-flight and separately reviewed audio work. Compact settings auto-apply only an explicit Save's current zero-impact preview; real pending impact remains human-reviewed. Director/media save identities and account setup remain separate.

Registered execution identities bind requests to the compiled-in adapter. Credentials resolve only through fixed backend aliases. No browser/model-supplied endpoint, key or arbitrary adapter code is accepted. There is no automatic provider fallback.

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
