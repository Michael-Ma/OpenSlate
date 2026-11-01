# Q4 — captions, sound and row edits

Q4 implements the render additions in `cards/CONTRACT.md`. Changes remain uncommitted in `codex/q4-render`. No other card's source, web code, browser contract, schema, saved guidance archive or implementation status was edited. All work and validation were offline; no browser, provider, external network, protected-state read or port-3001 listener was used.

## Implemented

- `speed`: exactly 0.5 / 0.75 / 1 / 1.25 / 1.5 / 2, `setpts` plus CFR frame selection, exactly `round(sourceFrames / speed)` frames. `holdFrames` adds 1–90 copies of the last used frame. `zoom` is a fixed crop and scale with `1 < scale <= 1.4` and focus coordinates in 0–1, with the crop clamped to the source. All three compose on one row. Validation reports the row, field and range. The finished total obeys both the project limit and the existing 10,800-frame local limit.
- Captions: 64 maximum, 1–80 Unicode code points, nonoverlapping finished-film frame intervals; top/middle/bottom at 12% / 50% / 78%. Canvas measures and wraps text to two lines in 84% of the output width; overflow reports the actual pixel/font-size limit. Bold white text has a dark outline and soft shadow over transparent pixels, without a box. Rasterized PNGs use separate `png_pipe` inputs and frame-number-enabled overlays.
- Fonts: `GlobalFonts` selects the specified platform CJK families before Latin fallbacks. CJK text without an available CJK family fails explicitly; tests inject the lookup. Font family, readable font-file SHA-256 and caption PNG SHA-256/byte length are frozen in the manifest and completion receipt. Replay reads those PNGs, without re-rasterizing or needing the current font. No font was added or downloaded. The native canvas/font catalog loads only when captions need it, so graph composition and caption-free films do not acquire that startup dependency.
- Mastering: code films locked to exactly 0.3.0 receive final-mix `loudnorm` with I=-14, TP=-1.5, LRA=11. A bounded audio-only measurement pass supplies loudnorm's measured values for the final pass; this fixes transient-heavy sound mixes that single-pass loudnorm can miss. Graph films and 0.1.0/0.2.0 code films keep their old filter graph. No-audio films remain without an audio track. `fadeInSamples` has the existing fade-out limits: 1–min(240000, placement duration).
- Sounds: `pop`, `thud`, `whoosh`, `ding`, `tick`, `boing` are synthesized offline using `aevalsrc`. The six WAVs are 48 kHz stereo PCM, 0.09–0.72 s and 17,324–138,284 bytes apiece. Names address fixed local assets; normal source verification, placements, eight mixing lanes and the 65-placement code timeline limit apply. Sounds create no media step, provider request or charge. The pack digest is part of the frozen recipe/receipt; frozen sources survive a later pack swap.
- The code-plan `render` declaration/doc comment now uses the exact shared types. `read_film` has no new projection. Source, caption and placement errors name their row/caption where applicable.

Absent fields are omitted rather than defaulted into normalized inputs, timelines or manifests. The regression compares the saved render step key to the previous normalization formula and checks the graph manifest/timeline field sets. Old code captures still call `captureCodePlanRender` unchanged. The extended adapter reuses its ownership resolver per row, checking length only after edits; this permits a long source trimmed or sped into a shorter allowed film.

## Contract and merge notes

`packages/core/src/studio-api.ts`: **none**. No shared core types were changed; extended server-only types live in the owned timeline/media modules.

Q3's 0.3.0 catalog is not introduced here. Mastering reads the film's saved `director_skill_lock` contract, with the imported `CODE_PLAN_TOOL_CONTRACT` as the single build fallback. `LocalMediaExecutor` has a trusted `codePlanContract` injection for offline 0.3.0 tests. Once Q3 updates the core constant, new films use that default automatically; existing film locks and already frozen intents keep their recipes.

The current guidance package digest, after changing only the render declaration and its supporting types, is `8eb94a6880275d9c89b6c508fc2d1d8b9a3217e2b57fcea929da3fbe5409b251`. Its pin in `apps/server/src/application/director-capabilities.ts` was updated as the card requests. The lead must recompute it after merging the other guidance edits. Plan normalization checks caption fitting using explicit dimensions or its 1280×720 default; the final project dimensions are checked again before rasterization. Font availability and fitting can therefore still refuse a render on another machine or a different implicit aspect ratio.

## Actual clip comparison

The read-only, existing research render `.../editing-research/render/c-captions.mp4` supplied the Tofu bowl shot, frames 480–539 (16–18 s), at 1080×1920/30 fps. No `.openslate` source was opened. The service imported that clip and produced 540×960 comparisons in `/tmp/openslate-q4-visual-lIY8If/`. These are disposable evidence, not repository assets.

- [Comparison sheet](/tmp/openslate-q4-visual-lIY8If/comparison.png), visually inspected offline: the centered 1.4× crop enlarges the dog's face and bowl; x=0.7 shifts the fixed crop right. Both remain sharp enough at this comparison size, with no generated camera motion.
- Speed 2× changes 60 frames to 30, preserving the same source action at matching source times. Hold 30 adds a second, making 90 frames; decoded frames 59 and 89 differ by only 0.6204 RGB levels on average after lossy encoding.
- Combined 0.75× speed, hold 30 and zoom 1.2× gives exactly 110 frames. “今日运动完成 Hello” is centered above the phone-interface region, white with a dark outline and no box; “Tomorrow 再继续” uses the top placement later. English/mixed-CJK two-line wrapping and the middle position have separate real raster/pixel tests.
- The real-clip transient-only mix originally measured -8.49 LUFS under single-pass loudnorm. With measured mastering it measures **-14.00 LUFS**, true peak **-6.69 dBTP**. Continuous mixed audio is also tested. Fade-in and every sound's leading/active/trailing sample intervals are checked from decoded audio; no subjective listening or claim of licensed-pack sound quality is made.
- This machine selected `Hiragino Sans GB`, font-file SHA-256 `f887295caf2881cab9554b14c5ab4c9ee624c3895599da152ec37416b5aefae0`. Sound-pack digest: `e2113f3789132a018493517667289e1ccb78ee8855ad86df59c8bc0750904140`.

## Verification

Pinned Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1 passed `pnpm setup:test-media` and `pnpm check:toolchain`; no download was needed.

| Command | Result |
| --- | --- |
| `pnpm setup:test-media` / `pnpm check:toolchain` | Passed; exact pinned versions, no download |
| `pnpm build` | All five workspace builds passed; existing Vite chunk/dynamic-import warnings only |
| `node scripts/run-tests.mjs apps/server/test/film-quality-render.test.mjs` | 31 passed, 0 failed, 0 skipped |
| `pnpm test` | **4,934 passed, 0 failed, 0 cancelled, 1 optional native-probe skip; 4,935 total** (1,365,793 ms) |
| `pnpm -r typecheck` | **All five workspace typechecks passed**, 0 failures |
| `git diff --check` | Passed after final report update |

The final full-suite 8-clip / 8-caption / 12-sound case took **7,000 ms** of its **148,800 ms** local render timeout. The final standalone Q4 file passed **31/31** after the lazy native-load refinement. The final full suite and typecheck both exited 0. The slow skill-release test file eventually completed successfully; the toolchain file also passed 7/7 independently while investigating that wait.

The new file `apps/server/test/film-quality-render.test.mjs` covers actual frame counts/probe duration for all six speeds (including one-frame sources), holds and next cuts, fixed/focused zoom, minimum output geometry, English/CJK overlay pixels on exact enabled intervals, wrapping/overflow/font refusal, fade-in samples, each sound's timing and limits, integrated loudness, contract gating, old identity compatibility, all-field free code-plan execution/replay, edited project bounds, cancellation, and frozen-PNG tamper refusal. No existing test was rewritten, deleted or disabled. The early two test failures were fixture errors (parsing FFmpeg JSON with trailing diagnostics and accidentally taking the fake-render route); both were corrected. An earlier six-file regression gate passed 121/121 before the final edge-case and mastering refinements.

Self-review examined the complete diff, callers, old recipes and failure/recovery paths. It corrected minimum-size zoom rounding, cancellation propagation during sound preparation, Linux font-file matching, source/caption error context, partial-dimension compatibility, eager native-font loading and transient-mix mastering; regression coverage was added for the important boundaries.

## Short-lease regression investigation

The long gate exposed two cases in the unchanged `apps/server/test/transcription-preparation-engine.test.mjs`:

- `an edit during awaited preparation aborts the old signal and settles only that obsolete unstarted attempt` — expected `failed`, observed `preparing`.
- `pause after the dispatch marker does not abort or discard the actual provider observation` — missing the expected `INVALID_PROVIDER_OUTPUT` rejection.

Both use 150 ms leases. The complete file was rerun as requested before classifying the results: an early rerun was 23 passed / 1 failed, and a later run under load was 22 passed / 2 failed. The obsolete-attempt case also passed once in the paired post-refinement run, so the timing is variable. The assertions and transcription implementation were left intact.

To distinguish a card regression from existing timing sensitivity, the five changed implementation modules were replaced with their `git show HEAD:...` versions only in a temporary source mirror, compiled with this checkout's exact `pnpm exec tsc` and compiler options, and redirected through a temporary loader. Repository files, branches and the index were untouched. That exact-compiler HEAD baseline returned **23 passed / 1 failed** over the same 24-case file, reproducing the obsolete-attempt failure while the post-marker case passed. Evidence: `/tmp/openslate-q4-tsc-baseline.log`, generated by `/tmp/openslate-q4-tsc-baseline.mjs`. This supports treating the lease failures as an existing test/engine timing issue, rather than changing money/integrity assertions to make the card green. Both short-lease cases passed in the final complete full-suite run. No failing test remains in that final gate; the baseline investigation is retained here to explain the intermediate variability.

## Files

Changed:

- `apps/server/src/code-plan/identity.ts` — render validation only.
- `apps/server/src/execution/local-media-executor.ts` — code-plan adapter, contract gating and exact intent recovery.
- `apps/server/src/media/local-timeline.ts` — extended local recipe/types and validation.
- `apps/server/src/media/local-media.ts` — timeline freeze/render, local sound supply and mastering only.
- `skills/code-plan/references/studio.d.ts` — render declaration/comment and supporting render types only.
- `apps/server/src/application/director-capabilities.ts` — current guidance digest pin only.

Added:

- `apps/server/src/media/captions.ts`
- `scripts/make-sfx.mjs`
- `apps/server/assets/sfx/pop.wav`, `thud.wav`, `whoosh.wav`, `ding.wav`, `tick.wav`, `boing.wav`
- `apps/server/test/film-quality-render.test.mjs`
- `docs/ai/film-quality/reports/Q4-report.md`

Deleted: none.

## Proposed commits (lead only)

1. `feat(media): add offline synthesized sound pack` — `scripts/make-sfx.mjs` and the six `apps/server/assets/sfx/*.wav` files.
2. `feat(render): add captions, row edits and measured mastering` — the six changed source/declaration/pin files above, `captions.ts`, `film-quality-render.test.mjs` and this report.

No commits made. No unresolved source finding remains from self-review. Remaining integration checks: recompute the combined guidance pin at merge, verify the Q3 contract/archived-guidance integration, and assess sound timbre by listening. Linux/Windows font selection is implemented but not visually exercised on those operating systems. Host fonts are not promised to rasterize identically across machines; the receipt records the chosen font/PNG bytes.
