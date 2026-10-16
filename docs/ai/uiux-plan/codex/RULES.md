# Rules for Codex tasks on `feature/last-ferry-ui`

You are the backend and infrastructure engineer. Claude is the lead: it owns the plan, the shared contract, the web app and every merge. Read these before you start:

- `docs/ai/UIUX-IMPLEMENTATION-PLAN.md` (the plan, in Chinese; decisions D1 to D18 are final, take the recommendation column)
- The gap items your card names, in `docs/ai/uiux-plan/gap-*.md`. Each item has Current (with file:line evidence), Gap, Change, Risk and Tests. Treat Change as the spec and Tests as the minimum test list. Line numbers refer to commit 2c4b6e3 and may have moved.
- `packages/core/src/studio-api.ts`: the browser-facing contract. Build exactly these shapes. If you need to change it, keep the change minimal and list it under "Contract changes" in your report.
- `AGENTS.md` and `docs/implementation/STATUS.md`.

## Hard rules

1. Work only inside this worktree. Do not run git commit, git stash, git checkout or git reset; the lead reviews your working tree and commits it.
2. Do not edit `apps/web/**` unless your card says so. The lead owns the UI.
3. Never run `scripts/browser-check.mjs`, `pnpm check:browser` or anything that launches Google Chrome or another browser: inside your sandbox Chrome cannot register with macOS and crashes, and the owner sees a crash dialog each time. The lead runs browser checks outside the sandbox and sends you the failures.
4. Never read `.env*`, `./secrets/**` or anything under `.openslate/`. Never call a real provider or the network beyond loopback. Never start anything on port 3001.
5. Schema: the store keeps JSON entities by kind (`store.put` / `store.get` / `store.list`). Prefer a new entity kind over DDL. If you truly need DDL, add a new numbered migration per `docs/implementation/DATABASE-MIGRATIONS.md`; never edit a shipped migration.
6. Old tests: the owner said the old tests matter less than the new design. When a test encodes behaviour your card replaces, rewrite it or delete it, and say which in your report. Keep tests that protect money and integrity (no double charge, no blind resubmission of an unknown outcome, idempotent replay, stale-version refusal). Every new behaviour gets a test, including the failure cases in the card.
7. Match the surrounding code: strict TypeScript, the existing error style (`invariant(cond, "CODE", "message")`, `DomainError`), the existing route registration and test helpers. Prefer pure functions for anything that computes state.
8. Run checks before you report: `pnpm build`, then the test files you touched with `node scripts/run-tests.mjs <files...>`, then the full `pnpm test`, then `pnpm -r typecheck`. Report the exact pass/fail counts. If something fails that you did not cause, say so with the failing test names.

## Your final message

Plain text with these headings:

- **Done**: what you implemented, per gap item id.
- **Files**: changed, added, deleted.
- **Tests**: added, rewritten, deleted (with the reason), and the final counts of `pnpm test` and typecheck.
- **Contract changes**: changes to `packages/core/src/studio-api.ts`, or "none".
- **Commits**: a proposed split into conventional commits (`type(scope): description`), each with its file list.
- **Open issues**: anything you could not finish, risks, decisions you made that the lead should check.
