# P3a routes report

Date: 2026-10-29. Worktree: `codex-p3a-routes`; branch: `codex/p3a-routes`.

## Done

- **P3a item 1 — routes:** added all five routes against the unchanged lead-owned `CodePlanPort` and browser shapes. GET returns the view or one stored source version. POST choices/ceiling returns `{view}`; source calls `submit` with author `user` and the exact Idempotency-Key as `invocationId`, returning `{view, diff}`. Added strict Ajv schemas, positive safe-integer versions, canonical integer micros and a 256 KiB UTF-8 source limit. Existing error mapping returns mode/rejection conflicts as 409; rejected source exposes `error.details.diff`.
- **P3a item 1 — integrity:** all three POSTs require a bounded key and use route/project-scoped `store.command` receipts. Exact replay returns the saved receipt, including its original view; changed bodies fail. Source uses a second durable command row to bind its request digest before asynchronous submission and a per-registration promise map to share simultaneous identical requests. Retrying an interrupted submission sends the original invocation identity to the port; it does not manufacture another identity or hold a SQLite transaction across await. Authentication/CSRF and quarantine apply before work/replay; source receipt publication rechecks recovery after await.
- **P3a item 2 — creation:** HTTP creation accepts optional graph/code mode. `ProductionService.createProject(name, selection?, planMode?)` validates and stores only `code`, including in the initial project revision. Existing callers remain compatible; graph and omitted mode preserve the legacy serialized record. No browser create-project input type exists, so the shared contract needs no change.
- **P3a item 3 — media:** confirmed the existing authenticated `GET /api/projects/:projectId/artifacts/:artifactId/content` directly serves an owned `ArtifactRecord` without a graph selection, binding or project artifact-list entry. Documented this URL for `CodePlanStepView.artifact` and choice artifacts. Regression tests cover unselected image/video/audio, wrong project, missing session, escaped paths, escaping symlinks and changed bytes. No extra artifact route is necessary.
- **P3a items 4–5 — wiring/docs:** added optional `AppOptions.codePlans`, conditional registration and the startup runtime-to-port wiring with the explicitly permitted temporary cast. Updated API documentation and implementation status. P2a/P2b implementation, the two lead-owned contract files, all web files, schema, dependencies and existing execution invariants remain untouched.

## Files

Added:

- `apps/server/src/code-plan/routes.ts`
- `apps/server/test/code-plan-routes.test.mjs`
- `docs/ai/code-plan/reports/P3a-report.md`

Changed:

- `apps/server/src/app.ts` — registration/options, required-key list, rejection details and project-create schema/call.
- `apps/server/src/application/service.ts` — only `createProject`.
- `apps/server/src/index.ts` — only wiring/import.
- `docs/technical/APPLICATION-API.md`
- `docs/implementation/STATUS.md`

Deleted: none.

## Tests

Added **27 tests** in `apps/server/test/code-plan-routes.test.mjs`. No existing tests were rewritten, deleted, disabled or relaxed. Coverage includes each success shape; missing session/CSRF; missing, blank and oversized keys; graph/missing projects; absent/invalid versions; exact saved replay and changed-body conflicts; source rejection diff and stale base; strict schemas/UTF-8 size/money bounds; JSON/null answers and stale choices; concurrent requests and interrupted-result recovery; quarantine before writes/replay and after an asynchronous submission; port-absent registration; legacy project record identity; and the media ownership/containment checks above.

Observed verification on Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**:

| Command | Result |
| --- | --- |
| `pnpm setup:test-media` | Passed; matching installed tools, no download |
| `pnpm check:toolchain` | Passed; exact versions and required codecs |
| `pnpm build` | Passed; all five workspace builds |
| `node scripts/run-tests.mjs apps/server/test/code-plan-routes.test.mjs` | **27 passed, 0 failed/skipped/cancelled/todo** |
| `pnpm test` | **4,650 passed, 0 failed/cancelled/todo, 1 skipped; 4,651 total**; 1,640.660 s |
| `pnpm -r typecheck` | **5/5 workspace typechecks passed**, zero TypeScript errors |
| `git diff --check` | Passed |

The first focused run passed 26/27: one test incorrectly compared raw JSON key order on command replay. It was corrected to compare parsed receipts. The concurrency test was also made deterministic by waiting until the second request actually reaches the durable intent check before releasing the first; final focused results above include that correction. No production assertion was relaxed. Build output retains the existing Vite mixed-import and chunk-size warnings.

The optional skip is `opt-in native Codex probe never starts a model turn`. The full run took about 27 minutes, including a quiet final release-validation stage; it completed successfully without launching a duplicate suite or retrying failed tests. Verification logs are `/tmp/openslate-p3a-{build,focused,full-test,typecheck}.log`. The final scope check also confirmed that web source, both lead-owned contracts and the existing code-plan runtime files are unchanged.

Self-review covered correctness, transaction/await boundaries, namespaced keys, failure/retry cleanup, project-create callers, immutable contract shapes, artifact access and file ownership. The test assertion/scheduling corrections above were made during verification. No remaining actionable issue was found in the owned implementation; integration dependencies and existing-policy limitations are listed below.

## Contract changes

None. `packages/core/src/studio-api.ts` and `apps/server/src/code-plan/port.ts` are unchanged. No DDL/schema-version change or dependency change.

## Commits

No commits created, per the hard rules. Proposed lead-owned split:

1. `feat(server): expose keyed code-plan HTTP routes and project mode` — `apps/server/src/code-plan/routes.ts`, `apps/server/src/app.ts`, `apps/server/src/application/service.ts`, `apps/server/src/index.ts`, `apps/server/test/code-plan-routes.test.mjs`.
2. `docs(code-plan): document P3a routes media access and verification` — `docs/technical/APPLICATION-API.md`, `docs/implementation/STATUS.md`, `docs/ai/code-plan/reports/P3a-report.md`.

## Open issues

- **P2b integration dependency:** this checkout still has the P1 runtime, which does not implement `CodePlanPort` (`view`, `source`, `submit`, etc.). `index.ts` uses the card-authorized `as unknown as CodePlanPort` until P2b lands. The lead must merge P2b and resolve/remove that cast before enabling integrated code-plan HTTP use. Fake-port tests prove the adapters, not real runtime behavior or startup integration. The contracts themselves needed no correction.
- **Quarantine reads:** the existing recovery inspection allowlist does not include either new code-plan GET. They are refused during quarantine, while the existing artifact-content route remains inspectable. The allowlist lives outside this card's owned files; the lead should decide whether to add these two read-only patterns for recovery inspection. POSTs and completed-command replays are verified blocked.
- **Existing media limits:** the reused preview route has a 256 MiB cap, a fixed supported MIME list and returns a complete `200` body even for Range requests. No partial-content support is introduced. The card only requires a new media adapter if the existing one cannot serve unselected code-step artifacts; it can.
- **Retry boundary:** a source key remains bound to its first input even if dry run rejects it or the submission result is lost. Corrected source uses a new key. Interrupted identical input relies on the port's durable invocation deduplication; tests simulate this with a contract fake.
- No browser check, real provider/model call, external network access, protected-state read, port-3001 listener, commit or push was performed. The web and runtime acceptance remain with their assigned cards and the lead.
