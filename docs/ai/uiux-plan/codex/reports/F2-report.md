# F2 — aligned Director skill release automation

## Done

- F2 item 1: `pnpm skills:draft`, `skills:release` and `skills:check`; a pure TypeScript release planner; exact unchanged-package byte reuse; patch/minor/major bumps; notes and supported contract selection; exclusive authoring lock, staged validation, append-only historical row text and synchronous publication rollback. Server startup strictly parses and freezes `skills/shipped-releases.json`, checks supported contracts/handler digests and rejects malformed, duplicate or unordered rows. The legacy guidance table is unchanged.
- F2 item 2: generated `skills/v8.0.2` with the command's one-time `--realign` option. Its release digest is `c1509e31ab84582f29e147aea7adb3de6d2951b5f116eeb836d1ca0a395c0802`. Production, plan-authoring, craft-shot-prompting and craft-visual-style use 8.0.1; the other eighteen packages retain 8.0.0 and their exact digests. Only those four manifests and `release.json` differ from 8.0.1. Both historical directories have no tracked changes.
- F2 item 3: the normal test suite invokes the checker against every shipped release. It checks release/package identity, last-content-change alignment, directory resolution, duplicate/missing/unregistered releases, drafts and handler digests. The local draft override is `OPENSLATE_SKILLS_DRAFT=1`, named in the success/refusal message. Checks also build the exact runtime stage-prompt lock, enforce declared word budgets and preserve the existing non-core decision/permission lint.
- F2 item 4: current-default tests read the latest row; historical 8.0.0/8.0.1 pins remain explicit. Added saved-8.0.1 verification, fresh-turn upgrade, retained epoch binding and upgrade idempotency coverage.
- F2 item 5: documented draft → edit → release → check, alignment, cross-major version retention, parallel worktree authoring, rerunning the second merged release and interrupted-command recovery.

## Files

Changed:

- `package.json`
- `packages/director/src/index.ts`
- `packages/director/src/skills/index.ts`
- `packages/director/test/skill-release.test.mjs`
- `apps/server/src/application/director-capabilities.ts`
- `apps/server/src/application/director-shipped-guidance.ts`
- `apps/server/test/director-skills-v8-0-1.test.mjs`
- `apps/server/test/narration-tools.test.mjs`
- `skills/README.md`
- `docs/technical/SKILLS-TOOLS.md`
- `docs/implementation/STATUS.md`

Added:

- `packages/director/src/skills/releasing.ts`
- `scripts/lib/skill-releases.mjs`
- `scripts/skills.mjs`
- `scripts/test/skills-release.test.mjs`
- `skills/shipped-releases.json`
- `skills/v8.0.2/**` (107 files: one release manifest and 22 complete packages)
- `docs/ai/uiux-plan/codex/reports/F2-report.md`

Deleted: none. The three pre-existing untracked card/instruction files were not edited or included in this inventory.

## Tests

33 tests added: 32 release-command/planner/checker tests and one saved-lock upgrade test. Four existing cases were adapted: two current-default assertions, the explicitly historical 8.0.0 → 8.0.1 transition, and the obsolete same-major refusal (replaced with an unchanged-package retention test across a major release). No tests were disabled. Integrity, idempotency and stale-authority checks remain.

Pinned toolchain setup/preflight passed without a download: Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1. Final build passed. The four touched test files passed **84/84**, zero failures, skips, cancelled or todo. The five additional runtime-prerequisite/policy failure fixtures also passed separately **5/5**. `pnpm skills:check` verified all three releases. Local links in both edited skill documentation files resolve; `git diff --check` passed.

**Final `pnpm test`: 4,495 passed, zero failures/cancelled/todo and one optional opt-in native Codex probe skipped (4,496 total). All five package/app `pnpm -r typecheck` checks passed.**

An earlier full run was interrupted to include the independent-review corrections; it is not reported as a completed gate. The final run completed after the complete 84-test focused gate.

## Contract changes

None in `packages/core/src/studio-api.ts`. No browser contract, UI, database schema, shipped tool catalog or skill instruction content changed.

## Commits

No commits made: the card's lead-owned review/commit rule applies. Proposed atomic conventional commit:

`feat(skills): automate aligned Director guidance releases`

File list: all changed and added files above. Keep registry migration, generated successor, server integration and tests together so each committed state has a valid latest release.

## Open issues and review

Self-review corrected UTF-8 BOM preservation and escaped JSON field handling. Independent review found future-version/contract test assumptions and release validation gaps for runtime-required stage prompts and the existing CI budget/policy checks; those were fixed and covered by failure fixtures. Stage-prompt identity enumeration is shared with the runtime verifier.

The existing major-directory convention is retained: `N.0.0` goes to `skills/vN`; later versions go to `skills/v<version>`. Package majors can differ from the release major because unchanged packages retain the version of their last content change. The one historical 8.0.1 mixed-version exception is constrained by its exact shipped release digest; the only version-only repair is the recorded 8.0.2 row.

A process crash can leave a stale command lock or an unregistered release directory. Authoring commands refuse stale locks, and the checker refuses leftover drafts and unregistered release directories; authors inspect the draft, row file and directory before manual recovery, as documented. Synchronous directory/row publication failures are tested to restore the draft and historical row data exactly.

No browser, real Codex/model/provider call, external network request, personal credential/configuration read, production-state access, production restart or port-3001 listener occurred. No user action is needed for F2.
