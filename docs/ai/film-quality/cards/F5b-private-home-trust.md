# F5b · The private Codex home inherits no project trust

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. You own `packages/director/src/runtime/private-home.ts`, `setup.ts`, `codex.ts`, `packages/director/src/media/codex-image.ts`, `scripts/probe-codex-compat.mjs` and their tests.

## Problem

F5 added `project_root_markers = []`, `project_doc_max_bytes = 0` and empty fallbacks to the Director and image worker configuration, and its offline probe passed. The next live run (V3, data under `/Users/michael/SideProject/OpenSlate/data/test-runs/20261102-v3-dance/studio`) still lost its first Codex image after three seconds with `native_instructions_unexpected`.

The image worker's private Codex home, `<data>/codex-images/runtime/director-home/config.toml`, contains exactly:

```toml
[projects."/Users/michael/SideProject/OpenSlate"]
trust_level = "trusted"
```

That is the owner's own trust entry for the repository, carried into the private home. The repository root has an `AGENTS.md`, and a trusted project's instructions still load, so a workspace inside the repository inherits them. F5's probe used a temporary repository with no trust entry, which is why it passed. Data under the home folder worked only because it was outside the trusted project.

## Change

The private Codex homes OpenSlate prepares, for the Director and for the image worker, carry only what OpenSlate writes: no `[projects]` trust entries (or any other table) copied from the owner's `~/.codex/config.toml`. Find where `preparePrivateCodexHome` or setup derives `config.toml` and stop the inheritance; if Codex itself writes a trust entry at runtime (for example by trusting the working directory), prevent it with configuration or mark OpenSlate's own workspaces explicitly untrusted, and say which it was. Keep authentication working exactly as now (the private home still uses the owner's login through the existing `auth.json` link). Keep the instruction check as the guard. Existing private homes must be corrected on the next start, not only new ones.

## Tests

1. Reproduce the real case with the real 0.162.1 binary and the offline loopback probe: a git repository with `AGENTS.md` at its root, a source `config.toml` that trusts that repository, and a workspace inside it. Before the change the thread reports the inherited instruction source; after it, none. Show both.
2. An existing private home with a copied trust entry is cleaned on the next setup.
3. Login still works through the private home (the existing auth tests).
4. Director runtime and image worker suites stay green.

## Finish

Run `pnpm test`, `pnpm typecheck`. Write `docs/ai/film-quality/reports/F5b-report.md`.
