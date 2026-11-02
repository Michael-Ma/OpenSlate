# M2c report: Claude Code real init compatibility

## Done

M2c removes `--safe-mode` from the shared Claude launch arguments used for print and subscription-auth checks. Every other isolation flag stays in place. Init now permits a plugin inventory only when it is an array and every entry has exactly `path: "builtin"` and a string `source` ending in `@builtin`. Empty plugin arrays remain valid. Non-builtin paths, missing/malformed sources, mixed personal/builtin inventories and plugin errors/warnings still fail with `CLAUDE_CODE_CONFIG_UNEXPECTED`.

The tools check still requires exactly the selected film's locked tool catalog, including multiplicity. The MCP list still requires exactly one connected `openslate` entry; the existing guard against user/project/local sources remains. Skills, agents and slash commands must still be empty. Init rejection emits no native ids or activity and never releases the bridge's ready gate. Subscription checks, epoch/application authorization and unknown-outcome handling are unchanged.

M2b's private system-prompt file, exact instruction bytes, permissions, 2 MiB context support and cleanup stay intact. No provider, step key, receipt, price, browser shape or schema changes.

## Current flags

This list supersedes M2's historical safe-mode/argument-prompt launch description; M2 and M2b reports are left unchanged.

```text
-p --verbose
--input-format stream-json --output-format stream-json
--restricted --setting-sources ""
--settings '{"disableAllHooks":true,"enabledPlugins":{},"env":{"CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS":"1"}}'
--disable-slash-commands --no-chrome --no-session-persistence
--model claude-opus-5-5 --effort high
--permission-mode dontAsk --permission-prompts none
--tools "" --allowedTools 'mcp__openslate__*'
--strict-mcp-config --mcp-config '<one openslate stdio server with scoped bridge environment and ready-file gate>'
--system-prompt-file '<private per-run directory>/system-prompt.txt'
```

Sonnet selection uses `--model claude-sonnet-5-5`. The print process receives only the existing environment allow list; bridge credentials remain scoped to the explicit MCP server configuration. Setup/per-turn `auth status --json` use the same restricted/empty-source/hooks-off isolation arguments without safe mode. `--bare` remains absent so the local subscription login stays available.

## Isolation evidence and boundaries

The M2c card supplies the lead's real Claude Code **2.1.312** probe evidence: safe mode advertised no tools or MCP servers even with an explicit MCP config; removing it advertised the two configured tools and one connected dynamic `openslate` server. Both advertised these plugins:

| name | path | source |
| --- | --- | --- |
| `cc-plugin-agents-md` | `builtin` | `cc-plugin-agents-md@builtin` |
| `cc-plugin-telemetry` | `builtin` | `cc-plugin-telemetry@builtin` |
| `cc-plugin-plugin-authoring` | `builtin` | `cc-plugin-plugin-authoring@builtin` |

The card also records a real one-turn probe without safe mode: the model reported no personal notify instruction from the owner's home `CLAUDE.md`; the signed-in account's email remained additional context. These are **lead-supplied observations from the card**, not live experiments performed for this report. The optional raw init files were not needed or read.

Safe mode is removed because it disables OpenSlate's bridge. Isolation now rests on restricted mode, empty setting sources, explicit hooks-off settings and plugin settings, disabled slash commands and built-in agents, strict MCP configuration, no built-in tools, and verified init inventories before the bridge's tools/call gate opens. The native runtime is trusted for the builtin plugin classification; this accepts metadata, not arbitrary plugin paths or application authority.

The fake CLI now uses the three reported builtin entries by default, so existing runtime and server-supervisor tests run against that shape. The two-tool probe shape is replayed with contract 0.1.0, and 0.2.0/0.3.0 replay uses each contract's exact catalog. The planted personal-files fixture now follows the retained restricted/empty-setting-source flags and includes both workspace and home `CLAUDE.md` candidates. This is a flag-contract test, not independent proof of the actual CLI's instruction loading.

Real stdio MCP processes and loopback HTTP tests deliberately race a tool call before init validation. Accepted builtin init allows one request; rejected billing, non-builtin plugin paths/sources, and missing/disconnected bridge entries allow zero HTTP requests. No real Claude model or provider was called.

## Files

Changed:

- `packages/director/src/runtime/claude-code-process.ts`
- `packages/director/src/runtime/claude-code.ts`
- `packages/director/test/claude-code-fixture.mjs`
- `packages/director/test/claude-code.test.mjs`

Added: `docs/ai/film-quality/reports/M2c-report.md`.

Deleted: none. All changes are within M2c's runtime/test ownership plus its requested report. No server source/test, web source, shared contract, other card report or status file was edited.

## Tests

Added 30 regressions: four accepted plugin/catalog cases; one duplicate-tool refusal; five malformed/missing/disconnected/extra MCP cases; sixteen plugin path/source/shape/diagnostic refusals; and four additional pre-init bridge-race refusals. Existing launch/setup tests now assert absence of safe mode and preservation of the explicit isolation settings. All init-refusal cases additionally check absent native ids and prompt-file cleanup. The existing two bridge-race cases were adapted to the reported builtin inventory. No tests were deleted, skipped or weakened.

Pinned toolchain: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**, required encoders present. `pnpm setup:test-media` reused matching installed binaries without downloads; `pnpm check:toolchain` passed.

| Command | Result |
| --- | --- |
| `pnpm build` | All five workspace builds passed; existing Vite chunk/dynamic-import warnings only. |
| `node scripts/run-tests.mjs packages/director/test/claude-code.test.mjs` | **66 passed, 0 failed, 0 skipped** (66 total). |
| `node scripts/run-tests.mjs packages/director/test/*.test.mjs apps/server/test/claude-code-director.test.mjs` | **410 passed, 0 failed, 1 existing optional native-probe skip** (411 total). |
| `pnpm test` | **5,222 passed, 0 failed, 2 skipped** (5,224 total); all five builds passed. Duration: **741,203.786875 ms**. |
| `pnpm typecheck` | All three library builds and all **five** workspace typechecks passed, zero errors. |
| `pnpm -r typecheck` | All **five** workspace typechecks passed, zero errors. |
| `pnpm demo:code` | Passed with offline placeholder media: versions **1 → 2 → 3 → 4**, **2** answered choices, **4** reused steps, **0 duplicate submissions**, **1 lookup recovery**, fixture spend **$0.40 / $4.00**, final state **done**. |
| `git diff --check` plus report whitespace check | Passed. Final working-tree inventory contains only the four owned runtime/test files and this report. |

The full run's existing skips are `HTTP picture: animated WebP` (the installed decoder cannot decode animation; the explicit unsupported-format refusal remains) and `opt-in native Codex probe never starts a model turn`. No test failed in any run, so no timing-sensitive file rerun was needed. The full run had a quiet final interval and then completed normally.

## Self-review

Reviewed the source/test diff, both callers of the shared isolation arguments, plugin metadata validation, unchanged exact tool/MCP checks, bridge-gate ordering, malformed inventories, native-id publication, prompt cleanup and the server fixture's use of the new default inventory. The fixture's obsolete safe-mode isolation prerequisite was removed, and its personal-file candidates now include the already-planted home `CLAUDE.md`. Malformed-list regressions use JSON-preserved `null` rather than overrides that JSON would omit. No remaining actionable issue was found in the owned code.

## Contract changes

None. `packages/core/src/studio-api.ts`, tool contract versions and server/browser setup shapes are unchanged.

## Commits

No commit made. Proposed single conventional commit for the lead:

`fix(director): accept isolated Claude Code real init`

Files: the four changed runtime/test files and this report listed above.

## Open issues and limits

No implementation blocker or failing check remains. The lead can review this working-tree diff and perform the real subscription-backed Director acceptance. Actual subscription/model entitlement, billing and end-to-end native acceptance are not revalidated by fake-process tests. No browser, real provider/native-model call, external network request, protected-state read, port-3001 listener or commit is part of M2c.
