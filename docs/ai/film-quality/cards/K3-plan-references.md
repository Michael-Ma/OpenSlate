# K3 · The code-plan view lists the shared pictures the plan uses

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. The lead is building the web at the same time; do not edit `apps/web/src/**`. You own `apps/server/src/code-plan/view.ts` and server tests. `packages/core/src/studio-api.ts` already has the field; do not change it. If you need another file, edit it and say so in your report.

## Problem

Plan in a code film now shows a "References" row: the shared pictures every shot builds on (uploads, character sheets, empty sets). The web finds them as reached image steps tied to no shot. In a real film that misses them: after a rewrite the Director passed the three existing reference pictures to `ctx.keyframe` as artifact literals instead of calling `ctx.image` again, so no reference step is reached, and the row is empty although the plan uses all three. The browser view carries no step inputs, so only the server can say which pictures the plan takes.

## Change

`codePlanView` in `apps/server/src/code-plan/view.ts` adds `references?: StudioArtifactRef[]`:

- Walk the steps the latest pass reached (`run.reachedStepKeys`), image and video, in journal order. Collect each image artifact in their input's `references`, `firstFrame` and `lastFrame`, first use first, no duplicates (by artifact id).
- Leave out a picture an image step with a shot made: use the same shot links the view already computes (`codePlanShotLinks`), so a keyframe passed into its own clip is not a reference.
- Only artifacts owned by this film, as image artifacts in `codePlanArtifacts`. Report an upload's reduced copy (`imageReferences`, the `code_plan_image_reference` rows) as the upload itself, so the person sees the picture they gave.
- At most 24. Omit the field when the list is empty and before the first plan.
- Nothing is persisted and no step or price changes. Read only, like the rest of the view. The same as `usedImages` in `assets.ts`, but ordered and without keyframes.

The Director's `read_film` spreads the view, so it gets the field too. That is fine; say so in your report.

## Tests

In a new or existing server test, through a real `CodePlanRuntime`:

1. A plan that makes a sheet with `ctx.image` and a keyframe from it with `ctx.keyframe`: `references` lists the sheet, not the keyframe, after the keyframe is answered and its clip starts with `keyframe_and_references` (the frame is in the clip's references).
2. A later version that passes the same sheet to `ctx.keyframe` as an artifact literal, with no `ctx.image` call: the sheet is still listed.
3. An upload whose reduced copy is used: the upload is listed, not the copy.
4. A foreign or unknown artifact in an input is not listed. An unreached step's inputs are not listed. Order is first use, no duplicates.
5. A film with no plan has no `references` field.

## Finish

Run `pnpm test` and `pnpm typecheck`. Write `docs/ai/film-quality/reports/K3-report.md`: what changed, what you could not cover.
