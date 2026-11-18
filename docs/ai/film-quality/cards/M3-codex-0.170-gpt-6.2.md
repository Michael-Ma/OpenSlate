# M3 · The Director runs on Codex 0.170.0 and can use GPT 6.2

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Read `docs/ai/film-quality/cards/M1-latest-codex.md`, `M1b-restart-safe-upgrade.md` and their reports: this card is the same upgrade one version later, and every rule they set still holds. You own `packages/director/**`, `packages/providers/**`, `apps/server/**`, `scripts/**`, the docs named here and their tests. In `apps/web/src/**` change only fixtures, tests and default model strings. Stay out of `skills/**`.

## Problem

The owner wants the Director on the newest GPT models. Settings › Models offers `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6.1-terra` and older ones. `gpt-6.2-sol` and `gpt-6.2-astra` exist, and the service offers them only to Codex CLI 0.170.0 or newer (checked on 2026-11-17 with `codex debug models`: 0.162.1 does not list them, 0.170.0 lists both first). OpenSlate pins `CODEX_PROTOCOL_VERSION = "0.162.1"`.

## Change

### 1. Pin Codex 0.170.0

Make `0.170.0` the supported runtime for the Director and for Codex images.

- **Install side by side.** The supported install is the versioned prefix `~/.local/share/openslate-codex-0.170.0` (binary `node_modules/.bin/codex`), which `supportedCodexInstall` already derives from the pin. The owner's running studio uses `~/.local/share/openslate-codex-0.162.1` until it restarts: never touch or delete that folder or `~/.local/share/openslate-codex`. Update `scripts/setup-readiness.mjs` and `docs/implementation/MANUAL-LIVE-PRODUCTION.md` (`npm install --prefix "$HOME/.local/share/openslate-codex-0.170.0" --save-exact @openai/codex@0.170.0`). Do not install anything into the owner's home; the lead does that after review.
- **A configured path only wins when it is the supported version**, as in M1.
- **Protocol.** The adapter has compatibility evidence for 0.162.1. Establish it for 0.170.0 from the real binaries. For the new one, install a throwaway copy inside this worktree (`npm install --prefix ./.codex-0.170.0-probe --save-exact @openai/codex@0.170.0`), use it, and delete the folder before you finish; it must not appear in `git status`. For the old one, read `~/.local/share/openslate-codex-0.162.1/node_modules/.bin/codex` without changing it. Run `app-server generate-json-schema` (or `generate-ts`) on both and compare every method, notification, item type and field the adapter uses in `runtime/codex.ts`, `runtime/setup.ts`, `runtime/transport.ts`, `runtime/policy.ts` and `media/codex-image.ts`. Fix anything that moved. The disabled-feature list and config keys must still mean what they did, and an unknown feature key must not make startup fail. You cannot start a nested Codex turn in your sandbox; the lead runs a real turn after review, so say exactly what you could and could not verify.
- **Saved work stays valid.** Receipts, settings and attempts that recorded `runtimeVersion` `0.153.4` or `0.162.1` are history and must keep validating, so a saved film replays and buys nothing again. New work records `0.170.0`. No saved step key, receipt, lock, price or input may change.
- **M1b's two rules, one version later.** A provider configuration whose Codex image profile declares `0.162.1` (or `0.153.4`) loads as `0.170.0` for new work, with the startup notice and the `--doctor` line naming the profile and the version to write. A film whose locked Codex image profile differs from the installed one only by runtime version makes new pictures on `0.170.0` without a Settings step, and its journaled steps keep their keys and replay with no attempt.
- **The image model stays `gpt-6-astra`** if 0.170.0 still offers it (it was listed on 2026-11-17 as the previous generation). Do not change it; say in the report what the real catalog shows.

### 2. New films use `gpt-6.2-sol`

The Director default becomes `gpt-6.2-sol` everywhere M1 set `gpt-6.1-sol`: `LocalDirectorService` defaults, `scripts/storyboard-review.mjs`, the web fixture defaults and model choices (add `gpt-6.2-sol` and `gpt-6.2-astra` first), and any other default. A film that already chose a model keeps it. Settings lists what the pinned runtime's `model/list` returns, as now. Keep the reasoning effort the adapter already uses.

## Tests

1. Binary selection: the pinned 0.170.0 install is found; a configured 0.162.1 path falls back to it with the notice; a missing install still refuses with the install instruction.
2. The adapter's request and notification shapes match 0.170.0 (fixtures updated from the real schema), and startup works with the feature list.
3. A film recorded under 0.162.1, and one under 0.153.4, each with Codex image steps, replays with no new attempt and no charge, and its receipts still validate.
4. A new Codex image request records `runtimeVersion: "0.170.0"` and `model: "gpt-6-astra"`.
5. A new film's Director selection defaults to `gpt-6.2-sol`; an existing film keeps `gpt-6.1-sol`.
6. Server startup with a provider configuration that says `0.162.1` succeeds with the notice; `0.150.0` still fails.
7. Every test that pinned `0.162.1` as the current version now pins `0.170.0`, and every test about history keeps its recorded version.

## Finish

Run `pnpm build`, the touched test files with `node scripts/run-tests.mjs`, `pnpm -r typecheck` and `pnpm demo:code`, with exact counts. The lead runs the full suite and a real Director turn afterwards. Write `docs/ai/film-quality/reports/M3-report.md`: what changed, the schema diff and what you fixed, what the 0.170.0 model catalog lists, and what you could not cover.
