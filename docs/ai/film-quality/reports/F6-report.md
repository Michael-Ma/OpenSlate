# F6 · Claude Code's reply appears once

## Done

- Buffer assistant text until a subsequent allowlisted `tool_use` establishes that it is commentary. This works within one message and across messages, including multiple text blocks and tool rounds.
- On a successful `result`, discard all remaining assistant text, even when it differs from the result. Emit the result once as `final`.
- Keep commentary before its following tool activity. Buffer intervening activity metadata with the text so surviving events retain their order; reasoning and redacted reasoning never contribute text.
- Keep credential redaction before buffering, native result/error handling, single dispatch, and unknown-completion behavior. Pending answer text is not published when the process exits without a result.
- Make the default fake CLI reproduce print mode's repeated terminal assistant/result text. The supervisor test now requires exactly one persisted final reply alongside the earlier commentary.

## Files

Changed:

- `packages/director/src/runtime/claude-code.ts`
- `packages/director/test/claude-code-fixture.mjs`
- `packages/director/test/claude-code.test.mjs`
- `apps/server/test/claude-code-director.test.mjs`

Added: `docs/ai/film-quality/reports/F6-report.md`. Deleted: none.

## Tests

Added eight runtime regression cases: text/tool/text/result, answer-only, terminal text differing from result, multiple text blocks/tool rounds, event order with and without a following tool, missing result, and credential redaction.

Strengthened the existing supervisor persistence assertion; no tests deleted. The existing launch/event-order test now also uses the realistic duplicated-answer fixture without changing its expected events.

Before the runtime change, the updated fake CLI/tests reproduced the bug: the two Claude test files finished with **73 passed, 10 failed, zero skipped** (exit 1). Failures were the duplicate persisted reply, the existing event-order assertion and all eight new regressions. These were assertion differences, not timing failures.

| Check | Result |
| --- | --- |
| `pnpm setup:test-media` | Exit 0; existing FFmpeg/ffprobe 8.1.1 matched |
| `pnpm check:toolchain` | Exit 0; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required codecs/font matched |
| `pnpm build` after the runtime change | Exit 0 |
| `node scripts/run-tests.mjs packages/director/test/*.test.mjs apps/server/test/claude-code-director.test.mjs` | Exit 0; **418 passed, zero failed, one optional skip** (419 tests) |
| `pnpm test` | Exit 0; **5,256 passed, zero failed, one optional skip** (5,257 tests; 1,210.1 seconds) |
| `pnpm typecheck` (builds packages, then runs `pnpm -r typecheck`) | Exit 0; **five packages passed, zero failed** |
| `git diff --check` | Exit 0 |

Both post-change test runs skipped only `opt-in native Codex probe never starts a model turn`. No post-change failures or timing-sensitive retries were needed. The web build's existing chunk-size and mixed static/dynamic import warnings did not fail the build.

## Contract changes

None. `packages/core/src/studio-api.ts`, tool contracts, persistence schemas and runtime event types are unchanged.

## Self-review

Reviewed the diff for same-message and cross-message ordering, multiple blocks/tool rounds, terminal draft handling, per-run buffer lifetime, credential redaction, reasoning privacy and failed/unknown outcomes. No unresolved correctness issues found. Intervening activity is buffered with assistant text so it cannot overtake commentary; only metadata is retained. Scope is confined to the Claude runtime, its fixtures/tests, its supervisor integration test and this report.

## Commits

No commits made. Proposed single commit:

`fix(director): emit Claude Code final replies once`

Files: all five files listed above.

## Open issues

No live model/provider or browser validation was performed, as required by the card rules. Existing stored duplicate outputs are not rewritten; the change applies to subsequent turns.
