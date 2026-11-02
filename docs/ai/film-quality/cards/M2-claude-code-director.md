# M2 · Claude Code can be a code film's Director, on the owner's Claude plan

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Card M1 (Codex 0.162.1, default `gpt-6.1-sol`) runs at the same time in another worktree. Stay out of its files: `packages/director/src/runtime/{codex,setup,policy,transport}.ts`, `packages/director/src/media/**`, `packages/providers/**`, `apps/server/src/application/{codex-binary,provider-catalog}.ts`, `apps/server/src/execution/codex-image-*.ts`, `scripts/setup-readiness.mjs` and tests that pin the Codex version. In `apps/server/src/application/local-director.ts` M1 changes only the default model; leave that line alone. Put Claude setup in a new file. If you need the bridge environment, move `bridgeEnvironment` out of `codex.ts` into a new shared module and change only its call site in `codex.ts`. Otherwise you own `packages/director/**`, `apps/server/**`, `packages/core/**` where a shared type needs a field, and their tests. Do not edit `apps/web/src/**` except fixtures and tests; the lead builds the Settings UI against the contract in section 5. If you need another file, edit it and say so in your report.

## Goal

The owner approved: Claude Code as a second Director runtime, using the owner's own local `claude` login so usage counts against their Claude plan, with no API key. Models: Opus 5.5 (`claude-opus-5-5`, default) and Sonnet 5.5 (`claude-sonnet-5-5`). It may use only OpenSlate's Director tools and must not load the owner's personal Claude Code setup. Code-plan films only for now; storyboard films keep Codex or the demo. Pictures and video stay on Codex images and Viggle.

Local facts: `claude` 2.1.312 at `~/.local/bin/claude`. Its print mode supports `-p`, `--output-format stream-json`, `--input-format stream-json`, `--mcp-config`, `--strict-mcp-config`, `--model`, `--permission-mode`, `--allowedTools`, `--disallowedTools`, `--tools`, `--system-prompt`, `--append-system-prompt`, `--setting-sources`, `--settings`, `--session-id`. Check the exact semantics with `claude --help` and small local runs; do not guess.

## 1. `ClaudeCodeDirectorRuntime`

New `packages/director/src/runtime/claude-code.ts`, exported from `runtime/index.ts`, implementing `DirectorRuntime` (`runtime/types.ts`) with id `claude-code`. One process per turn, no resume (code-film turns already start fresh).

- **Instructions.** Give the model exactly what the Codex runtime gives it (`runtime/codex.ts` around line 195): the same base instructions, the same developer instructions followed by `input.context`, and the content of each `input.skills` file, as the system prompt (`--system-prompt`, replacing Claude Code's coding-agent prompt). The person's message is `input.text`. `input.images` go in as image blocks in a stream-json user message.
- **Tools.** The OpenSlate MCP bridge only: `--mcp-config` with one server named `openslate`, command `process.execPath`, args `[input.bridge.entrypoint]` and the same environment `CodexDirectorRuntime.bridgeEnvironment` builds, plus `--strict-mcp-config`. No built-in tools at all (no Bash, file, web, task or question tools). Allow `mcp__openslate__*` without prompting. Verify from the stream's `system`/`init` event that the tool list is exactly the bridge's tools, and fail the start with a clear diagnostic if it is not.
- **Nothing personal.** Run in the film's native workspace (`<data>/native/<project>/workspace`). Load no user, project or local settings, hooks, plugins, skills, slash commands, agents, output styles or `CLAUDE.md`, and no MCP server but the bridge. Prove it from the `init` event and a test that plants a `CLAUDE.md`, a settings file with a hook, and a user MCP server in a fake home, and shows none of them reach the run.
- **The plan, not an API key.** Spawn with a small allow-listed environment (`PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, terminal-free). Never pass `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX` or any OpenSlate secret; the bridge's own variables go only into the MCP server's `env`. If the `init` event reports an `apiKeySource` other than the subscription login, stop the run before any tool call with `CLAUDE_CODE_NOT_ON_PLAN`.
- **Events.** Map the stream to `DirectorRuntimeEvent`: `runtime_started` and `turn_started` from `init` (session id as the native ids), assistant text as `assistant_message` commentary, the `result` text as `final`, tool use and tool results as `activity` tool started/completed, thinking as `activity` reasoning with no text. No reasoning text, tool arguments or native diagnostics in events, as `types.ts` says.
- **Result.** `completed`, `failed`, `interrupted` or `unknown` with the same meaning and the same `dispatched` rule as the Codex runtime: `dispatched` is true once the prompt was written to the process. A limit hit, an auth failure or a usage-limit message from the plan is a `failed` result with a code and a plain message (`CLAUDE_CODE_AUTH`, `CLAUDE_CODE_USAGE_LIMIT`, `CLAUDE_CODE_FAILED`), never a retry. Use the Codex runtime's run timeout. Abort and timeout kill the whole process group. `close()` stops owned processes.
- **Unsupported, said plainly.** `pending_input` never occurs (no question tool). A storyboard film or a `resumeThreadId` is refused before dispatch.

## 2. Setup and readiness

`setupLocalClaudeCode({ binaryPath, model })` next to `runtime/setup.ts`: finds the program (`OPENSLATE_CLAUDE_BINARY`, then `~/.local/bin/claude`, then `PATH`), reads `claude --version`, checks the login without spending a turn if Claude Code offers a status command (check `claude auth --help`); otherwise say "not checked" rather than spending. Result: `{ status: "ready" | "blocked" | "missing" | "unchecked"; binaryPath; version; reason? }`. Never print or store tokens.

## 3. Selection

`LocalDirectorSelection` in `apps/server/src/application/local-director.ts` gains `mode: "claude"` with `binaryPath` and `model` (`claude-opus-5-5` | `claude-sonnet-5-5`, default Opus). Saving it for a storyboard film is refused (`DIRECTOR_RUNTIME_UNSUPPORTED`, "Claude Code directs code-plan films only"). The selection, change and lock rules stay as they are for Codex: a change applies to the next turn. A film's turns record `runtimeId: "claude-code"`. Tool invocations, holds, receipts, the 0.3.0 tool contract and `CODE_PLAN_GUIDANCE_DIGEST` are unchanged; if the skill lock or capability lock checks the runtime id, accept `claude-code` for code films without changing what Codex films record. Code-film input preparation (uploads, attachments, `codeDirectorInput`) is shared, not copied.

## 4. Nothing else changes

Codex stays the default Director (M1 makes it `gpt-6.1-sol`). Codex images, Viggle, Lyria and every step key, price and receipt are untouched. A film on Claude Code that switches back to Codex works on its next turn.

## 5. Contract for the Settings UI

The director setup the browser reads (`DirectorSetup` in `apps/web/src/next/model/settings-director.ts` mirrors the server) gains:

```ts
selection: { mode: "fake" } | { mode: "native"; binaryPath?: string; model?: string; codexHome?: string } | { mode: "claude"; binaryPath?: string; model?: string };
claude: {
  status: "ready" | "blocked" | "missing" | "unchecked";
  binaryPath: string | null;
  version: string | null;
  /** Plain words for blocked or missing, e.g. "Sign in to Claude Code first". */
  reason: string | null;
  models: { id: "claude-opus-5-5" | "claude-sonnet-5-5"; label: string }[];
  /** False for storyboard films. */
  available: boolean;
};
```

The existing save and change routes accept the `claude` selection. Put the server shape in the route's response type and document it in your report; the lead updates the web types.

## Tests

Use a fake `claude` program (a small Node script in the test fixtures) that records its argv and environment and replays stream-json lines, as the Codex runtime tests use fixtures.

1. Flags: stream-json in and out, the model, strict MCP with exactly the `openslate` server and its environment, no built-in tools, the custom system prompt with base, developer, context and skill text.
2. Environment: no `ANTHROPIC_*` or OpenSlate secret reaches the process; the bridge variables reach only the MCP server entry.
3. Isolation: a planted `CLAUDE.md`, settings hook and user MCP server do not reach the run; an `init` with extra tools fails the start.
4. `apiKeySource` other than the plan stops the run with `CLAUDE_CODE_NOT_ON_PLAN` before any tool call.
5. Event mapping and results: a normal turn, a tool call, an error result, a usage-limit message, abort and timeout (process group killed), `dispatched` before and after writing.
6. Selection: code film saves `claude`; storyboard film is refused; switching back to Codex works; turns record `claude-code`.
7. A code film turn through the supervisor with the fake program ends with the Director's final text in the thread, and a turn where the fake calls a bridge tool records a normal `tool_invocation`. If driving the real bridge from the fake is impractical, say how you covered it.
8. Setup: found, missing, wrong version, not signed in.

## Finish

Run `pnpm test`, `pnpm typecheck` and `pnpm demo:code`. Do not run the real `claude` against a model; the lead does that live. You may run `claude --help`, `claude --version` and `claude auth --help`. Write `docs/ai/film-quality/reports/M2-report.md`: what changed, the exact flags and why, how isolation and plan billing are proven, the setup contract as built, and what you could not cover.
