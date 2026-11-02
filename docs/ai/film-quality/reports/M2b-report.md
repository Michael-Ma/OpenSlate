# M2b report: Claude Code system prompt file

## Done

M2b writes the unchanged M2 system prompt to `system-prompt.txt` in the existing private `.claude-director-*` per-run directory alongside the bridge's `ready` file. The file is created exclusively (`wx`) with mode `0600`; the directory retains `mkdtemp`'s `0700` permissions. Claude receives `--system-prompt-file <path>` rather than `--system-prompt <contents>`.

The base instructions, developer instructions plus application context, ordered skill contents and `\n\n` separators are unchanged. Existing `finally` cleanup removes the prompt and its enclosing directory on completion, failure, abort, timeout and runtime shutdown. A cancellation check after the asynchronous file write prevents a cancelled or timed-out preparation from spawning Claude.

## Installed flag check

Confirmed locally without starting a model:

- `~/.local/bin/claude --version`: `2.1.312 (Claude Code)`, matching the runtime pin.
- `~/.local/bin/claude --help`: documents `via: --system-prompt[-file]`, confirming `--system-prompt-file`.
- The unqualified `claude` on this shell's PATH resolves to `/opt/homebrew/bin/claude` (2.1.292). Its help also documents the flag. The runtime's existing default prefers `~/.local/bin/claude`; no binary discovery or version policy was changed.

## Files

Changed:

- `packages/director/src/runtime/claude-code.ts`
- `packages/director/test/claude-code-fixture.mjs`
- `packages/director/test/claude-code.test.mjs`

Added: `docs/ai/film-quality/reports/M2b-report.md`.

Deleted: none. No M1b-owned image/provider files, server source, web source, shared contracts or status document were edited.

## Tests

Added one regression: the fake CLI starts with an exactly 2 MiB application context, reads the prompt file, completes successfully and receives less than 16 KiB of argv. Before the production change, this regression failed before dispatch using M2's argument form; it passed after the change.

Updated the existing launch test to assert the file flag, absence of the argument flag, location beside the bridge gate, `0600`/`0700` permissions, exact UTF-8 bytes including Unicode, CRLF, trailing newlines and multiple ordered skills, and successful cleanup. Extended seven existing native-error cases and three abort/timeout/shutdown cases with file and directory cleanup assertions; the latter also check that the prompt exists while the CLI is running. No tests were deleted or disabled.

Pinned toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 with all required encoders. `pnpm setup:test-media` reused installed matching binaries without downloading anything; `pnpm check:toolchain` passed.

| Command | Result |
| --- | --- |
| `pnpm build` | Passed all five workspace builds. Existing Vite dynamic-import/chunk-size warnings only. |
| `node scripts/run-tests.mjs packages/director/test/claude-code.test.mjs` | 36 passed, 0 failed, 0 skipped. |
| `node scripts/run-tests.mjs packages/director/test/*.test.mjs apps/server/test/claude-code-director.test.mjs` | 380 passed, 0 failed, 1 optional native-probe skip (381 total). |
| `node scripts/run-tests.mjs apps/server/test/codex-image-runtime.test.mjs` (rerun after full-suite failure) | 22 passed, 1 failed, 0 skipped (23 total); same untouched Codex image test reproduced. |
| `pnpm test` | 5,183 passed, 1 failed, 2 skipped (5,186 total); the sole failure is detailed below. Duration: 1,075,531.295 ms. All five builds passed. |
| `pnpm typecheck` | Passed all five workspace typechecks, after all three library builds passed. |
| `pnpm -r typecheck` | Passed all five workspace typechecks. |
| `git diff --check` | Passed, including the final report. |

The full run reported `enabled native route fails closed for missing binary, tools, invalid paths or incomplete injection` in `apps/server/test/codex-image-runtime.test.mjs:22`. Rerunning that entire file reproduced `AssertionError: Missing expected exception` at line 32. A read-only diagnostic using the existing disposable fixture isolated the second case: `codexImageBinary: '/does-not-exist/codex'` falls back to the installed Codex binary and builds without an exception. The other six cases throw their expected configuration/tool errors. This Codex image configuration test does not exercise the changed Claude print launcher; its source and implementation are outside M2b ownership and were left unchanged. No timing-sensitive failure occurred; the unrelated failure was nevertheless rerun by file before classification.

Both full-run skips are existing conditions: the opt-in native Codex probe, and animated WebP decoding unsupported by the installed decoder. All 36 Claude runtime tests, including the 2 MiB case and cleanup checks, passed again in the full run.

## Self-review

Reviewed the entire diff for byte preservation, file permissions and containment, cleanup on terminal paths, cancellation across the new asynchronous write, fixture consumers and server integration. The post-write cancellation check covers the newly introduced await boundary. No remaining actionable finding in the owned change.

## Contract changes

None. `packages/core/src/studio-api.ts`, tool contracts and provider interfaces are unchanged.

## Commits

No commit was made. Proposed single commit for the lead:

`fix(director): load Claude system prompt from a private file`

Files: the three changed director source/test files and this report listed above.

## Open issues and limits

The reproduced Codex image configuration failure above needs the lead or that card's owner to resolve. M2b's focused director/server checks pass. Validation uses synthetic Claude processes and the real loopback MCP bridge; installed Claude CLI checks were limited to help/version. The unrelated Codex fixture diagnostic constructed/closed runtimes and performed only local binary version resolution, without dispatching native image work. No real model/provider call, external network request, browser, protected-state read or port-3001 listener was used.
