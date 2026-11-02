# N3 · Background music for code plans (Lyria 3.5)

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, never read `.env*`, never start anything on port 3001.
- **Exception to the network rule:** you may read the two documentation pages below with plain GET requests. Make no API calls and use no keys.

Then read `docs/ai/code-plan/NEXT.md` (item 1 and "Music providers"), the N1 report, and `packages/providers/src/gemini-audio.ts` (the existing Gemini client, used for song analysis).

## Problem

Code plans cannot make music. The owner's Director wrote `musicStatus: "待提供有授权的配乐"` into a scene and rendered a silent film. The owner chose **Google Lyria 3.5 through the Gemini API**, using the same key variable as song analysis (`OPENSLATE_GEMINI_API_KEY`).

## The API (Gemini docs of 2026-10-01 and pricing of 2026-10-28)

- **Request:** `POST https://generativelanguage.googleapis.com/v1beta/interactions`, header `x-goog-api-key`, body `{ model: "lyria-3.5", input: "<prompt text>", response_format: { type: "audio" } }`. `response_format` audio returns WAV; the default is MP3.
- **Response:** the reply carries a `steps` array. Audio is base64 `data` on an audio content block; lyrics or structure come back as text blocks.
- **Output:** 44.1 kHz stereo.
- **Behaviour:** single turn, no seed, no editing; results vary between calls.
- **Length:** "A couple of minutes (controllable using prompt)". There is no exact length or maximum, so the request has to state the length in words.
- **Watermark:** every output carries an inaudible SynthID audio watermark.
- **Safety:** prompts go through safety filters; artist voices and copyrighted lyrics are blocked.
- **Price:** `$0.08 per song`, **paid tier only** (the free tier is "Not available"). A key on a project without billing is refused.

Pages: https://ai.google.dev/gemini-api/docs/music-generation and https://ai.google.dev/gemini-api/docs/pricing

## Verified live (October 30, one $0.08 call with the owner's key, 200 in 19 s)

Where this disagrees with the docs above, this wins:

- **Format:** the response was `audio/mpeg`, even with `response_format: {type: "audio"}`: MP3, 192 kbps, 44.1 kHz stereo, not WAV. Accept both by `mime_type`. MP3 is already in the media path's input whitelist.
- **Length:** a prompt asking for about 20 seconds came back **68 s** long, so the text only loosely steers it. Never rely on the length; always trim at the cut.
- **Silence:** about 1.2 s of silence at the start and 2.7 s at the end.
- **Shape:** `steps` held two `model_output` entries: a text block (`[[A0]]\n[[B1]]\n…`) and then the audio block `{data, mime_type, type: "audio"}`. Find the audio block by `type`, not by position.
- **Size:** 2.18 MB of base64 for 68 s. A full song needs a response limit well above the Gemini client's 4 MiB `responseBytes`.
- **Metadata:** `GET /v1beta/models/lyria-3.5` lists `generateContent` and `countTokens`; `interactions` works as documented.

## Change

1. **Adapter `gemini-lyria`** (`packages/providers/`), next to `gemini-audio.ts`. Share its origin, header and response-size handling; do not copy them.
   - **Prompt:** built from `prompt`, the requested `durationSeconds` ("about N seconds long, ending with a clean final chord") and `instrumental` (default true: "instrumental, no vocals").
   - **Call:** synchronous with a long timeout (≥ 240 s). Decode the base64 audio (MP3 or WAV by `mime_type`), then spool and ingest it through the existing audio path (measured, resampled to 48 kHz, owned).
   - **Silence:** measure the leading silence on ingest and expose it on the result (for example `leadInSamples`), so a placement starts on the first note.
   - **Error mapping:**
     - safety refusal → `retry: "none"`;
     - 429 → busy;
     - 401/403 or a billing/free-tier refusal → a key error whose message says the key's Google project needs billing for Lyria;
     - transport loss after the request was sent → unknown, may have charged (no lookup exists).
   - **Connect-phase errors:** "not submitted", per N1's `connect-failure.ts`.
2. **Credentials and profile.**
   - **Credential:** a `gemini-music` slot reading `OPENSLATE_GEMINI_API_KEY`, the same variable as `gemini-audio`.
   - **Profile:** installable like the others. Kind `music`, `unitCostMicros: "80000"`.
   - **Egress:** allowlisted to `generativelanguage.googleapis.com`.
   - **Setup docs:** give the owner the profile JSON for `.env.live.local`, without reading or creating that file.
3. **`ctx.music({model?, prompt, durationSeconds, instrumental?, variant?})`**:
   - Returns a media result with an owned audio artifact, priced per call. The ceiling, holds, retry and N1 rules apply.
   - The new step kind is `music`. The lead adds `"music"` to `CodePlanStepKind` in `packages/core/src/studio-api.ts` before you start, and you use it.
   - The code-plan models list Lyria with its price and the note "length is approximate; trim and fade at the cut".
4. **Placing music in the render.**
   - Code-plan audio placements accept `fadeOutSamples`.
   - Raise the fade bound for code-plan placements to 5 s (240 000 samples) in `timeline-capture.ts` / `local-timeline.ts` / `local-media.ts`. Keep the existing 0.1 s bound for storyboard narration unless a single shared bound is simpler and safe; say which you chose.
   - Music longer than the picture is trimmed by `durationSamples`, which already happens.
5. **Guidance** (`skills/code-plan/`, update the digest pin):
   - **When:** make the music once the cut's length is known. The length Lyria returns is only loosely related to the request (20 s asked, 68 s returned), so always trim: place it at sample 0, skip its lead-in with `startSample`, set `durationSamples` to the film and fade the last 2 s. If a track is shorter than the film, say so and make another with a `variant`.
   - **Mix:** about −14 dB under speech, about −6 dB when the film is silent.
   - **Mood:** say the mood, instruments and tempo in words.
   - **Tell the person:** the file carries a SynthID watermark.
   - **Regenerating:** use a `variant`.
   - **Example:** extend the example plan with one music step behind the two clips.
6. **Tests** (offline, loopback fake of the interactions API):
   - an MP3 response (as verified live) and a WAV response each → owned 48 kHz audio artifact;
   - a text block before the audio block is ignored; a response with no audio block fails clearly;
   - leading silence is measured and a placement can skip it;
   - safety refusal, 429, the 403 billing refusal and transport loss after send each map as above;
   - the ceiling counts $0.08;
   - a render places the music with a 2 s fade and trims it to the film;
   - the P2c end-to-end flow still passes;
   - graph projects unaffected.
7. **Docs:** `docs/technical/PROVIDERS-ARTIFACTS.md` and `TIMELINE-RENDERING.md` (the fade bound), plus a `docs/implementation/STATUS.md` entry.

## Files you own

- New adapter files in `packages/providers/src/` and `apps/server/src/execution/`.
- The credential slot.
- `apps/server/src/code-plan/**`, except `port.ts`.
- The narrow fade-bound change in `apps/server/src/media/`.
- `skills/code-plan/**`, with the digest pin.
- Tests and docs.

Do not edit `packages/core/src/studio-api.ts` or `apps/web/**`.

## Out of scope

The live call (the lead runs one $0.08 check once the owner has added a billing-enabled key), other music providers, stems, editing.
