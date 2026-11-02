# Common rules for the R and W cards (deep review of the plan and generation flow)

Read `docs/ai/uiux-plan/codex/RULES.md` and follow it (sandboxed: no git, no Chrome or browser checks, no `.env*`, no `.openslate/`, nothing on port 3001, no real provider).

- The findings, with full evidence, reproduction notes and the verifier's corrections, are in `docs/ai/uiux-plan/review-flow/FINDINGS.md`. Search for each finding id your card names. Treat the finding's Fix and the verifier's corrections as the starting point. Where this card decides differently, this card wins.
- The lead already added the shared contract fields to `packages/core/src/studio-api.ts`. Search it for `takenOff`, `ingestionIssue`, `fitSeconds`, `oneClip`, `oneVoice`, `keyframesRun`, `discards_running` and `medium?:`. Build exactly those shapes; if you must change one, keep it minimal and list it under Contract changes.
- Frozen, do not edit: everything under `skills/`, and the tool descriptors, schemas and catalogs in `packages/core/src/tools.ts`. Finding skills-legacy-1 shows that editing them in place blocks the Director on existing projects. Card R6 is the only one allowed to touch them. Validation message rendering in tools.ts is not frozen.
- Other cards run at the same time on other branches. Stay inside your card's files where you can, and list every edit outside them in your report. Do not reformat code you do not change.
- Money and integrity tests stay: no double charge, no blind resubmission of an unknown outcome, idempotent replay, stale-version refusal. Every fix gets a regression test that fails without the fix. Say in the report that you checked this.
- Checks: `pnpm build`; your touched and related test files with `node scripts/run-tests.mjs <files>`; then the full `pnpm test` once at the end, and `pnpm -r typecheck`. The machine is shared with the other cards, so a timing-sensitive test may flake under load. Rerun a failing file alone before you call it a real failure, and report both runs.
- Write the report to `docs/ai/uiux-plan/codex/reports/<card id>.md` with the RULES headings. Do not edit `docs/implementation/STATUS.md`.
