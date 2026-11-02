# Timeline and rendering

The timeline is an editorial use of exact selected takes and accepted audio. It is distinct from shot intent or the provider's original clip. OpenSlate captures a revision-bound immutable manifest and renders it locally with FFmpeg.

## Canonical time and limits

Picture uses integer frames at 30/1 fps. Audio uses integer samples at 48,000 Hz; one picture frame is 1,600 samples. Absolute boundaries are converted once to avoid cumulative rounding drift.

The current local document supports up to **360 seconds, 64 cuts, 65 audio placements and 65 distinct audio sources**, with **eight simultaneous mixing lanes**. The transition is a cut. Inputs are normalized silent H.264 video and measured 48 kHz stereo PCM audio. Source ranges must actually exist in their owned media.

Accepted compact voiceover uses its exact range within the planned shot. Short audio ends while picture continues; it is never padded to imply accepted coverage. Canonical placement follows current shot order. The separate plan-DSL asset timeline still accepts explicit absolute audio coordinates and exact-length timing pending its planning-layer removal. Optional owned background music supplies one chosen range/gain; automatic looping and ducking are not implemented in the storyboard editor. Code-film 0.3.0 renders separately use measured loudness mastering. Explicit per-placement fade-out is supported as described below.

## Storyboard exports

The next Film view uses `GET /api/projects/:projectId/exports` for readiness/current/history and `POST` on the same route with `expectedHeadVersion` and an idempotency key. Capture follows current storyboard scene/shot order, chosen clips, accepted narration and music; it does not require a Director-authored render plan. Missing/outdated clips or unsettled voice are blockers. All-demo exports receive a Demo stamp; mixing demo and real media is refused.

`POST .../exports/:exportId/cancel` and `/recover` retain the original render identity. History reports whether shots, order, music or narration changed. Completed bytes use the owned artifact content route. The older `/media/renders` routes remain for historical Director plans; they are not the current export entry.

## Capture and execution

1. Resolve selected owned clip/audio identities, exact hashes, ranges, order and gain.
2. Validate current accepted narration, render bounds and pinned local execution.
3. Save a digest-bound local timeline document and durable completion receipt.
4. Run FFmpeg with trusted argument arrays and bounded child-process/media validation.
5. Probe the returned MP4, retain its exact recipe/content identity and publish the compatible export selection.

Storyboard export is local, creates no generation authority and may run while stopped. Film order/music edits are hold-free; capture still checks current selection, source integrity, leases and installation recovery quarantine. Paid media remains fenced by Stop. Interrupted completed renders recover from immutable receipts rather than reinterpreting a changed project.

## Browser playback

[Film](../../apps/web/src/next/views/film/FilmView.tsx) previews muted picture with accepted narration and music on a shared playback clock. Seek, pause, buffering and revision cleanup synchronize the tracks. Audio loading and media cleanup are bounded to the current view. The FFmpeg export is the exact final timing/output; browser preview uses the browser clock.

## Source and checks

- [Storyboard capture](../../apps/server/src/media/storyboard-capture.ts), [historical plan capture](../../apps/server/src/media/timeline-capture.ts), [local document](../../apps/server/src/media/local-timeline.ts), [local media](../../apps/server/src/media/local-media.ts)
- [Audio placement](../../apps/server/src/narration/audio-placement.ts), [local executor](../../apps/server/src/execution/local-media-executor.ts)
- Tests: `timeline-capture.test.mjs`, `local-timeline.test.mjs`, `media-rendering.test.mjs`, `media-audio-scale.test.mjs`, storyboard export/HTTP and stopped-export suites, shot-audio placement and next Film clock/audio/export tests.
- Actual synthetic short-overlay/65-placement verification: [October 1 review](../implementation/V1-COMPLETION-REVIEW.md). Actual real six-second export: [dated evidence](../implementation/LIVE-VALIDATION.md).

General timeline trimming/splitting, transitions, waveform editing and range streaming remain pending in the studio editor; code-plan source-row trimming/speed/holds/zoom are implemented as described below; synthetic six-minute verification does not establish a six-minute real-provider film.

## Code-plan music fades (N3)

Code-plan audio rows accept `{artifact, startSample?, durationSamples?, atSample?, gainMilliDb?, fadeOutSamples?}`. All coordinates are measured 48 kHz samples. `fadeOutSamples` is a positive integer no larger than the placement duration or **240,000 samples (5 seconds)**. The same bound is shared by local timeline validation and frozen render manifests; FFmpeg applies the fade after trimming and gain, ending exactly at that placement’s cut. Storyboard narration’s existing capture producers continue to choose/clamp fades to **4,800 samples (0.1 seconds)**; widening the shared validator does not alter those placements.

Make music after picture duration is known. Place it at sample zero, use `startSample: music.leadInSamples`, set `durationSamples` to the film’s total samples and `fadeOutSamples: Math.min(96000, filmSamples)` for the last two seconds. A track must have enough samples left after its lead-in; a shorter one requires another variant. The source is retained whole, and the render trims only the placement. Mix around -14 dB under speech or -6 dB with no speech. Render lengths, eight-lane limits, ownership and source-range checks are unchanged. `code-plan-music.test.mjs` verifies normalized MP3/WAV, skipped silence, exact picture trim and the measured fade in decoded render audio.

## Code-plan editing and mastering (0.3.0)

`ctx.render` accepts owned clips or timeline rows with `startFrame`, `durationFrames`, `fit`, speed (0.5/0.75/1/1.25/1.5/2), a 1–90 frame final hold and fixed zoom (1 < scale ≤ 1.4, normalized centre point). A row lasts `round(durationFrames / speed) + holdFrames`; source bounds still apply. These are cut-based program controls, not a general editor or animated camera path.

Captions address finished-film frames (up to 64, nonoverlapping, 1–80 characters/two lines); mixed Chinese needs an installed CJK font. Audio placements add `fadeInSamples` beside fade-out, bounded by five seconds and placement duration. Six local sounds (`pop`, `thud`, `whoosh`, `ding`, `tick`, `boing`) use finished-film samples, are free and count toward audio placement/lane limits. They do not consume media steps. New 0.3.0 audio renders measure/apply loudnorm at -14 LUFS; legacy manifests without mastering/edits retain their own identities.

Video frames come from the owned sources; provider-generated embedded sound is still stripped on normalization. The Director inspects contact sheets, not the resulting audio. Inspect/listen to the actual MP4 for quality acceptance. Source contract: [studio.d.ts](../../skills/code-plan/references/studio.d.ts); implementation: [code runtime](../../apps/server/src/code-plan/index.ts) and [local media](../../apps/server/src/media/local-media.ts).
