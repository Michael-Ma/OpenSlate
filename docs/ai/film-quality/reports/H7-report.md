# H7 — Vertical renders, cut-list findings and review time

## Done

1. **Render shape.** For a code film with a Viggle resolution setting, the resolution sets the export size. The explicit render width and height select portrait, square or widescreen. Without a complete pair, the first timeline row with measured width and height supplies the shape. The film aspect is the fallback when no row has both measurements. Render admission, `ZOOM_SOFT` and the cover-fit warning share this calculation. For a replay, advice uses the dimensions saved with the attempt or frozen recipe. A fresh render uses current policy. Step keys and recorded attempts are preserved.
2. **Cut-list findings.** `CUTS_UNKNOWN_CLIP` and `CUTS_UNUSED_SHOT` now require at least one reached shot declaration. The existing `CUTS_SHAPE` and `CUTS_LENGTH` checks still run before the first shot.
3. **Review deadline and notice.** The default Director run limit is 600 seconds. `OPENSLATE_DIRECTOR_RUN_TIMEOUT_MS` still overrides it within the existing range. When a review fails, ends with an unknown outcome, or is interrupted by the runtime deadline, the application adds one line to that turn using the repair notice's existing output and event path.

   > The review of the clips did not finish, so the film was cut from the planned ranges. Ask the Director to review the clips again.

   The review state and notice are saved together before replay continues. A completed review does not emit the line.

## Files and proposed commits

The worktree on `codex/h7-real-run-fixes` contains **13 changed, 2 added and 0 deleted files**. Proposed commits for the lead follow. The changes are uncommitted.

1. `fix(code-plan): honor render shape and resolution`
   - `apps/server/src/code-plan/execution.ts`
   - `apps/server/src/code-plan/fit-warning.ts`
   - `apps/server/src/code-plan/index.ts`
   - `apps/server/src/code-plan/render-size.ts` (added)
   - `apps/server/src/code-plan/video-settings.ts`
   - `apps/server/src/code-plan/view.ts`
   - `apps/server/test/code-plan-video-settings.test.mjs`
   - `packages/core/src/aspect.ts`
2. `fix(code-plan): wait for shots before checking cut names`
   - `apps/server/src/code-plan/cut-findings.ts`
   - `apps/server/test/code-plan-edit-tools.test.mjs`
3. `fix(director): extend review deadlines and report failures`
   - `apps/server/src/code-plan/director.ts`
   - `apps/server/test/code-plan-review.test.mjs`
   - `apps/server/test/director-run-config.test.mjs`
   - `packages/director/src/runtime/policy.ts`
4. `docs(film-quality): record H7 verification`
   - `docs/ai/film-quality/reports/H7-report.md` (added)

## Tests

**Five cases added.** The sizing test covers explicit portrait at both resolutions, explicit widescreen and square, precedence among measured rows, and fallback. The executor test uses an offline transport and the real local renderer to verify 1080×1920 and 720×1280 output, fit and softness advice, and preservation of the first attempt. Two cut-list cases cover a dry run paused at a shared image and cut-length advice before any shot. One review case covers a native-style timeout reported as an interrupted turn.

**Existing cases updated, zero deleted.** The unknown-clip case now reaches a shot before checking cut names. The export-policy matrix supplies explicit render shapes and still checks immutable capture across every resolution. The default-deadline test now checks 600 seconds and still verifies shorter overrides and invalid values. Existing review tests also verify notice absence on completion, notice presence on failure and unknown outcomes, and exactly one notice across restart.

- `pnpm setup:test-media` and `pnpm check:toolchain` passed. The pinned tools were Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1.
- `pnpm build` passed with **5 workspace builds, 0 failures**. Vite reported its existing ineffective dynamic-import and bundle-size advisories.
- The command below ran **61 tests, 61 passed, 0 failed, 0 skipped, 0 cancelled, 0 todo**.

  ```sh
  node scripts/run-tests.mjs \
    apps/server/test/code-plan-edit-tools.test.mjs \
    apps/server/test/code-plan-review.test.mjs \
    apps/server/test/code-plan-video-settings.test.mjs \
    apps/server/test/director-run-config.test.mjs
  ```

- `pnpm -r typecheck` passed with **5 workspaces, 0 failures**.
- `git diff --check` passed.

## Contract changes

None in `packages/core/src/studio-api.ts`. The Viggle Settings export-size field remains the film-level estimate. Individual render attempts capture the size of their actual timeline. Code films without a Viggle resolution setting use their existing explicit dimensions and local capture defaults.

## Self-review and open issues

Reviewed source precedence, agreement between the three render callers, replay of recorded dimensions, and notice persistence on repeated ticks and restart. During review, restricted dimension lookup to render attempts owned by the requesting film. The verified code passed the final build, targeted tests and typecheck after that change.

The lead owns the full-suite `pnpm test` run. This verification used temporary data, synthetic footage and offline transports. Browser and live-provider acceptance are outside the card's verification scope.
