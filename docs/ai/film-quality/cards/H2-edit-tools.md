# H2 · Edit tools for a cut that tells the story

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. H1 (skill 2.1.0: text and release) and H3 (web) run alongside this card. You own `apps/server/src/code-plan/**`, `apps/server/src/media/**`, the tool schemas in `packages/director/src/tools/**`, the contract in `packages/core/src/**` where an item below needs it, and their tests. Stay out of `skills/**` (H1 copies your final shapes into `studio.d.ts` and the example plan) and out of `apps/web/**`.

## Why

`docs/ai/film-quality/DIRECTOR-IDEATION-AND-CUT-PLAN.md`, sections 5 and 11. From skill 2.1.0 the Director writes a cut list before it buys clips, uses one clip in several cuts, and builds in the edit what the video model does badly. Five small capabilities are missing. All five are additive.

## 1. Still rows

A picture the film owns can be a timeline row, held for a set time. An empty chair or a clock face then costs no video.

- A `render` timeline row may carry an image artifact: `{ artifact, durationFrames, fit?, zoom? }`. The image must be an owned picture of this film: a keyframe's `frame`, a `ctx.image` result or an upload. Use the ownership check that references already use.
- `durationFrames` is required on a still row: an integer from 1 to 300 (frame numbers are 1/30-second positions, so up to 10 seconds).
- `startFrame`, `speed` and `holdFrames` are refused on a still row with `CODE_PLAN_RENDER_INPUT` and a plain message such as "Row 3: a still row takes durationFrames, fit and zoom only". A bare image artifact in the timeline array, without a row object, is refused with a message that asks for `durationFrames`.
- `fit` and `zoom` behave as on video rows.
- Still rows count toward the 64 rows and the 360 seconds. A timeline made only of stills is valid.
- The render stays a probed MP4 at the film's frame rate, as today. Rendering a still adds no step and no price.
- Demo projects: the fixture renderer accepts still rows.
- `codePlanFitWarning` must not break on a still row; compute it from the picture's size when known, otherwise skip the row.

## 2. Punch-in to 2×

- `zoom.scale` may be greater than 1 and at most 2 (today 1.4).
- Add an advisory finding `ZOOM_SOFT` to the plan diff when a reached render has a row that enlarges source pixels by more than 1.5× after fit and zoom, and the source size is known. The detail names the row and the factor in plain words: "Row 4 enlarges the picture 2.3×; it will look soft." It never refuses a plan.

## 3. Cut pairs on a render

The Director must be able to look at both sides of every cut.

- `read_clip_frames({ artifactId, cuts: true, fromCut? })` is valid for a render of this film. It returns a contact sheet with two cells per cut (the boundary between timeline row n and row n+1): the last frame before the cut and the first frame after it, labelled `cut N before` and `cut N after`, with finished-film frame numbers as `read_clip_frames` already numbers renders.
- At most 18 cuts a sheet (36 cells). `fromCut` (1-based, default 1) pages through the rest. The metadata lists, for each cut on the sheet, its finished-film frame number and, when known, the shot ids of the two rows.
- `cuts: true` together with `startFrame`, `endFrame` or `everyFrames` is refused with a plain message. On an artifact that is not a render it is refused with "cuts: true reads a render".
- Update the tool's schema and description in the Director tool catalog.

## 4. Findings for the cut list

The Director records its cut list as data in a scene declaration: `cuts: [{ sees, seconds, clip }]`, where `clip` is the id of the declared shot that supplies the cut. Check it at dry run and report advice as findings in the plan diff. None of these refuses a plan.

- `CUTS_UNUSED_SHOT`: a declared shot that no cut names. The detail lists up to five ids.
- `CUTS_UNKNOWN_CLIP`: a cut whose `clip` is not a declared shot id. The detail lists up to five.
- `CUTS_LENGTH`: when the pass reaches a render, the cut seconds and the rendered timeline differ by more than one second. The detail gives both numbers.
- `CUTS_SHAPE`: `cuts` is present but is not an array of objects with a string `sees`, a positive number `seconds` and a string `clip`. The detail says what is expected.

Check at most 64 cuts. Write it as a pure function with table-driven tests. Plans without `cuts` get none of these findings.

## 5. A suggested video input on the keyframe card

The person still picks the clip's input on the card. The Director may now say which one it would pick and why.

- `ctx.keyframe(shot, { ..., suggest?: { input, why } })`. `input` is one of `"keyframe_and_references"`, `"references_only"`, `"first_frame"`. `why` is a string of 1 to 160 characters. Anything else is an input error with a plain message.
- `suggest` is display metadata, like `shot`: strip it before step identity, the options digest, pricing and provider input. Adding, changing or removing it in an existing plan keeps the same image step, the same card and the same answer: nothing is asked again and nothing is bought.
- Projection: the keyframe choice in `CodePlanView.choices[]` carries `suggest: { input, why }` when the suggested input is one of that card's options. When it is not offered (the model lacks the mode, or there are no references), drop it and add the advisory finding `SUGGEST_UNAVAILABLE` with the shot id.
- `read_film` shows the suggestion beside the choice and its answer, so a later turn can see what was suggested and what the person chose.

## Contract and compatibility

- Existing plans replay with identical step keys, prices, choices and answers. Prove it with a saved-plan fixture that uses none of the new fields.
- Tool contract version: keep 0.3.0 if the catalog and lock rules allow an additive change, as Q4 and G2 did. If a digest or lock test forces a new version, follow the repository's rules and say in the report which films and turns see what.
- List every change to `packages/core/src/studio-api.ts` in the report: H3 builds the web against it.

## Tests (minimum)

- Still rows: a still between two clips gives the expected total frames and a probed MP4; a stills-only timeline renders; each refused field; a picture the film does not own; `fit` and `zoom` on a still; the demo fixture path.
- Zoom: 2 is accepted and 2.01 refused; `ZOOM_SOFT` appears above 1.5× and not below; no finding when the size is unknown.
- Cut pairs: three rows give two cuts and four cells with the right frame numbers; paging with `fromCut`; both refusals.
- Cut-list findings: one case per code, a clean list, a plan without `cuts`, and the 64-cut bound.
- Suggest: identity, digest, price and provider input are unchanged with and without it; the card carries it; the unavailable case; both invalid shapes.
- The saved-plan replay fixture above.

## Finish

Run the touched tests, then `pnpm build`, the full `pnpm test` and `pnpm -r typecheck`, and report exact counts. Write `docs/ai/film-quality/reports/H2-report.md` with the final shapes exactly as implemented (row type, tool input, finding codes with a sample detail each, the choice field), because H1 copies them into the skill and H3 into the web.
