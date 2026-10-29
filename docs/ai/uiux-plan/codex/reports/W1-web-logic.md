# W1 — web logic fixes

## Done

- **ui-1:** successful narration saves share one settlement path before the editor closes. Composite text/mode/voice saves return the text command id for a Director note's evidence; the final command remains the toast/check Undo target. Refused, superseded and partially failed saves retain the editor and do not claim settlement.
- **ui-3:** recording import has one Choose a file button at a stable tree position. Only refusal text appears/disappears in the footer. A fake DOM regression exercises synchronous file refusals, clearing them and asynchronous duration refusal while retaining the same focused node.
- **ui-4:** scene playback skips unavailable clips once per shot/availability boundary, including effect replay, without advancing an idle preview or a ready clip.
- **keyframes-regenerate-identity-ignores-replacement:** paid-press identity includes replacement state, attempt id and failure time. Exact lost-reply replay remains until observed job progress proves that the press landed.
- **keyframes-voice-only-make-keyframes-label:** Make counts actual missing frames; voice-only generation uses the specified voice label/note/breakdown. Mixed quotes name frames and paid voice lines separately, preserving subscription and unknown-price behavior.
- **plan-impact-clip-unpriced / narration-voice-price-missing:** clip/voice remake estimates use independent `oneClip`/`oneVoice` quotes, preferring the selected scene and then another scene. Fully saved fixture scenes expose zero-unit `confirmVideo` plus those unit quotes.
- **narration-fit-contract-drift:** measured extensions use `shot.narration.fitSeconds`. Estimates show the specified explanation and only Edit narration. Fixture fit uses measured samples and the server's whole-second rule, without padding, within its 3–15 second profile.
- **narration-keyframes-run-invisible:** cards, inspector and panel read keyframe voice-run steps/stops, with Make and Regenerate guarded during confirmation. The fixture now makes missing generated speech alongside frames, exposes `keyframesRun`, supports voice-only presses and stops without starting clips, and fences late speech steps by their original text/mode/voice and run ownership.
- **video-02 / video-04:** stale confirmations and download ingestion issues use the specified bilingual copy. Download reasons are allowlisted; unknown reasons use the generic retrying text. Ingestion cannot expose Give up or a fresh paid clip retry.
- **film-length-inflight-clip, inspector half:** motion/duration impact discloses the charged, outdated result of running clips and retained replacements.
- **plan-delete-shot-running-job, web half:** Delete is disabled with `error.ATTEMPTS_RUNNING` for running/unanswered image, clip, replacement or voice work. An already-open confirm and the fixture command also refuse it, preserving the attempt and media.

## Files

Changed source:

- `apps/web/src/next/keyframes/CheckBanner.tsx`
- `apps/web/src/next/keyframes/Inspector.tsx`
- `apps/web/src/next/keyframes/KeyframesView.tsx`
- `apps/web/src/next/keyframes/NarrationPanel.tsx`
- `apps/web/src/next/keyframes/Preview.tsx`
- `apps/web/src/next/model/checks.ts`
- `apps/web/src/next/model/inspector.ts`
- `apps/web/src/next/model/keyframes.ts`
- `apps/web/src/next/model/keyframes-press.ts`
- `apps/web/src/next/model/narration.ts`
- `apps/web/src/next/model/narration-edits.ts`
- `apps/web/src/next/model/plan.ts`
- `apps/web/src/next/model/plan-edit.ts`
- `apps/web/src/next/model/types.ts`
- `apps/web/src/next/views/plan/PlanView.tsx`
- `apps/web/src/next/views/plan/ShotRow.tsx`
- `apps/web/src/next/i18n/translate.ts`
- `apps/web/src/next/i18n/catalog/keyframes.ts`
- `apps/web/src/next/i18n/catalog/errors.ts`
- `apps/web/src/next/fixtures/last-ferry.ts`
- `apps/web/src/next/fixtures/fixture-commands.ts`
- `apps/web/src/next/fixtures/fixture-director.ts`
- `apps/web/src/next/fixtures/routes/narration.ts`
- `apps/web/src/next/fixtures/routes/plan.ts`
- `apps/web/src/next/fixtures/routes/film.ts` (two mode-context arguments to the shared fixture recomputation only)

Added source:

- `apps/web/src/next/fixtures/narration-fit.ts`

Added tests:

- `apps/web/test/next/w1-keyframes-states.test.mjs`
- `apps/web/test/next/w1-narration-save.test.mjs`
- `apps/web/test/next/w1-plan-delete.test.mjs`
- `apps/web/test/next/w1-pricing-fit.test.mjs`

Changed tests/scenarios:

- `apps/web/test/next/edit-conflict.test.mjs`
- `apps/web/test/next/keyframes-checks.test.mjs`
- `apps/web/test/next/keyframes-fixture.test.mjs`
- `apps/web/test/next/keyframes-model.test.mjs`
- `apps/web/test/next/keyframes-parity.test.mjs`
- `apps/web/test/next/keyframes-parity-fixture.test.mjs`
- `apps/web/test/next/narration-edits-feedback.test.mjs`
- `apps/web/test/next/narration-model.test.mjs`
- `apps/web/test/next/narration-own-writes.test.mjs`
- `apps/web/test/next/plan-edit.test.mjs`
- `apps/web/test/next/subscription-prices.test.mjs`
- `scripts/browser/next-keyframes-parity.mjs` (syntax checked only)
- `scripts/browser/next-narration.mjs` (stable Choose-node focus assertions and updated containment; syntax checked only)

Added documentation: this report. Deleted files: none. No source outside the card's web/fixture/test/catalog/browser/report scope was edited. The protected note banner, notes catalog, Film view, film-export model, film catalog, core contract, server, schema and frozen skills/tools were left untouched.

## Tests

Added **42 test cases**: 13 state/identity/playback/download cases, four actual narration component/fake-DOM cases, four Plan deletion cases, 19 pricing/fit/voice-pipeline cases, and two narration command-result/no-op cases in the existing feedback file. Parameterized cases cover both locales, all supported download reasons plus fallback, replacement states, mode choices and asynchronous ownership boundaries.

Updated existing narration assertions in `narration-edits-feedback`, `edit-conflict` and `narration-own-writes` for command-id/null results. Adapted **14 existing pricing/fit/fixture cases** to authoritative fit targets, measured-only fit and earlier keyframe-stage speech; two existing keyframe/subscription cases now require the specified mixed frame/voice breakdown. The clocked parity helper advances chained timers in 100 ms increments so later-step callbacks are actually observed. Original exact-key/body replay, no-double-charge, unknown-outcome and stale-write assertions remain.

No tests were deleted, disabled or newly skipped. The money/integrity protections were explicitly checked during review, including lost-response replay before/after observable job progress, different fresh human keys, stale-version refusal, and no clip dispatch from a keyframe voice run.

| Check | Final result |
| --- | --- |
| Toolchain | Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders passed |
| `pnpm setup:test-media` | Passed using existing binaries; no download |
| `pnpm build` | All five packages/apps passed |
| `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs` | **870 passed**, zero failures/cancelled/skipped/todo |
| `pnpm -r typecheck` before full suite | All five packages/apps passed, zero failures |
| `pnpm test` | **3,423 passed**, zero failures/cancelled/todo, **one optional native-probe skip** (**3,424 total**); 922.086 seconds |
| `pnpm -r typecheck` after full suite | All five packages/apps passed, zero failures |
| Browser scenario syntax | `node --check` passed for both changed browser scenario files; never launched |
| Listed changed/added-file whitespace/conflict checks | **44 files**, zero trailing-whitespace/conflict-marker issues |

Focused groups also passed: narration **49/49**, pricing/fit/fixture **133/133**, states/state-truth **28/28**, and deletion **4/4**. These overlap the final web suite and are not additional distinct test totals. The only full-suite skip was `opt-in native Codex probe never starts a model turn`; it was not enabled. The build retains its existing advisory about a web chunk larger than 500 kB. Independent source/test reviews found no outstanding must-fix issue.

Development runs exposed one obsolete subscription-breakdown expectation (first broad web run **861 passed, one failed**), which was updated for the card's required copy. Small new-test harness issues and missing pre-build core output were corrected; the final all-web run above has no failures. Two older clocked fixture tests initially failed after moving speech earlier; their files passed after the manual-clock helper was corrected. No failure was left attributed to machine load.

## Contract changes

None. `packages/core/src/studio-api.ts` is unchanged. The internal web `Msg` gains optional nested message placeholders so the download reason stays localized by message id until render; this does not change the browser/server contract.

## Commits

No commits were created, per the card rules. Proposed conventional commit:

- `fix(web): address W1 plan and generation logic findings` — all source, tests, browser scenario and report files listed above. This keeps the shared fixture-pipeline, pricing and status changes together for review.

## Open issues

- No remaining W1 implementation or required-check blocker.
- No browser was launched. The lead should replay `next-keyframes-parity-confirm-steps-and-stop`, `next-keyframes-parity-confirm-narrow`, `next-narration-refusals` and the other recording flows in `scripts/browser/next-narration.mjs`, plus normal Plan deletion, regeneration, voice-only Make and scene playback. Node/fake-DOM results do not establish rendered layout or live-provider acceptance.
- The contract has no run timestamps. Running operations take precedence over blocked history. Current pending targets/narration distinguish a fresh voice-run failure from a historical stop after video is saved.
- The fixture models generated speech readiness but has no separate canonical-acceptance readiness field. It does not invent free accept-only keyframe targets for the already measured golden scene; fresh blocked narration remains visible from its current state. Missing generated speech, measured fit, voice-run ownership and the specified new contract fields are exercised.
- Unit-price fallbacks use only `oneClip`/`oneVoice`; aggregate `confirmVideo`/`voice` quotes can be empty or mixed and are not safe unit prices. An explicitly unknown selected-scene quote remains unknown.
- Recording Add/import remains a distinct action from narration Save. Narration Save calls settlement before close; recording import retains its own existing result/refusal feedback.
- Initial read-only `git status --short` and `git branch --show-current` ran during the entry inventory, before `_review-common.md`'s stronger no-Git wording was read. There were no further Git commands, mutations, commits or pushes.
- Validation uses fixtures, fake transports and disposable test state. No browser, real provider/model call, external network request, personal credential read, production-state access/restart or port 3001 listener was initiated for this work.
