# T00: Codex compatibility probe

This is an executable **no-model-turn probe**, not the production director adapter. Source lives in `packages/director/src/probe`; the fixtures cannot generate media or modify canonical project state. No runtime or dependency was installed for this work.

## Run it

Use the repository's Node 24 toolchain, build the director, then select an explicit installed binary:

```sh
pnpm --filter @openslate/director build
node packages/director/dist/probe/cli.js --codex /absolute/path/to/codex
node --test packages/director/test/*.test.mjs
```

The native integration test is opt-in:

```sh
OPENSLATE_CODEX_PROBE_BINARY=/absolute/path/to/codex node --test packages/director/test/*.test.mjs
```

On the inspected machine, Node was `/Users/michael/.nvm/versions/node/v24.15.0/bin/node`; the working binary was `/Applications/ChatGPT.app/Contents/Resources/codex`. The ordinary npm launcher identified package version `0.128.0` but failed with `ENOENT` because its optional native binary was missing. The probe does not silently replace, repair, or install that launcher.

The executable prints a JSON report. Exit 2 means startup was blocked or a check failed; exit 0 means the available local checks completed, **not** that production is approved. Individual blocked checks and `productionReady: false` remain visible. A recorded version/platform/schema baseline detects drift without pretending another release has passed. Local fixture tests explicitly skip if the environment prohibits loopback listeners; the native probe reports that restriction as blocked. Neither outcome counts as successful integration coverage.

## Mechanism and safety boundary

Each run creates fresh temporary HOME, CODEX_HOME, XDG, workspace, and scratch directories. It creates only two synthetic skill packages, a synthetic configuration, and an empty workspace marker. Child environments are constructed from an allowlist, never copied from the user's environment. No private config, auth file, real API key, or existing conversation is copied. Temporary files are removed and spawned processes closed afterward.

The only configured model provider points at a local HTTP fixture that refuses inference. Proxy variables also point at that denying fixture. These settings are defense in depth; they are not proof of OS-enforced network isolation. The native request transport has an explicit allowlist excluding `turn/start`, compaction, shell commands, and history injection. Steering probes accept an empty input array and target no active turn. Unexpected native server requests are rejected rather than granting permissions or supplying authentication.

Codex connects to a fixed fake MCP server exposing the five proposed tool names. Its schemas accept empty objects; these are intentionally **not** the future production tool contracts. Direct App Server MCP calls reach a local in-memory epoch fixture. The MCP process reads its opaque credential once, so revocation and process replacement can be tested without a model. The fixture checks captured authority again at its synchronous mutation point. It proves transport attribution mechanics, not SQLite durability or media admission.

The [official App Server documentation](https://learn.chatgpt.com/docs/app-server) defines the initialization sequence and schema-generation commands. Native method availability is taken from the installed binary's generated schema and negative dispatch probes; declarations alone are not treated as working live-turn behavior. MCP configuration is described in the [official MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).

## Observed evidence

Observed September 10, 2026, 23:49 PDT (`2026-09-11T06:49:45Z`), with Node `24.15.0`, macOS arm64, and **`codex-cli 0.153.4`**. Generated JSON-schema tree SHA-256:

```text
03cd0961387d55845ca2ac1cb7127a9a9724d31ec53897b5a2993b4541168a7b
```

| Check | Result |
|---|---|
| Request before initialization | Rejected: `-32600`, `Not initialized` |
| Initialize/initialized handshake | Passed with experimental APIs disabled |
| Thread creation without a turn | Passed; returned idle thread with local fake provider |
| Thread metadata read | Passed; returned `historyMode: paginated` |
| Full empty history read | **Blocked:** `-32601`, `list_turns is not supported yet` |
| Replacement process resumes empty thread | Passed with the same persisted thread ID |
| Skill metadata discovery | Found both fixtures plus six bundled system skills; all discovered paths were inside the isolated root |
| Exclusive two-skill catalog | **Not established:** bundled skills remain discoverable |
| Fixed fake MCP catalog | Exactly `read_context`, `prepare_change`, `apply_change`, `control_execution`, `inspect_artifact` |
| Direct fake MCP mutation | Passed with original immutable epoch attribution |
| Revoked bridge call | Rejected; fixture mutation count unchanged |
| Replacement bridge | Used the new epoch after process replacement |
| Interrupt/steer without an active turn | Rejected with `no active turn to interrupt/steer`; active-turn behavior untested |
| Model/vendor activity | Zero `turn/start` requests, zero requests to the local provider/proxy fixture, no real credentials provided |

The generated schema declares interruption, steering, MCP tool calls, permission/command/file approval requests, MCP elicitation, and `item/tool/requestUserInput`. This is an inventory, not proof that all declared requests are stable, enabled, or exercised. The installed schema's thread sandbox values use `read-only`, `workspace-write`, and `danger-full-access`; the probe uses the first.

Eight tests passed with native integration explicitly enabled: request restrictions, environment isolation, schema inventory, commit-time epoch revocation, read-only/forged authority rejection, missing-executable cleanup, real local MCP process attribution, and the no-turn native probe. The local fixture mutation tests allocate no generation intents, assets, or financial records.

## Subsequent live evidence

The separate [September 11 live experiment](CODEX-LIVE-PROBE.md) used three explicitly authorized turn starts. It demonstrated experimental dynamic-tool dispatch, active interruption, fixture epoch rejection and same-thread resume in a new process. It did not exercise a follow-up model turn after that restart or live MCP with the required tool host enabled. Its native history API omitted tool output that the native session log preserved. A separately authorized [MCP follow-up](CODEX-MCP-FOLLOWUP.md) subsequently verified live MCP and post-restart model continuation using canonical application context. All six authorized starts were used. The executable no-turn probe and its historical results above remain unchanged; current open gates are listed in [implementation status](STATUS.md).

## Remaining release gates at the no-turn baseline

- Full-history/reconnect behavior on the selected runtime needs a supported strategy; empty-thread resume does not establish recovery of populated histories or pending calls.
- Actual reasoning streams, model-dispatched MCP calls, skill instruction injection, compaction, active interruption/steering, pending-input replies, and vision require separately authorized model-turn tests. No such tests were run here.
- Runtime filesystem/network isolation and exclusion or explicit allowlisting of bundled/system skills need adversarial tests before connecting production authority.
- Durable epoch revocation, replay identities, candidate grants, holds, and admission must be tested against the application database; this fixture is intentionally in-memory.
- Restart/resume latency, context cost, real model protocol compatibility, authentication, and provider billing are unverified.

Keep real-generation integration blocked on those applicable gates. A passing no-turn probe establishes a useful local transport baseline without claiming the production director is implemented.
