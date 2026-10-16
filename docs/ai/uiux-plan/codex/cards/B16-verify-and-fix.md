# Card B16: verify the merged branch and fix what fails (web and server)

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it, with one change: this card MAY edit apps/web, because the owner asked Codex to do the testing and fixing. Do not redesign anything: the UI design is fixed (docs/ai/prototypes/last-ferry/DESIGN.md, P5-DESIGN.md); keep each fix the smallest change that makes the intended behaviour work.

## Do
1. Run, in this order, and record the exact results: `pnpm build`; `pnpm test` (all packages and the web unit tests); `pnpm -r typecheck`; `node scripts/browser-check.mjs` twice (it starts disposable fixture studios on free ports and drives Google Chrome headless through playwright-core; it never uses port 3001). If Chrome cannot start inside the sandbox, say so and run everything else.
2. For each failure, find the root cause (a real bug, a test that encodes behaviour a merged card intentionally changed, or a flaky wait), and fix it: real bugs in the code, outdated expectations in the test (say which card changed the behaviour), flaky waits by waiting on state (data-act hooks, `window` state) instead of time. Never delete a test to make it pass; never weaken a money or integrity check.
3. Re-run everything until it is green twice in a row.

## Report
Per failure: the test, root cause, fix, files. Final counts for each command. Anything you could not fix and why.
