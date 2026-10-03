# Timeline and rendering

The timeline is an editorial use of exact selected takes and accepted audio. It is distinct from shot intent or the provider's original clip. OpenSlate captures a revision-bound immutable manifest and renders it locally with FFmpeg.

## Canonical time and limits

Picture uses integer frames at 30/1 fps. Audio uses integer samples at 48,000 Hz; one picture frame is 1,600 samples. Absolute boundaries are converted once to avoid cumulative rounding drift.

The current local document supports up to **360 seconds, 64 cuts, 65 audio placements and 65 distinct audio sources**, with **eight simultaneous mixing lanes**. The transition is a cut. Inputs are normalized silent H.264 video and measured 48 kHz stereo PCM audio. Source ranges must actually exist in their owned media.

Accepted compact voiceover uses its exact range within the planned shot. Short audio ends while picture continues; it is never padded to imply accepted coverage. Compact placement follows current shot order. Legacy absolute audio keeps its saved coordinates. Optional owned background music supplies one chosen range/gain; looping, fades, ducking and limiting are not implemented.

## Capture and execution

1. Resolve selected owned clip/audio identities, exact hashes, ranges, order and gain.
2. Validate current accepted narration, render bounds and pinned local execution.
3. Save a digest-bound local timeline document and durable completion receipt.
4. Run FFmpeg with trusted argument arrays and bounded child-process/media validation.
5. Probe the returned MP4, retain its exact recipe/content identity and publish the compatible export selection.

Local operations require no external paid allowance. They still respect pause/holds, current selection, leases and installation recovery quarantine. Interrupted completed renders recover from immutable receipts rather than reinterpreting a changed project.

## Browser playback

[Timeline](../../apps/web/src/Timeline.tsx) previews muted picture with accepted narration and music on a shared playback clock. Seek, pause, buffering and revision cleanup synchronize the tracks. An eight-entry current/upcoming audio cache and viewport media release bound retained media. The FFmpeg export is the exact final timing/output; browser preview uses the browser clock.

## Source and checks

- [Timeline capture](../../apps/server/src/media/timeline-capture.ts), [local document](../../apps/server/src/media/local-timeline.ts), [local media](../../apps/server/src/media/local-media.ts)
- [Audio placement](../../apps/server/src/narration/audio-placement.ts), [local executor](../../apps/server/src/execution/local-media-executor.ts)
- Tests: `timeline-capture.test.mjs`, `local-timeline.test.mjs`, `media-rendering.test.mjs`, `media-audio-scale.test.mjs`, shot-audio placement and web playback/cache suites.
- Actual synthetic short-overlay/65-placement verification: [October 1 review](../implementation/V1-COMPLETION-REVIEW.md). Actual real six-second export: [dated evidence](../implementation/LIVE-VALIDATION.md).

Advanced trimming/transitions, waveform editing and range streaming remain pending; synthetic six-minute verification does not establish a six-minute real-provider film.
