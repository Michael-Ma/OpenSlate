# M2c · Claude Code's real start-up passes the isolation checks

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. M2b (system prompt file) is merged; build on it. You own `packages/director/src/runtime/claude-code*.ts` and their tests.

## Problem

The first live turn with Claude Code as Director failed in one second with `CLAUDE_CODE_TOOLS_UNEXPECTED`. The lead probed the real `claude` 2.1.312 with M2's flags and a two-tool stdio MCP server named `openslate`:

| | `tools` | `mcp_servers` | `plugins` |
|---|---|---|---|
| with `--safe-mode` | `[]` | `[]` | three, all `path: "builtin"` |
| without `--safe-mode` | `["mcp__openslate__read_film", "mcp__openslate__submit_plan"]` | `[{ name: "openslate", status: "connected", source: "dynamic" }]` | the same three |

The three plugins are `cc-plugin-agents-md`, `cc-plugin-telemetry` and `cc-plugin-plugin-authoring`, each `{ name, path: "builtin", source: "<name>@builtin" }`. In both runs `skills`, `agents` and `slash_commands` are empty, `apiKeySource` is `"none"`, `output_style` is `"default"`. `--safe-mode` drops every MCP server, including ours from `--mcp-config`, so the bridge never connects.

A real one-turn probe without `--safe-mode` (with `--restricted --setting-sources ""`, the hooks-off settings, `--strict-mcp-config`, `--tools ""`) confirmed the owner's `~/.claude/CLAUDE.md` is not loaded: the model reported no notify instruction, which that file contains. The only extra context Claude Code adds is the signed-in account's email.

The raw init events are in `/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/claude-probe/init-*.json` if you can read them; otherwise use the table above.

## Change

1. Remove `--safe-mode` from the launch. Keep every other isolation flag M2 uses.
2. The init check accepts plugins only when every entry has `path: "builtin"` and a `source` ending in `@builtin`; anything else is still `CLAUDE_CODE_CONFIG_UNEXPECTED`. Skills, agents and slash commands must still be empty.
3. The tools check stays exact, and the MCP server list must be exactly one `openslate` entry with status `connected`.
4. Update the report's flag list and the isolation evidence: safe mode is gone because it disabled the bridge; isolation now rests on restricted mode, empty setting sources, hooks off, strict MCP, no built-in tools, and the init checks.

## Tests

1. The launch has no `--safe-mode`.
2. The fake program replays the real init shape from the table and the turn proceeds; a plugin with any non-builtin path fails; a missing or not-`connected` `openslate` server fails.
3. Everything M2 and M2b test still passes.

## Finish

Run the director package tests, the server Claude Code tests and `pnpm typecheck`. Write `docs/ai/film-quality/reports/M2c-report.md`.
