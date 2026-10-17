# Card B25: say why Codex could not start, and give a cold start enough time

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it (sandboxed: no git, no Chrome or browser checks). This card may edit `apps/server`, `packages/*` (not frozen skill or catalog packages) and `apps/web` logic and catalogs (the lead owns visual design; keep markup and CSS changes minimal). Do not edit `docs/implementation/STATUS.md`; report in `docs/ai/uiux-plan/codex/reports/B25-native-diagnostics.md`.

In LIVE-4 (`docs/ai/live-test-20261016d/REPORT.md`) two native failures ran while the lead's full browser suite loaded the machine heavily:
- the first-film Director setup returned `409 DIRECTOR_SETUP_REQUIRED` ("Codex setup checks did not pass…") after 15.46 s, and a later Save in Settings with the same pinned binary succeeded;
- all four Codex image attempts failed after about 16 s each with `not_dispatched / LOCAL_NATIVE_UNAVAILABLE`. `apps/server/src/execution/codex-image-execution.ts` (~54) catches the preparation error and discards it, so the cause cannot be told apart (timeout, spawn, auth, protocol, quota).

`packages/director/src/runtime/policy.ts` sets `requestTimeoutMs: 15_000`; the lead suspects a cold native start under load exceeded it. Both failures took about 15 to 16 seconds.

1. **Keep the cause.** Native preparation and setup failures keep a safe diagnostic category (for example `native_timeout`, `native_spawn_failed`, `native_auth_required`, `native_protocol`, `native_rate_limited`, `native_unknown`), with the limit that was hit where relevant. Persist it on the attempt or setup result, log it server-side (redacted, no paths to auth or tokens), and show it to the person in plain words (en and zh, errors only in `errors.ts`). For example: "Codex images did not start within 15 s. The computer may be busy; nothing was charged. Try again." Never put raw native messages in public projections.
2. **Give a cold start enough time.** Find the requests that a cold native start makes (spawning the app server, initialize, the model or account checks) and give that first start a deliberate, longer limit (for example 60 s, configured through a host setting with bounds), keeping the 15 s limit for ordinary steady-state requests. Retry nothing automatically that could cost money; a keyframe that failed before dispatch may be pressed again by the person.
3. **Find out, if you can.** Use the retained data `$HOME/openslate-live-test-20261016d` (read only; never `.env*`, `secrets/`, `~/.codex` auth or tokens) to confirm or refute the timeout hypothesis from timestamps (setup start and end, attempt created and failed). Report what you can prove.
4. Tests: a slow fake native start (beyond 15 s, within the new limit) succeeds; a start past the new limit fails with `native_timeout` and a plain message; each category maps to its message; no raw message leaks into the public projection.

Checks: `pnpm build`, touched tests, `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`, the full `pnpm test`, `pnpm -r typecheck`. Report with the RULES headings.
