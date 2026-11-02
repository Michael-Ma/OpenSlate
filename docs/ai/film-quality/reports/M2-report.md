# M2 — Claude Code Director on the owner's Claude plan

## Implemented scope

`ClaudeCodeDirectorRuntime` is exported from `@openslate/director`, with runtime id `claude-code`. It starts a fresh Claude print process for each turn, in the film's canonical `<data>/native/<project>/workspace`, with Opus 5.5 (`claude-opus-5-5`) as default and Sonnet 5.5 (`claude-sonnet-5-5`) as the other supported choice. Storyboard contracts and any resume id are refused before dispatch. The binary/version, local subscription login, init inventory, native model/cwd/permission mode, and stream framing are checked. The supported Claude Code version is **2.1.312**.

Code films select `{ mode: "claude", binaryPath?, model? }` through the existing authenticated save/change routes. Saving/changing a storyboard film to Claude returns `DIRECTOR_RUNTIME_UNSUPPORTED`, with `Claude Code directs code-plan films only`. Selection digests, command replay, setup locks, queued/running-turn refusal, fresh epochs and next-turn application use the existing Codex rules. Changing Claude → Codex → Claude works and retains each prior turn's runtime id. Code film locks use `claude-code` as their runtime binding; Codex locks continue to use `codex-app-server`. Tool contract **0.3.0**, archived **0.1.0/0.2.0**, the code-plan guidance digest, tool invocations, receipts and request-owned holds are unchanged.

Claude and Codex share `prepareLiveInput`, including `prepareCodePlanUploads`, `createDirectorInput`/`codeDirectorInput`, attachment thumbnails and owned media references. Claude has its own supervisor queue and is classified as `live` in the thread and turn views. Assistant messages become commentary, result text becomes final, tool use/results become started/completed tool activity, and thinking becomes activity without text. There is no `pending_input` path. Explicit native auth and usage-limit errors get fixed plain messages; native diagnostics, reasoning, tool arguments and tool result bodies are never runtime events. An absent result or broken stream after dispatch stays unknown and is not retried. Cancellation returns interrupted after process cleanup; timeout after dispatch stays unknown. Version/auth preparation failures remain undispatched. `dispatched` becomes true immediately before attempting the prompt write, conservatively including a pipe failure.

No media providers, prices, step keys or default Codex model line changed. No web source, database schema or shared browser-contract file changed. No commit was made.

## Exact print launch and local CLI evidence

The installed program was inspected with `claude --help`, `claude --version`, `claude auth --help`, and `claude auth status --help`. Version reported `2.1.312 (Claude Code)`; `auth status --json` is documented as a non-model command. No real auth-status operation or real model turn was run for this card. Narrow inspection of the installed program's embedded JavaScript confirmed the init shape, API-key-source representation, auth-status fields, and the noninteractive built-in-agent disable setting; no personal configuration/credential files were opened.

The print arguments, apart from the selected model and generated payloads, are:

```text
-p --verbose
--input-format stream-json --output-format stream-json
--safe-mode --restricted --setting-sources ""
--settings '{"disableAllHooks":true,"enabledPlugins":{},"env":{"CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS":"1"}}'
--disable-slash-commands --no-chrome --no-session-persistence
--model claude-opus-5-5 --effort high
--permission-mode dontAsk --permission-prompts none
--tools "" --allowedTools 'mcp__openslate__*'
--strict-mcp-config --mcp-config '<one-server JSON>'
--system-prompt '<base + developer + input.context + each input.skills file>'
```

- Print plus verbose produces newline-delimited stream-json. Input is one user message containing the person's text and base64 image blocks. Images reuse the existing canonical-path/hash/type/dimension/byte checks; only frozen verified bytes are sent.
- `--system-prompt` replaces Claude's coding-agent prompt with the exact Codex base/developer strings followed by canonical context and every selected skill entry's contents. A regression compares both instruction strings with Codex's source. Context already contains the application's verified referenced skill-file contents.
- The installed CLI documents safe mode as disabling personal `CLAUDE.md`, skills, installed plugins, hooks, MCP servers, commands, agents and output styles while keeping auth. Restricted mode additionally ignores user/project/local settings. Empty setting sources, explicit hook disabling, slash-command disabling and no Chrome/session persistence reduce the remaining surface. Safe mode alone retains built-in agent definitions in 2.1.312. Its inspected `G2e`/`Wwe` noninteractive loader explicitly returns an empty list for `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1`; that OpenSlate-owned setting is supplied through the inline settings `env` map, not inherited spawn environment. Init still verifies zero agents. The same pinned implementation identifies explicit CLI MCP configuration as `dynamic` (SDK configuration as `sdk`), so the init source guard accepts those two and rejects user/project/local sources. Admin-managed policy is still native policy; unexpected advertised inventories fail closed.
- `--tools ""` removes all built-in tools. Only `mcp__openslate__*` is allowed, with `dontAsk` and no permission prompts. There is no bypass-permissions, resume, fallback model, API key or API-key helper configuration.
- Deliberately **no `--bare`**: this CLI's help says bare mode disables OAuth/keychain auth and requires an API key/helper, which would defeat the owner-plan requirement.

The MCP JSON has exactly one server:

```ts
{ mcpServers: { openslate: {
  command: process.execPath,
  args: [input.bridge.entrypoint],
  env: {
    OPENSLATE_BRIDGE_ENDPOINT: input.bridge.endpoint,
    OPENSLATE_BRIDGE_PROJECT_ID: input.projectId,
    OPENSLATE_BRIDGE_CREDENTIAL: input.bridge.credential,
    OPENSLATE_BRIDGE_TOOL_CONTRACT: input.bridge.toolContractVersion,
    OPENSLATE_BRIDGE_READY_FILE: "<private per-run directory>/ready"
  }
} } }
```

The shared `bridgeEnvironment` is extracted unchanged from Codex. The only Codex edits are that extraction, import, and its two call sites; M1's version/config/media files and the default-model line are untouched. `OPENSLATE_BRIDGE_READY_FILE` is an additional launch gate, used only for Claude; it is not authorization and replaces no application checks.

## Isolation and plan-billing evidence

The parent process environment is built from an allow list: `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `TMPDIR`, with defaults for HOME/PATH if absent. It never merges process.env. `ANTHROPIC_*`, Claude OAuth override tokens, Bedrock/Vertex flags, terminal variables, NODE_OPTIONS and OpenSlate secrets are filtered out. The bridge credential and its other variables occur only in the MCP server entry. macOS may itself add `__CF_USER_TEXT_ENCODING`; the test distinguishes that OS insertion from the explicit launch environment.

Every turn checks `--version` and isolated `auth status --json` **before writing a prompt**. The latter must report logged-in `claude.ai`, `firstParty`, no API-key source, and a pro/max/team/enterprise subscription. Auth output is transient and never returned, logged or stored. Setup uses the same checks. This avoids treating init's `apiKeySource: "none"` as sufficient evidence of a subscription: that value only says no API key is in use. The subsequent init must still report `none`; other/missing sources fail with `CLAUDE_CODE_NOT_ON_PLAN`.

Init must advertise exactly the locked `mcp__openslate__…` tools, one connected `openslate` MCP server (explicit dynamic/SDK source if supplied), empty skills/plugins/agents/commands, no plugin errors/warnings, and the default/normal output style. It must match the selected model, pinned CLI version, canonical workspace and permission mode. It emits no native ids/activity on refusal.

The stdio MCP server permits initialization and tools/list before this check, but gates **tools/call** on a private 0700 per-run directory and 0600 ready file. OpenSlate creates that file only after validated init and delivered runtime/turn-start events. A fake CLI deliberately begins a real bridge call before emitting init: valid init releases it; invalid billing results in **zero HTTP calls / zero application tool invocations**. This closes the init-consumer race instead of assuming the child waits for the parent to inspect stdout. Cleanup removes the gate and terminates the entire owned process group, escalating to SIGKILL and verifying exit. A bounded EPERM reprobe covers macOS's transient exiting-group probe race without treating permission denial as exit.

Synthetic isolation tests plant workspace/home `CLAUDE.md`, a settings hook and a user MCP configuration in a disposable fake home. The fixture demonstrates the required launch flags exclude them and checks that no hook marker or personal text reaches the run. Separate init tests reject extra/missing tools, MCP servers, skills, plugins, agents, commands, output styles and billing sources. These are adapter/flag-contract and rejection proofs, **not a real native-model isolation or billing acceptance run**.

## Setup and Settings contract as built

`setupLocalClaudeCode({ binaryPath?, model? })` is next to Codex setup, in `runtime/claude-code-setup.ts`. Discovery order is explicit argument, `OPENSLATE_CLAUDE_BINARY`, `~/.local/bin/claude`, then executable `claude` entries on PATH. An explicit missing path is reported rather than silently selecting another binary. Unsupported versions are blocked. If `auth --help` offers no status command, it returns unchecked without spending a turn; missing binary, signed-out login, API-key/third-party login and malformed checks have fixed plain reasons. No token is returned or persisted.

```ts
type LocalClaudeCodeSetupResult = {
  status: "ready" | "blocked" | "missing" | "unchecked";
  binaryPath: string | null;
  version: string | null;
  reason?: string;
};
```

`GET /api/projects/:projectId/director/setup` explicitly types its Reply as `Awaited<ReturnType<LocalDirectorController["inspectSettings"]>>`. Its existing fields remain, with these additions/selection extension:

```ts
selection:
  | { mode: "fake" }
  | { mode: "native"; binaryPath?: string; model?: string; codexHome?: string }
  | { mode: "claude"; binaryPath?: string; model?: "claude-opus-5-5" | "claude-sonnet-5-5" };
claude: {
  status: "ready" | "blocked" | "missing" | "unchecked";
  binaryPath: string | null;
  version: string | null;
  reason: string | null;
  models: { id: "claude-opus-5-5" | "claude-sonnet-5-5"; label: string }[];
  available: boolean;
};
```

Model labels are `Opus 5.5` and `Sonnet 5.5`. `available` is true only for code films. Ordinary Settings reads never launch Claude or perform account discovery; before a check this section honestly says unchecked, version/path may be null, and the reason says sign-in has not been checked. Saving/changing to Claude performs setup; `GET …/director/models` refreshes the Claude check when Claude is the saved selection. Checks do not spend a model turn. Claude readiness is held as non-authoritative in-memory diagnostic data, never as cached credentials. Controller restart checks again before preparation; the runtime checks local auth every turn regardless of setup cache.

The existing POST setup/change schemas both accept `mode: "claude"`; Claude codexHome/unknown models are rejected. Omitted Claude model normalizes to Opus before selection hashing. Save/change responses retain their existing fields, including readiness/selection digests; readiness for a Claude selection is `LocalClaudeCodeSetupResult`. The browser lead must add the section/selection to its mirror and render the two model choices. `packages/core/src/studio-api.ts`: **no changes**.

## Self-review and verification

Self-review covered callers, code-film lock bindings, native dispatch reservations, unknown outcomes, authority/selection fencing, failure messages, shutdown and child cleanup, media-input reuse, and M1 ownership. It corrected stale subscription evidence (per-turn auth preflight), the tool-before-init race (bridge gate), symlink workspace identity, bounded non-model command cancellation, explicit stderr auth/limit classification, plain failure propagation to Director status, and the pinned CLI's safe-mode built-in agent inventory (disabled explicitly through session settings). No remaining must-fix issue was found in the reviewed owned code.

44 tests were added (35 runtime/setup tests and 9 controller/HTTP tests); no existing tests were rewritten, deleted or disabled. Integration tests use the **actual stdio MCP entrypoint, loopback HTTP route, supervisor, store, lock activation and tool invocation service**, not a substituted tool handler. No provider accepts a real media submission. Runtime tests cover images and instruction parity, init rejection, local auth before dispatch, error/usage messages, pipe/stream uncertainty, concurrency, stalled consumers, timeout/abort/close, noncooperative descendant cleanup, missing/wrong-version/signed-out setup and discovery fallback. Controller tests cover code/storyboard selection, locks/CAS/busy rules, final thread text/live classification, real bridge receipts, no pre-init effects, holds, no automatic retries and switching both directions.

Pinned toolchain setup/preflight passed without a download: Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. The final `pnpm build` passed **5/5** workspace builds; existing web bundle size/dynamic-import warnings remain. `git diff --check` passed.

| Command | Result |
| --- | --- |
| `node scripts/run-tests.mjs packages/director/test/claude-code.test.mjs apps/server/test/claude-code-director.test.mjs` | **44 passed / 0 failed / 0 skipped**, 42.941 seconds, after the final pinned-CLI settings/source corrections. |
| Earlier compatibility gate: those two files plus `apps/server/test/local-director.test.mjs`, `apps/server/test/code-plan-director.test.mjs`, `packages/director/test/runtime.test.mjs` | **155 passed / 0 failed / 0 skipped**, before the final local Claude inventory correction and one added source-scope test; the final full gate below covers all final files. |
| `pnpm test` | **5,153 passed / 0 failed / 2 skipped; 5,155 total**, zero cancelled/todo; **1,052.423 seconds**. |
| `pnpm typecheck` | **5/5** workspace typechecks passed, zero errors (including its package rebuild). |
| `pnpm -r typecheck` | **5/5** workspace typechecks passed, zero errors. |
| `pnpm demo:code` | Passed: versions **1 → 2 → 3 → 4**, **2** answered choices, **4** reused steps, **zero duplicate submissions**, **one lookup recovery**, fixture spend **$0.40 / $4.00**, final state **done**. |

The two full-suite skips are `HTTP picture: animated WebP` (the installed decoder cannot decode animation; its explicit unsupported-format refusal remains) and `opt-in native Codex probe never starts a model turn`. The full run had a quiet final interval and then completed normally. There were no full-suite test failures to diagnose or retry.

An earlier full attempt was interrupted after 1,161 passing reporter lines and no failures to rebuild after the pinned CLI inventory correction; it has no final summary and is not counted as a completed gate. Timing-sensitive new-test files were rerun before diagnosis: macOS cleanup probes were fixed conservatively; a stream-flood test now stalls its consumer explicitly rather than depending on chunk scheduling; a version-check cancellation test uses a relative call-count barrier because a timed-out fake startup may not have written its first record. The full 35-case runtime file passed the immediate retry after that startup-barrier timeout.

## Limits and lead handoff

- No real Claude model turn, real auth-status check, external network request, personal credential/configuration read, browser launch, port-3001 listener or commit was made. Native help/version and embedded CLI implementation inspection were the only native evidence. All execution tests use disposable synthetic homes and fake programs.
- The lead owns native acceptance on the actual subscription, including actual Opus/Sonnet access, exact init metadata under these flags, absence of inherited personal instructions/hooks, and observed plan billing. Unexpected inventories are refused; they are not silently accepted or reclassified. A setup-ready status proves supported local CLI/subscription login, not model entitlement, remaining quota or successful generation.
- The system prompt is passed through the requested `--system-prompt` argument. Very large contexts can exceed the operating system's argv bound; spawn then fails before dispatch. This implementation does not quietly truncate context or substitute a different prompt channel.
- Web Settings/types are intentionally left to the lead. The server contract above is built and tested. The default Codex model remains the line M1 owns.

## File inventory and proposed commits (not created)

Added:

- `packages/director/src/runtime/bridge-environment.ts`
- `packages/director/src/runtime/claude-code.ts`
- `packages/director/src/runtime/claude-code-process.ts`
- `packages/director/src/runtime/claude-code-setup.ts`
- `packages/director/src/tools/launch-gate.ts`
- `packages/director/test/claude-code-fixture.mjs`
- `packages/director/test/claude-code-helpers.mjs`
- `packages/director/test/claude-code.test.mjs`
- `apps/server/test/claude-code-director.test.mjs`
- `docs/ai/film-quality/reports/M2-report.md`

Modified:

- `packages/director/src/runtime/codex.ts` (permitted bridge-environment extraction only)
- `packages/director/src/runtime/index.ts`
- `packages/director/src/tools/mcp.ts`
- `apps/server/src/application/local-director.ts` (default Codex model line untouched)
- `apps/server/src/application/director-supervisor.ts`
- `apps/server/src/application/director-turn-view.ts`
- `apps/server/src/application/service.ts`
- `apps/server/src/app.ts`

Deleted: none. No additional source outside the card's owned trees was needed; this requested report is the only documentation edit.

Proposed split:

1. `feat(director): add isolated Claude Code plan runtime` — all changed/added `packages/director/**` files above.
2. `feat(server): select Claude Code for code films` — all changed/added `apps/server/**` files above, plus this report.
