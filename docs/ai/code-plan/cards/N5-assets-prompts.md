# N5 · Code-plan assets, step details and the crop warning

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, no network beyond loopback, never read `.env*`, never start anything on port 3001.

## Problem

The owner tested a real film and found:

- **Assets ignores code plans.** `apps/server/src/asset-library.ts` only knows graph films: it joins artifacts through `node_binding`. A code film's assets have no shot and `current: false`, so every tile says "Earlier" and sits under "not in a shot".
- **Posters leak into the library.** A clip's poster is an image `artifact` with no `attemptId`, so it is listed as a keyframe. The Tofu film shows 16 keyframes; only 10 exist.
- **Music is mislabelled.** A generated music file is listed with the voice role.
- **Prompts are hidden.** `CodePlanStepView.label` stops at 200 characters. There is no way to see what a step really sent.
- **Crops are silent.** The Tofu plan set `fit: "cover"` on 1344×768 clips in a 1080×1920 render. The render kept 32% of each clip's width and nothing said so.

The contract is already in `packages/core/src/studio-api.ts`: `AssetItem.width`, `height`, `poster`, `stepKey`; `CodePlanStepView.fitWarning`; `CodePlanStepDetail`.

## Change

1. **Assets for code films** (`projectAssets`). Graph films must come out byte for byte as they do today. When `project.planMode === "code"`, use the rows of `code_plan_step`, `code_plan_choice`, `code_plan_run` and `code_plan_poster`:
   - Drop every artifact that is a poster (`code_plan_poster.poster.artifactId`) from the list.
   - For an artifact produced by a succeeded step, set `stepKey`, and `shotId` from `codePlanShotLinks`. `sceneId` comes from the matching entry in `run.declarations.shots`. Do not read `project.shots`.
   - Role by step kind: `image` → `keyframe`, `video` → `clip`, `speech` → `voice`, `music` → `music`, `render` → `export`. Imported files keep their role.
   - `takeIndex` stays 1-based per shot and role, oldest first, as today.
   - `current`: the step is in `run.reachedStepKeys`, and for an `image` step the picture is also the answer of its choice, or the input of a reached video. An image with no choice in the film counts as current when reached.
   - `poster` on clips and renders, when one exists.
2. **Sizes, all films.** `width` and `height` from the `ArtifactRecord` of an image. For a clip or render use its poster's record. Omit them when unknown.
3. **Step details.** Add `stepDetail(projectId, stepKey): CodePlanStepDetail` to `CodePlanPort` and `GET /api/projects/:projectId/code-plan/steps/:stepKey`. Add the route to `INSPECTION_ROUTES`. NOT_FOUND for an unknown key; CODE_PLAN_MODE for a graph film.
   - `prompt`: `input.prompt`, else `input.text`, else `input.motion`, whole.
   - `durationSeconds`, `aspectRatio`, `variant`, `firstFrame` from the step input.
   - `output`: the artifact record's size, or the poster's for video, and `physicalDurationSeconds`.
   - `call`: from the step's attempt and the adapter's mapping rows when they exist (Viggle H3, MiniMax H3, Seedance, fal, Lyria, Codex image). Read the task id and the crop the same way. Omit what an adapter did not record.
   - **`call.settings` is an allow list** of scalar fields: `model`, `resolution`, `quality`, `aspectRatio`, `ratio`, `durationSeconds`, `durationFrames`, `width`, `height`, `seed`, `generateAudio`, `instrumental`, `voice`. A test must prove that a key, an authorization header, a local path and a signed URL never appear anywhere in the response, for every adapter, including when a mapping row holds such a field.
4. **Crop warning.** In `codePlanView`, for a `render` step with a timeline, compute `fitWarning` from a pure, tested function. For each timeline row with `fit: "cover"`, use the clip's poster size (skip a clip with no poster) and the render's `width` and `height`: `keptPercent` is the share of the clip's picture left after a centred crop to the film's shape. Report the rows below 90 in `clips` and the lowest value, rounded, in `keptPercent`. No store writes, and no change to rendering or to any step key.
5. **Tests**, offline:
   - a graph film's asset list is unchanged (a snapshot test);
   - a code film with a chosen frame, an unchosen frame, a clip, a poster, music and a render gets the right roles, shots, takes and `current`, and no poster is listed;
   - an older plan with no `shot` annotation links through `<shot>-keyframe`;
   - `stepDetail` returns the whole prompt past 200 characters, and 404s;
   - the secrets test above;
   - `fitWarning` is 32 for 1344×768 in 1080×1920, absent for 768×1344 in 1080×1920, absent for `contain`, and the Tofu shape of five clips reports `clips: 5`.
6. **Docs:** `docs/technical/EXECUTION-ENGINE.md` and a `docs/implementation/STATUS.md` entry.

## Files you own

- `apps/server/src/asset-library.ts`, `apps/server/src/code-plan/**`, `apps/server/src/application/recovery-routes.ts`.
- `apps/server/test/**` and the docs above.

Do not touch `apps/web/**` or `packages/core/src/studio-api.ts`; if the contract must change, list it in your report.

## Report

Write `docs/ai/code-plan/reports/N5-report.md`: what changed, the checks you ran with their results, anything you could not do, and any change you think the contract needs.
