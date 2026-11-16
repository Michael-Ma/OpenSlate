# Accepted decision: one computer, trusted local Codex

Accepted September 12, 2026: v0 supports one user on one computer. The browser, Fastify application, SQLite, artifacts, execution and native director remain local. Cloud LLM/image/video/audio APIs are external model services; local deployment does not mean offline generation.

## Trust boundary

OpenSlate trusts the exact pinned installed Codex runtime and its built-in sandbox as local infrastructure. `LocalCodexPolicy` uses mode `local` and exact version/configuration identity. It checks supported runtime configuration, locked skills/tool catalogs, loopback bridge/credentials and request epochs; application services enforce canonical mutations, grants, reviews and provider submissions.

Independent code-host/authentication isolation is unverified. Model refusal in a prompt is not enforcement evidence. This accepted local assumption does not authorize arbitrary native operations or weaken application generation/recovery checks.

## Later runtimes under the same decision

These boundaries were added after September 12 and follow the same local trust model.

- **Codex workspace isolation (F5/F5b, November 2):** the exact policy pins empty `project_root_markers` and zero project-document budget, so the film workspace is its own project root and no `AGENTS.md`, `.codex` configuration or repository skills from parent directories reach the Director. Private Codex homes pin only that workspace as untrusted and clear earlier auto-trust records.
- **Claude Code (code films only):** OpenSlate trusts the installed Claude Code 2.1.312 or later 2.x on the user's own Claude subscription. Each turn is a fresh restricted process with an allow-listed environment, no setting sources, hooks, plugins, built-in agents, slash commands or built-in tools, and a strict MCP configuration holding only the locked bridge. The adapter checks the actual init inventory before using output, and API-key billing is refused. The same epochs, receipts and application authorization apply as for Codex.
- **Code-plan guest:** a code film's TypeScript runs only inside a QuickJS/WASM interpreter in a Node worker thread, with no Node, filesystem, network or secret access. Its only host interface is a bounded set of JSON `ctx` methods; each pass has CPU, heap, stack, source-size and host-call limits and a frozen clock and seed. Media effects are host decisions recorded in the journal, never guest side effects.

None of these additions claims independent code-host/authentication isolation.

## What remains local

Same-computer processes still need leases, ownership, epoch fences and restart recovery. The source launcher and backup/restore enforce their cooperative installation boundary. There is no remote-worker registration, public/shared service, distributed dispatcher or database shared across hosts.

Same-machine Python H3 inference is later provider work. Multi-host/remote GPU/hosted operation needs a separate design decision and validation; it is not a missing mandatory gate for the accepted local v0.

Source: [runtime policy](../../packages/director/src/runtime/policy.ts), [native adapter](../../packages/director/src/runtime/codex.ts), [private Codex home](../../packages/director/src/runtime/private-home.ts), [Claude Code process](../../packages/director/src/runtime/claude-code-process.ts), [code-plan sandbox](../../apps/server/src/code-plan/sandbox.ts), server local director/setup and supervisor. The [evidence index](VALIDATION-EVIDENCE.md) retains direct tests/native campaigns and their limits. [Architecture](../design/README.md) and [current status](STATUS.md) use this same boundary.
