# Codex live compatibility probe

Observed September 11, 2026, using `codex-cli 0.153.4`, Node 24.15.0 and GPT-6 Astra with low reasoning effort. The user authorized at most three short Codex turns. Exactly three `turn/start` requests were sent, with an on-disk allowance record updated before each request. This is a small compatibility experiment, not the production director integration.

**Result:** live function dispatch, active interruption, rejection of a late call after authority revocation, and process restart/resume were demonstrated. The history API did not expose the tool result even though the native session log retained it. No follow-up model turn after restart was run; the allowance was exhausted.

No image/video provider ran. Only synthetic text and fixture tools were provided. Native Codex used the configured ChatGPT account; credentials were not read, printed or copied into the harness. Both synthetic native threads were archived after the experiment. The repository was not committed or pushed.

A later, separately authorized [three-start MCP follow-up](CODEX-MCP-FOLLOWUP.md) verified live MCP dispatch and a real model turn after restart with application context. The observations below remain the historical first allowance; native recall and lossless history hydration are still unverified.

## Three-turn result

| Start | Configuration | Observation |
|---|---|---|
| 1 | Only the local MCP fixture enabled; `features.code_mode_host=false` | Model completed but the fixture received no call. This does not establish that MCP itself is broken. |
| 2 | Five explicit dynamic tools registered; all MCP disabled; tool host still disabled | Model completed with an unavailable-tool response. The saved native log records `code-mode host is disabled`; metadata confirms the five dynamic tools were registered. |
| 3 | Resumed the second thread with the same five tools and `features.code_mode_host=true`; all MCP still disabled | Model completed `read_context`, then invoked `prepare_change`. The host held the second response, revoked its epoch, and interrupted the active turn. The pending handler subsequently rejected its stale epoch. A replacement process resumed the same populated thread in idle state. |

The third start exercised two function calls within one Codex turn. “Three turns” does not mean three underlying model inference requests: a tool loop can contain multiple inference steps.

The successful tool result and the native interrupted-call marker were present in the probe's own saved session log. Native `thread/read(includeTurns:true)` returned the two turns but omitted their Code Mode tool output. Experimental `thread/turns/list` returned two turns; that proves turn enumeration, not complete output reconstruction. `thread/items/list` returned `-32601`, `thread/items/list is not supported yet`.

The successful thread was created with explicit experimental `historyMode: "legacy"`. These observations must not be generalized to the default paginated mode. The earlier [no-turn probe](CODEX-PROBE.md) observed a full-history-read failure for paginated history.

## Interruption sequence actually exercised

```mermaid
sequenceDiagram
    participant Host as Probe host
    participant Codex as Codex process A
    participant Tool as Synthetic tool handler
    Host->>Codex: turn/start (third and final allowed start)
    Codex->>Tool: read_context, epoch 1
    Tool-->>Codex: synthetic marker
    Codex->>Tool: prepare_change, epoch 1
    Note over Tool: Hold response pending
    Host->>Host: Revoke epoch 1
    Host->>Codex: turn/interrupt
    Codex-->>Host: turn completed: interrupted
    Host->>Tool: Release pending handler
    Tool-->>Host: Reject stale epoch; no fixture change
    Host->>Codex: Close process A
    Host->>Host: Start process B with epoch 2
    Host->>Codex: thread/resume, same thread ID
    Codex-->>Host: Resumed, idle
```

The handler captured its epoch from its process/client instance and compared it again before returning a successful result. Model arguments could not choose the epoch. This was a harmless fixture boundary; the separate SQLite/application tests provide the durable command and generation-admission evidence.

## Configuration lessons

1. Preserve the required native tool host. In this installed release, disabling `features.code_mode_host` prevented execution even when tool metadata was registered. Enable the host and restrict the tools and application authority separately. This does not relax OpenSlate's plan compiler: generated production plans still pass through the restricted parser rather than native JavaScript evaluation.
2. An empty `mcp_servers` override did not erase inherited entries. Explicitly disable each inherited server and verify the effective enabled set before starting a model turn. The CLI's dotted configuration keys accepted the actual bare server names; adding literal quote characters created an invalid new server key.
3. `features.skip_host_skill_discovery=true` did not by itself empty the discovered catalog. Explicit per-path `skills.config` disable entries reduced enabled discovery to zero. Only name/path metadata was used to construct these entries. No production skill injection was tested.
4. The successful probe kept apps, plugins, remote plugins, shell tools, hooks, image generation, browser/computer tools, memories, subagents and workspace-dependency tools disabled, with read-only sandboxing, no project instructions and no model-side network permission. The native local tool host was deliberately **enabled**. Effective settings and observed fixture calls are useful evidence, not an adversarial proof of filesystem/network isolation.
5. The host reused native authentication instead of duplicating credentials. This test wrote synthetic native session records under the account's ordinary Codex session storage and kept its own database/log settings in a separate test directory. Production credential/state isolation remains a separate T06 requirement.

The [official App Server reference](https://learn.chatgpt.com/docs/app-server) documents explicit dynamic tools, native call identifiers and interruption/resume. These APIs remain experimental where labeled. The installed experimental schema was generated with `app-server generate-json-schema --experimental`; stable schema generation omits experimental request fields. The [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) describes per-server and per-skill controls. Observed local behavior above takes precedence over assumptions based only on schema declarations.

## Implications for OpenSlate

Keep OpenSlate's project state and command receipts authoritative. Persist tool invocation identities/results in the application event stream, and assemble resumed director context from those records. The UI must not depend on Codex's history projection returning every tool result. Reading Codex's private session-log format was a diagnostic step, not a proposed application integration.

Keep MCP as the planned initial transport until it receives a fair live test with the required host enabled. The successful explicit dynamic-tool path is evidence for an alternative adapter; it is not an implicit decision to add experimental dynamic registration to the initial production dependency set.

Before enabling real generation authority, still verify:

- Model continuation after process restart with the new request/epoch, using application-reconstructed context.
- Live MCP dispatch with the tool host enabled, and a supported strategy for event/history recovery.
- Explicit pinned skill injection and multi-request skill lifecycle.
- Adversarial runtime isolation and credentials separation.
- Pending human-input replies, vision and any optional steering behavior actually required by the product.

Further live turns require a new allowance. No fourth turn was started. The [machine-readable summary](codex-live-evidence.json) records these outcomes without account credentials or private session paths.
