# M2b · Claude Code reads its system prompt from a file

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Card M1b runs at the same time on the Codex image and provider catalog files; stay out of them. You own `packages/director/src/runtime/claude-code*.ts` and their tests.

## Problem

M2 (merged) passes the whole system prompt (base and developer instructions, `input.context`, every skill file) as the `--system-prompt` argument. A film's context can be large, and argv plus environment is bounded by the operating system, so a big film would fail to start. The installed `claude` 2.1.312 documents `--system-prompt-file` (see `claude --help`: "via: --system-prompt[-file]").

## Change

Write the exact same system prompt to a file in the run's private per-run directory (the one that already holds the bridge ready file, mode 0600, removed after the run) and pass `--system-prompt-file <path>` instead of `--system-prompt`. Content and order stay byte-identical to M2. Confirm the flag and its exact name with `claude --help` before using it; if it does not exist, say so and stop.

## Tests

1. The launch uses `--system-prompt-file` with a path inside the private run directory, never `--system-prompt`; the file's bytes equal what M2 sent.
2. A 2 MB context starts (the fake program sees the file) where the argument form would exceed the bound.
3. The file is removed after completion, failure, abort and timeout.

## Finish

Run the director package tests, `pnpm typecheck`, and the server tests that cover Claude Code. Write `docs/ai/film-quality/reports/M2b-report.md`.
