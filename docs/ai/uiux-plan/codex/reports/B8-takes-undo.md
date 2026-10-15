# B8 — current takes, earlier takes and media-restoring Undo

## Done

- GR-6 / LG-16 / D8: retain the current frame and clip during keyframe replacement, including shared/owned conditioning frames, restarts and known-failure recovery. A replacement candidate keeps its independent grant and attempt. Success atomically selects the new frame and outdates dependent clips and assembly; failure keeps current paid media. Retained display media never supplies execution inputs for a replacement.
- Earlier takes: authenticated `GET .../shots/:shotId/takes` returns `ShotTakes`; required-key `POST .../takes/:artifactId/use` re-verifies owned bytes, publishes a plan without grants, switches the frame, outdates dependent media, and returns `UseTakeReceipt` with an undoable storyboard command. History includes successful per-shot frames, shared/owned conditioning frames, and late successful results. Replays do not buy or dispatch work.
- SB-9 / D9: storyboard commands save their original input and affected binding snapshots. Undo restores only media whose intent, prompt, model recipe, generated duration, original successful attempt and resolved inputs match the restored state; bytes are verified again. Images restore before dependent clips. Narration-fit stores its earlier canonical selection and Undo re-commits that immutable projection (or an empty one) with the original duration, cue, pending state and fit choice. Historical acceptance evidence is retained.
- Lead additions: blocking-note confirmation is tested before speech/grants/confirmation records; server-owned voice writing derives `zh` from CJK text and otherwise uses `en`.

## Files

Changed:
- `apps/server/src/app.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/narration-fit.ts`
- `apps/server/src/scene-confirmations.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/src/scene-row.ts`
- `apps/server/src/storyboard.ts`
- `apps/server/test/generation-overview.test.mjs`
- `apps/server/test/helpers/scene-row-parity.mjs`
- `apps/server/test/narration-fit.test.mjs`
- `apps/server/test/scene-confirmations.test.mjs`
- `apps/server/test/scene-generation.test.mjs`
- `apps/server/test/storyboard.test.mjs`
- `docs/implementation/STATUS.md` (final verification entry)

Added:
- `apps/server/src/keyframe-take-history.ts`
- `apps/server/src/shot-takes.ts`
- `apps/server/src/storyboard-history.ts`
- `apps/server/test/takes-undo.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B8-takes-undo.md`

Deleted: none.

## Tests

Added 17 tests: 14 take/Undo cases in the new `takes-undo.test.mjs`, one prior-canonical narration-fit restoration case, and two confirmation integration cases (blocking note before spend and Chinese voice language).

Rewrote assertions in eight existing tests: retain rather than detach paid clips during regeneration; preserve old Opened identity until new-frame success; return `UNDO_UNAVAILABLE` for a consumed Undo; and extend fit Undo assertions to the keyframe, cue and canonical projection. The keyless regeneration test now supplies its real fixture token and actually tests `IDEMPOTENCY_KEY_REQUIRED` instead of accidentally testing failed authentication. The scene-row extraction parity helper allows the deliberate retained-output pending-flag change; all other row fields stay compared. Deleted tests: none. Money/integrity/replay/unknown-outcome protections remain intact.

Final checks:
- `pnpm setup:test-media` and `pnpm check:toolchain`: pass; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1.
- `pnpm build`: pass, all five packages.
- `node scripts/run-tests.mjs apps/server/test/takes-undo.test.mjs apps/server/test/narration-fit.test.mjs apps/server/test/storyboard.test.mjs apps/server/test/scene-generation.test.mjs apps/server/test/scene-confirmations.test.mjs apps/server/test/generation-overview.test.mjs`: **118 passed, 0 failed, 0 skipped**.
- `pnpm test`: **2,572 passed, 0 failed, 1 optional native-probe skip (2,573 total)**; its required build also passed.
- `pnpm -r typecheck`: **5 packages passed, 0 failed**.
- `git diff --check`: pass.

The first full regression run hit the unchanged timing-sensitive test `long submit and poll renew the lease while competing executors cannot claim them` in `execution-routing.test.mjs` (`OUTPUT_STORE_CANCELLED` during ingestion). Its unchanged isolated file recheck passed **8 tests, 0 failures**. The final clean full run passed that lease test as well as the complete suite; no lease assertions were changed. It supersedes the earlier development run and incorporates all corrected/new assertions.

All validation uses disposable local state and fake providers, including local speech/media normalization. No real provider/network call, credentials, production edit/restart, or port 3001 listener is used.

## Contract changes

None. `packages/core/src/studio-api.ts` is unchanged; its existing `ShotTakes` and `UseTakeReceipt` shapes are implemented.

## Commits

No commits were made, per `codex/RULES.md`. Proposed split:

1. `feat(studio): preserve takes and restore paid media on undo`
   - `apps/server/src/app.ts`
   - `apps/server/src/execution/engine.ts`
   - `apps/server/src/generation-overview.ts`
   - `apps/server/src/keyframe-take-history.ts`
   - `apps/server/src/narration-fit.ts`
   - `apps/server/src/scene-generation.ts`
   - `apps/server/src/scene-row.ts`
   - `apps/server/src/shot-takes.ts`
   - `apps/server/src/storyboard-history.ts`
   - `apps/server/src/storyboard.ts`
   - `apps/server/test/generation-overview.test.mjs`
   - `apps/server/test/helpers/scene-row-parity.mjs`
   - `apps/server/test/narration-fit.test.mjs`
   - `apps/server/test/scene-generation.test.mjs`
   - `apps/server/test/storyboard.test.mjs`
   - `apps/server/test/takes-undo.test.mjs`
2. `fix(narration): derive scene voice language and verify note refusal`
   - `apps/server/src/scene-confirmations.ts`
   - `apps/server/test/scene-confirmations.test.mjs`
3. `docs(uiux): record B8 scope and verification`
   - `docs/implementation/STATUS.md`
   - `docs/ai/uiux-plan/codex/reports/B8-takes-undo.md`

## Open issues

No B8 implementation blockers remain. The lead should review these decisions and compatibility boundaries:

- Decision: Undo remains one step and requires the latest unchanged storyboard head. An event-cursor fence also refuses Undo with `UNDO_UNAVAILABLE` after any new generated attempt in that project, including uncertain outcomes; local assembly does not count. This conservatively treats a project generation as use of its current state.
- Decision: a selected earlier frame is an explicit free reuse of that artifact under the active shot direction. A later Undo never authenticates that frame as having been generated for different intent/prompt/settings: its original attempt and resolved inputs must still match before reattachment.
- Decision: Undo rebuilds local timeline/render outputs against restored state instead of restoring assembly receipts. Paid picture/audio artifacts and their immutable evidence remain available.
- Historical storyboard rows without the new snapshots retain their existing strict head fence and cannot retroactively restore bindings that were never captured.
- No DDL, web implementation, paid experiment, commit, push or merge is part of this component. Lead review/merge remains outstanding.
