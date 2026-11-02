# N2 · Seedance (official) and a fal image-to-video adapter

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, never read `.env*`, never start anything on port 3001.
- **Exception to the network rule:** you may read the public documentation pages listed below with plain GET requests. Make no API calls and use no keys.
- **If a page is unreachable,** use the shapes in this card and say so in your report.

Then read `docs/ai/code-plan/NEXT.md` ("Video providers"), the P4a report, and the existing adapters in `packages/providers/src/` (`viggle-h3.ts`, `minimax-h3.ts`, `fal-h3-lipsync.ts`) with their server execution files in `apps/server/src/execution/`.

## Problem

Code plans can make clips only with Viggle H3 and MiniMax H3. The owner wants more video models, Seedance first, through **BytePlus ModelArk (official)**. Research (October 30, 2026) recommends one official Seedance adapter, plus one generic fal adapter for the other strong models. fal charges about list price for those, but about 2× for Seedance 2.x.

## Change

1. **Seedance adapter** (`adapter: "seedance"`), BytePlus ModelArk, region ap-southeast-1.
   - **Create:** `POST https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks`, `Authorization: Bearer <key>`, body:
     - `model`;
     - `content: [{type:"text", text}, {type:"image_url", role:"first_frame", image_url:{url: "data:image/png;base64,…"}}, {type:"image_url", role:"last_frame", …}?]`;
     - `resolution` (`480p|720p|1080p`), `ratio` (default `"adaptive"`, which keeps the first frame's aspect; also `16:9 4:3 1:1 3:4 9:16 21:9`), `duration`;
     - `generate_audio` (default false), `seed`, `watermark:false`, `return_last_frame:true`.

     The response is `{id}`.
   - **Poll:** `GET …/tasks/{id}` → `status` `queued|running|succeeded|failed|expired|cancelled`, `content.video_url` (valid 24 h), `content.last_frame_url`, `usage.completion_tokens`, `error`. `DELETE …/tasks/{id}` cancels a queued task.
   - **Models:** `seedance-1-0-pro-fast-251015` (drafts, first frame only), `dreamina-seedance-2-0-mini-260615` (720p max), `dreamina-seedance-2-0-260128`. Verify the ids against the model list page.
   - **Input limits:** images 300–6000 px, aspect 0.4–2.5, under 30 MB, so downscale or refuse. Output is 24 fps.
   - **Price, computed exactly before submit:**
     - tokens = output seconds × width × height × 24 / 1024, with width × height taken from the resolution and the first frame's aspect;
     - rates per 1M tokens: 1.0 Pro Fast $1.00, 2.0 Mini $3.50, 2.0 $7.00 (2.0 at 1080p $7.70).
     - Record the actual `usage.completion_tokens` cost as evidence.
     - Failed and moderated tasks are free, so they release liability.
   - **Moderation:** Seedance 2.x rejects first frames with real-looking human faces. Map that refusal to a clear error code with `retry: "none"` and a plain message.
   - **Ingest:** the clip, through the existing spool and ingesters (24 fps input is normalized by the existing media path). Keep `last_frame_url` as an owned image artifact when present.
   - **Unknown outcomes:** P1/P4a rules. A lost create response is reconciled by lookup only if the API offers a list/filter that can find the task; otherwise unknown, with liability retained. Connect-phase errors (no connection made) are "not submitted", the same rule card N1 adds for Viggle and MiniMax. Implement it in your adapters the same way.
   - **Credentials:** a new credential name for the ModelArk key, read by the existing credential resolver from an environment variable you name. Document it for the owner. Egress is allowlisted to the API host and the video/image download hosts named in the docs.
2. **Generic fal image-to-video adapter** (`adapter: "fal-video-i2v"`). It reuses the fal queue client and the `fal-video` credential from `fal-h3-lipsync.ts`; refactor shared pieces into a small module rather than copy them. Model table, each with its own field map (`image_url`, `prompt`, duration, resolution/aspect, audio flag) and its price from that model's `https://fal.ai/models/<id>/llms.txt`:
   - Kling 3.0 Standard (silent),
   - Veo 3.1 Fast,
   - Wan 3.0.

   Unknown models are refused.
3. **Code plans can use them.**
   - **Models:** add both adapters to `supportedCodePlanAdapters` and `provider-input.ts` (duration bounds per model, the `aspectRatio` mapping, `ratio:"adaptive"` by default for Seedance).
   - **Pricing:** these prices depend on the input (duration, resolution). Put each adapter's price in **one** function used by `modelPrice`, the step reservation and `provider-authority.ts`. A duplicate pricing rule there caused a real bug in P4a.
   - **Catalog:** `read_film` lists the models with their price basis.
   - **Docs:** a short section in the code-plan guidance says which model to use for drafts, normal shots and hero shots, and warns about the face rule. Update the digest pin.
4. **Profiles.** Make both adapters installable as provider profiles the same way Viggle and MiniMax are. Give the owner a copy-paste example for `.env.live.local` covering the profile JSON and the key variable names; describe it, never create or read that file. Graph projects must ignore these adapters cleanly: no crash and no quote.
5. **Tests**, offline, against loopback fakes of both APIs:
   - create → poll → download → ingest;
   - exact price before submit, matching the authority check;
   - moderation refusal → `retry: "none"`, liability released;
   - a lost create → unknown, never resubmitted;
   - connect refused → not submitted;
   - adaptive ratio for a 9:16 first frame;
   - fal field maps for the three models;
   - an unknown fal model refused;
   - graph projects unaffected.
6. **Docs:** `docs/technical/PROVIDERS-ARTIFACTS.md` (adapters, prices, limits, the face rule, the setup example) and a `docs/implementation/STATUS.md` entry.

Documentation pages you may read (GET only):
- https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api
- https://docs.byteplus.com/en/docs/modelark/get-video-generation-task-api
- https://docs.byteplus.com/en/docs/modelark/model-list
- https://ai.byteplus.com/ark/region:ap-southeast-1/docs/model-pricing
- https://docs.byteplus.com/en/docs/modelark/seedance-portrait-asset-guide
- https://fal.ai/models/fal-ai/kling-video/v3/standard/image-to-video/llms.txt (and the Veo 3.1 Fast and Wan 3.0 equivalents; find their exact ids on fal.ai)

## Files you own

- New files in `packages/providers/src/` and `apps/server/src/execution/`.
- The provider registration and credential naming.
- `apps/server/src/code-plan/models.ts`, `provider-input.ts`, `provider-authority.ts`. Card N1 also edits code-plan files; keep your changes narrow, the lead merges N1 first.
- `skills/code-plan/**`, with the digest pin.
- Tests and docs.

Do not edit `packages/core/src/studio-api.ts` or `apps/web/**`.

## Out of scope

Live calls (the lead runs one small paid check per vendor later), graph-mode support, music, and Veo/Vertex direct.
