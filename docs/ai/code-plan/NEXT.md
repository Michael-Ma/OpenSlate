# Code plan · next round (owner list of October 30)

The owner ran a real 30-second, five-shot vertical film after P4b. Four clips succeeded; the fifth failed with `SUBMISSION_RESPONSE_LOST`, the film was never rendered, and nothing let the owner retry. This plan answers the owner's nine items, plus one bug the run exposed.

## What the run showed

- **Lost submission.** Viggle's POST failed 254 ms after sending, with no HTTP status (`VIGGLE_H3_TRANSPORT_OR_RESPONSE_LOSS`). Policy treats any transport loss as "may have been charged, never resubmit", so the step ended `failed` with $0.10 counted as charged. The program logged and returned; the run says `done` without a film.
- **Bug B0: vertical films are cropped to 16:9.** The Director planned 9:16 (render 1080×1920). Codex made portrait keyframes (941×1672). The code-mode Viggle path used the profile's fixed `16:9` and center-cropped every first frame to 928×522, so every clip lost most of its picture. Viggle supports 9:16.
- **No music in code mode.** The Director wrote `musicStatus: "待提供有授权的配乐"` into its scene declaration: storyboard mode only supports an uploaded soundtrack, and code mode has no music path at all.

## Items

### 1. Background music generation
`ctx.music({model, prompt, durationSeconds, instrumental?})` returns an owned, measured 48 kHz audio artifact that `ctx.render` already knows how to place (`audio: [{artifact, atSample, gainMilliDb}]`). New provider adapters per the research below; priced per call like the other models; the ceiling applies. The guidance says when to make music (after the cut is known, its length = the film's) and how to duck it under speech.
*Research and recommendation: see "Music providers".*

### 2. Code view only for developers
Settings › This computer gets **Developer mode** (off by default). Off: the Code tab is hidden and links to it fall back to Plan; the Director column and choice notes stop mentioning Code ("priced in Code" → the price shows on the card). On: as today. Stored per studio installation, not per film.

### 3. Pictures: whole image and double-click to enlarge
- Thumbnails show the whole picture: `object-fit: contain` on a neutral matte, the box following the image's own aspect (portrait keyframes stop losing 45% of the frame).
- Double-click (or Enter on focus) any picture — Keyframes cards, choice thumbnails, Plan shot rows, Assets — opens one shared viewer: full size, arrow keys through its siblings, Esc closes. A single click keeps its current meaning (on a choice it still chooses).

### 4. Spend limit: Settings and chat
- Settings › Director: **Spend limit for new films** (default $1) and, with a film open, **This film's limit**. Lowering below what is already spent or reserved is refused with the numbers.
- The Director gets `set_spend_limit({ceilingMicros, quote})`: allowed only in a turn started by the person's own message, `quote` must be the person's words asking for it (checked against the message), and the change shows in the thread as a receipt ("Limit raised to $3.00 at your request"). No cap (owner decision, October 30).
- New code-plan tool contract `0.2.0` (adds `set_spend_limit`, `retry_step`, see 8); `0.1.0` films keep working.

### 5. Failures you cannot miss, in plain words
- A red dot on the film (Films list), on the tab that holds the failed step (Keyframes / Film), and code-plan failures listed in the existing **Needs attention** menu, each opening its step.
- Every step error code gets a plain sentence and what can be done, e.g. `SUBMISSION_RESPONSE_LOST` → "The video service did not answer when the clip was sent, so we cannot tell whether it started (and whether it was charged, about $0.10). Retrying makes a new clip and may charge again."
- When a paid step fails, the run starts a Director turn (as repair turns do today for program errors). The Director says what failed in those plain words and offers to retry or skip; the owner answers in the chat or on a choice card.

### 6. Video thumbnails
Each ingested clip gets an owned poster (a measured still from frame 0, made locally with FFmpeg when the clip is ingested). Clip rows in Film, choices whose options are clips, and Plan shot rows show it; the viewer from item 3 plays the clip.

### 7. Plan shows the keyframes and clips
Media calls accept a `shot` annotation (`ctx.image({..., shot: "tofu-05"})`) that is **not** part of the step's identity, so adding it never re-pays. The view exposes `shotId` per step; the Plan row for a shot shows its chosen keyframe (else its newest made frame) and its clip's poster. The guidance and example always pass `shot`. Fallback for older plans: a choice id of the form `<shotId>-keyframe` links its options.

### 8. Retry with the owner's consent
- **Fewer false "lost" outcomes.** Adapters classify connect-phase errors (DNS, refused, TLS before the request body is written) as *definitely not submitted*: those retry safely without asking about money. Only a loss after the body may have reached the vendor stays "unknown".
- **The Director may retry.** `retry_step({stepKey, quote})` (contract `0.2.0`): for a failed or unknown step, with the person's consent quoted from their message or given on a choice card, the runtime opens a new attempt for the same step; the old liability stays counted. No plan edit or variant needed, so the rest of the film stays reused.
- **Plans can ask too.** Guidance and example show the in-program pattern for automatic flows: on `!clip.ok`, `ctx.choose("<shot>-retry", …)` with the honest cost line, then retry.
- The run never stops silently: a pass that ends with failed required steps reports `done_with_failures`, not `done`.

### 9. More video models, Seedance first
*Research and recommendation: see "Video providers".*

### B0. Vertical films
Code-mode video takes `aspectRatio` (one of the adapter's supported ratios) and otherwise follows the first frame's own aspect; the crop step uses it. The film's format can be declared once (`ctx.scene({format: "9:16"})` is already what the Director writes) and becomes the render default. Regression test: a 9:16 first frame reaches Viggle uncropped as 9:16.

## Music providers

Researched October 30, 2026; official docs and pricing pages; no account was used.

| Model | Access | API | Length | Instrumental | Output | Price | Commercial use |
|---|---|---|---|---|---|---|---|
| **Stable Audio 3.0** (Stability) | Self-serve key | Async: 202 + id, poll `/v2beta/audio/results/{id}` | Exact, 1–380 s | Prompt ("instrumental, no vocals") | WAV/MP3, 44.1 kHz | **$0.08 flat**, failed runs free | Output owned by the user; trained on licensed data |
| **ElevenLabs Eleven Music** (`music_v2_5`) | Self-serve key, Starter plan or higher | Sync `POST /v1/music` returns the file | Exact, 3–600 s | `force_instrumental` | MP3/PCM up to 48 kHz | $0.15/min | Commercial from Starter, **but "film" is excluded below Enterprise Music** (terms of 2026-10-09) |
| Google Lyria 3.5 (Gemini API) | Paid tier | Sync | No length control (~2–3 min) | Prompt | MP3/WAV 44.1 kHz | $0.08/song | No ownership claimed; SynthID watermark |
| MiniMax Music 3 | Direct API closed to new users; via fal | fal queue | ≤ 300 s | `[instrumental]` | WAV 44.1 kHz | fal $0.002/s | Not stated |
| ACE-Step 1.5 (open weights) | via fal | fal queue | 5–240 s | flag | WAV | fal $0.0002/s | Apache-2.0 (aggregator's claim) |

Not usable: Suno (no public API; invite-only partner program), Udio (closed platform), MusicGen (non-commercial weights), Lyria RealTime (WebSocket stream, no price), Mubert ($199/month for monetised use), Soundraw/Loudly/AIVA (sales-led or no API).

**Quality and control comparison** (owner asked for it, October 30).
- *Source:* the Artificial Analysis instrumental leaderboard v1.1: blind pairwise votes, about 21k votes across 17 genres, not film-specific.
- *Elo scale:* a 65-point gap means listeners prefer the higher model about 59% of the time. Suno v6 leads at 1148 but has no API.

| Model | Instrumental Elo | Length | Controls for film | Watermark / terms |
|---|---|---|---|---|
| Mureka V9.5 | 1084 (3rd–6th) | not published | instrumental endpoint, extend, 5/12 stems | paid API includes commercial use (second-hand); training data undisclosed |
| Lyria 3.5 | 1078 (3rd–6th) | only "influenced" (a 54 s ask ran 64 s) | BPM/key/sections in the prompt; no seed or editing | SynthID always on; preview |
| **Stable Audio 3.0** | 1014 (7th–12th) | **exact** | seed, inpaint a range, audio-to-audio; strong on beds and ambient, weaker on long arcs | **user owns output, licensed data, no watermark** |
| Eleven Music v2.5 | 1001 | exact, section plan | best control set (sections, stems, video-to-music) | **film excluded below Enterprise Music** |
| MiniMax Music 3 | 1000 | maximum only | seed; lyrics-first | weights licence asks for attribution in commercial UIs |
| ACE-Step 1.5 | not ranked (self-reported) | exact 10–600 s | BPM/key/time signature, repaint, stems | Apache-style model card; no indemnity |

**Recommendation (pending the owner's choice):**
- **Default: Stable Audio 3.0.** It is the only one with exact length, instrumental by design, seed and inpaint in the API, and the cleanest film terms (licensed data, user-owned output, no watermark, no film exclusion), at $0.08 per cue. The price is musicality: it sits mid-table, and about 59% of blind listeners prefer Lyria 3.5 or Mureka.
- **Optional second: Lyria 3.5** as a "richer score" choice at the same $0.08. It needs trimming and a fade at the cut, since it cannot hit an exact length, and every file carries SynthID.
- **ElevenLabs** stays out unless the owner gets Enterprise Music.
- **Bake-off:** a blind test of 5 cues × 3 providers (about $1.50) would settle quality and clean endings. It needs the owner's approval.

## Video providers

Researched October 30, 2026; official docs and pricing pages; no account was used. First-frame image-to-video, 5 s at 720p (1080p in brackets).

| Model | Official access | First / last frame | Length | Official price | Audio | Aggregators |
|---|---|---|---|---|---|---|
| **Seedance 2.0** | BytePlus ModelArk | ✓/✓ | 4–15 s | $0.76 ($1.87) | yes | Replicate $0.90, fal $1.51 |
| **Seedance 2.0 Mini** / Fast | same | ✓/✓ | 4–15 s, 720p max | $0.38 / $0.60 | yes | Replicate Fast $0.75, fal Mini $0.76 |
| Seedance 2.5 | same | ✓/✓ | 4–30 s | $1.16 ($2.84) | yes | Replicate $1.16 |
| **Seedance 1.0 Pro / Pro Fast** | same | ✓/✓ (Fast: first only) | 2–12 s | $0.26 ($0.61) / $0.11 ($0.24) | no | fal at list price |
| Kling 3.0 Std / Pro | Kling platform (prepaid packs) | ✓/✓ | 3–15 s | ~$0.42 | +50% | fal $0.42 / $0.56 |
| Veo 3.1 Fast / Lite | Vertex only (GCP project) | ✓/✓ | 4/6/8 s | $0.50 / $0.25 with audio | yes | fal Fast $0.75 |
| Wan 3.0 | Alibaba Model Studio | ✓/✓ | ≤ 30 s | $0.50 ($1.00) | ? | fal, same price |
| Runway Gen-4 Turbo | self-serve | first | 5–10 s | $0.25 | no | — |
| Sora 2 | **gone** (API removed 2026-09-24) | | | | | |

**Seedance API (BytePlus).**
- *Calls:* `POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks` with `content: [{type:"text"}, {type:"image_url", role:"first_frame"}, {role:"last_frame"}?]`, `ratio:"adaptive"` (keeps the first frame's aspect), `duration`, `resolution`, `generate_audio`, `watermark:false`, `return_last_frame`. Then `GET …/tasks/{id}` until `succeeded`, read `content.video_url`; the URL is valid 24 h.
- *Billing:* cost is computable before submit from tokens = seconds × width × height × 24 / 1024. Failed and moderated tasks are free.
- *Limits:* 3 concurrent on individual accounts. Video runs only in ap-southeast-1.

**Seedance caveats.**
- *Activation:* 2.x requires a $30 Credits activation.
- *Faces:* 2.x rejects input images with real-looking human faces unless they are ModelArk's own outputs. Photoreal Codex keyframes of people will likely be blocked; animals and stylised art are fine. 1.0 has no such rule documented.
- *US:* BytePlus video terms reportedly exclude the US. There, Replicate is the route, at list price or slightly above.
- *China:* Volcengine Ark has the same API (`doubao-seedance-*`, RMB, real-name verification).
- *The $1 limit:* one 5 s Seedance 2.0 clip is $0.76, so a multi-shot film needs Mini, 1.0 Pro, or a higher limit (item 4).

**Recommendation.**
1. **Seedance, official adapter** with three models: 1.0 Pro Fast for drafts ($0.11), 2.0 Mini for normal shots ($0.38), 2.0 for hero shots ($0.76). The price is computed exactly per call from duration and resolution, and `ratio:"adaptive"` fixes the vertical-film problem by design.
2. **One generic fal image-to-video adapter**, reusing the existing fal queue code and key (`fal-video`), with a short model table: Kling 3.0, Veo 3.1 Fast, Wan 3.0. fal charges about list price for those, while it charges about 2× for Seedance 2.x, so Seedance stays official.
3. Skip Sora (removed) and direct Vertex Veo (GCP auth work for little saving).

## Owner decisions (October 30)

- Seedance through BytePlus ModelArk, official.
- No cap on limit changes made in chat.
- Music: **Lyria 3.5 through the Gemini API**, using the same key variable as song analysis (`OPENSLATE_GEMINI_API_KEY`). It is paid tier only: the key's Google project needs billing. On October 30 that variable was not set on this machine, so the owner adds it. Card N3.
- Start Wave A.

## Phases and owners

Backend goes to Codex by card in its own worktree, the lead reviews and merges; the lead builds the UI and owns the shared contract (`studio-api.ts`, `port.ts`).

| Wave | Card | Owner | Items | Main files |
|---|---|---|---|---|
| A | N1 Failures, retry, spend limit | Codex | 8, 5 (server), 4 (tool and route), B0 | adapters' transport classification, code-plan execution/index/director/port, tools `0.2.0`, provider-input crop |
| A | N2 Video models | Codex | 9 | new provider adapters, execution registration, catalog, code-plan models |
| A | U1 Pictures, developer mode, failure dots | Lead | 2, 3, 5 (UI) | web only |
| B | N3 Music | Codex | 1 | new adapter, `ctx.music`, render audio, guidance |
| B | N4 Shots, posters, default limit | Codex | 6, 7, 4 (default for new films) | step annotation, poster derivation, studio setting |
| B | U2 Plan sync, posters, limit settings | Lead | 4, 6, 7 (UI) | web only |
| C | Live check | Lead | all | one real film ≤ $1: vertical, music, a forced retry |

Wave A cards touch disjoint files except the code-plan model table (N1 crop vs N2 adapters); N2 merges after N1.

## Risks

- **Retry spend.** A retry after an unknown outcome can charge twice. Every such retry needs the person's consent and shows the cost; the old liability keeps counting against the limit.
- **Contract bump.** Tools `0.2.0` changes the Director's catalog and guidance digest; films pinned to `0.1.0` must keep running unchanged.
- **New vendors.** Keys go into `.env.live.local` by the owner; adapters ship with offline fixtures only, and each vendor gets one small live check under $1.
- **Music licensing.** Use only providers whose terms grant commercial use of generated music; the film records which model made it.
