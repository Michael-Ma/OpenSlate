# B6 export implementation report

## Done

- **SB-16:** Added authenticated storyboard export GET/start/cancel/recover routes using the existing public contract. Captures current clips in scene/shot storyboard order, exact accepted narration through `projectAudioPlacements`, and soundtrack placement. Defaults to 1280×720. No timeline/render plan node is needed. Current binding, shot revision, video intent/prompt, artifact ownership, measured duration, narration, pause and hold checks remain. `EXPORT_BLOCKED` includes the contract readiness and per-shot blocker codes in `error.details`.
- **SB-17:** Storyboard targets persist the captured head version, input references and separate film fingerprints. Current export and history expose changes in shots, order, music and narration. Downloads remain available after edits and late completions are retained as history.
- **SB-18:** All-fixture clips are normalized from verified owned bytes to their full planned lengths, with a fixed burned-in `Demo` mark included in the frozen recipe. Demo artifacts retain `fixture:true` and library labels say `Demo export`. Mixed real/fixture clips, narration or music are refused with per-shot reasons. The shipped twelve-second demo, including its legacy accepted fixture narration, exports successfully.
- **SB-15:** Verified the existing soundtrack and shot-order routes are hold-free; no other soundtrack mutation route exists. `/media` now includes `lastExport` with its retained artifact, `outdated` and `outdatedBy`, while preserving the existing current-only `preview` semantics. Existing `/media/renders` remains supported.

## Files

Changed:

- `apps/server/src/app.ts`: expose structured export readiness errors.
- `apps/server/src/asset-library.ts`: identify demo exports.
- `apps/server/src/media/application-types.ts`: storyboard render target union and demo-capable publication metadata.
- `apps/server/src/media/application.ts`: export preparation, concurrent idempotent preparation, public projection and target matching; retained last export.
- `apps/server/src/media/local-media.ts`: trusted fixture normalization and fixed bitmap watermark.
- `apps/server/src/media/routes.ts`: export endpoints and legacy snapshot/summary compatibility.
- `apps/server/src/media/types.ts`: optional immutable demo recipe flag.

Added:

- `apps/server/src/media/storyboard-capture.ts`: SQL-only readiness/capture and film-change comparison.
- `apps/server/src/media/demo-source.ts`: bounded, hash-verified owned fixture reads.
- `apps/server/test/storyboard-export.test.mjs`: new behavior and failure-boundary coverage.
- `docs/ai/uiux-plan/codex/reports/B6-export.md`: this report.

Also changed `apps/server/test/generation-overview.test.mjs`: corrected one existing missing-key HTTP status assertion from 409 to the baseline handler's 400; its idempotency error-code and integrity checks remain.

Deleted: none. No web files or database migrations changed.

## Tests

Added tests cover storyboard order before/after reorder, exact narration/music placements and decoded picture/audio, missing/stale/foreign/short clips, unsettled voice, empty/oversized films, watermark pixels and planned demo lengths, mixed media, shipped demo/reopen, authenticated/revision-checked start, concurrent/success/lost-reply replay, key conflicts, cancel, receipt-only recover, stale freeze/publication, stop/holds, last-export download after a hold-free music edit, and changed-since categories. Rewrote one existing status assertion in `generation-overview.test.mjs`: missing idempotency keys are HTTP 400 in the baseline handler, while the test expected 409. The mismatch reproduced independently (17 passed / 1 failed) and was already present in HEAD. No tests were deleted.

Toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1, pinned encoder profile. `pnpm setup:test-media` confirmed the existing local tools matched; no download was needed.

- `pnpm build`: passed.
- New export test file: **9 passed, 0 failed**. Final touched-file run (export plus corrected overview assertion): **27 passed, 0 failed**.
- Earlier media/application/HTTP/timeline/storyboard regression run: **88 passed, 0 failed** (before the final additional narration regression).
- Bounded synthetic stress run using the pinned toolchain: **10,800 frames / 360 seconds, 1280×720, 64 cuts, 65 audio placements, Demo watermark**. Render completed in **52.912 seconds**, below the unchanged 120-second timeout; output 9,046,983 bytes. This was a local synthetic media run, with no provider calls. It did not measure memory or real-provider quality.
- Initial full suite: **2,483 passed, 1 failed, 1 skipped** (2,485 total). The sole failure was the pre-existing frame-view missing-key status assertion described above.
- Final `pnpm test`: **2,484 passed, 0 failed, 1 skipped** (2,485 total; opt-in native Codex probe skipped), 466.480 seconds.
- Final `pnpm -r typecheck`: **all 5 workspace packages passed** (core, providers, director, server, web), zero failures.
- `git diff --check`: passed. All source/tests remain uncommitted in `cx/b6`, as required.

## Contract changes

None in `packages/core/src/studio-api.ts`. The legacy `/media` response adds `lastExport`; storyboard summaries omit plan-node fields and identify `targetKind: "storyboard"`. New export endpoints return the existing `ExportView` / `ExportRecord` types.

## Commits

No commits were created, per `RULES.md`. Proposed conventional commits:

`feat(export): render storyboard films and marked demos with retained export history`

File list: all changed/added files listed above except `apps/server/test/generation-overview.test.mjs`.

`test(generation): align missing-key status with the API handler`

File list: `apps/server/test/generation-overview.test.mjs`.

## Open issues

No remaining implementation or check blocker for this backend card.

- Decisions for the lead: `ExportView.current` is the newest requested export and `history` contains earlier requests, newest first. A failed/cancelled newest request does not remove older completed downloads.
- Demo classification covers shot video, accepted narration and selected music. Mixing fixture and real media in any of these roles refuses the film with `mixed_demo_media` on every shot. An imported real soundtrack therefore cannot make a demo film export as real.
- The shipped demo has no canonical narration record. Its accepted, measured fixture cue ranges are supported only when both the shot clip and narration artifact are fixtures. Real narration still requires exact canonical acceptance and source identity.
- The watermark spells `Demo` with fixed bitmap glyphs and FFmpeg drawbox filters, so the pinned toolchain needs no font or drawtext dependency.
- Readiness maps absent/foreign/short or mismatched measured clip descriptors to the existing `clip_outdated` code; it does not extend the public blocker enum.
- This card changes the backend only. The lead still owns the Film/export UI. No real provider or non-loopback network calls were made.
