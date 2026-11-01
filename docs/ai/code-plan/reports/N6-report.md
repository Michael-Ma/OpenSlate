# N6 — Reference-image video and true Viggle prices

Implemented offline in `codex/n6-references` on October 31, 2026. Final verification results are recorded below. Source is left uncommitted for the lead, as required by the card rules.

## Done

- **N6.1–3 — Studio modes, identity and aspect.** `ctx.video` selects reference, first-frame, first-and-last-frame or text mode from its inputs. Each installed model advertises `videoModes`; unsupported modes raise `CODE_PLAN_INPUT` naming the available modes. Conflicting images, orphan last frames, invalid/missing text aspect, non-image references, vendor count limits and Viggle's five-second reference minimum are refused. All conditioning images resolve within the film. References normalize to ordered content identities; reversing them changes the key. Existing first-frame inputs/defaults and keys remain unchanged, including the `journaledDefault` path. The first reference supplies measured aspect; references upload uncropped and only the first frame uses the existing crop recipe.
- **N6.4 — Viggle execution and recovery.** The adapter emits repeated `reference_image` parts, supports text/frame/reference modes and records mode/enhancement in its description and metadata digest. Every new code-plan attempt explicitly sends `enhance=false`, outside Studio/profile options. New mappings pin every ordered image, including repeated content. Authority, Store reference validation, submission/dispatch/observation receipts, lineage and backup reconstruction support reference and text attempts. Historical receipts without the new fields retain their original digests and flat estimates. Graph admission, estimates and existing first-frame dispatch remain unchanged.
- **N6.5 — Seedance.** Seedance 2.x sends reference-image content or text-only content through the existing endpoint and execution bridge. Pricing uses the first reference's measured dimensions, or the explicit text ratio. Its count limit is nine. Seedance 1.0 remains first-frame-only, and realistic-human-face refusal behavior remains in place. Existing fal endpoints/modes and MiniMax conditioning remain unchanged.
- **N6.6 — Prices and liabilities.** One pure provider-package `vigglePriceMicros` implements every row/resolution/enhancement combination in the supplied table and rounds fractional duration upward. Preview, reservation, mapping validation and provider authority share it. Viggle advertises input-based pricing and the credit table. At six seconds/768p/enhance off: reference **$0.30**, first-frame **$0.18**, first-and-last **$0.30**, text **$0.18**. Saved attempts keep their price; a new attempt of an old step uses the new table and retains earlier liability. Validated failed/cancelled tasks release liability and follow existing bounded safe-retry rules. Unknown submissions never gain free-failure status or automatic resubmission. Vendor-reported credits/prices do not override the table.
- **N6.7–8 — Projection and inspection.** Videos link through their references to a `<shot>-keyframe` choice only when the references identify one unambiguous shot. Consumed reference pictures count as current in Assets, including an owned picture whose generating call is no longer reached. Details fill `mode`, ordered `references`, `firstFrame` and `lastFrame`. New call settings expose allow-listed mode and boolean enhancement while preserving the existing redaction boundary.
- **N6.9 — Guidance.** The current Studio declaration and example default to references, explain exact start/end-frame requests, action/camera prompts and Viggle's 5–15-second reference limit, and describe input pricing. Example video prompts combine the subject description and motion. The package digest pin is updated to `cac7e7551609acc42895a792663f094ff1dd6275a5ac007ae0f71f8535f4bfc7`. `skills/code-plan-v1` is untouched.
- **N6.11 — Documentation.** Updated the execution-engine specification and implementation status, including historical compatibility, pricing, free terminal failures and inspection semantics.

## Files

Added:

- `apps/server/test/code-plan-reference-video.test.mjs`
- `docs/ai/code-plan/reports/N6-report.md`

Changed:

- `packages/providers/src/viggle-h3.ts`
- `packages/providers/src/seedance.ts`
- `packages/providers/test/viggle-h3.test.mjs`
- `packages/providers/test/video-models.test.mjs`
- `apps/server/src/code-plan/identity.ts`
- `apps/server/src/code-plan/models.ts`
- `apps/server/src/code-plan/provider-input.ts`
- `apps/server/src/code-plan/provider-authority.ts`
- `apps/server/src/code-plan/execution.ts`
- `apps/server/src/code-plan/projection.ts`
- `apps/server/src/code-plan/assets.ts`
- `apps/server/src/code-plan/step-detail.ts`
- `apps/server/src/execution/video-i2v-execution.ts`
- `apps/server/src/execution/viggle-h3-execution.ts`
- `apps/server/src/execution/viggle-h3-authority.ts`
- `apps/server/src/execution/viggle-h3-receipts.ts`
- `apps/server/src/persistence/viggle-backup.ts`
- `apps/server/src/persistence/store.ts` — narrow change: validate artifact references for every optional frame/reference pin instead of dereferencing a mandatory first frame.
- `apps/server/src/application/director-capabilities.ts` — current code-plan guidance digest only.
- `apps/server/test/code-plan-providers-fixture.mjs`
- `apps/server/test/code-plan-providers.test.mjs`
- `apps/server/test/code-plan-retry.test.mjs`
- `apps/server/test/code-plan-port.test.mjs`
- `apps/server/test/code-plan-shots-posters-limit.test.mjs`
- `apps/server/test/video-models.test.mjs`
- `apps/server/test/code-plan-assets-prompts.test.mjs`
- `apps/server/test/code-plan-e2e-fixture.mjs` — expected subject-plus-motion prompt only.
- `skills/code-plan/SKILL.md`
- `skills/code-plan/references/studio.d.ts`
- `skills/code-plan/references/example-plan.ts`
- `docs/technical/EXECUTION-ENGINE.md`
- `docs/implementation/STATUS.md`

Deleted: none. No web source, browser contract, port interface, DDL, schema version or archived guidance changes.

## Tests

**28 new tests**: 20 in the new N6 suite, three Viggle adapter/price/digest tests, one Seedance body test, three Seedance mode/restart integration tests and one Assets/detail/shot-link regression. Parameterized assertions cover every mode and refusal for fake, Viggle, MiniMax, Seedance 1.0, Seedance 2.0/Mini, Kling, Veo and Wan. The suites also cover image ordering/count/ownership, reference multipart fields and uncropped bytes, the entire supplied credit table and fractional rounding, exact reservation/charge equality, tampered mappings, retained unknown liability, historical no-repayment and historical-step repricing, backup reconstruction and recovery after a lost local reply.

Thirteen existing pricing/retry/poster tests were updated to replace obsolete flat Viggle estimates with table prices while retaining their money/integrity assertions. The old zero-estimate Viggle test now proves the input price is known independently of the configured flat estimate. The ceiling test now uses a $0.25 limit against a $0.30 clip rather than a fabricated $1.50 flat price. Two existing fake-video identity/view fixtures now supply the explicit aspect ratio required for text mode. The P2c fixture's expected prompt follows the example's complete subject-plus-camera prompt. No tests were deleted, disabled or skipped by this change.

Pinned tools: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. No setup download was needed.

| Check | Final result |
| --- | --- |
| `pnpm setup:test-media` | Passed; installed tools already matched the pinned profile. |
| `pnpm check:toolchain` | Passed; pinned runtimes and required media encoders available. |
| `pnpm build` | Passed all five workspace builds; existing Vite chunk/dynamic-import warnings remain. |
| Focused command below | **284 passed / 0 failed / 0 skipped**, 284 total; 49.23 seconds. |
| `pnpm test` | **4,863 passed / 0 failed / 1 optional native-probe skip**, 4,864 total; 704.33 seconds. No cancelled/todo tests. |
| `pnpm -r typecheck` | **5 passed / 0 failed** workspace typechecks. |
| `pnpm demo:code` | Passed: versions 1 → 2, two answered choices, eight reused steps after the edit, one lookup recovery, zero duplicate submissions, $0.44 / $1.00, final `done`. |
| `git diff --check` and ownership review | Passed; no web/contract/port/archived-guidance changes. |

Focused command, after build:

```sh
node scripts/run-tests.mjs \
  packages/providers/test/viggle-h3.test.mjs \
  packages/providers/test/video-models.test.mjs \
  apps/server/test/code-plan-reference-video.test.mjs \
  apps/server/test/code-plan-assets-prompts.test.mjs \
  apps/server/test/code-plan-providers.test.mjs \
  apps/server/test/code-plan-retry.test.mjs \
  apps/server/test/video-models.test.mjs \
  apps/server/test/code-plan-e2e.test.mjs \
  apps/server/test/code-plan-director.test.mjs \
  apps/server/test/code-plan-runtime.test.mjs \
  apps/server/test/code-plan-port.test.mjs \
  apps/server/test/code-plan-shots-posters-limit.test.mjs \
  apps/server/test/viggle-h3-execution.test.mjs \
  apps/server/test/viggle-h3-frame-crop.test.mjs \
  apps/server/test/viggle-backup.test.mjs
```

Intermediate checks exposed obsolete pricing assertions and new fixture assumptions (profile ids, asynchronous view publication, returned clip length and retry backoff); these were corrected. Intermediate full runs were interrupted to complete the example prompt/digest correction and to update four additional obsolete text-mode/poster fixtures discovered by the broad run. A redundant release/toolchain diagnostic was started while the aggregate footer was pending, then stopped after the full run completed successfully; it is not an additional completed gate. Only the completed final runs above establish the final gate.

## Self-review

Reviewed the complete source/test/guidance diff, including callers and cross-file effects. Narrowed the detail-settings projection to read only the newly recorded mapping `mode`, preserving immutable request/configuration as the source for its other scalar settings. Added a two-distinct-reference regression for first-reference aspect inference and refusal of swapped pins, enhancement changes and understated mapping prices. Confirmed saved first-frame input/key/price and receipt digests survive restart, while explicit new attempts use the table without erasing history. The Store change is required for text-mode mappings with no frame and reference mappings with multiple pins. No remaining material finding is known after the final checks.

## Contract changes

None. `packages/core/src/studio-api.ts` already declares the required detail fields, and the lead-owned web app and `CodePlanPort` are untouched.

## Commits

No commits were made. Proposed conventional split for the lead:

1. `feat(providers): support reference video and exact Viggle prices`
   - `packages/providers/src/{viggle-h3,seedance}.ts`
   - `packages/providers/test/{viggle-h3,video-models}.test.mjs`
2. `feat(code-plan): execute reference video with durable pricing and recovery`
   - All changed `apps/server/src/code-plan/*.ts` files listed above.
   - `apps/server/src/execution/{video-i2v-execution,viggle-h3-execution,viggle-h3-authority,viggle-h3-receipts}.ts`
   - `apps/server/src/persistence/{store,viggle-backup}.ts`
   - `apps/server/test/code-plan-reference-video.test.mjs`
   - `apps/server/test/{code-plan-providers-fixture,code-plan-providers.test,code-plan-retry.test,code-plan-port.test,code-plan-shots-posters-limit.test,video-models.test,code-plan-assets-prompts.test}.mjs`
3. `docs(code-plan): default new clips to reference images`
   - `skills/code-plan/SKILL.md`, `skills/code-plan/references/{studio.d.ts,example-plan.ts}`
   - `apps/server/src/application/director-capabilities.ts`
   - `apps/server/test/code-plan-e2e-fixture.mjs`
   - `docs/technical/EXECUTION-ENGINE.md`, `docs/implementation/STATUS.md`, this report.

## Open issues and limits

- Verification is offline: disposable state, synthetic transports/loopback servers and local media tools. No real provider/native-model calls, external network, browser launch, protected-state read or port-3001 listener was used. Live vendor quality, acceptance and actual billing are not established by this card; the vendor facts/table come from the supplied card.
- Historical totals deliberately retain the recorded pre-N6 flat estimates; this change does not reconcile earlier vendor bills.
- Existing real films still pin their installed video profile; this does not add Seedance models, fal endpoints or silently switch providers. A person requesting references on a first-frame-only model gets the supported-mode error.
- The shared video path still normalizes clips to silent video, as before. Browser verification remains with the lead under the worktree rules.
- No user action or credential is needed for the completed offline scope. The lead owns final review, browser validation and commits/merge.
