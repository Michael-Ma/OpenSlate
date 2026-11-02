# Q2b report — align last-frame conditioning crops

Worktree: `codex/q2b-crop`. Source is uncommitted. Q2b's owned executor, receipt, authority, projection and browser-contract changes are implemented. A companion backup reconstruction change is outside the card's ownership list and remains pending authorization; see the open issue below.

## Implemented

- **Q2b.1 / Q2.5:** both frame inputs now use the same existing deterministic `center-crop-v1` recipe and requested ratio, calculated independently from each owned PNG's dimensions. The first frame's crop is never reused for the last frame. Exact-ratio frames retain their original bytes and omit crop facts. Ordered reference uploads retain their original bytes. The existing recipe's 9:16 / 16:9 policy is unchanged; this card does not expand the shared crop helper to other ratios.
- **Q2b.2:** execution mappings retain optional `lastFrameCrop` beside `firstFrameCrop`. Receipt validation checks plain data properties, recipe, bounds, deterministic geometry, uploaded dimensions and changed upload identity for either crop. Source authority checks each crop against its own pinned artifact. A changed upload without its crop facts is refused. Reference, text and first-frame-only modes reject `lastFrameCrop`. Saved first-and-last receipts with no last crop remain valid only when their last upload still matches the original owned source.
- **Q2b.3:** step detail projects only `sourceWidth`, `sourceHeight`, `width` and `height` for each recorded crop. The browser contract adds the optional matching last-frame member. No plan-input shape, step identity, existing receipt identity or price changes.
- **Q2b.4:** offline regressions cover both orientations, same-source and different-source sizes, exact-ratio and mixed pairs, actual multipart upload bytes, deterministic re-preparation, completed replay and accepted-task recovery across restart without another POST. They also cover tampered/missing crop facts, valid geometry claiming another source size, accessors, mode refusals, uncropped reference uploads and a simulated pre-Q2b receipt retaining its old uncropped last frame and backup validation.

No web source, status document, guidance, provider adapter, schema or DDL changes. All provider/native responses and credentials used by tests are synthetic; local media tools process disposable fixture data. No browser, real provider/native-model call, external network request, protected-state read or port-3001 listener was used.

## Contract changes

`packages/core/src/studio-api.ts`, `CodePlanStepDetail.call` adds:

```ts
lastFrameCrop?: { sourceWidth: number; sourceHeight: number; width: number; height: number };
```

This is optional and has the same public dimensions-only shape as `firstFrameCrop`.

## Tests and verification

- `pnpm check:toolchain`: passed; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders.
- `pnpm setup:test-media`: passed using the matching installed tools; no download/build needed.
- `pnpm build`: all five workspace builds passed.
- New tests: **14** in `apps/server/test/code-plan-last-frame-crop.test.mjs`.
- Existing tests extended: the **eight** adapter allow-list cases in `code-plan-assets-prompts.test.mjs` now also verify that last-crop projection excludes injected synthetic credentials, paths and URLs.
- Tests rewritten/deleted/disabled: none.
- Initial two-file gate: **30 passed / 1 failed / 0 skipped**. The failure was a new test fixture attempting to persist an `undefined` nested field; canonical JSON correctly refused it. The fixture now removes that property to model a saved receipt with missing facts. No production change was required for that failure.
- Final broader focused gate: **110 passed / 0 failed / 0 skipped**, using:

```sh
node scripts/run-tests.mjs apps/server/test/code-plan-last-frame-crop.test.mjs apps/server/test/code-plan-assets-prompts.test.mjs apps/server/test/viggle-h3-frame-crop.test.mjs apps/server/test/viggle-h3-execution.test.mjs apps/server/test/code-plan-reference-video.test.mjs apps/server/test/viggle-backup.test.mjs
```

- Final uninterrupted `pnpm test`: **4,991 passed / 0 failed / 2 skipped / 0 cancelled / 0 todo (4,993 total)**; exit 0, test-runner duration 956.351 seconds. The skips are `HTTP picture: animated WebP` (the installed decoder cannot decode animation; the test records the explicit unsupported-format response) and the opt-in native Codex probe. No timing-sensitive test failed, so no isolated timing retry was needed.
- Final post-full `pnpm -r typecheck`: **all five workspace typechecks passed / 0 failed**, exit 0.
- Final `git diff --check`, branch and changed-file ownership checks: passed; the branch is `codex/q2b-crop` and every retained change is in the card's file list or its named report.

Detailed local logs: `/tmp/openslate-q2b-build.log`, `/tmp/openslate-q2b-focused.log`, `/tmp/openslate-q2b-full-test.log` and `/tmp/openslate-q2b-typecheck.log`.

The separate one-off offline backup diagnostic passed **1/1** by reproducing the expected unresolved `VIGGLE_H3_IMAGE_INVALID` rejection described below. It is not a positive backup acceptance test for cropped last frames and is not a retained test file.

## Self-review and open issue

Self-review checked the full production diff and new test file: per-source geometry, exact-byte preservation, original artifact pins, optional-field compatibility, accessor refusal, mode separation, replay/price identity, safe public projection and the backup reconstruction caller. It found no additional issue in the owned implementation and one companion-file blocker:

`apps/server/src/persistence/viggle-backup.ts` reconstructs the first upload with `centerCropPng`, but always reconstructs the last upload from original source bytes. It therefore rejects a new mapping with a cropped last frame when reconstructing multipart identity. A disposable offline diagnostic confirmed `VIGGLE_H3_IMAGE_INVALID`. Ordinary receipt/source validation and runtime restart/replay pass; installation backup validation of these new cropped-last mappings remains blocked.

This file is not in Q2b's exclusive ownership list. An asynchronous question requested the narrow ownership extension; no dependent edit has been made. The required fix is to crop the last upload only when `mapping.lastFrameCrop` exists, compare its deterministic recipe to that field, and otherwise preserve the original last bytes for historical receipts. Add positive cropped-last backup reconstruction coverage and tampered-byte refusal with that fix. The lead must resolve this before merging the new execution behavior.

A reviewable, unapplied source proposal is at `/tmp/openslate-q2b-backup-proposal.patch`. It has not been built or validated as production code and is not included in the changed-file inventory.

## Files

Changed:

- `apps/server/src/execution/viggle-h3-execution.ts`
- `apps/server/src/execution/viggle-h3-receipts.ts`
- `apps/server/src/execution/viggle-h3-authority.ts`
- `apps/server/src/code-plan/step-detail.ts`
- `packages/core/src/studio-api.ts` — `CodePlanStepDetail.call` only
- `apps/server/test/code-plan-assets-prompts.test.mjs`

Added:

- `apps/server/test/code-plan-last-frame-crop.test.mjs`
- `docs/ai/film-quality/reports/Q2b-report.md`

Deleted: none.

## Proposed commits for the lead

No commits were made.

1. `fix(viggle): align first and last conditioning frame crops` — the five changed production files, `code-plan-last-frame-crop.test.mjs`, and `code-plan-assets-prompts.test.mjs`. Include the narrow backup reconstruction fix and its tests once ownership is authorized; the lead should not merge with the known backup regression unresolved.
2. `docs(film-quality): record Q2b crop validation` — this report.
