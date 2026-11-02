# M1b · Restart-safe Codex image upgrade

Implemented in the assigned `codex/m1b-restart-safe` worktree, based on `f5812e94`. Source is uncommitted for the lead. Build, full tests, both typecheck commands and the offline code demo passed. Validation uses disposable offline fixtures; the owner's provider configuration and films were not accessed.

## Done

1. **Old configuration loads.** The host catalog accepts exactly the supported `0.153.4` → `0.162.1` Codex image runtime upgrade on a detached in-memory copy. Full current-profile validation still runs: unsupported versions, unknown fields, wrong model/canvas, cost, concurrency and retry settings fail with `PROVIDER_CATALOG_INVALID`. The configuration file is never written. After the whole file validates, its loader emits one `codex_image_profile_runtime_notice` naming all upgraded profile IDs and instructing the owner to change `runtimeVersion` to `"0.162.1"`. Revalidation by the runtime does not duplicate that notice. New selections contain the current runtime.
2. **Old films make new pictures without Settings.** Catalog availability recognizes the old locked profile only when replacing its runtime version gives the installed profile exactly. Revision, ID, configuration, price and all limits still participate in the comparison. Model normalization continues using the original locked profile and digest, so unchanged `ctx.image` and `ctx.keyframe` calls retain their journal keys and pictures. New code-film image attempts retain that original admission/input identity, while their native transport and receipts record `0.162.1`. The image model remains `gpt-6-astra`.
3. **Historical integrity stays exact.** No saved lock, step key, receipt, input or price is migrated. Receipt validation accepts the one forward runtime pair, preserves matching historical pairs, and refuses a downgrade from a current lock. Native worker pinning, lease/selection fences, durable markers, unknown-outcome handling and original-binary historical lookup remain in place. This upgrade is admitted for code films; graph preflight keeps its existing exact-current-runtime requirement.
4. **Doctor explains the action.** The readiness module used by `./start.sh --doctor` reports the old profile as a nonblocking warning, names its ID and instructs the owner to change `runtimeVersion` to `"0.162.1"`. Unsupported or missing Codex runtime versions are blocking. Exact validation of the remaining catalog fields remains the server's responsibility, as before. A subprocess test runs the real `start-local.mjs --doctor` entry from a disposable root without any environment file.

Example doctor lines for the synthetic old file:

```text
Optional setup: Codex image profile. old-film-images: using Codex 0.162.1 for new images. Saved film inputs and receipts stay unchanged.
  Change runtimeVersion to "0.162.1" in provider configuration profile old-film-images. The server validates all other fields during startup.
```

## Files

Changed:

- `apps/server/src/application/provider-catalog.ts`
- `apps/server/src/code-plan/models.ts` (identity/dispatch boundary comment)
- `apps/server/src/code-plan/provider-input.ts` (identity/dispatch boundary comment)
- `apps/server/src/execution/codex-image-execution.ts`
- `apps/server/src/execution/codex-image-receipts.ts`
- `apps/server/test/codex-image-runtime.test.mjs`
- `apps/server/test/codex-runtime-upgrade.test.mjs`
- `apps/server/test/provider-catalog.test.mjs`
- `packages/providers/src/codex-image.ts`
- `scripts/setup-readiness.mjs`
- `scripts/test/setup-readiness.test.mjs`

Added: this report. Deleted: none. The frozen `codex-image-0.153.4-film.json` fixture is unchanged. No M2, Director selection, web, schema, or shared contract files changed.

## Tests and self-review

**Eight test cases added:** startup normalization/notice/readiness, unsupported versions and invalid neighboring fields, old keyframe-card reuse across restart, three retired/missing-profile cases, unknown upgraded-turn reconciliation, and doctor output/file preservation. The existing frozen-film regression now requires one current-runtime attempt after an input edit instead of requiring refusal. Its unchanged-plan replay and complete original-record preservation assertions remain. The current-work test additionally refuses a coherent-looking downgraded mapping. No tests were deleted or disabled.

Self-review checked current admission versus historical reconstruction, all catalog callers, mapping/receipt validation, replay keys, keyframe choices, and restart recovery. It found a host-dependent existing missing-binary test: the supported installation on this machine allows M1 fallback from its deliberately nonexistent configured path. The first broad focused pass had **157 passed / 1 failed**, and rerunning that file reproduced **22 passed / 1 failed**. The test now mocks `homedir()` to a disposable fixture, synchronizes/restores Node's built-in ESM bindings, and preserves every refusal assertion. No production behavior or assertion was weakened.

Verification:

| Command | Result |
| --- | --- |
| `pnpm setup:test-media` | Passed; existing pinned media pair, no download/install. |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders. |
| `pnpm build` | Passed for all five workspace packages. Existing Vite chunk/dynamic-import warnings remain. |
| Initial focused startup/upgrade/doctor files | 46 passed, 0 failed. |
| Final broad focused gate, listed below | 158 passed, 0 failed, 0 skipped. |
| `pnpm test` | **5,143 passed, 0 failed, 2 skipped (5,145 total)**; completed normally in 988.5 seconds. |
| `pnpm -r typecheck` | All 5 workspace packages passed; 0 type errors. |
| `pnpm typecheck` | Package builds and all 5 workspace typechecks passed; 0 type errors. |
| `pnpm demo:code` | Passed: versions 1 → 2 → 3 → 4, 2 choices answered, 4 reused steps on edit, 0 duplicate submissions, 1 lookup recovery, final state `done`, fixture spend $0.40 / $4.00. No real film export or provider call. |
| `git diff --check` | Passed, including the final report check. |

The final focused command was:

```sh
node scripts/run-tests.mjs apps/server/test/codex-runtime-upgrade.test.mjs apps/server/test/provider-catalog.test.mjs scripts/test/setup-readiness.test.mjs apps/server/test/codex-image-execution.test.mjs apps/server/test/codex-image-outcomes.test.mjs apps/server/test/codex-image-runtime.test.mjs apps/server/test/code-plan-image-continuity.test.mjs apps/server/test/code-plan-keyframes.test.mjs packages/providers/test/codex-image-policy.test.mjs
```

The full-suite skips are the installed decoder's unsupported animated WebP and the opt-in native no-turn probe. The last skill-release tests took longer and completed normally; no full-suite test failed or needed a retry.

Local command output is in `/tmp/openslate-m1b-{build,targeted,focused,runtime-rerun,test,recursive-typecheck,typecheck,demo-code}.log`; logs are not part of the deliverable.

## Contract changes

`packages/core/src/studio-api.ts`: none. No schema or saved-record shape changed. `installedDefinition` includes the sole runtime-compatible old Codex lock; its returned profile and `definitionDigest` continue describing the saved lock, while the installed catalog and new native mappings describe the current runtime.

## Proposed commit

`fix(codex): keep legacy image films usable after runtime upgrade`

Include all eleven changed files listed above and `docs/ai/film-quality/reports/M1b-report.md`. This is one coherent compatibility/integrity change. No commit was made.

## Open issues and limits

No unfinished work or remaining self-review findings within this card. No browser, port-3001 listener, real provider call, protected configuration/state read, dependency install or native inference was performed. Native authenticated image generation and the owner's exact live file/films remain unverified; the startup and replay proofs use synthetic configurations, M1's frozen old-film records and fake transports with local media tools.
