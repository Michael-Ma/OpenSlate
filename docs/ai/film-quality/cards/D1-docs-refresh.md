# D1 · README and docs describe OpenSlate as it is now

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. You own `README.md`, `docs/**` and tests that only check documentation or test removed code. Do not change product code. Another engineer may later run a live demo; nothing in this card touches runtime behaviour.

## Goal

`main` now holds everything (merge `c8461021`): the Next UI (Last Ferry design, English and Chinese), storyboard films and code-plan films, confirmed keyframes, cards that stay in their reply and retire when their dependencies change, visible progress, uploads the Director reads, Codex 0.162.1 with `gpt-6.1-sol` as the default Director, and Claude Code as a code film's Director on the owner's Claude plan. The README (92 lines) and many docs describe older states. The owner asked to update the README's features and technical architecture, delete outdated test files and docs, and update the remaining docs.

## 1. README

Rewrite `README.md` for a developer opening the repository today. Short sections, no marketing:

- What OpenSlate is, in two or three sentences.
- Features, grouped: making a film (storyboard and code plan), the Director (Codex models, Claude Code, what it can and cannot do), media models (Codex images, Viggle H3, Lyria, OpenAI speech and transcription; Seedance and fal are built but need keys), the studio UI (views, languages, Settings, spend limits).
- Technical architecture: the workspace layout (`packages/core`, `packages/director`, `packages/providers`, `apps/server`, `apps/web`, `skills/`, `scripts/`), how a turn flows (studio → Director runtime → MCP bridge tools → code-plan runtime or storyboard graph → execution engine → providers), persistence (SQLite entity store, data directory), the code-plan sandbox and replay, and the one-paragraph story of each Director runtime. A small diagram in Mermaid is welcome if it stays accurate.
- Getting started: Node and pnpm versions from `package.json`, `pnpm install`, the pinned Codex install (`docs/implementation/MANUAL-LIVE-PRODUCTION.md`), Claude Code as optional, the names (never values) of the environment variables in `.env.example` or the docs, `scripts/start-local.mjs` with one fixed `OPENSLATE_DATA_DIR`, and the fixture studio for safe UI work.
- Testing: `pnpm test`, `pnpm typecheck`, `pnpm demo:code`, `node scripts/browser-check.mjs`, and where owner test instructions live.
- A map of the docs that remain.

Every claim must match the code. Check commands, paths, versions and model ids against the source.

## 2. Delete what is outdated

Delete a doc when all of these hold: it describes a plan, design, prototype, draft or audit that the code no longer follows or that was superseded by a later doc; nothing in code, tests, scripts or remaining docs links to it (grep for its path and file name); and its useful facts, if any, are already in a remaining doc. Candidates to examine, not a list to delete blindly: `docs/ai/uiux-plan`, `docs/ai/ui-v8`, `docs/ai/skill-drafts`, `docs/ai/prototypes`, `docs/ai/v8-plan`, single-file folders under `docs/ai/`, `docs/design`, `docs/audit`, old reports in `docs/implementation`. Task cards and reports under `docs/ai/film-quality` and `docs/ai/code-plan` are the project's record of decisions; keep them unless one is plainly superseded. Keep `docs/ai/ARCHITECTURE-OVERVIEW.md` if present and untracked: it is not yours.

Delete a test only when its subject no longer exists in the code (a removed route, module or flag), it is permanently skipped for a removed feature, or it exactly duplicates another test. Never delete a test because it fails or is slow. Browser scenarios under `scripts/browser` follow the same rule.

## 3. Update what remains

Bring these up to date with the code: `docs/implementation/STATUS.md` (a current summary at the top; trim history that only repeats reports), `docs/ai/code-plan/TEST-INSTRUCTIONS.md` (the owner's test guide: add a test for choosing Claude Code as Director and for the latest Codex models, drop tests for features that are gone, keep it in Chinese with English keywords like the rest of the file), `docs/technical/*` (Codex 0.162.1, the Claude Code runtime, choice retirement), `docs/implementation/MANUAL-LIVE-PRODUCTION.md`, and any remaining doc whose facts are now wrong. Fix broken relative links.

## Tests

`pnpm test`, `pnpm typecheck` and `node scripts/browser-check.mjs` stay green; if you cannot launch a browser, say so and run the rest. A link check over `README.md` and `docs/**` finds no broken relative links.

## Finish

Write `docs/ai/DOCS-CLEANUP-REPORT.md`: every deleted file with its reason, every updated doc with what changed, the test counts before and after, and anything you were unsure about and kept.
