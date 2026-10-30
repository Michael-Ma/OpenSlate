# P4b · First real code-plan film

Lead run, October 29, 2026, on `feature/last-ferry-ui` at `ac4195a`. Real providers: the Codex subscription for the Director and keyframes, Viggle H3 for clips. Silent film, no OpenAI speech.

## Result

One message produced a finished 12-second film. Nothing failed, nothing was retried, and the server log has no warnings or errors.

- **Spend:** $0.20 of the $1.00 ceiling, two clips at the profile's $0.10 per call. Keyframes cost $0 (Codex plan). Viggle bills about $0.01 a second, so the actual charge for 2 × 6.6 s should be about $0.13; this was not checked against the vendor.
- **Film:** `ffprobe` gives h264, 1280×720, 30 fps, 12.000 s, no audio track. The render letterboxes the two 1344×768 Viggle clips (6.6 s each) and trims each to 180 frames.
- **Content:** matches the brief (contact sheet: [`p4b/film-contact-sheet.jpg`](p4b/film-contact-sheet.jpg)). In shot 1 the woman in the red coat stands at the rail with a slow push-in. In shot 2 her hand opens and the ticket falls toward the water.

## Flow and timings

| Step | Time | Duration |
|---|---|---|
| Brief sent ("silent two-shot film … two keyframe options per shot … 6-second clip from the frame I pick … render") | 22:44:47 | |
| Director submits plan version 1 (scene, 2 shots, 4 images, 2 choices, 2 clips, render) | 22:45:35 | 48 s |
| Four Codex keyframes, one after another | 22:45:35–22:47:24 | 30, 22, 29, 28 s |
| Choice 1 answered (lead) | 22:48:16 | waited 52 s |
| Viggle clip 1 (submit → ingested) | 22:48:16–22:50:23 | 2 min 07 s |
| Choice 2 answered (lead) | 22:50:53 | waited 30 s |
| Viggle clip 2 | 22:50:54–22:52:37 | 1 min 43 s |
| Local render, probed MP4 | 22:52:37–22:52:40 | 3 s |

The whole run took 7 min 54 s; the machine's share is about 6 min 30 s. Against LIVE-4b (keyframes 35–48 s each, then a 25 s review): code-mode keyframes took 22–30 s each, and the review step is replaced by choosing in the chat.

The Director's program used the installed profile ids (`codex-keyframes`, `viggle-live-six-seconds`) and `local-render`. It declared a scene and both shots, asked with `ctx.choose`, logged and stopped on a failed result instead of retrying, and quoted the cost correctly: "Certain cost: $0. Later clips are estimated at $0.20."

## Findings

1. **Parallel keyframes run serially.** The plan starts all four images with `Promise.all`, but Codex image runs them one at a time, so the frames took 1 min 49 s. Because the program waits for all four before the first `ctx.choose`, shot 1's choice could have appeared about a minute earlier. Fix: either the guidance tells the Director to ask per shot as soon as that shot's frames exist, or the Codex image profile gets more concurrency.
2. **The Plan tab showed "This version declares no scenes or shots" for a few seconds**, until the first pass reached `ctx.scene`/`ctx.shot`. It should say the plan is still running instead.
3. **The choice-card thumbnails are too small to compare.** Choosing meant looking at the Keyframes tab. The card needs a larger view on click or hover.
4. **The render has no audio track.** ~~Storyboard exports carry 48 kHz audio~~. Correction: this is the shared renderer's contract. With no audio placements it writes no audio track and checks for exactly that (`Unexpected output audio`), so storyboard exports without narration are video-only too. No change.
5. **Film › Renders lists the render as "No prompt".** A label such as "Film render" would read better.

## Setup and safety

- Fresh data directory `~/openslate-live-code-20261029`. The studio loaded the owner's `.env.live.local` through `node --env-file`; the file was never opened. Port 3001 was free before the run, and the studio was stopped afterwards.
- Spend under $1, so the lead confirmed both clip choices without asking (owner rule). No unsandboxed Codex agent was used: the studio itself ran the Codex CLI.

## Follow-up fixes

- **1:** the guidance and the two-shot example now run each shot as its own pipeline (frames, choose, clip), with all shots started together. A shot's choice appears as soon as its own frames exist, and its clip runs while the next shot is being chosen. The guidance digest is re-pinned. A side effect: the P2c motion edit's preview now reaches seven reused steps instead of three.
- **2:** before the first pass ends, the Plan tab says the plan is running instead of "declares no scenes or shots".
- **3:** a media choice card has **Compare larger**, a dialog with the options side by side, each with its own Choose. An answered card opens it read only.
- **5:** a render with no label is named "Film render".
