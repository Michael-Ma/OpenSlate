# Skills and tools

OpenSlate separates instruction content, validated tool contracts and provider execution. Adding a skill does not grant filesystem access, paid work or an arbitrary new handler.

## Locked instruction packages

The two production packages are `production` and `plan-authoring`. Each declares an entry, reference files, compatibility and required tools. The loader verifies bounded regular files, UTF-8, links, manifest declarations and hashes, then preserves immutable snapshots. The project lock binds instruction bytes, tool catalog/handlers, workflow recipe, stage checks and runtime identity.

Legacy `skills/`, `skills/v2`, `skills/v3` and `skills/v4` are runtime compatibility inputs. Do not edit/delete old versions during prose cleanup. New schema/behavior extensions use a successor catalog rather than changing old digests.

## Model-facing tools

| Tool | Responsibility |
|---|---|
| `read_context` | Read bounded current project/workflow/capability evidence |
| `prepare_change` | Validate a typed creative/plan proposal and return impact without generation |
| `apply_change` | Commit the exact prepared proposal under current request/epoch authority |
| `control_execution` | Apply allowed controls within the bound request |
| `inspect_artifact` | Inspect permitted owned output/provenance |

Versioned tool variants support narration drafting and reviewed audio proposals through the same bounded bridge. Model calls cannot supply a trusted actor, grant, acceptance or provider credential. Tool-call IDs are trace identities; service command/intention identities own replay and effect uniqueness.

## Context and upgrades

Activated references carry exact package/digest provenance and request binding. Required contract references are delivered as verified native developer instructions. Context projection includes capabilities so an old catalog cannot silently pretend it can write individual shot narration.

A successor guidance lock applies before the first context/dispatch of an eligible fresh native turn; already-bound epochs preserve their old lock. The application verifies exact shipped V1–V3 predecessor content and saves a replay-safe V4 successor/audit event. It rejects already-used/restored/stale/busy/customized epochs safely and changes no canonical film, hold, acceptance, grant or allowance. The manual diagnostic endpoint remains, but normal settings expose no version-management control. See [guidance compatibility](../implementation/DIRECTOR-TOOLS-UPGRADE.md).

## Source and checks

- [Skill loader/locks](../../packages/director/src/skills/index.ts)
- [Core tool catalogs](../../packages/core/src/tools.ts) and [legacy schemas](../../packages/core/src/legacy-change-schema.ts)
- [Bridge/MCP](../../packages/director/src/tools/bridge.ts), [invocations](../../apps/server/src/application/tool-invocations.ts), [lock construction](../../apps/server/src/application/director-capabilities.ts)
- Tests: `packages/director/test/skills.test.mjs`; server director-context, tool catalog/upgrade, narration tools and proposal tools suites.

The [runtime trust decision](../implementation/RUNTIME-TRUST-DECISION.md) describes the accepted native boundary; hashes/catalog checks are not an independent sandbox certification.
