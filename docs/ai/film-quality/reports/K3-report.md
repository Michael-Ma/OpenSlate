# K3 — Shared references in the code-plan view

## Done

`codePlanView` now projects the optional `references` field already declared in the shared browser contract. It scans reached image/video steps in journal order, reading each input's `references`, `firstFrame` and `lastFrame`. It resolves only this film's owned image artifacts through `codePlanArtifacts`, excludes images produced by shot-linked image steps using the existing `codePlanShotLinks`, maps reduced upload copies back to their owned originals, deduplicates by the resulting artifact id and stops at 24. Empty lists and films without a plan omit the field.

This is a read-only projection. No journal/input, step key, price, execution, schema or persistence changes were made. The Director's `read_film` spreads this view and therefore receives `references` too; the regression verifies that behavior without editing Director code.

## Files

- Changed: `apps/server/src/code-plan/view.ts`.
- Added: `apps/server/test/code-plan-references-view.test.mjs`.
- Added: this report, `docs/ai/film-quality/reports/K3-report.md`.
- Deleted: none. No additional ownership exception was needed; web source and the shared contract were not edited.

## Tests

Eight tests were added, all through a real `CodePlanRuntime` and `CodePlanExecution` with a durable fake provider and disposable stores:

1. A generated sheet feeds `ctx.keyframe`; after the person chooses `keyframe_and_references`, the clip consumes both images while the view lists only the sheet. A later version uses the sheet as an artifact literal without reaching its image step. It retains the reference, all media step identities, dispatch count and spend. Direct, HTTP and Director reads leave database entities, project, events and provider calls unchanged.
2. Reduced upload and original inputs report the original once, including after restart.
3. Image references, video first/last frames and video references preserve journal first-use order, including when a later program reaches the same steps in a different order. Replays dispatch nothing new.
4. A replaced, unreached step no longer contributes its input picture.
5. Foreign, unknown, non-image, mismatched and malformed persisted inputs do not leak into the view. Normal admission rejects invalid inputs; this test modifies a reached journal input after valid execution and only reads it afterward.
6. A legacy keyframe identified through its choice is excluded even without a shot annotation on the image step.
7. 27 distinct owned picture inputs return only the first 24.
8. No plan, unused pictures and an empty latest plan omit the field.

No existing tests were rewritten, deleted, skipped or disabled.

## Verification

- `pnpm setup:test-media`: passed; installed FFmpeg/ffprobe already matched, no download.
- `pnpm check:toolchain`: passed with Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1.
- `pnpm build`: passed all five workspace builds. Existing web bundle-size/dynamic-import warnings remain.
- `node scripts/run-tests.mjs apps/server/test/code-plan-references-view.test.mjs`: **8 passed, 0 failed, 0 skipped**.
- `pnpm test`: **5,114 passed, 5 failed, 2 skipped; 5,121 total**, 0 cancelled/todo, duration 720,708.72575 ms. All eight K3 regressions passed again in this full run. The five failures are the unchanged web component harness cases listed below.
- Isolated recheck, `node scripts/run-tests.mjs apps/web/test/next/code-plan-components.test.mjs`: **13 passed, 5 failed, 0 skipped**. All five web failures from the full run reproduced immediately; see below.
- `pnpm typecheck`: passed all **five** workspace typechecks, with **0 failures**, after its package builds.
- `pnpm -r typecheck`: passed all **five** workspace typechecks, with **0 failures**.
- `git diff --check`: passed.

## Self-review

Reviewed the implementation and new tests for ownership, normalized content identity, historical/current shot links, reduced-copy canonicalization before deduplication, ordering, bounds, omissions and caller effects. The direct/HTTP/Director read regression verifies no database/event or provider side effects. No remaining material finding was identified.

## Contract changes

None. `packages/core/src/studio-api.ts` already defines `CodePlanView.references?: StudioArtifactRef[]` and is unchanged.

## Commits

No commit was made, as required. Proposed single conventional commit for the lead:

`fix(server): list shared image inputs in the code-plan view`

Files: `apps/server/src/code-plan/view.ts`, `apps/server/test/code-plan-references-view.test.mjs`, `docs/ai/film-quality/reports/K3-report.md`.

## Open issues and coverage limits

K3 implementation is complete, but the full gate is not clean because of five failures in the unchanged `apps/web/test/next/code-plan-components.test.mjs`. Its VM harness removes component imports without supplying two dependencies used by the current web source. These tests import web components/models, not the changed server view. `git diff --exit-code HEAD` confirmed that the test, `apps/web/src/next/codeplan` and `apps/web/src/next/model/code-plan.ts` remain unchanged. The isolated file rerun reproduces all five failures, so they are not classified from a single timing-sensitive run:

| Test | Error on isolated rerun |
| --- | --- |
| the run strip: state chip, version, spend with pending money, and the held line | `ReferenceError: makingNow is not defined` |
| paused at the ceiling the strip offers +$1 (white, primary) and raising sends the next ceiling | `ReferenceError: makingNow is not defined` |
| an error is said plainly with the pass’s own message; an unreadable run offers Read again | `ReferenceError: makingNow is not defined` |
| Plan before the first pass ends says the plan is running, not that it declares nothing | `ReferenceError: useEffect is not defined` |
| the spend limit is changed in the run strip | `ReferenceError: makingNow is not defined` |

The lead should update the web test harness; web files are outside K3 ownership and were not edited.

Browser presentation and real-provider behavior were not exercised under the card's hard rules. The new upload test uses synthetic owned original/copy records and a real runtime, rather than repeating image reduction; existing upload tests cover reduction itself in the full suite. The invalid-input case tests read-side defense on a deliberately damaged journal, not successful admission of invalid media. No live provider, external network, personal credentials, protected production state or port-3001 listener was used.
