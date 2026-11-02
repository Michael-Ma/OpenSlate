# F9 · The dev launcher asks the port it prints, and a clean shutdown is not an error

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. F5b (private Codex homes) and F8 (caption fonts) run at the same time; stay out of `packages/director/**`, `apps/server/src/media/captions.ts` and `scripts/test-toolchain.mjs`. You own `apps/server/src/studio-launcher.ts`, `apps/server/src/studio-cli.ts`, `apps/server/src/code-plan/index.ts` and their tests.

## Problems (from `docs/ai/film-quality/reports/V3-report.md`, problems 4 and 6)

1. `studio-cli --dev --no-open` prints a 5173 link (F1), but `requestStudioLaunch` still POSTs the launch request to `127.0.0.1:3001`, the owner's studio. In V3 that sent a side run's launch request toward the owner's port. It failed only because nothing listened there.
2. Stopping a side instance gracefully while a code-plan pass replays persists the run as `error` with "Code-plan execution is stopping", although every step and the export succeeded. `assertCode` throws `CODE_PLAN_STOPPED` inside `call`, the sandbox outcome becomes an error, and `pass()` writes it.

## Change

1. `requestStudioLaunch` sends its request to the same port the link names (3001 by default, 5173 with `--dev`), and nowhere else. Keep the loopback-only and allowed-port checks.
2. A pass that ends because the runtime is stopping must not write an error state, change choices or cancel steps: leave the run as it was, so the next start replays it. Keep real errors as they are.

## Tests

1. The `--dev` launcher's request goes to 5173 (a local test server records it), the default to 3001, and no other port is ever contacted.
2. Stopping the runtime during a pass leaves the previous run state untouched and the next start finishes it; a genuine plan error still persists.

## Finish

Run the launcher and code-plan suites, `pnpm typecheck`. Write `docs/ai/film-quality/reports/F9-report.md`.
