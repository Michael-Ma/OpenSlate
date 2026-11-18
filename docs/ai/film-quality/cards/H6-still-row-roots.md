# H6 · A still row must be able to read the picture it holds

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. You own `apps/server/src/media/local-media.ts`, `apps/server/src/execution/local-media-executor.ts` and their tests. Stay out of `skills/**` and `apps/web/**`.

## Problem (the first real film with skill 2.2.0, 2026-11-17)

The Director's plan put a shared picture (a `ctx.image` result) in the first timeline row as a still. The four clips were bought, then the render stopped the plan with:

`Row 1: Input is outside configured local roots`

`LocalMediaService.supplyStill` snapshots the picture's path against the service's default input roots, which are the upload folder and `execution-output/blobs` (`apps/server/src/application/media-execution-runtime.ts`). Pictures the film owns (keyframes and shared pictures made by Codex images, stored posters) live under the artifact folder, in `artifacts/images/blobs`. The H2 tests put their picture inside an allowed root, so they did not see this.

## Change

- `supplyStill` takes the artifact folder, as `poster` already does (`artifactDir`), and accepts a picture that is inside that folder or inside the service's input roots (an uploaded picture). Everything else about the check stays: an absolute path, no symlink, a regular bounded file, and the SHA-256 must match the owned picture.
- `captureEditedCodePlanRender` passes the executor's `artifactDir` through.
- Nothing else about still rows changes.

## Tests

- A still whose picture is stored under the artifact folder, outside the service's input roots, renders: this is the real layout and must be the default fixture for still tests from now on.
- A still from an uploaded picture (inside the upload root) still renders.
- A picture outside both is still refused with `MEDIA_PATH_REJECTED`, and a symlink is still refused.

## Finish

Run `pnpm build`, the touched test files with `node scripts/run-tests.mjs`, and `pnpm -r typecheck`, with exact counts. The lead runs the full suite afterwards. Write `docs/ai/film-quality/reports/H6-report.md`.
