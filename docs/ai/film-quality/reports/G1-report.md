# G1 report: video quality and per-film resolution

## Done

- **G1.1 Quality:** new code films pin built-in Viggle revision 2, high quality and 1080p. Exact revision-1 low/768p locks remain installed/executable and replay without purchasing again. Legacy host configurations naming that exact former built-in are normalized only for new selections.
- **G1.2 Settings:** persisted optional `code_plan_settings.videoResolution` with 480p, 768p, 1080p and 2k. Missing settings use the saved profile resolution. Ceiling and video settings preserve one another. Added authenticated GET/PUT views, exact validation, 409 availability errors, recovery/CSRF checks, plan wake and `code_plan.changed`.
- **G1.3 Submission integrity:** resolution stays outside normalized inputs and step keys. New intents capture it in a separate immutable capability lock derived from the film's original lock; only resolution may differ. Existing requests, prices, mappings, attempts, artifacts and uncertain liabilities retain their snapshots. Retakes and consented retries capture current settings. Existing call details expose the actual submitted setting without a web change.
- **G1.4 Pricing:** current resolution drives `read_film.models[].priceBasis`, dry-run/circuit-breaker estimates, reservations, keyframe input options and the film model-settings endpoint's `ProviderOption.pricing`. Open cards refresh on the awakened pass and keep their conversation position. Already answered recipes retain their exact row and answer. Explicit Director resolution is refused in both `ctx.video` and `keyframe.video`, before image purchase in the latter case.
- **G1.5 Export:** new render intents capture the film aspect and resolution sizes: 480p → 480 short side (even 854 long side), 768p → 720, 1080p/2k → 1080. Explicit plan dimensions do not override film policy. Render identity remains stable; saved render outputs replay unchanged. Graph export sizing is unchanged.
- **G1.6 Price table:** unchanged. The card's three measured five-second charges equal the existing published rates (15/25/30 credits); no new live provider calls or billing measurements were performed.

## Files

Modified:

- `apps/server/src/app.ts`: video-settings GET/PUT and film-specific model-option pricing.
- `apps/server/src/application/provider-catalog.ts`: revision-2 default and exact revision-1 compatibility.
- `apps/server/src/code-plan/execution.ts`: immutable submission locks and export-size snapshots.
- `apps/server/src/code-plan/identity.ts`: host-only resolution policy, explicit override refusal.
- `apps/server/src/code-plan/index.ts`: setting persistence/wake/events, current estimates and answer reuse.
- `apps/server/src/code-plan/model-pricing.ts`: shared optional host resolution.
- `apps/server/src/code-plan/models.ts`: exact saved catalog definitions and current price basis.
- `apps/server/src/code-plan/port.ts`: server settings read/write methods.
- `apps/server/src/code-plan/provider-authority.ts`: original-identity/derived-submission validation.
- `apps/server/src/code-plan/records.ts`: optional video setting beside optional ceiling.
- `apps/server/test/code-plan-viggle-model.test.mjs`
- `apps/server/test/model-pricing.test.mjs`
- `apps/server/test/provider-catalog.test.mjs`
- `packages/core/src/aspect.ts`: separate code-film export-size function.
- `packages/core/test/aspect.test.mjs`
- `docs/technical/PROVIDERS-ARTIFACTS.md`

Added:

- `apps/server/src/code-plan/video-settings.ts`
- `apps/server/test/code-plan-video-settings.test.mjs`
- `docs/ai/film-quality/reports/G1-report.md`

Deleted: none. No `apps/web/**`, media implementation, `clip-frames.ts`, skills, secrets or environment files changed. No database schema/DDL changes.

## Tests

Added eight G1 integration tests covering new/default versus saved profiles, queued/in-flight separation, stable keys and unchanged media state, actual multipart settings and prices, restart without re-purchase, retakes, consented uncertain retries, current card/read_film/dry-run prices, answered-card reuse, API shapes/rates/400/409/CSRF/recovery, ceiling preservation, explicit Director override refusal, actual local render size and all resolution/aspect intent combinations, and derived-lock integrity. Added one core export-size test including graph regression checks.

Rewritten expectations in the existing built-in-model, price and catalog tests: old 768p/low default and corresponding rates are intentionally replaced by 1080p/high. Historical custom-profile, replay, no-double-charge and unknown-submission protections remain. No tests deleted.

Verification (offline fixtures and loopback only):

- Toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. `pnpm setup:test-media` and `pnpm check:toolchain` passed using already-installed tools.
- `pnpm build`: passed.
- G1 settings file: 8 passed, 0 failed.
- `node scripts/run-tests.mjs apps/server/test/code-plan-*.test.mjs apps/server/test/provider-catalog.test.mjs apps/server/test/model-pricing.test.mjs packages/providers/test/*.test.mjs packages/core/test/aspect.test.mjs`: 700 passed, 0 failed, 0 skipped (exit 0).
- `pnpm test`: build passed; the full test run was interrupted after more than 50 minutes, including a final ten-minute interval with no new output (exit 1). It emitted no normal final test-count summary. Its captured reporter output contains exactly **3,042 pass lines and 25 flagged checks**; these are observed reporter lines, not complete suite totals. Full-suite acceptance is **not established**.
- `pnpm typecheck`: passed, 5 workspace package checks.
- `pnpm -r typecheck`: passed, 5 workspace package checks.
- `git diff --check`: passed.

During development, test fixtures were corrected to seed historical locks through explicit test-only SQL rather than the immutable production writer, include Store-added entity identity fields, use canonical recovery timestamps and distinguish unknown liability from charged liability. The retry test uses a real synthetic lost-response/reconciliation path, not fabricated success/failure transitions. The full run and all attempted affected-file reruns are detailed below; the flagged checks could not be reproduced or cleared because the rerun startup gate did not pass.

## Full-run verification limitation (November 3)

The full run slowed sharply: individual untimed checks took 134, 204, 226, 326 and 489 seconds. It eventually stopped producing output for ten minutes. I interrupted only this task's managed test session and preserved its log; no source or timing limits were changed to make checks pass. The runner printed these interrupted files:

- `apps/server/test/transcription-preparation-engine.test.mjs`
- `apps/server/test/transcription-preparation-port.test.mjs`
- `apps/server/test/transcription-preparation-storage.test.mjs`
- `apps/server/test/upload-formats.test.mjs`
- `apps/server/test/video-derivation.test.mjs`
- `apps/server/test/video-download.test.mjs`
- `apps/server/test/video-models.test.mjs`
- `apps/server/test/viggle-backup.test.mjs`
- `apps/server/test/viggle-h3-execution.test.mjs`
- `apps/server/test/viggle-h3-frame-crop.test.mjs`
- `apps/server/test/voice-outcomes.test.mjs`

Per the owner's rerun instruction, I attempted each affected file again:

| File | Initial flagged checks | Rerun outcome |
|---|---:|---|
| `apps/server/test/storyboard-export.test.mjs` | 3 | Repeated startup attempts exited 1 before tests: pnpm version probe unavailable |
| `apps/server/test/takes-undo.test.mjs` | 16 | Serial rerun exited 1 before tests: same startup gate |
| `apps/server/test/tool-invocations.test.mjs` | 1 | Serial rerun exited 1 before tests: same startup gate |
| `apps/server/test/transcript-candidate-records.test.mjs` | 5 | Serial rerun exited 1 before tests: same startup gate |

An optional isolated `spool-transcript-ingestor.test.mjs` diagnostic also could not start, twice, at the same gate. This is not a failed result for that file's tests.

The installed CLI still returns **pnpm 10.33.0** when allowed to finish. I separately reproduced the checker's actual bounded subprocess calls: both the Corepack shim and direct installed CLI returned `ETIMEDOUT`/`SIGTERM` at approximately 5.0 seconds, with no version output within the probe. Using a temporary symlink to the real installed CLI and a task-local Node compile cache did not clear the gate. No version output was spoofed, no checks bypassed, no test deadlines extended and no global installation modified. The initial pinned-toolchain checks, build, 700-test suites and both typecheck commands completed successfully before this later problem.

Captured logs remain in `/private/tmp/openslate-g1-full-test.log`, `/private/tmp/openslate-g1-suites.log`, `/private/tmp/openslate-g1-settings-final.log`, `/private/tmp/openslate-g1-typecheck.log`, `/private/tmp/openslate-g1-recursive-typecheck.log`, `/private/tmp/openslate-g1-storyboard-rerun*.log` and `/private/tmp/openslate-g1-rerun-*.log`. The 25 initial checks below remain **unconfirmed**, since their rerun bodies did not execute. I cannot attribute or dismiss their causes based on the incomplete full-run output. No changes were made in these four test files.

### storyboard-export.test.mjs

- cancel aborts a running export; recover only checks receipts, replay never re-renders failed or cancelled work
- the shipped fake demo exports twelve planned seconds with accepted fixture narration after reopening
- the Director's start_export is not blocked by its own conversation's edit hold, but still is by the person's and other requests' holds

### takes-undo.test.mjs

- regeneration keeps current frame and clip through dispatch/restart, then outdates clip only on success
- failed regeneration retains current frame and clip and never invents another take
- use earlier take verifies bytes, publishes without grants, outdates clip, replays and undoes
- undo imagePrompt restores exact media and preserves immutable attempts
- undo videoPrompt restores exact media and preserves immutable attempts
- undo desiredFrames restores exact media and preserves immutable attempts
- undo is refused after paid work used the edited state, including unknown outcomes
- take routes reject missing key, foreign shot/artifact, current take and live regeneration without side effects
- undo byte verification fails atomically and the original identity can retry after repair
- undo never reattaches a take made for a different intent
- undo never reattaches a take made for a different prompt
- undo never reattaches a take made for a different duration
- a terminally failed regeneration does not prevent selecting an earlier successful take
- released regeneration with a retained task id can switch takes while its late result stays historical
- lost regeneration has no late take, remains charged and permits selecting an earlier take without another purchase
- HTTP shotFields outdates both media slots and a single Undo restores every field and exact paid take

### tool-invocations.test.mjs

- the next-action receipt preserves grant integrity and never authorizes an incomplete multi-operation plan

### transcript-candidate-records.test.mjs

- candidate insertion rejects an identical-byte winner belonging to a different provider receipt
- candidate insertion requires its retained provider dispatch even after a completed raw response
- published candidate backup retains exact raw JSON, source derivative and unreviewed projection
- backup rejects a published candidate whose sample coordinates were rewritten in retained SQL
- published candidate backup requires the original raw spool even when artifact bytes remain intact

## Self-review

Reviewed the full source/test diff for replay identities, admission authority, request/receipt invariants, retry accounting, catalog callers, settings persistence, choice retirement and render capture. Fixed two issues found: reject `keyframe.video.resolution` before its image can dispatch, and preserve the existing `code_plan.changed` payload fields. Also guarded recipe comparison against primitive generic-choice values. No remaining implementation correctness issue identified in the owned scope.

## Contract changes

`packages/core/src/studio-api.ts`: none. The new routes implement the card's view. The server-only `CodePlanPort` gains `videoSettings` and `setVideoSettings`; `CodePlanSettings` gains optional `videoResolution`. No Director tool contract/version or step-key format changes.

## Commits

No commits made, as requested. Proposed split for the lead:

1. `feat(code-plan): add per-film video resolution and high-quality defaults`: all modified/added server and core source files plus the five changed/added test files listed above.
2. `docs(providers): document code-film video quality and settings`: `docs/technical/PROVIDERS-ARTIFACTS.md`, `docs/ai/film-quality/reports/G1-report.md`.

## Open issues and integration notes

- **Verification blocker:** the full suite has no final pass/fail totals, and the four affected-file reruns could not start because the pnpm subprocess exceeded the existing five-second startup probe. A full rerun and those four files need verification on a responsive machine before claiming full-suite acceptance. The completed targeted suites remain 700 passed, 0 failed.
- The lead owns Settings UI, web fixtures and browser verification; no browser was launched here.
- PUT emits the existing refetch event immediately; card price refresh happens on the next plan pass. New unpaid cards get a new price-bound options digest while retaining `askedAt`; existing answers remain exact.
- A completed render stays cached by its existing key. A deliberate fresh render/variant captures a later export size, preserving the card's no-rekey/no-artifact-replacement requirement.
- The new default lives in the capability lock, so no eager write/migration is needed for either new or saved films. Settings writes remain separate from generation; the wake resumes only work already authorized by the saved plan and existing guards.
- The existing model-settings GET handler is adjusted only to project film-specific pricing; its shape and graph behavior remain unchanged.
