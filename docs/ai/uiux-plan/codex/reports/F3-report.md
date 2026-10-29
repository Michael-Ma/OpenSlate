# F3 — remake saved clips while keeping approved keyframes

## Done

- F3.1: added `POST /api/projects/:projectId/scenes/:sceneId/remake-clips` beside scene confirm. It accepts `RemakeClipsInput`, requires an idempotency key and exact current review/version/request evidence, and selects 1–4 distinct saved shots from one scene. It uses the existing durable scene confirmation and video generation path (`kind: "video", regenerate: true, targetShotIds`), with no narration steps. The existing human `/generate` route also supports that exact video-remake selection.
- F3.1: the selected video binding gets a fresh one-use grant/candidate while its old clip remains selected through queueing, running and unknown outcomes. Success publishes the replacement; terminal failure restores the old binding. History remains immutable. Keyframe artifacts, saved video recipe/profile/settings/duration and existing voice are reused. F1 crop behavior stays in the existing adapter, receiving the same approved frame and recipe. Unselected bindings/candidates and unresolved sibling replacement jobs are preserved. Per-shot quotes exclude keyframes and speech; per-shot availability uses the command's prerequisites.
- F3.1 integrity: request replay returns its original receipt, publication recovery resolves the original command, and existing reservation/submission/reconciliation machinery remains authoritative. Running or unknown jobs, held edits, unopened/stale frames, changed quotes and stale requests are refused. Missing clips return `CLIP_NOT_SAVED` with scene-confirm recovery; foreign/duplicate IDs return `VALIDATION_ERROR`.
- F3.2–3: tool contract 7.1.0 adds `remake_clip {shotIds}`. `record_notes` validates saved clips, ready frames, scope and one-scene membership without starting work. Remake presses settle matching notes through `settleNotesElsewhere`; a subset press leaves wider choices open. Under 7.1.0, a scene without video targets refuses `confirm_video` with `SCENE_VIDEO_SAVED` and named-remake recovery. Older contracts retain their prior behavior.
- F3.4: made 7.1.0 current without changing earlier catalog digests or handler IDs. The fixture Director offers a human remake choice for named saved shots. Updated runtime guidance and inherited 7.0 capabilities/recovery gates for 7.1.0. Generated guidance 8.1.0 using `pnpm skills:draft`, draft edits, and `pnpm skills:release --minor --contract 7.1.0`. All 22 packages receive the new compatibility/version. Earlier release rows and directories remain unchanged. New native turns lock the latest release; all three 8.0.x releases still verify and upgrade once on a fresh eligible turn while bound epochs retain their historical lock.
- F3.5–6: added shared browser types only and updated technical guidance and implementation status. No web source or database migration changes.

## Files

Changed:

- `apps/server/src/scene-confirmations.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/src/scene-row.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/generation-quotes.ts`
- `apps/server/src/application/director-notes.ts`
- `apps/server/src/application/tool-invocations.ts`
- `apps/server/src/application/director-input.ts`
- `apps/server/src/application/director-capabilities.ts`
- `apps/server/src/application/film-planning-guidance.ts`
- `apps/server/src/application/fake-director.ts`
- `packages/core/src/tools.ts`
- `packages/core/src/studio-api.ts`
- `apps/server/test/chat-confirm-notes.test.mjs`
- `apps/server/test/fake-director-confirm.test.mjs`
- `apps/server/test/director-skills-v8.test.mjs`
- `apps/server/test/director-skills-v8-0-1.test.mjs`
- `apps/server/test/director-tools-upgrade.test.mjs`
- `skills/shipped-releases.json`
- `docs/technical/SKILLS-TOOLS.md`
- `docs/implementation/STATUS.md`

Added:

- `apps/server/test/scene-clip-remake.test.mjs`
- `apps/server/test/scene-clip-remake-integrity.test.mjs`
- `apps/server/test/director-skills-v8-1.test.mjs`
- `packages/core/test/clip-remake-contract.test.mjs`
- `skills/v8.1.0/**` (107 files: release manifest and 22 complete packages)
- `docs/ai/uiux-plan/codex/reports/F3-report.md`

Deleted: none.

## Tests

28 tests added: 11 remake behavior/concurrency/refusal/quote tests, four crash/Stop/stale/price integrity tests, seven contract/note/fixture tests and six release/lock tests. Four existing guidance test cases were adapted to read the latest release and one current-default status test now reads `CURRENT_TOOL_CONTRACT`; their historical pins remain explicit. Note and fixture helpers were extended for release locks and contract selection. No tests were deleted, disabled or had integrity assertions removed.

Pinned setup/preflight passed without a download: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. Final `pnpm build` passed for all five packages/apps. Existing Vite mixed static/dynamic import and large-chunk warnings remain.

The required focused gate used `node scripts/run-tests.mjs` with these eight touched files and passed **60/60**, zero failures/skips/cancelled/todo:

```text
apps/server/test/scene-clip-remake.test.mjs
apps/server/test/scene-clip-remake-integrity.test.mjs
apps/server/test/chat-confirm-notes.test.mjs
apps/server/test/fake-director-confirm.test.mjs
apps/server/test/director-skills-v8.test.mjs
apps/server/test/director-skills-v8-0-1.test.mjs
apps/server/test/director-skills-v8-1.test.mjs
packages/core/test/clip-remake-contract.test.mjs
```

`pnpm skills:check` verified all four shipped releases. The new release's worst-case injection is 7,645/10,000 words. Existing server regression tests also passed 132/132 before the final additional concurrency cases; the final dedicated remake file passed 11/11. Independent review ran that file plus its own unrelated-publication reproduction: **12/12 passed**, no skips/failures.

The additional touched `director-tools-upgrade.test.mjs` file passed **20/20**, no failures/skips. Its old 7.0.0 current-default expectation was discovered by the full suite and updated for the new current contract, while historical upgrade/replay assertions remain unchanged.

**Final `pnpm test`: 4,566 passed, zero failures/cancelled/todo, one optional native Codex probe skipped (4,567 total).** The full run includes the release checker and release-automation failure/recovery tests. A prior completed run had 4,565 passes, the one obsolete current-version assertion failure named above and one skip; the clean rerun passed after that expectation was corrected. An earlier partial run was intentionally interrupted to include review corrections and is not claimed as a completed gate.

**`pnpm -r typecheck` fails in the lead-owned web package with three TS2366 diagnostics listed below.** Core and providers passed before the recursive command stopped. A separate `pnpm --filter @openslate/director --filter @openslate/server -r typecheck` passed both remaining packages. Thus all four non-web package/app typechecks pass; the web typecheck remains for the lead, as the card explicitly requires. No web source was edited.

`git diff --check` passed. Direct inventory/registry checks confirmed no changes under `apps/web`, `skills/v8`, `skills/v8.0.1` or `skills/v8.0.2`, and all historical shipped release rows remain unchanged.

## Contract changes

`packages/core/src/studio-api.ts` adds:

- `NoteChoice` variant `{ kind: "remake_clip"; shotIds: string[] }`.
- Optional `ShotOverview.quotes.remakeClip: PriceQuote` and `ShotOverview.remakeClip: { available: boolean; code?: string }`, preserving existing fixture compatibility.
- `RemakeClipsInput extends ConfirmSceneInput` with `targetShotIds` and optional `expectedRequestId`.

The lead can price a subset press by summing its selected per-shot remake quotes, echo the scene's current `confirmationDigest`, and send only those shots' exact `reviewedFrames`. `expectedEstimateMicros` checks that selected total. The server rechecks availability on press.

Tool contract 7.0.0 remains pinned to `e99bf5bd4b04cff07732a2997fb25fe0e052b8efbc893514a307ec163871dc92`. New 7.1.0 digest: `b9b0e85b36087a948dfa987ea5095e16e919fb9d3de6d3be91605c189e531f5f`. Generated guidance 8.1.0 digest: `f1811aab89074a932a24f25ac6cf3334d48e2d14ac206d4cf262e8ba1868ad13`.

## Commits

No commits made, as required by the card rules. Proposed atomic commit:

`feat(studio): remake saved clips without replacing keyframes`

File list: all changed and added files above. Keep the server path, new tool contract, generated guidance/registry and their tests together so the committed state has a valid latest release and matching browser types.

## Open issues

The lead owns wiring the New clip action and `remake_clip` note press in `apps/web/**`. Browser checks and live-provider acceptance remain outside this card's allowed verification. No browser, real Codex/model/provider call, external network request, credential/configuration read, protected production-state access, production restart or port-3001 listener occurred.

The new choice makes three web switches non-exhaustive. Exact `pnpm -r typecheck` errors:

```text
apps/web/src/next/model/notes.ts(59,113): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
apps/web/src/next/model/notes.ts(117,112): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
apps/web/src/next/model/notes.ts(130,79): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
```

These are `choiceLabel`, `settledMsg` and `action`. The lead must add `remake_clip` handling and the UI press/price flow, then run web typecheck and browser checks. F3 item 5 explicitly requires reporting these errors instead of editing `apps/web/**`.

Self-review corrected stale-error ordering and availability for ambiguous active takes, and narrowed retained-take restoration to selected video bindings so a sibling's unresolved replacement candidate is preserved. Independent review reproduced a stale captured-plan check after an unrelated publication; video replacement detachment/retention now uses the synchronous publication plan after rebase. A compiled-plan regression also aligns per-shot availability with the command's scene-wide take-selection refusal. Final self-review and independent read-only review found no remaining actionable issue in the owned implementation.
