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
| Gemini Lyria 3.5 music (code plans) | Same server-side Gemini key as song analysis; billing-enabled Google project | One synchronous Interactions POST, $0.08/song; MP3/WAV retained and normalized to owned 48 kHz stereo |
| OpenAI speech | Server-side OpenAI key | Exact script/voice/instructions and owned PCM audio |
| OpenAI transcription | Server-side OpenAI key | Exact owned audio request with required word timing; candidate evidence for Director attachments |

Each route needs an installed supported profile, explicit host enablement, credentials/tools, current project compatibility and in-app authority. Credential presence is not a live access/eligibility check. Prices in example profiles are configured estimates, not verified charges. One real Codex-image/Viggle six-second export is established; other media paths retain their [live acceptance limits](../implementation/STATUS.md).

## Profiles and dispatch

A saved profile pins ID/revision/kind, adapter/version, exact model/settings, concurrency/retry/duration limits and estimated unit cost. Catalog changes cannot redefine that saved identity. Existing model changes preview/apply a new lock and eligible pending graph while preserving completed, in-flight and separately reviewed audio work. Compact settings auto-apply only an explicit Save's current zero-impact preview; real pending impact remains human-reviewed. Director/media save identities and account setup remain separate.

Registered execution identities bind requests to the compiled-in adapter. Credentials resolve only through fixed backend aliases. No browser/model-supplied endpoint, key or arbitrary adapter code is accepted. There is no automatic provider fallback.

Runtime configuration explicitly supplies every route switch and download-host array, with `false` switches and empty arrays when no routes or hosts are configured. Only optional Codex binary/home paths and the additive music switch may be omitted by older host compositions; an omitted music switch disables music. Environment parsing always emits an explicit music boolean. Viggle preparation and backup validation reproduce the current centre-crop recipe; crop metadata is absent only for inputs that already need no crop.

## Experimental code-plan use

Code projects expose the installed image/video/speech/music profiles in their saved lock by profile id through `read_film.models`. Exact definitions, registered adapters, explicit host enablement, required media tools and credentials are checked before admission. Codex image authentication remains the existing native ChatGPT prepare check. A missing or changed installation definition never selects a demo or alternate route. The same server composition supplies registry, credential resolver, protected download allowlists, output store and ingesters to both execution modes.

The code-plan journal substitutes its own immutable attempt/request/version/price reservation for graph candidate/grant/node admission; graph authority remains unchanged. Codex and speech retain their full original profile/receipt lineage. Viggle's first-frame receipt has an alternate code-plan intent pin, keeping exact artifact identity and the shared F1 centre crop without inventing a human review. Unknown outcomes use only retained tasks/receipts and lookup; an existing submission intent is never sent twice. N1 permits at most two automatic retries only for positive not-submitted evidence, each with a new attempt and persisted backoff. Ambiguous outcomes retain liability and need the person’s consent for another attempt. Viggle/MiniMax can close an unresolvable lost POST as `SUBMISSION_RESPONSE_LOST`, preserving possible charges; they cannot discover a job from the application’s attempt id.

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

## Code-plan background music (N3)

`ctx.music({model?, prompt, durationSeconds, instrumental?, variant?})` uses an exact installed `music` profile; instrumental defaults to true. Prompt words ask for about N seconds and a clean final chord. The model has no seed, editing or exact duration control. Every output carries an inaudible SynthID watermark. A returned track is measured independently of the requested length: successful results expose `leadInSamples` (first stereo frame above -60 dBFS) and `durationSamples` at 48 kHz. An all-silent result has lead-in equal to its entire length. Always check the remaining usable samples, skip the lead-in, trim to the picture and fade at the cut. A short track needs another deliberate variant.

The fixed transport allowlist is `https://generativelanguage.googleapis.com`, path `/v1beta/interactions`, with `x-goog-api-key` only in the header and redirects refused. Song analysis and Lyria share this origin, header policy, bounded JSON reader and cancellation/timeout implementation. Lyria has a 300 s HTTP timeout (code-plan call deadline at least 360 s), a 96 MiB JSON-response bound and a 32 MiB decoded/raw spool bound. Both `audio/mpeg` and `audio/wav` are accepted by MIME, with audio found by block type after any text blocks. Original bytes/hashes stay in the output store. The existing bounded importer, decoder, probe, 48 kHz stereo PCM resampler and managed-audio installer own normalization; music receipts bind its exact request, raw spool, normalization recipe, measured source and lead-in. Artifact and media-source publication are atomic.

Safety refusal is terminal with no retry. 429 means busy and follows N1’s at-most-two safe retries/backoff. 401/403 and explicit free-tier/billing refusals say the Gemini key’s Google project needs billing. Proven connection-setup failures mean not submitted. A loss after send stays unknown and may have charged; local reconciliation closes a known lost response as `SUBMISSION_RESPONSE_LOST`, preserving the $0.08 liability and requiring person consent for a new attempt. Lyria has no vendor lookup: recovery only reads retained local evidence/spools and never repeats POST. Missing/invalid audio also retains possible charge. A marker with no result after process loss stays unknown until the maximum 600 s dispatch window has elapsed. Earlier liabilities remain counted through retries.

### Owner setup (do not place secrets in the profile)

Merge this entry into the JSON catalog named by `OPENSLATE_PROVIDER_CONFIG`; include `lyria-3.5-music` in the new code film’s selected profile ids so it is pinned in that film’s capability lock. Existing film locks are not silently amended. The lead owns any UI for selecting music.

```json
{
  "version": 1,
  "profiles": [{
    "label": "Google Lyria 3.5 · $0.08/song",
    "profile": {
      "id": "lyria-3.5-music", "revision": "1", "kind": "music",
      "adapter": "gemini-lyria", "executionVersion": "1",
      "configuration": { "model": "lyria-3.5", "settings": {} },
      "maxConcurrency": 1, "unitCostMicros": "80000", "maxRetries": 0
    }
  }]
}
```

In the owner-managed `.env.live.local`, set `OPENSLATE_GEMINI_API_KEY` to the billing-enabled key and `OPENSLATE_PROVIDER_CONFIG` to that catalog’s absolute path. The configured key enables the music route by default; `OPENSLATE_ENABLE_MUSIC_GENERATION=0` explicitly disables it. No separate key/spending approval is needed. Neither the environment file nor any key was read or written for this card. The profile estimate is exactly 80,000 USD micros per call and participates in normal ceiling, hold, Stop, concurrency, stale-version and one-use submission fences. `read_film.models` includes the price and “length is approximate; trim and fade at the cut”.

Protocol/pricing documentation checked with plain unauthenticated GETs on October 30, 2026: [music generation](https://ai.google.dev/gemini-api/docs/music-generation), [pricing](https://ai.google.dev/gemini-api/docs/pricing). The card’s October 30 live observation takes precedence where it differs (MP3 despite requesting audio format; 68 s returned for a 20 s request). All N3 verification here uses synthetic fixtures/loopback; no live provider acceptance or actual billing claim is made.
