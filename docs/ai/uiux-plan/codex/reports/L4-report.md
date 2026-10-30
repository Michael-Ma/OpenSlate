# L4 report — shot-only canonical narration and transcript-adoption removal

Date: October 29, 2026. Worktree: `claude/drop-legacy-lf`. Baseline supplied by the lead after L1–L3 and P1–P3 merge: **4,728 total; 4,727 passed; zero failed; one optional skip**.

## Done

1. **Absolute canonical narration:** canonical preparation requires a dedicated shot session, one selected section/mapping, explicit shot-relative selection and duration mode. Canonical segments always have `placementMode: "shot"` and `timingMode: "within_shot"`. Removed the full-snapshot/absolute projection, overlap/absolute rounding branch, obsolete comparison/export helpers, absolute playback IDs/filtering, absolute storyboard de-duplication and conditional plan rebase. Existing accepted source samples remain immutable and placements follow current shot order.
2. **Project-wide canonical authority:** cue creation, script/audio/timing acceptance and placement reject project-scope actors with `NARRATION_SHOT_SCOPE_REQUIRED`. Generated canonical verification requires exact local-user shot scope, immutable session/section pin and the original acceptance subjects. No project-scope or missing-mode compatibility is retained.
3. **Draft ownership:** removed canonical `shotMappings` as a fallback when a shot draft is missing in shot reads, scope ownership, scene narration views and materialization/human-field mapping. Current canonical mappings remain in committed-state, library and project reads. Shot drafts and undo snapshots now require `intentDigest`; mapped speech preparation rejects a missing/malformed/stale digest.
4. **Transcript adoption:** deleted human word/timing adoption methods, transcript selection/media/projection modules, adoption-specific types/provenance, context projection and store/backup validation branches. Deleted the unused generated-recording list projection. Director attachment recognition, transcript candidates and source sample mapping remain intact.
5. **Retained generated provenance defect exposed by real fixtures:** accepting B after accepted generated A acquired an unfinished replacement draft previously failed strict provenance validation. Canonical publication now saves a separate immutable narration revision containing exactly the selected and retained accepted entries, while the live workspace/drafts retain their own revision. Strict generated verification is unchanged. The regression asserts frozen A, untouched unfinished live state, exact publication revision and replay without a second revision.

## Files

No web source, browser contract, code-plan runtime, core compiler/tool catalog, shipped guidance, schema, engine or scene-confirmation compatibility code changed.

Modified:

- `apps/server/src/application/context-projection.ts`
- `apps/server/src/media/storyboard-capture.ts`
- `apps/server/src/narration/audio-placement.ts`
- `apps/server/src/narration/canonical-types.ts`
- `apps/server/src/narration/canonical.ts`
- `apps/server/src/narration/generated-audio.ts`
- `apps/server/src/narration/index.ts`
- `apps/server/src/narration/mapped-speech-intent.ts`
- `apps/server/src/narration/narration-scope.ts`
- `apps/server/src/narration/service.ts`
- `apps/server/src/narration/shot-audio-routes.ts`
- `apps/server/src/narration/shot-recording-routes.ts`
- `apps/server/src/narration/types.ts`
- `apps/server/src/persistence/installation-backup-closure.ts`
- `apps/server/src/persistence/store.ts`
- `apps/server/src/scene-narration-view.ts`
- `apps/server/src/storyboard-history.ts`
- `apps/server/test/generated-narration-backup.test.mjs`
- `apps/server/test/generated-narration-fixture.mjs`
- `apps/server/test/generated-narration-http.test.mjs`
- `apps/server/test/generated-narration.test.mjs`
- `apps/server/test/generation-overview.test.mjs`
- `apps/server/test/local-media-executor.test.mjs`
- `apps/server/test/mapped-speech-intent.test.mjs`
- `apps/server/test/media-execution-runtime.test.mjs`
- `apps/server/test/media-production-pipeline.test.mjs`
- `apps/server/test/narration-domain.test.mjs`
- `apps/server/test/narration-http.test.mjs`
- `apps/server/test/narration-service-harness.mjs`
- `apps/server/test/narration-speech-http.test.mjs`
- `apps/server/test/narration-tools.test.mjs`
- `apps/server/test/owned-transcription-http.test.mjs`
- `apps/server/test/owned-transcription-records.test.mjs`
- `apps/server/test/owned-transcription-review.test.mjs`
- `apps/server/test/owned-transcription-service.test.mjs`
- `apps/server/test/shot-audio-http.test.mjs`
- `apps/server/test/shot-audio-placement.test.mjs`
- `apps/server/test/shot-narration-scope.test.mjs`
- `apps/server/test/storyboard-export.test.mjs`
- `apps/server/test/transcription-execution-fixture.mjs`
- `apps/server/test/voice-outcomes.test.mjs`
- `docs/implementation/MANUAL-AUDIO-TESTING.md`
- `docs/implementation/MANUAL-LIVE-PRODUCTION.md`
- `docs/implementation/SHOT-AUDIO.md`
- `docs/implementation/STATUS.md`
- `docs/technical/NARRATION.md`
- `docs/technical/PROVIDERS-ARTIFACTS.md`
- `docs/technical/TIMELINE-RENDERING.md`

Added:

- `docs/ai/uiux-plan/codex/reports/L4-report.md`

Deleted:

- `apps/server/src/narration/generated-recording-projection.ts`
- `apps/server/src/narration/transcript-projection.ts`
- `apps/server/src/narration/transcript-selection-media.ts`
- `apps/server/src/narration/transcript-selection.ts`
- `apps/server/test/narration-canonical.test.mjs`
- `apps/server/test/transcript-review-http.test.mjs`
- `apps/server/test/transcript-selection-backup.test.mjs`
- `apps/server/test/transcript-selection-fixture.mjs`
- `apps/server/test/transcript-selection-helpers.test.mjs`
- `apps/server/test/transcript-selection.test.mjs`

## Tests

**Test inventory:** 11 introduced replacement/new cases and 71 original cases removed, a net reduction of 60. Seven new shot-workspace cases preserve the old canonical durability/integrity/fence checks: reopen/exact replay, canonical transaction rollback on conflicting artifact identity, corrupt-byte refusal, narration/head/request fences across asynchronous verification, and cue/source bounds plus foreign-recording refusal. Additional cases cover missing drafts, required intent digests, direct project-scope mutation refusal and retained generated narration with unfinished drafts. The generated provenance tamper matrix additionally rejects project-wide acceptance.

Removed originals: 41 transcript-adoption cases; 15 old canonical cases after moving current invariants; seven absolute/project projection domain cases; two project-wide HTTP cases; two shot absolute-placement cases; two absolute storyboard export cases; one absolute placement-helper case; one dead generated-library paging case. No tests disabled or optional skips added. `retired-routes.test.mjs` is retained.

Rewrote generated narration, backup/HTTP and shared transcription fixtures onto actual shot sessions/workspace operations. Speech/transcription request tests use their retained real application session helper instead of the removed project-session harness branch. Configured-media and owned-transcription consumers retain their admission, reservation, exact provenance, review, byte, no-new-call and restart assertions. Generation-overview, voice-outcome and secondary mapped-speech fixtures now supply the required digest without changing outcome, liability or no-dispatch assertions (29/29 and 16/16 isolated checks passed). The negative cross-shot canonical test now supplies all required fields and asserts `SCOPE_DENIED`, so input validation cannot mask the scope check.

Final verification:

| Check | Result |
| --- | --- |
| `pnpm setup:test-media` | Passed; existing FFmpeg/ffprobe 8.1.1 already matched, no download |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders |
| `pnpm build` | Passed all five workspace builds; existing web chunk/dynamic-import warnings only |
| Touched/focused fixture gates | 169/169, 110/110, shot acceptance 26/26, shot-scope 5/5, configured media 21/21 and plan-DSL local executor 6/6 passed |
| Web + code-plan regression gate | 1,131 tests, 1,131 passed, zero failed/skipped across 97 web and seven code-plan files |
| Final backend target | 1,032 tests, 1,032 passed, zero failed/skipped across 87 files: all card families plus local-media-executor |
| Final combined target after fixture corrections | **2,208 tests / 2,208 passed / zero failed/skipped** across 194 files: card families, all touched tests, web and code-plan regressions |
| Full `pnpm test` | **4,668 total / 4,667 passed / zero failed / one optional native-probe skip**, zero cancelled/todo; 626.214 seconds |
| `pnpm -r typecheck` | Passed all five workspace typechecks after the final full suite |
| `pnpm demo:headless` | Passed after the final full suite: four initial + two edited fake acceptances, zero duplicates after restart, unchanged shot preserved; one-second fixture preview, no real model/network calls |
| `git diff --check` and documentation links | Passed; all 89 checked local documentation links resolve |

The first broad diagnostic returned 1,018 total / 1,003 passed / 15 failed / zero skipped. It identified the retained-generated revision defect and remaining old fixture authority in media/runtime, narration-tools and owned-transcription tests; those setups were rewritten without weakening assertions. One module-load failure was caused by a concurrent server build while the diagnostic was running. Subsequent final gates use a completed build with no concurrent output mutation. The unchanged local-media-executor setup independently failed all six cases on the removed project acceptance path before its planning-only fixture adaptation; all six then passed.

The first complete `pnpm test` run returned **4,668 total / 4,666 passed / one failed / one optional skip**. The single failing case, `current voice attempts project making and failed without dispatching` (`generation-overview.test.mjs`), still seeded a draft without its newly required intent digest. Its fixture now supplies the saved shot's digest; the exact outcome and no-dispatch assertions remain, and its 29-case file passed in isolation. The same omission was corrected in voice-outcome and secondary mapped-speech fixtures, whose combined 16 cases passed. The final 194-file target and complete suite both passed after these corrections. The only skipped test is the unchanged `opt-in native Codex probe never starts a model turn`.

Self-review covered correctness, edge cases, callers, cross-file effects and integrity coverage. It corrected a scope test masked by input validation, restored exact supplied-provenance assertions during fixture rewriting, and changed positional canonical assertions to segment-ID lookups after removal of the absolute sort. Independent fresh source and final source/test reviews found no remaining actionable issue.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. No route or browser shape added. Internal canonical input fields `segmentIds`, `shotRelativeSegmentIds`, `shotDurationMode` and prepared shot-relative IDs are mandatory; canonical placement/timing modes and draft/undo intent digests are required. Canonical `narrationRevisionId` identifies the immutable accepted publication snapshot, independent of the current draft revision. Human transcript-adoption APIs/types and dead projection exports were removed. Project-wide canonical mutation now returns `NARRATION_SHOT_SCOPE_REQUIRED`.

## Commits

**No commits created**, per COMMON.md and RULES.md. Proposed single atomic conventional commit:

`refactor(narration): require pinned shot audio and remove transcript adoption`

File list: every modified, added and deleted file enumerated above. This keeps the stricter writer/provenance changes, caller/fixture rewrites, preserved integrity regressions and current documentation together for lead review.

## Open issues

None within L4. All required offline gates passed.

Deliberately retained card boundaries:

- `apps/server/src/narration/audio-placement.ts` keeps optional placement/timing fields, absolute pass-through and exact-length non-`within_shot` timing for `media/timeline-capture.ts` plan-DSL asset timelines. `requireAbsoluteCutStart` and canonical callers' absolute handling are removed. The shipped demo seed remains unchanged at placement frames 0/180 and continues to pass.
- `apps/server/test/local-media-executor.test.mjs` was entangled: it authored its no-shot, absolute plan fixture through the removed project writer. The test now verifies/installs the real normalized recording and directly seeds the same planning-only accepted absolute data with `shotMappings: []`, following `timeline-capture.test.mjs`'s existing fixture convention. All exact sample/audio, content invalidation, no-paid-work, rollback, pause/edit and restart checks remain. No planning runtime compatibility or canonical fallback was added. The other two media fixtures have actual shots and now use the real shot writer.
- Project-session speech/transcription plumbing, Director whole-film requests, review methods, scene-confirmation checkpoint compatibility, low-value shape fallbacks, plan compiler/compositions, tool catalogs/guidance, no-localExecution-pin mode, engine profile harness fallback and the entire code-plan runtime are unchanged.

All checks use disposable local state, synthetic audio/media and fake or injected provider transports. No browser, port-3001 server, real model/provider call, external network, protected `.env*`/`.openslate/`/secret read, commit or push occurred.
