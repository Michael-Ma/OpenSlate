# Done

Card O1 is implemented in the server publication boundary. Each scene decision now carries the exact compiled node IDs selected by that decision. Pending-candidate and known-failure retry assessment use those IDs instead of the human request's potentially whole-film scope. Other scenes and unselected shots retain their existing specifications, candidates, outputs and outdated state. The existing grant checks, one-use consumption, dependency invalidation, deferred video review, unknown-submission guards and version fences are unchanged.

## Diagnosis from the supplied snapshot

The three-scene, ten-shot snapshot was queried with `sqlite3 -readonly`. Publication reproductions used independent task-owned database copies under `/private/tmp/openslate-o1-snapshot-diag`, a provider stub that throws on every dispatch/poll/lookup, and no engine execution. The original database was never opened by the application. No snapshot, prompts or media are included in the regression fixture.

All times below are UTC.

| Time | Persisted evidence | Meaning |
| --- | --- | --- |
| October 27, 02:01:46.231 | Creative publication, head 10, prepared `0f4e6418…` | Two shots changed. |
| 02:01:47.686 | Creative publication, head 11, prepared `c3c396de…` | Four more shots changed. |
| 18:28:53.789 | Creative publication, head 12, prepared `b7bcc3dc…` | The final four shots changed. |
| 19:30:44.230 / 19:30:44.785 | Event 219048 publishes head 13; receipt `d4257862ff0ebf7a911b7fae64e547237967473af3a0dd5b06f5785f3c39443d` records scene 2 started | Four candidates admitted; this happened **after** the creative changes. |
| 19:30:47.045 / 19:30:47.579 | Event 219056 publishes head 14; the same receipt records scene 3 started | Four candidates admitted. “Started” does not establish successful returned media. |
| 19:30:50.055–19:31:01.485 | Eight linked execution-evidence outcomes | Scene 2/3 image attempts ended `failed`, rejected with `certainty: not_accepted` and `retryAllowed: false`. Their current bindings have non-null candidates and empty outputs; all eight local image execution observations report `LOCAL_NATIVE_UNAVAILABLE`. |
| October 28, 01:44:16.869 | Event 236101, request `c75f507c-67f4-4d0b-a602-012992e40344` | The later whole-film request. No intervening `change.applied` follows head 14. |
| 01:44:37.670–01:44:39.099 | Receipt `7eeeffb9ae029ff44a4cfc3507d6a2af198ec46fe9e0217e872161cd93a4ea86` | All three scenes refused, `started: []`. |

The exact refused scene IDs and first missing-grant aliases are:

| Scene | ID | Refusal time | Alias requiring an unrelated grant |
| --- | --- | --- | --- |
| 1 | `de6f18f6-b4eb-4433-b75e-94ad5ad094b0` | 01:44:38.134 | `shot-7df7887b-f433-4512-8897-e0fbaaf4fb00/keyframe` (scene 2) |
| 2 | `61e9ea0d-a42a-4dee-8ebf-5fb0db3ff545` | 01:44:38.679 | `shot-ce744861-8b5a-4f91-809c-c2b4a59643c0/keyframe` (scene 3) |
| 3 | `7bf8ac48-b442-4e7b-b4e9-74cfe418aa1d` | 01:44:39.098 | `shot-7df7887b-f433-4512-8897-e0fbaaf4fb00/keyframe` (scene 2) |

### Exact impact lists

Failed publication transactions roll back, so their full prepared impacts are not persisted. The receipt retains the first error per scene. The final call's arguments were recovered by matching its persisted argument digest against finite valid argument candidates: `{ shotIds: <all ten shot IDs in film order>, regenerate: true }`. This is digest-based reconstruction, not a plaintext saved argument record. Pure composition/diff reconstruction and actual baseline `generateScene` calls on independent copies produced the same impacts and byte-identical refusal codes/messages. A diagnostic interception recorded the final assessment immediately before grant finalization.

Define the following complete node sets; each shot below names its `shot-<shot ID>/keyframe` alias. Set **AV** names the two corresponding `/video` aliases.

| Set | Shot IDs |
| --- | --- |
| A: scene 1 keyframes | `7c8b6dd3-d861-4741-8623-1de0c33018e7`, `5422c0b6-1712-475f-bbbc-aea71c3eff5e` |
| B: scene 2 keyframes | `7df7887b-f433-4512-8897-e0fbaaf4fb00`, `5f9f6530-c031-49ef-9979-063b3e346900`, `63741fd3-e685-459b-a37d-6b6978c50029`, `5ad2c72e-31f8-4d85-93bf-173929fc1572` |
| C: scene 3 keyframes | `ce744861-8b5a-4f91-809c-c2b4a59643c0`, `9ae0422c-afda-4db5-84e7-2e08757eef20`, `c218feb5-ea03-449f-aa66-a6c43e7e6ea1`, `917b4671-b38e-42d3-b36a-61e71c518b62` |

| Baseline Director scene decision | Replace: changed effective spec | Replace: selected regeneration's pending candidate | Replace: promoted known failure | Reuse | Deferred |
| --- | --- | --- | --- | --- | --- |
| Scene 1 | A + AV | None | B + C | None | AV |
| Scene 2 | None | B | C | A + AV | None |
| Scene 3 | None | C | B | A + AV | None |

These lists cover every node in each composed plan: 12 nodes total, zero `new` or `retire`. Raw composition/diff gives scene 1 four `replace` and eight `reuse`; scene 2/3 each have twelve `reuse`. Selected regeneration detaches its execution slots inside the transaction, so their reused nodes receive reason `Pending work requires fresh generation approval`. Every cross-scene replacement has reason `New scene generation after a known failed attempt`, rather than a changed specification.

The earlier B1 fix already preserves unselected source recipes during composition. The actual bug is the second retry-promotion loop in `applyCompiledSceneGeneration`: it used `allows(actor, shot)` as if it were the current scene's selected work. The Director's underlying human request has project scope, so unrelated terminal failures were promoted to fresh candidates. Selected-only grants correctly refused publication. The pending/null-candidate promotion in `assessCompiledChange` had the same overly broad target derivation and is fixed with the same exact set.

### Human-button comparison

Baseline calls **without** `directorActor` or an existing actor succeeded on all three independent snapshot copies. They created respectively 2, 4 and 4 image candidates, zero attempts and zero provider calls. Their newly created human requests have scene scope, so unrelated failures were already left alone:

| Human scene decision | Replace | Reuse | Deferred |
| --- | --- | --- | --- |
| Scene 1 | A + AV | B + C | AV |
| Scene 2 | B | A + AV + C | None |
| Scene 3 | C | A + AV + B | None |

The card's provisional human-parity failure and “earlier successful run before the script” leads are therefore disproved by the data. The Director reproduction restores the original request's historical active epoch **only in each disposable copy**, because the saved snapshot contains its later revoked epoch. It does not revive production authority.

After the fix, the exact recovered Director arguments and ordinary human button calls each publish successfully for all three independent scene copies, with the human impact sets above. Every successful run verifies unchanged sibling binding fields except the expected `planId` rebase, exactly 2/4/4 new image grants and candidates at the selected shot scopes, zero new attempts/video candidates/provider calls, and the original snapshot's unchanged SHA-256. The exact-argument baseline proof uses a task-local copy of the built service with only this card's two selection changes reverted and absolute local imports; it reproduces all three original refusals. No application execution ran against the source snapshot.

# Files

Changed:

- `apps/server/src/application/service.ts`: require a bounded, distinct, single-scene set of exact reviewed operation IDs; use it in both fresh-candidate promotion paths.
- `apps/server/src/scene-generation.ts`: resolve each selected operation to its exact compiled node before publication and pass that identity set.
- `apps/server/test/scene-confirmation-video-scopes.test.mjs`: migrate one direct internal-method call to supply its exact selected image node.
- `apps/server/test/scene-undercoverage.test.mjs`: migrate one direct internal-method call; retain its no-unreviewed-video assertions.

Added:

- `apps/server/test/scene-cross-scene-grants.test.mjs`: synthetic multi-scene regression fixture and both entry paths.
- This report.

Deleted: none. No web/fixture, overview, narration/transcription, compiler, browser-contract, schema, frozen tool catalog, skill or implementation-status edits.

# Tests

Toolchain: exact Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1** with required encoders. `pnpm setup:test-media` reused installed matching tools without a download; `pnpm check:toolchain` passed.

| Check | Observed result |
| --- | --- |
| `pnpm build` | All five package/app builds passed; Vite emitted its existing large-chunk advisory. |
| New regression file alone | **14 passed, 0 failed/skipped/cancelled/todo**. |
| Touched and related files, `node scripts/run-tests.mjs <17 files>` | **225 passed, 0 failed/skipped/cancelled/todo**. |
| `pnpm test` | **4,123 passed, 0 failed/cancelled/todo, 1 optional native-probe skip (4,124 total)**. One full-suite run after the fix. |
| `pnpm -r typecheck` | **5/5 package/app typechecks passed, 0 failures**. |
| Whitespace inspection | `git diff --check` and both added files passed; no whitespace issues. |

The 17 related files are `scene-cross-scene-grants`, `scene-generation`, `director-keyframes`, `scene-generation-proposals`, `scene-confirmation-video-scopes`, `scene-undercoverage`, `scene-keyframe-run-identity`, `scene-confirmations`, `scene-confirmation-guards`, `scene-review-concurrency`, `service`, `stop-release`, `takes-undo`, `scene-plan-context` and `scene-plan-speech` under `apps/server/test`, plus `scene-composition` and `scene-composition-narration-revision` under `packages/core/test` (all `.test.mjs`).

The synthetic fixture uses six shots in three scenes, existing returned frames, a genuine held Director script proposal and authenticated human acceptance changing every shot. It covers both current failed candidates and detached/null candidates, scene-by-scene generation, a selected shot with same-scene and cross-scene siblings, whole-film Director generation, exact replay, fresh paid-work scope and stale authority/version refusal. No owner snapshot data is copied into tests.

The original twelve tests ran against the unchanged baseline build: **6 passed / 6 failed**, zero skipped/cancelled/todo. All six Director behavior failures were `ORIGIN_NOT_AUTHORIZED` for unselected sibling keyframes, including the whole-film call refusing every scene. All four human parity cases and both stale guards passed. This checks the actual failure boundary without weakening existing money/integrity tests. The synthetic failed-candidate variant exhausts bounded fake technical failures; the real snapshot's failures were known non-acceptances, as distinguished above.

**14 tests added; zero existing behavioral expectations rewritten, deleted or disabled.** Two existing calls are mechanically migrated for the required internal argument without weakening their assertions. The grouped internal-boundary test refuses missing/malformed, duplicate, unknown, wrong-kind, cross-scene and foreign-scope selections, then verifies that even a valid selected operation still fails without its unused grant. The additional snapshot-argument case exercises explicit whole-film regeneration and preserves old failure receipts.

Self-review and independent review covered code correctness, every caller, exact node/shot authority, sibling state preservation, terminal and pending candidate promotion, video deferral, unknown-outcome/replay boundaries and test evidence. No outstanding must-fix finding remains. Changed-file whitespace inspection passes; no database/media/build/dependency output is included in the diff.

# Contract changes

None to `packages/core/src/studio-api.ts`; no public error code, route, request/response shape or schema change. The application-only `ProductionService.applyCompiledSceneGeneration` method gains a required `reviewedNodeIds` argument. Its only production caller and both direct test callers are migrated.

# Commits

No commits made; the card reserves review and commits for the lead. Proposed single component commit:

`fix(server): scope scene retry candidates to exact reviewed nodes`

Files: the two server sources, three test files and this report listed above.

# Open issues

- No incomplete card implementation or failing required check remains. Browser/sample-film replay and changes to the owner's live film remain with the lead.
- Decision: preserve `ORIGIN_NOT_AUTHORIZED` for genuinely missing grants. The observed misleading refusals disappear when unselected work is no longer promoted. Invalid internal selection uses existing `SCOPE_DENIED`; no public code is added or renamed.
- Decision: preserve other scenes' existing failed/pending/outdated state and prior authority; their own generation decision creates a fresh candidate. No implicit film-wide grant or image deferral is introduced.
- The saved `LOCAL_NATIVE_UNAVAILABLE` provider failures are a separate runtime problem. This change repairs scene publication; it does not establish that a fresh native image attempt will succeed. Runtime investigation or live acceptance remains with the lead outside this card's no-provider scope.
- Sample-film parity for the lead: after changes to every scene, retain multiple known failed keyframes with non-null candidates and empty outputs; a whole-film human request followed by one-scene Director generation must leave other failures unchanged. Also mirror detached/null candidates, a one-shot request with an unselected failed sibling in the same scene, scene-by-scene/whole-film progression, selected-only quotes/grants, replay and video-review deferral. `apps/web/src/next/fixtures` is intentionally unedited under this card.
- The owner's live film is untouched. No browser, live model/provider, external-network request, credential file, production restart or port-3001 listener is used; browser/sample-film replay belongs to the lead.
