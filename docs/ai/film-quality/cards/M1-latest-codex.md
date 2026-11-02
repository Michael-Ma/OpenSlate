# M1 · The Director runs on the latest Codex and GPT models

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. You own `packages/director/**`, `packages/providers/**`, `apps/server/**`, `scripts/**`, the docs named here and their tests. In `apps/web/src/**` change only fixtures, tests and the default model strings named below; the lead builds the Settings UI later. If you need another file, edit it and say so in your report.

## Problem

The owner wants the latest GPT models. Settings › Models offers the Director `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra` and `gpt-5.6-luna`, and nothing newer.

Cause: OpenSlate pins its own Codex, `CODEX_PROTOCOL_VERSION = "0.153.4"` in `packages/director/src/runtime/policy.ts`, installed at `~/.local/share/openslate-codex` (`supportedCodexInstall` in `apps/server/src/application/codex-binary.ts`). The model list comes from that runtime's `model/list`, and the service answers by client version. The owner's own Codex CLI is `0.162.1`; its cached catalog lists, by priority: `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6.1-terra`, `gpt-6-sol`, `gpt-6-luna`, then the `gpt-5.6-*` models. About 70 files mention `0.153.4`: the Director runtime and setup, Codex image execution and its receipts, `provider-catalog.ts`, `packages/providers/src/codex-image.ts`, `scripts/setup-readiness.mjs`, docs and tests.

## Change

### 1. Pin Codex 0.162.1

Make `0.162.1` the supported runtime for the Director and for Codex images.

- **Install side by side.** The supported install moves to a versioned prefix, `~/.local/share/openslate-codex-0.162.1` (binary `node_modules/.bin/codex`). The owner's running studio still uses the old prefix until it restarts, so never touch or delete `~/.local/share/openslate-codex`. Update `supportedCodexInstall`, `scripts/setup-readiness.mjs` and `docs/implementation/MANUAL-LIVE-PRODUCTION.md` (`npm install --prefix "$HOME/.local/share/openslate-codex-0.162.1" --save-exact @openai/codex@0.162.1`). Do not install anything into the owner's home yourself; the lead does that after review.
- **A configured path only wins when it is the supported version.** `OPENSLATE_CODEX_BINARY` and `OPENSLATE_CODEX_IMAGE_BINARY` may still point at the old 0.153.4 binary. When a configured binary reports another version and the pinned install exists, use the pinned install and show the existing version-mismatch diagnostic as a notice. If the pinned install is missing, keep refusing with the diagnostic that says how to install it.
- **Protocol.** The adapter has compatibility evidence only for 0.153.4. Establish it for 0.162.1 from the real binary: `codex app-server generate-json-schema` (or `generate-ts`) on both versions, then compare every method, notification, item type and field the adapter uses in `runtime/codex.ts`, `runtime/setup.ts`, `runtime/transport.ts`, `runtime/policy.ts` and `media/codex-image.ts`. Fix anything that moved. The disabled-feature list and config keys in `codex.ts` (around line 16 and line 302) must still mean what they did; an unknown feature key must not make startup fail. Run the adapter against the real 0.162.1 binary in a disposable `CODEX_HOME` far enough to prove initialize, `model/list`, thread and turn start and MCP server status work. If that needs a ChatGPT sign-in you do not have, say so and cover it with the schema comparison and fixtures. Put the schema diff in your report.
- **Saved work stays valid.** Image receipts, settings and attempts that recorded `runtimeVersion: "0.153.4"` are history and must keep validating, so a saved film replays and buys nothing again. New work records `0.162.1`. Where a validator compares a saved runtime version with the current pin, accept the recorded historical version for verifying existing records only. No saved step key, receipt, lock, price or input may change. Prove it with a test that replays a film whose image steps were recorded under 0.153.4.
- **The image model stays `gpt-6-astra`.** 0.162.1 still offers it, and the picture comes from the image model. Do not change it.

### 2. New films use `gpt-6.1-sol`

The Director default becomes `gpt-6.1-sol`: `LocalDirectorService` defaults in `apps/server/src/application/local-director.ts`, `scripts/storyboard-review.mjs`, the web fixture defaults (`apps/web/src/next/fixtures/routes/computer.ts`, `settings.ts`, adding `gpt-6.1-sol` first in fixture `modelChoices`) and any other default. A film that already chose a model keeps it. Settings lists whatever the pinned runtime's `model/list` returns, hidden models excepted, as it does now. Use the reasoning effort the adapter already uses; do not raise it.

## Tests

1. Codex binary selection: the pinned 0.162.1 install is found; a configured 0.153.4 path falls back to it with the notice; a missing install still refuses with the install instruction.
2. The adapter's request and notification shapes match 0.162.1 (fixtures updated from the real schema), and startup works with the feature list.
3. A film recorded under 0.153.4, with Codex image steps, replays with no new attempt and no charge. Its receipts still validate.
4. A new Codex image request records `runtimeVersion: "0.162.1"` and `model: "gpt-6-astra"`.
5. A new film's Director selection defaults to `gpt-6.1-sol`; an existing film keeps `gpt-6-astra`.
6. Every test that pinned `0.153.4` as the current version now pins `0.162.1`, and every test about history still uses `0.153.4`.

## Finish

Run `pnpm test`, `pnpm typecheck` and `pnpm demo:code`. Write `docs/ai/film-quality/reports/M1-report.md`: what changed, the schema diff and what you fixed, whether the real binary run reached a turn, what you could not cover.
