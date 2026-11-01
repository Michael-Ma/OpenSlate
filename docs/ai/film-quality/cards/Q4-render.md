# Q4 · Captions, sound and small edits in the renderer

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Then `docs/ai/film-quality/research-editing.md` sections 4 and 5, and `cards/CONTRACT.md`.

## Problem

The renderer has cuts, trims and audio placements. It has no words on screen, no loudness control, no fade-in, no way to change speed or hold a frame, and no sound effects. The local FFmpeg has no `drawtext` or `subtitles`. A silent film also makes every cut more visible, so this matters for the cuts too.

Measurements from the research, all on real clips: 8 captions rasterised in 55–61 ms and `overlay` works; re-cut plus captions renders in 7–13 s; placeholder mix was −24.6 LUFS; 2× `setpts` costs about 0.3 s; 1.4× punch-in is still usable; `INPUT_OPTIONS` refuses PNG, so PNG inputs need `png_pipe`.

## Change

Add the fields in `CONTRACT.md` to the code-plan render path: validation in `identity.ts`, the plan-to-timeline step in `local-media-executor.ts`, and `apps/server/src/media/local-timeline.ts` and `local-media.ts`. Graph films and saved code films must render exactly as before. Absent fields must not change step keys.

1. **Row edits.** `speed` with `setpts` (film frames are `round(durationFrames / speed)`); `holdFrames` freezing the last used frame; `zoom` as a fixed punch-in cropped and scaled to the output, with no motion across time. Each row may use all three. Validate the range of every value with a message that gives the allowed range. Total film length after edits stays under the existing limits.
2. **Captions.** Rasterise each to a transparent PNG with `@napi-rs/canvas`, already a direct dependency of the server, then `overlay` with `enable=between(n,...)`.
   - Style: bold white text, dark outline, soft shadow, centred, no box. Size scales with output height. `bottom` sits at about 78% of the height, above the phone interface; `top` at about 12%; `middle` at 50%. Wrap to at most two lines. A caption that still will not fit is refused at plan time with the limit.
   - Fonts: use the system's fonts through `GlobalFonts`, trying PingFang SC, Hiragino Sans GB and Heiti SC on macOS, Noto Sans CJK on Linux, Microsoft YaHei on Windows, for mixed Chinese and English text. No CJK font found with CJK text: refuse with a message that says so. Do not add or download a font file. Put the font family and a digest of its file, when readable, in the render's receipt.
   - At most 64 captions, 1–80 characters each; overlaps refused.
3. **Mastering.** Apply `loudnorm` to the final mix on films of contract 0.3.0 only, I=-14, TP=-1.5, LRA=11. A film with no audio track stays silent. `fadeInSamples` on an audio placement, same limits as `fadeOutSamples`.
4. **Sound effects.** Render-time placements `{ sound, atSample, gainMilliDb? }`. Generate the six sounds offline with a committed script `scripts/make-sfx.mjs` using `aevalsrc`, into `apps/server/assets/sfx/*.wav`, 48 kHz, each under 1.5 s and 150 KB. Make them sound as good as simple synthesis can; they are stand-ins for a licensed pack, and the file names are the only thing a later swap would need. Sounds count toward the placement limits, are free and consume no step. The pack's digest goes in the render's receipt.
5. **`read_film`** shows nothing new, but a render's error must name the row or caption at fault.
6. **`studio.d.ts`**: replace the `render` doc comment and signature with the `CONTRACT.md` types.
7. **Tests**, offline, using real FFmpeg and real probing:
   - speed, hold and zoom each give the right frame count, and duration matches the probe;
   - captions: a pixel in the caption area differs while the caption shows and not outside it; Chinese and English; wrapping; refusal when no CJK font is available (injected font lookup);
   - loudness of a mixed film is −14 ± 1 LUFS on a 0.3.0 film; a 0.2.0 film has no `loudnorm`;
   - fade-in; each of the six sounds places correctly; an unknown sound is refused;
   - a saved plan's render step key is unchanged; the graph timeline path is unchanged;
   - a full timeline of 8 clips, 8 captions and 12 sounds finishes inside the local timeout.

## Files you own

`apps/server/src/media/local-timeline.ts`, `apps/server/src/media/local-media.ts` (timeline only), `apps/server/src/execution/local-media-executor.ts`, a new `apps/server/src/media/captions.ts`, `apps/server/assets/sfx/**`, `scripts/make-sfx.mjs`, `apps/server/src/code-plan/identity.ts` (render validation only), `skills/code-plan/references/studio.d.ts` (the `render` lines only), tests.

Do not edit `SKILL.md`, `film-craft.md`, `example-plan.ts` or `docs/implementation/STATUS.md`. If `studio.d.ts` changes the guidance digest, update the pin in `director-capabilities.ts`; the lead recomputes it at merge. Until Q3 merges there is no 0.3.0 contract: read it as a constant in one place so the merge only changes that line, and test with an injected contract value.

## Report

Write `docs/ai/film-quality/reports/Q4-report.md`, with how each field looked on a real clip if you can compare frames offline.
