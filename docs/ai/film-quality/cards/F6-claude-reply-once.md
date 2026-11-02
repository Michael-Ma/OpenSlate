# F6 · Claude Code's reply appears once

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. F5 runs at the same time on the Codex runtime and image files; stay out of them. You own `packages/director/src/runtime/claude-code*.ts` and their tests.

## Problem

In the V2 live run every Claude Code turn showed its long reply twice in the thread. The stored `director_output` rows hold the same text as `commentary` and as `final`: the runtime emits each assistant text block as commentary, then the `result` text as final, and in print mode the last assistant text and the result are the same words.

## Change

Match the Codex runtime's meaning: `commentary` is text said on the way (before more tool use), `final` is the answer. Hold each assistant text block until you know whether more tool use follows; emit it as commentary only if it does. Emit the `result` text once as `final`. A text equal to the final answer is never also commentary. Keep the event order and the no-reasoning-text rule.

## Tests

With the fake program: a turn with text, tool use, text, then result emits one commentary (the first text) and one final; a turn with only a final answer emits only final; a turn whose last assistant text differs from the result emits the result as final and the last text as nothing (it was not followed by a tool). The stored outputs of a supervisor-level turn hold one copy.

## Finish

Run the director package tests and the server Claude Code tests, `pnpm typecheck`. Write `docs/ai/film-quality/reports/F6-report.md`.
