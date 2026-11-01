# Q2b · Crop the last frame the same way as the first

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. This is item 5 of `Q2-lock.md`, left out because its files were outside that card. The section "Q2.5 ownership blocker" in `docs/ai/film-quality/reports/Q2-report.md` names exactly what is needed.

## Problem

In `apps/server/src/execution/viggle-h3-execution.ts` the first frame is centre-cropped to the requested ratio and the last frame is not, so a first-and-last pair can be misaligned. `film-craft.md` now tells the Director to use this pair on shots where the pose is the joke.

## Change

1. Centre-crop both frames to the same requested ratio, each from its own source size, and upload the crops. References stay uncropped. A frame that already matches the ratio is not cropped.
2. Record `lastFrameCrop` beside `firstFrameCrop` in the execution mapping. Update validation in `viggle-h3-receipts.ts` and `viggle-h3-authority.ts`. Existing receipts with no `lastFrameCrop` must stay readable. Reference and text modes reject the field.
3. Project it through `apps/server/src/code-plan/step-detail.ts` and add optional `call.lastFrameCrop` to `CodePlanStepDetail` in `packages/core/src/studio-api.ts`.
4. Tests, offline: same-source and different-source sizes; exact-ratio input; tampered or missing crop facts refused; restart and replay; a saved receipt without the field still validates.

## Files you own

`apps/server/src/execution/viggle-h3-execution.ts`, `viggle-h3-receipts.ts`, `viggle-h3-authority.ts`, `apps/server/src/code-plan/step-detail.ts`, the `call` type in `packages/core/src/studio-api.ts`, tests. Do not touch `apps/web/**` or `docs/implementation/STATUS.md`.

## Report

Write `docs/ai/film-quality/reports/Q2b-report.md`.
