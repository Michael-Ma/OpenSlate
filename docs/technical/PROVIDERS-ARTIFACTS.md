# Providers and artifacts

Provider adapters implement exact transport contracts. OpenSlate owns planning, admission, credentials, attempts, receipt recovery, owned output validation and selection. An adapter cannot change canonical project state or silently choose another model/account.

## Current integrations

| Route | Authentication/account | Current boundary |
|---|---|---|
| Demo image/video/speech/transcription | None | Explicit fake fixtures; no paid media |
| Codex images | Pinned local Codex with existing ChatGPT login | Separate Codex 0.162.1 image turn (`gpt-6-astra`); quota/internal call amount is not estimated |
| OpenAI images | Server-side OpenAI key | Exact configured image contract and PNG ingestion |
| Viggle H3 | Separate server-side Viggle key | Fixed video request/task/poll/download bridge |
| Direct MiniMax H3 | Separate MiniMax key | Fixed H3 request/task/poll/download bridge |
| Gemini Lyria 3.5 music (code plans) | Same server-side Gemini key as song analysis; billing-enabled Google project | One synchronous Interactions POST, $0.08/song; MP3/WAV retained and normalized to owned 48 kHz stereo |
| Seedance (ModelArk, ap-southeast-1) | Server-side ModelArk key | Code-plan only; fixed task/poll, token pricing, owned last frame |
| fal image-to-video | Existing fal-video key | Code-plan only; allowlisted Kling/Veo/Wan queue models |
| OpenAI speech | Server-side OpenAI key | Exact script/voice/instructions and owned PCM audio |
| OpenAI transcription | Server-side OpenAI key | Exact owned audio request with required word timing; candidate evidence for Director attachments |

Each route needs an installed supported profile, explicit host enablement, credentials/tools, current project compatibility and in-app authority. Credential presence is not a live access/eligibility check. Prices in example profiles are configured estimates, not verified charges. Dated Codex-image/Viggle/Lyria runs are recorded in [film-quality results](../ai/film-quality/RESULTS.md). They do not establish every installed route, account or longer-film quality; keep [live acceptance limits](../implementation/STATUS.md) separate.

## Profiles and dispatch

A saved profile pins ID/revision/kind, adapter/version, exact model/settings, concurrency/retry/duration limits and estimated unit cost. Catalog changes cannot redefine that saved identity. Existing model changes preview/apply a new lock and eligible pending graph while preserving completed, in-flight and separately reviewed audio work. Compact settings auto-apply only an explicit Save's current zero-impact preview; real pending impact remains human-reviewed. Director/media save identities and account setup remain separate.

Registered execution identities bind requests to the compiled-in adapter. Credentials resolve only through fixed backend aliases. No browser/model-supplied endpoint, key or arbitrary adapter code is accepted. There is no automatic provider fallback.

Runtime configuration explicitly supplies every route switch and download-host array, with `false` switches and empty arrays when no routes or hosts are configured. Codex binary/home paths and the additive N2 and music switches/host arrays may be omitted; absent routes stay disabled. Viggle preparation and backup validation reproduce the current centre-crop recipe; crop metadata is absent only for inputs that already need no crop.

## Experimental code-plan use

Code projects expose the installed image/video/speech/music profiles in their saved lock by profile id through `read_film.models`. Exact definitions, registered adapters, explicit host enablement, required media tools and credentials are checked before admission. Codex image authentication remains the existing native ChatGPT prepare check. A missing or changed installation definition never selects a demo or alternate route. The same server composition supplies registry, credential resolver, protected download allowlists, output store and ingesters to both execution modes.

The code-plan journal substitutes its own immutable attempt/request/version/price reservation for graph candidate/grant/node admission; graph authority remains unchanged. Codex and speech retain their full original profile/receipt lineage. Viggle's first-frame receipt has an alternate code-plan intent pin, keeping exact artifact identity and the shared F1 centre crop without inventing a human review. Unknown outcomes use only retained tasks/receipts and lookup; an existing submission intent is never sent twice. N1 permits at most two automatic retries only for positive not-submitted evidence, each with a new attempt and persisted backoff. Ambiguous outcomes retain liability and need the person’s consent for another attempt. MiniMax and unresolved Viggle outcomes retain possible charge as `SUBMISSION_RESPONSE_LOST`; a local attempt ID is not a vendor lookup key. For no-status/no-task code-plan Viggle outcomes, N8 can prove non-submission only after two complete bounded account-list checks with no stranger; any stranger/error/incomplete coverage stays uncertain. See [settlement](EXECUTION-ENGINE.md).

Legacy P4a code-plan prices use `unitCostMicros` per call for images, speech and clips alike (the graph quote's basis). Codex subscription images count $0; other zero estimates remain unknown. N2 overrides this basis only for its two input-priced adapters; graph pricing remains unchanged. These host estimates bound known liability under the film's configured circuit breaker (new default $4), not actual vendor charges or unpriced usage.

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

## N2 video models (offline implementation, October 30, 2026)

`seedance` uses official BytePlus ModelArk in `ap-southeast-1`. `fal-video-i2v` uses the existing shared fal queue transport and `fal-video` credential. Both execution versions are `1`; unknown models/settings fail closed. They require a code-plan project. Graph overview reads omit their video quotes, and graph generation refuses before buying narration or submitting video. Existing graph providers keep their estimates and behavior.

| Model id | Duration | Resolution | Known price basis (USD) |
|---|---|---|---|
| `seedance-1-0-pro-fast-251015` | 2–12 whole seconds | 480p/720p/1080p | $1.00 / 1M output tokens |
| `dreamina-seedance-2-0-mini-260615` | 4–15 whole seconds | 480p/720p | $3.50 / 1M output tokens |
| `dreamina-seedance-2-0-260128` | 4–15 whole seconds | 480p/720p/1080p | $7.00 / 1M tokens; 1080p $7.70 |
| `fal-ai/kling-video/v3/standard/image-to-video` | 3–15 whole seconds | Provider standard; no resolution field | $0.084 / second, silent |
| `fal-ai/veo3.1/fast/image-to-video` | 4, 6 or 8 seconds | 720p/1080p/4k | $0.10 silent / $0.15 audio per second; 4k $0.30 / $0.35 |
| `alibaba/wan-3.0/image-to-video` | 2–30 whole seconds | 480p/720p/1080p | $0.05 / $0.10 / $0.20 per second |

For Seedance the reservation is `seconds × output width × output height × 24 / 1024 × token rate`, rounded up once to a whole USD micro using integer arithmetic. Dimensions use the official model-specific resolution/aspect table: for example, 5 s of Mini at 720p with a 9:16 frame uses 720×1280, 108,000 tokens and 378,000 micros ($0.378). 1.0 Fast uses a different pixel grid (704×1248 in this case). Adaptive selects the closest supported aspect from the first frame. The actual returned `usage.completion_tokens` and computed actual cost are retained separately in `video_i2v_terminal`; the circuit breaker conservatively retains the pre-submit reservation. These are pinned published rates and calculated reservations, not live-verified bills.

Code input accepts `durationSeconds`, `resolution`, `aspectRatio`, `generateAudio`, `seed` and optional `lastFrame`. ModelArk maps aspectRatio to `ratio` (default `adaptive`); fal uses each model's exact field map. Kling is silent, infers aspect from its first frame and exposes no seed; its profile's `720p` is a standard-tier label and is never sent as a resolution parameter. Veo supports `auto`, `16:9` and `9:16`; its I2V endpoint has no last-frame field. Wan uses `start_image_url`, integer duration and `audio`. Seedance Fast accepts only a first frame and no audio. Returned videos enter the existing **silent** H.264/30-fps normalization path: vendor audio can be requested and billed but is not preserved in the film; use separately owned speech for audible narration.

Inputs must be owned validated PNGs. Seedance refuses dimensions outside 300–6000 px, aspect outside 0.4–2.5 or images of 30 MB and above; this implementation refuses rather than resizing. The existing owned-image store has tighter 4096 px / 8,294,400-pixel limits. First/last frame roles are pinned by hash in the durable operation. Output is 24 fps at ModelArk and normalized locally; a returned last-frame JPEG is downloaded through the protected allowlist, normalized to an owned PNG and included in the media result's `artifacts`. The primary `artifact` remains the video. Recovery reuses saved locators, spools, normalization receipts and last-frame artifacts.

**Face rule:** Seedance 2.x refuses ordinary input images containing real-looking human faces. The official portrait guide describes special trusted-model outputs and authorized portrait assets; this adapter accepts ordinary owned PNGs and does not claim those exceptions. `SEEDANCE_FACE_REJECTED` gives a plain explanation and `retry: "none"` in the retained terminal evidence. Seedance failed/moderated/expired/cancelled tasks release liability on definitive task evidence; fal terminal failures conservatively retain charged liability. A connect-phase refusal is not submitted. A lost create response remains unknown with liability retained and cannot automatically resubmit: no list/filter discovery by application attempt id is implemented. The ModelArk transport exposes queued-task DELETE cancellation, without adding a new Stop/cancellation workflow.

The fixed API hosts are `ark.ap-southeast.bytepluses.com` and `queue.fal.run`; API URLs are never plan inputs. Default ModelArk video/image download host: `ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com` (from the retrieve-task example). Default fal video download hosts: `v3.fal.media`, `v3b.fal.media`, `fal.media`, `storage.googleapis.com` (the model docs' examples). HTTPS-only downloads reject redirects and private addresses and pin DNS results. Override lists only with verified exact vendor hosts; no wildcard is supported. An unlisted returned host stays recoverable and cannot trigger another create. fal video sends owned frames inline, so it needs no storage upload; existing lip sync retains its `rest.fal.ai` upload path and original CDN allowlist.

Owner setup example: **edit your own `.env.live.local`; this task does not create or read it.** Set the two server-side keys and point the existing provider-config setting at a local JSON catalog:

```dotenv
OPENSLATE_MODELARK_API_KEY=replace-with-your-byteplus-modelark-key
OPENSLATE_FAL_API_KEY=replace-with-your-existing-fal-key
OPENSLATE_ENABLE_SEEDANCE_GENERATION=1
OPENSLATE_ENABLE_FAL_VIDEO_GENERATION=1
OPENSLATE_PROVIDER_CONFIG=/absolute/path/to/providers-video.json
# Optional exact overrides, only if a verified vendor response uses different hosts:
# OPENSLATE_SEEDANCE_DOWNLOAD_HOSTS=ark-content-generation-ap-southeast-1.tos-ap-southeast-1.volces.com
# OPENSLATE_FAL_DOWNLOAD_HOSTS=v3.fal.media,v3b.fal.media,fal.media,storage.googleapis.com
```

`modelark-video` resolves only `OPENSLATE_MODELARK_API_KEY`; `fal-video` continues resolving `OPENSLATE_FAL_API_KEY`. Configured keys enable their routes by default; an explicit `0` disables a route. No additional API-key or spending approval is added. The owner must separately establish account/model/region eligibility. Keep keys out of the JSON. Merge these profile entries with your existing image/speech entries in `providers-video.json`:

```json
{
  "version": 1,
  "profiles": [
    { "label": "Seedance drafts", "profile": { "id": "seedance-draft", "revision": "n2-1", "kind": "video", "adapter": "seedance", "executionVersion": "1", "configuration": { "model": "seedance-1-0-pro-fast-251015", "settings": { "resolution": "720p", "ratio": "adaptive", "generateAudio": false } }, "minFrames": 60, "maxFrames": 360, "maxConcurrency": 1, "unitCostMicros": "0", "maxRetries": 0 } },
    { "label": "Seedance normal shots", "profile": { "id": "seedance-mini", "revision": "n2-1", "kind": "video", "adapter": "seedance", "executionVersion": "1", "configuration": { "model": "dreamina-seedance-2-0-mini-260615", "settings": { "resolution": "720p", "ratio": "adaptive", "generateAudio": false } }, "minFrames": 120, "maxFrames": 450, "maxConcurrency": 1, "unitCostMicros": "0", "maxRetries": 0 } },
    { "label": "Seedance hero shots", "profile": { "id": "seedance-hero", "revision": "n2-1", "kind": "video", "adapter": "seedance", "executionVersion": "1", "configuration": { "model": "dreamina-seedance-2-0-260128", "settings": { "resolution": "720p", "ratio": "adaptive", "generateAudio": false } }, "minFrames": 120, "maxFrames": 450, "maxConcurrency": 1, "unitCostMicros": "0", "maxRetries": 0 } },
    { "label": "Kling 3 Standard silent", "profile": { "id": "fal-kling", "revision": "n2-1", "kind": "video", "adapter": "fal-video-i2v", "executionVersion": "1", "configuration": { "model": "fal-ai/kling-video/v3/standard/image-to-video", "settings": { "resolution": "720p", "aspectRatio": "adaptive", "generateAudio": false } }, "minFrames": 90, "maxFrames": 450, "maxConcurrency": 2, "unitCostMicros": "0", "maxRetries": 0 } },
    { "label": "Veo 3.1 Fast", "profile": { "id": "fal-veo", "revision": "n2-1", "kind": "video", "adapter": "fal-video-i2v", "executionVersion": "1", "configuration": { "model": "fal-ai/veo3.1/fast/image-to-video", "settings": { "resolution": "720p", "aspectRatio": "auto", "generateAudio": false } }, "minFrames": 120, "maxFrames": 240, "maxConcurrency": 2, "unitCostMicros": "0", "maxRetries": 0 } },
    { "label": "Wan 3.0", "profile": { "id": "fal-wan", "revision": "n2-1", "kind": "video", "adapter": "fal-video-i2v", "executionVersion": "1", "configuration": { "model": "alibaba/wan-3.0/image-to-video", "settings": { "resolution": "720p", "aspectRatio": "adaptive", "generateAudio": false } }, "minFrames": 60, "maxFrames": 900, "maxConcurrency": 2, "unitCostMicros": "0", "maxRetries": 0 } }
  ]
}
```

`unitCostMicros` is a required legacy profile field and is ignored for N2 pricing; zero does not make these calls free. A new code film pins every ready video and music profile beside the selected one, which stays the default, so its plan can choose per shot; `read_film` lists them. Storyboard films keep one profile per kind, and a saved film's lock is never amended.

Sources read with unauthenticated public GETs: [create](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api), [retrieve](https://docs.byteplus.com/en/docs/modelark/get-video-generation-task-api), [model list](https://docs.byteplus.com/en/docs/modelark/model-list), [pricing](https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing), [portrait guide](https://docs.byteplus.com/en/docs/modelark/seedance-portrait-asset-guide), [Kling](https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/llms.txt), [Veo](https://fal.ai/models/fal-ai/veo3.1/fast/image-to-video/llms.txt), [Wan](https://fal.ai/models/alibaba/wan-3.0/image-to-video/llms.txt). All final pages were reachable. Initial guessed `fal-ai/wan-*` equivalents returned 404; the exact Alibaba id was found in the public fal model catalog. No authenticated API or real provider call was made.

## Code-plan background music (N3)

`ctx.music({model?, prompt, durationSeconds, instrumental?, variant?})` uses an exact installed `music` profile; instrumental defaults to true. Prompt words ask for about N seconds and a clean final chord. The model has no seed, editing or exact duration control. Current guidance and the example request duration in 30-second blocks to improve reuse across small re-cuts. This is an authoring convention, not host normalization: an explicit different duration still changes the step identity, and requested length does not guarantee returned length. Every output carries an inaudible SynthID watermark. A returned track is measured independently of the requested length: successful results expose `leadInSamples` (first stereo frame above -60 dBFS) and `durationSamples` at 48 kHz. An all-silent result has lead-in equal to its entire length. Always check the remaining usable samples, skip the lead-in, trim to the picture and fade at the cut. A short track needs another deliberate variant.

The fixed transport allowlist is `https://generativelanguage.googleapis.com`, path `/v1beta/interactions`, with `x-goog-api-key` only in the header and redirects refused. Song analysis and Lyria share this origin, header policy, bounded JSON reader and cancellation/timeout implementation. Lyria has a 300 s HTTP timeout (code-plan call deadline at least 360 s), a 96 MiB JSON-response bound and a 32 MiB decoded/raw spool bound. Both `audio/mpeg` and `audio/wav` are accepted by MIME, with audio found by block type after any text blocks. Original bytes/hashes stay in the output store. The existing bounded importer, decoder, probe, 48 kHz stereo PCM resampler and managed-audio installer own normalization; music receipts bind its exact request, raw spool, normalization recipe, measured source and lead-in. Artifact and media-source publication are atomic.

Safety refusal is terminal with no retry. 429 means busy and follows N1’s at-most-two safe retries/backoff. 401/403 and explicit free-tier/billing refusals say the Gemini key’s Google project needs billing. Proven connection-setup failures mean not submitted. A loss after send stays unknown and may have charged; local reconciliation closes a known lost response as `SUBMISSION_RESPONSE_LOST`, preserving the $0.08 liability and requiring person consent for a new attempt. Lyria has no vendor lookup: recovery only reads retained local evidence/spools and never repeats POST. Missing/invalid audio also retains possible charge. A marker with no result after process loss stays unknown until the maximum 600 s dispatch window has elapsed. Earlier liabilities remain counted through retries.

### Owner setup (do not place secrets in the profile)

With `OPENSLATE_GEMINI_API_KEY` set and no music profile configured, this profile installs itself, and new code films pin it. To change it, add an entry like this to the JSON catalog named by `OPENSLATE_PROVIDER_CONFIG`. Existing film locks are not silently amended.

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
