# Skills and tools

OpenSlate separates instruction content, validated tool contracts and provider execution. Adding a skill does not grant filesystem access, paid work or an arbitrary new handler.

## Locked instruction packages

The two production packages are `production` and `plan-authoring`. Each declares an entry, reference files, compatibility and required tools. The loader verifies bounded regular files, UTF-8, links, manifest declarations and hashes, then preserves immutable snapshots. The project lock binds instruction bytes, tool catalog/handlers, workflow recipe, stage checks and runtime identity.

Legacy `skills/`, `skills/v2`, `skills/v3` and `skills/v4` are runtime compatibility inputs. Do not edit/delete old versions during prose cleanup. Current `skills/v5` has package version `5.0.0` and retains the `4.0.0` JSON tool contract. It describes configured-provider scene generation and requested audio without usage-approval steps. Package-content successors preserve historical digests instead of rewriting frozen snapshots.

## Guidance releases (v8 and later)

From guidance v8 a project locks a **release**, not two packages. `skills/v8/release.json` pins every package of the release with its digest; each package has a schema 2 manifest with a `role` (`core`, `type`, `craft`, `format`), `routes` (required on type packages, optional on format modifiers, never on core or craft), `requires` and `optional` (`{id, when}` with a closed `when` enum). Schema 1 manifests keep exactly their six fields, so V1–V7 bytes and digests never change.

- `loadSkillRelease` validates pins and digests, one contract, the shared major version (≥ 8), a closed acyclic dependency graph (required chains at most two deep; craft requires craft; type requires craft or format; core requires nothing), and route coverage (the release `routes` table names one owner or `fallback` for every application film kind, and agrees with every manifest). It then snapshots each package and the release itself (`<snapshotRoot>/<releaseDigest>/release.json`).
- A schema 2 lock adds `release: {version, releaseDigest}` and pins every release package. Schema 1 locks verify exactly as before.
- `routeSkills(filmKind, release, conditions)` is pure: core, then the type package from `filmKindRouteKey` (a null or unshipped type package means the release fallback), its format packages, then the `requires` closure and optional packages whose condition holds. A schema 2 activation records the decision (inputs, digest, selected, reasons) and is recomputed from its inputs on activation.
- Only the routed packages' `SKILL.md` and the release's `inject` core references go into the Director input; the context lists every locked package with its files. Everything else is read with `read_guidance {package, path?}` (7.0.0, free, read-only, any turn), which reads only packages in the conversation's own lock and records a `skill_read` (`via: "read_guidance"`). The allowance is per Director turn (one activation): at most 32 distinct files and 192 KiB; a repeat of a file already read that turn is recorded with `repeat: true` and is free up to 32 repeats. Past it, `GUIDANCE_READ_LIMIT` carries `{readFiles, maxFiles, readBytes, maxBytes, next}` and tells the Director to continue with what it has; the next message starts a fresh allowance. Codex enables only the routed entries.
- Release `8.0.1` (contract `7.0.0`, `skills/v8.0.1`) is the latest row of `SHIPPED_DIRECTOR_RELEASES`, after `8.0.0` (`skills/v8`): new films lock it, and fresh native turns upgrade any shipped identity, including 8.0.0, to it. `releaseDirectory` maps `N.0.0` to `skills/vN` and any later release to `skills/v<version>`. Word budgets in `release.json` are a CI check (`skillReleaseBudget`), not a runtime one; the shipped-release test also lints non-core packages for permission and decision calls.
- Contract 7.0.0 adds `propose_visual_style`: a whole-film style card whose option the person picks; the pick saves that look as `project.visualStyle` with an internal, undoable storyboard command (see [the v8 UI contracts](../ai/ui-v8/contracts.md)).

## Model-facing tools

| Tool | Responsibility |
|---|---|
| `read_context` | Read bounded current project/workflow/capability evidence |
| `prepare_change` | Validate a typed creative/plan proposal and return impact without generation |
| `apply_change` | Commit the exact prepared proposal under current request/epoch authority |
| `control_execution` | Apply allowed controls within the bound request |
| `inspect_artifact` | Inspect permitted owned output/provenance |

Versioned tool variants support narration drafting and requested audio through the same bounded bridge. V5-bound audio tools publish the exact requested input with `state: "requested"`; old V4-bound calls retain their proposal-only behavior. Model calls cannot supply a trusted actor, content acceptance, visual review or provider credential. Tool-call IDs are trace identities; service command/intention identities own replay and effect uniqueness.

## Context and upgrades

Activated references carry exact package/digest provenance and request binding. Required contract references are delivered as verified native developer instructions. Context projection includes capabilities so an old catalog cannot silently pretend it can write individual shot narration.

A successor guidance lock applies before the first context/dispatch of an eligible fresh native turn; already-bound epochs preserve their old lock. The application verifies exact historical predecessor content and saves a replay-safe current successor/audit event. V4 → V5 guidance is a package-content transition with the same tool contract. It rejects already-used/restored/stale/busy/customized epochs safely and changes no canonical film, hold or acceptance. Normal settings expose no manual guidance-update control. See [guidance compatibility](../implementation/DIRECTOR-TOOLS-UPGRADE.md) for the earlier V4 transition and [status](../implementation/STATUS.md) for current verification.

## Source and checks

- [Skill loader/locks](../../packages/director/src/skills/index.ts)
- [Core tool catalogs](../../packages/core/src/tools.ts) and [legacy schemas](../../packages/core/src/legacy-change-schema.ts)
- [Bridge/MCP](../../packages/director/src/tools/bridge.ts), [invocations](../../apps/server/src/application/tool-invocations.ts), [lock construction](../../apps/server/src/application/director-capabilities.ts)
- Tests: `packages/director/test/skills.test.mjs`; server director-context, tool catalog/upgrade, narration tools and proposal tools suites.

The [runtime trust decision](../implementation/RUNTIME-TRUST-DECISION.md) describes the accepted native boundary; hashes/catalog checks are not an independent sandbox certification.
