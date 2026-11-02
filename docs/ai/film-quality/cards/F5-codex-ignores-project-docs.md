# F5 · Codex runs the same wherever the data directory lives

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. F6 runs at the same time on `packages/director/src/runtime/claude-code*.ts`; stay out of those. You own `packages/director/src/runtime/{codex,setup,policy}.ts`, `packages/director/src/media/codex-image.ts`, the Codex image execution files under `apps/server/src/execution/`, `scripts/probe-codex-compat.mjs` and their tests.

## Problem

The owner now keeps every test data directory inside the repository, under the git-ignored `/Users/michael/SideProject/OpenSlate/data/test-runs/<run>/`. In the V2 live run (`docs/ai/film-quality/reports/V2-report.md`, problem 1) the first Codex image in such a directory ended `submission_unknown` with `native_instructions_unexpected`. The repository has a tracked `AGENTS.md` at its root. Codex looks for project instructions (`AGENTS.md` and its fallbacks) from the working directory up to the git root, so a native workspace under `data/test-runs/` inherits the repository's instructions, and OpenSlate's instruction check rightly refuses. A Codex Director in such a directory would fail the same way (`RUNTIME_INSTRUCTIONS_UNEXPECTED`). Data directories under `~` worked only because no `AGENTS.md` sits above them.

## Change

Make the Director runtime and the Codex image worker load no project instructions, whatever directories sit above the data directory: no `AGENTS.md`, no fallback file names, no project `.codex/` configuration or skills found by walking up. Use the supported Codex 0.162.1 configuration for this (for example `project_doc_max_bytes = 0` and an empty `project_doc_fallback_filenames`, or whatever the real schema provides; check it with `codex app-server generate-json-schema` and the real binary, as M1 did). Keep the existing instruction check as the guard: it must still refuse if anything is inherited. Do not move data directories or weaken the check.

## Tests

1. With the real 0.162.1 binary and the offline probe (`scripts/probe-codex-compat.mjs`, loopback refusal server, disposable homes), a native workspace inside a temporary git repository whose root has an `AGENTS.md` and a `.codex/` folder starts a Director thread with no inherited instructions; the same for the image worker's preflight. Show the before and after.
2. The instruction check still refuses when instructions are injected some other way.
3. Existing Director runtime and Codex image suites stay green.

## Finish

Run `pnpm test`, `pnpm typecheck`. Write `docs/ai/film-quality/reports/F5-report.md`.
