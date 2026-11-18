# H6 · Still-row artifact roots

## Done

`LocalMediaExecutor` passes its configured `artifactDir` through `captureEditedCodePlanRender` to `LocalMediaService.supplyStill`. The still snapshot uses the canonical artifact directory alongside the configured input roots. Film ownership, absolute paths, symlink rejection, bounded regular files, and SHA-256 verification still apply. The artifact root is scoped to still snapshots.

## Files

- Changed `apps/server/src/media/local-media.ts` and `apps/server/src/execution/local-media-executor.ts`.
- Changed `apps/server/test/film-quality-render.test.mjs` and `apps/server/test/native-frame-rate.test.mjs`.
- Added this report. Deleted 0 files.

## Tests

Added 3 cases for uploaded-picture rendering, a picture outside all allowed roots, and a symlink to an owned artifact. Updated 3 existing still scenarios to use `artifacts/images/blobs` outside the configured `uploads` and `execution-output/blobs` roots. These scenarios cover mixed timelines, stills-only playback, and free render replay. The replay test also asserts `MEDIA_INTEGRITY_ERROR` on a SHA-256 mismatch. Updated 4 other existing cases for the revised capture arguments or shared fixture roots. Deleted 0 tests.

| Command | Result |
| --- | --- |
| `pnpm check:toolchain` | Passed with Node 24.15.0, pnpm 10.33.0, and FFmpeg/ffprobe 8.1.1 |
| `pnpm build` | 5 workspace builds passed, 0 failed. Vite reported dynamic-import and bundle-size advisories. |
| `node scripts/run-tests.mjs apps/server/test/film-quality-render.test.mjs apps/server/test/native-frame-rate.test.mjs` | 53 passed, 0 failed, 0 skipped, 0 cancelled |
| `pnpm -r typecheck` | 5 workspace typechecks passed, 0 failed |
| `pnpm test` | Deferred to the lead per the card |
| `git diff --check` | Passed |

## Contract changes

None. `packages/core/src/studio-api.ts` required no change.

## Commits

Proposed single commit `fix(media): allow owned artifact pictures in still rows` with these files.

- `apps/server/src/media/local-media.ts`
- `apps/server/src/execution/local-media-executor.ts`
- `apps/server/test/film-quality-render.test.mjs`
- `apps/server/test/native-frame-rate.test.mjs`
- `docs/ai/film-quality/reports/H6-report.md`

## Open issues

Self-review confirmed that only still capture gets the extra root, a sibling directory with the same path prefix is refused, and the code-plan executor replays the frozen render without resupplying the still. Verification used temporary data directories and offline fixtures. The full suite remains for the lead.
