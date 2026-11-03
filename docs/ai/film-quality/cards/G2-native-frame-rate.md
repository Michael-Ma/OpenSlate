# G2 · Clips keep their own frame rate, and code films play at 24 fps

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. G1 (Viggle quality and export size) and G3 (shot lengths in the code-plan skill) run at the same time. Stay out of `apps/server/src/application/provider-catalog.ts`, `packages/core/src/aspect.ts`, `apps/server/src/code-plan/model-pricing.ts` and `skills/**`. You own `apps/server/src/media/**`, `apps/server/src/execution/video-derivation.ts`, `apps/server/src/execution/spool-video-ingester.ts`, `apps/server/src/execution/local-media-executor.ts`, `apps/server/src/code-plan/clip-frames.ts`, `apps/server/src/toolchain-probe.ts`, their tests, and the render/normalization sections of `docs/technical/EXECUTION-ENGINE.md`. If you must change a file outside this list, say so in the report and keep the change minimal.

## Problem (measured on the owner's film, 2026-11-02)

Viggle (MiniMax H3) returns 768×1344 H.264 at **24/1** fps, 1.9 Mbps, 8.000 s. Normalization (`apps/server/src/media/local-media.ts`, the `fps=30` filter near line 335, and the `frameRate === "30/1"` check after it) turns it into 30 fps by duplicating every fourth frame; the render then runs at 30 fps too. Every motion judders. Seedance, Veo, Kling and MiniMax also deliver 24 fps, so this affects almost every generated clip.

## Lead decisions

- **The plan API keeps its unit.** `startFrame`, `durationFrames`, `holdFrames`, caption `atFrame`/`durationFrames` and `read_clip_frames` numbering stay 1/30 s positions, exactly as today. Saved plans keep their meaning, their step keys and their purchases. No tool-contract change.
- **Normalized clips keep their source frame rate** when it is a constant 24, 25 or 30 fps (accept 24000/1001 and 30000/1001 too, kept as they are). Anything else is normalized as today. Keep every other normalization property (SAR 1, even size, yuv420p, rotation 0, no audio, bounded size).
- **Code-film renders play at 24 fps.** The renderer turns the 1/30 s timeline into output time and takes the source frame shown at that time (no interpolation, blending or motion synthesis). A 24 fps source at speed 1 must come out frame for frame: every output frame is a distinct source frame, in order. `speed`, `holdFrames`, `zoom`, `fit`, captions and the 48 kHz audio keep their timing to the nearest output frame; the film's length is the timeline length rounded to whole 24 fps frames, and audio is trimmed to match it.
- **Graph (non-code) films stay at 30 fps.** Only change them if they share the code path in a way you cannot separate; say so in the report.
- **Existing films** may re-normalize and re-render locally (free). That must never resubmit, re-poll or re-download a provider job.

## Tests

1. A 24 fps fixture (ffmpeg `testsrc2` or similar with a burned-in frame counter, about 3 s) normalizes to `24/1` with the same frame count and identical decoded frames.
2. Rendering it whole at speed 1 gives a `24/1` film whose decoded frames are all distinct and in source order (compare per-frame hashes; no two consecutive equal).
3. Cuts given in 1/30 s positions land on the nearest 24 fps frame, and the output length is `round(ticks / 30 × 24)` frames; captions and audio stay in sync within one output frame.
4. A 30 fps source in a code film renders at 24 fps, dropping frames evenly, with no repeated frame.
5. `speed`, `holdFrames` and `zoom` rows still render with the expected on-screen length.
6. A saved code film with finished clips replays and renders without any new provider call.
7. Graph-film render tests keep passing unchanged (or, if you had to touch them, explain why).

## Finish

Run the media, render, code-plan and execution suites, then `pnpm test` and `pnpm typecheck`. Write `docs/ai/film-quality/reports/G2-report.md`: what changed, the measured before/after frame counts and rates of a real 24 fps clip, and any place that still assumes 30 fps.
