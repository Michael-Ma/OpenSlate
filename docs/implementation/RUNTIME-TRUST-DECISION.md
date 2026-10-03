# Accepted decision: one computer, trusted local Codex

Accepted September 12, 2026: v0 supports one user on one computer. The browser, Fastify application, SQLite, artifacts, execution and native director remain local. Cloud LLM/image/video/audio APIs are external model services; local deployment does not mean offline generation.

## Trust boundary

OpenSlate trusts the exact pinned installed Codex runtime and its built-in sandbox as local infrastructure. `LocalCodexPolicy` uses mode `local` and exact version/configuration identity. It checks supported runtime configuration, locked skills/tool catalogs, loopback bridge/credentials and request epochs; application services enforce canonical mutations, grants, reviews, allowances and provider submissions.

Independent code-host/authentication isolation is unverified. Model refusal in a prompt is not enforcement evidence. This accepted local assumption does not authorize arbitrary native operations or weaken application generation/recovery checks.

## What remains local

Same-computer processes still need leases, ownership, epoch fences and restart recovery. The source launcher and backup/restore enforce their cooperative installation boundary. There is no remote-worker registration, public/shared service, distributed dispatcher or database shared across hosts.

Same-machine Python H3 inference is later provider work. Multi-host/remote GPU/hosted operation needs a separate design decision and validation; it is not a missing mandatory gate for the accepted local v0.

Source: [runtime policy](../../packages/director/src/runtime/policy.ts), [native adapter](../../packages/director/src/runtime/codex.ts), server local director/setup and supervisor. The [evidence index](VALIDATION-EVIDENCE.md) retains direct tests/native campaigns and their limits. [Architecture](../design/README.md) and [current status](STATUS.md) use this same boundary.
