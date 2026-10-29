# F2 · Automatic, aligned Director skill releases

Read `docs/ai/uiux-plan/codex/RULES.md` first. Its hard rules apply in full.

## Problem

A guidance release is shipped by hand today:

- copy `skills/vN` to `skills/v<version>`;
- edit packages and bump their `openslate.skill.json` versions by judgement;
- recompute package digests and write `release.json`;
- append a row to `SHIPPED_DIRECTOR_RELEASES` in `apps/server/src/application/director-shipped-guidance.ts` with a hand-copied `releaseDigest` and `handlerDigest`;
- update every test that hard-codes "the latest release" (`'8.0.1'` in `narration-tools.test.mjs`, `director-skills-v8*.test.mjs`, and others).

This is error-prone:

- Release 8.0.1 holds packages at mixed versions: four at 8.1.0, eighteen at 8.0.0. A package version says nothing about which release changed it.
- Two agents working in parallel would both create "8.0.1" and collide on the directory and the row.
- A test that hard-codes the latest version breaks on every release.

## Change

1. **One release command:** `pnpm skills:release` (a script under `scripts/`, a pure core in a testable module).
   - **Authoring:** `pnpm skills:draft` copies the latest shipped release into `skills/next/`, the only editable working copy, and refuses if it exists. Authors edit `skills/next/**` freely without touching versions.
   - **Release:** `pnpm skills:release [--minor|--major] [--note "..."]`. The default is a patch release.
     - It computes the next release version from the latest shipped row: patch by default, so the next is 8.0.2.
     - It diffs each package's content against the latest shipped release, ignoring the `version` field and anything the digest already excludes.
     - Changed packages get the new release version. Unchanged packages keep their previous version and digest byte-for-byte.
     - It writes the versions into each `openslate.skill.json` and writes `release.json` with recomputed digests, using the existing digest code in `packages/director/src/skills` (do not reimplement).
     - It moves `skills/next` to `skills/v<version>` and appends the new row.
     - It refuses when there is no content change, when the target directory exists, or when the computed version collides.
   - **Rows as data:** move the release rows out of TypeScript into `skills/shipped-releases.json`. The script appends to the file; it never rewrites existing rows. `director-shipped-guidance.ts` loads and validates it at startup (frozen, schema-checked, fail closed).
     - The handler digest comes from `toolCatalog(contract).digest`, or whatever the current rows were computed from. Verify the existing rows reproduce exactly.
     - A `--contract <x.y.z>` option selects a new tool contract.
     - Keep the legacy `SHIPPED_DIRECTOR_GUIDANCE` table as is.
2. **Alignment rule, from now on:** a package's version is the release version in which its content last changed. So in 8.0.2, production might be 8.0.2 and craft-story 8.0.0.
   - Shipped directories `skills/v8` and `skills/v8.0.1` stay byte-identical. Never rewrite a shipped release; old locks must keep verifying.
   - Produce release 8.0.2 with the new tool, with no content change from 8.0.1, only aligned versions:
     - packages changed in 8.0.1 → `8.0.1`: production, plan-authoring, craft-shot-prompting, craft-visual-style;
     - all others → `8.0.0`.
   - This is the one release where a version-only change is allowed; give the tool an explicit `--realign` flag for it.
   - New projects then lock 8.0.2, and 8.0.1 projects upgrade on their next fresh native turn, as today.
3. **`pnpm skills:check`, wired into `pnpm test` as a test file.** It fails when:
   - a shipped release directory's bytes no longer match its row's `releaseDigest`;
   - a package changed content without its version moving to the release that changed it;
   - a package version moved without a content change (except under the recorded realign release);
   - two rows share a version, or a row has no directory;
   - `releaseDirectory()` does not resolve each row;
   - a leftover `skills/next/` exists. Allow it locally with `OPENSLATE_SKILLS_DRAFT=1` and name it in the message.
4. **Tests stop hard-coding "latest".**
   - Tests that mean "the latest shipped release" read `SHIPPED_DIRECTOR_RELEASES.at(-1)`.
   - Tests that pin a specific historical release (8.0.0, 8.0.1) keep their literals.
5. **Docs:** update `skills/README.md` and `docs/technical/SKILLS-TOOLS.md` with the draft → edit → release workflow, the alignment rule, and the parallel-work rule. Parallel authors each work in their own worktree on `skills/next`. Whoever merges second re-runs `skills:release` on top of the first, so versions never collide.

## Tests (minimum)

- The pure planner computes the next version, the per-package versions and digests, and refuses no-change, existing-directory and collision cases.
- An end-to-end run in a temp copy of `skills/` (never the real tree) produces a release that `loadSkillRelease` and `createDirectorReleaseLock` accept.
- The existing rows for 8.0.0 and 8.0.1 load from JSON with identical digests to the current TypeScript constants.
- The 8.0.2 realign release verifies, new projects lock it, and an 8.0.1 lock still verifies and upgrades on a fresh turn.
- `skills:check` fails on each listed drift, using a temp fixture tree.

## Out of scope

- Changing skill content.
- The web UI.
- The legacy 1.0.0–7.0.0 guidance table.
