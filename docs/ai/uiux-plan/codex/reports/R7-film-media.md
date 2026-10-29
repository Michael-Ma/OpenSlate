# R7: export finishes on real footage and gives true reasons

## Done

- **film-render-timeout:** Render encoding now receives `min(600000, configuredTimeoutMs + totalFrames * 40)` milliseconds. With the default 120-second base, a 10,800-frame film receives 552 seconds. Import, probe and validation subprocess limits retain their existing bounds. The output x264 encoder uses four fixed threads; input decoding, filtering and normalization retain one thread. Existing hash tests checked immutable files and receipts, rather than old render golden hashes. A new detailed, seeded-noise 720p acceptance renders twice and checks equal output hashes, geometry, exact frame count, successful decoding and retained picture detail.
- **film-export-media-busy:** Export fixture preparation and render admission wait through known `MEDIA_BUSY` refusals, with an abortable 50 ms delay during rendering. Each attempt rechecks the original authority, exact target and relevant holds; render retries additionally check worker ownership and cancellation. `MEDIA_BUSY` is raised before the shared worker is acquired or FFmpeg is dispatched. No other failure is automatically retried. Same-key preparation remains shared and durable render intent is unchanged. `exportView` selects a rendering record before a newer failed record and preserves every other record once in history. Added the exact requested English/Chinese `error.MEDIA_BUSY` entry.
- **film-shutdown-marks-cancelled:** Host aborts persist `interrupted`, with `cancelRequested: false`, no live owner/lease and no failure code. The existing public `rendering` plus `canRecover` projection reaches the panel's restart/interruption message. Check again still scans verified receipts without rerendering; a missing receipt becomes `MEDIA_NO_COMPLETION`. Only the human Cancel command sets `cancelRequested`. Tests cover shutdown, human cancellation and publication of a receipt already written before an interruption.
- **film-mixed-demo-false-reason:** Mixed-media blockers identify `clip`, `voice` or `music`. A differing soundtrack produces one film-level music blocker; a differing recording produces a voice blocker on its mapped shot. Mixed clips retain per-shot clip blockers. The browser contract's existing optional `medium` field is used.
- **film-absolute-narration-reorder:** Storyboard readiness and playback require a legacy absolute narration placement to equal its cue-mapped cut's starting sample. Reordering or lengthening an earlier cut makes mismatched shots `voice_unsettled` and removes the mismatched playback placement. The accepted audio range and original anchor remain immutable. Shot-relative narration still follows cuts. Legacy DSL timelines built from unmapped supplied-video assets retain their established absolute mix.

## Files

Changed source:

- `apps/server/src/media/local-media.ts`
- `apps/server/src/media/application.ts`
- `apps/server/src/media/routes.ts`
- `apps/server/src/media/storyboard-capture.ts`
- `apps/server/src/narration/audio-placement.ts`
- `apps/server/src/narration/shot-audio-routes.ts` — playback projection only.
- `apps/web/src/next/i18n/catalog/errors.ts` — `MEDIA_BUSY` entry only.

Changed tests:

- `apps/server/test/media-rendering.test.mjs`
- `apps/server/test/media-application.test.mjs`
- `apps/server/test/media-http.test.mjs`
- `apps/server/test/storyboard-export.test.mjs`
- `apps/server/test/shot-audio-placement.test.mjs`
- `apps/server/test/shot-audio-http.test.mjs`

Added: this report. Deleted: none. No source edits outside the card's ownership. The implementation status, browser contract, schemas, migrations, tools, provider catalogs and skills are unchanged.

## Tests

Added **19** regression tests: two renderer cases, five application contention/fencing cases, one human HTTP cancel case, eight storyboard-export cases, one placement case and two playback cases. **Four existing behavior cases rewritten:** the application external-abort expectation and the HTTP server-close expectation now distinguish interruption from a human cancel; the combined fixture/mixed export case is split into precise medium reasons; the shared absolute cue case now rejects the nonaligned mapped shot. One additional existing process test's PID-file fixture now publishes atomically and validates a positive PID before retaining the original cancellation/child-exit/timeout/output-limit assertions. No tests deleted or disabled. Existing double-charge, idempotency, stale-version, immutable-media, human cancellation and unknown-outcome/receipt-recovery protections were checked and retained.

Toolchain: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**, all required encoders available. `pnpm setup:test-media` and `pnpm check:toolchain` passed without downloads.

Final verification:

- `pnpm build`: passed.
- Touched and related test files: **106 passed, zero failures/cancellations/skips/todo** (50.53 seconds).
- Renderer file after atomic PID-fixture stabilization: **21 passed, zero failures/cancellations/skips/todo** (11.04 seconds); preceding full build passed.
- Full `pnpm test`: **3,400 passed, zero failures/cancellations/todo, one optional native-probe skip (3,401 total)**; completed in **574.99 seconds**. Its preceding full build also passed.
- `pnpm -r typecheck`: **all five workspace package/app typechecks passed**, zero failures.

The touched/related command is `node scripts/run-tests.mjs apps/server/test/media-rendering.test.mjs apps/server/test/media-application.test.mjs apps/server/test/media-http.test.mjs apps/server/test/storyboard-export.test.mjs apps/server/test/shot-audio-placement.test.mjs apps/server/test/shot-audio-http.test.mjs apps/server/test/media-production-pipeline.test.mjs apps/server/test/within-shot-export.test.mjs apps/web/test/next/film-export.test.mjs apps/web/test/next/i18n.test.mjs`.

Earlier targeted results and corrections: renderer tests passed 21/21; the new detailed acceptance took 2.35 seconds. The first application/HTTP run passed 21/22: `mixed canonical narration uses exact sample ranges rather than the single optional DSL audio` exposed an overly broad absolute-placement check. Independent review found the same regression. The fix makes cut alignment opt-in for storyboard/playback and preserves that existing legacy-audio test. The first storyboard/placement/playback run passed 39/41: both new playback fixtures attempted to replace immutable canonical records. Their setup now inserts fresh canonical versions and moves the head pointer. No product integrity guard was weakened. These were implementation/fixture failures, not timing flakes.

The first full `pnpm test` run was incomplete: it logged 1,890 passing result lines and one failure in the existing `process cancellation and timeout await actual child exit, with bounded diagnostics` case, then stopped making progress at `transcription-preparation-engine.test.mjs` after `unrelated project and plan revisions preserve exact waiting work and its original preparation proof`. Its next test waits indefinitely for a hook after admitting a 150 ms lease; load can expire that lease before the hook. The run was stopped after sustained lack of progress, so it has no complete-suite total. The unchanged transcription file passed **24/24** alone (51.98 seconds). The renderer file passed **21/21** alone before any fixture change (13.36 seconds). Its PID writer had a separate file-existence/content race, now closed by atomic publication; production `process.ts` is unchanged. The final full run passed both cases and the entire suite. No unrelated transcription source or tests were changed. In that full run, the detailed 720p acceptance took **2.34 seconds**.

Independent final review found no remaining must-fix issue in retry safety, original authority and hold fencing, interruption projection, export selection, media reasons, narration compatibility or renderer determinism.

## Contract changes

None. `packages/core/src/studio-api.ts` is unchanged. The placement helper's opt-in option is internal server code.

## Commits

No commits made, per the card rules. Proposed split for the lead:

1. `fix(media): scale export encoding time and use deterministic parallel encoding`
   - `apps/server/src/media/local-media.ts`
   - `apps/server/test/media-rendering.test.mjs`
2. `fix(media): wait for FFmpeg and distinguish interrupted exports`
   - `apps/server/src/media/application.ts`
   - `apps/server/src/media/routes.ts`
   - `apps/web/src/next/i18n/catalog/errors.ts`
   - `apps/server/test/media-application.test.mjs`
   - `apps/server/test/media-http.test.mjs`
   - Busy preparation, current selection and shutdown-receipt cases in `apps/server/test/storyboard-export.test.mjs`.
3. `fix(media): identify mixed media and reject misaligned legacy narration`
   - `apps/server/src/media/storyboard-capture.ts`
   - `apps/server/src/narration/audio-placement.ts`
   - `apps/server/src/narration/shot-audio-routes.ts`
   - Remaining changes in `apps/server/test/storyboard-export.test.mjs`.
   - `apps/server/test/shot-audio-placement.test.mjs`
   - `apps/server/test/shot-audio-http.test.mjs`
   - `docs/ai/uiux-plan/codex/reports/R7-film-media.md`

## Open issues

- No implementation blocker or failing final check remains. Changes are ready for the lead's review and commits.
- Decisions: four fixed output-encoder threads keep the recipe independent of host CPU count. The allowance applies to modern exports and legacy local render encoding; it does not extend import/probe/decode limits. The detailed acceptance is short synthetic footage, not a six-minute performance or real-provider-quality claim. The 600-second encoding cap remains intentional.
- Decisions: voice/music fixture status is compared with unanimous selected-clip status; when clips themselves mix, the existing per-shot clip blockers remain. Demo classification retains its existing all-selected-media-fixture rule.
- Decisions: a shared legacy absolute cue plays once at its aligned cut, and only that cut appears in playback `shotIds`; other mapped shots need settling. Alignment enforcement is opt-in so old DSL timelines without shot mappings keep their narration.
- No browser was launched. Rendered UI acceptance and other web changes belong to the lead under the card rules. No real model/provider call, external-network request, personal-credential read, production-state access, production restart or port-3001 listener was used. Validation uses disposable test state, fake providers and synthetic local media.
