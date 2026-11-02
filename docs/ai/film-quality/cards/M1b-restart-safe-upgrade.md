# M1b · Upgrading Codex never stops the studio from starting, and old films keep making pictures

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Card M2 (Claude Code Director) runs at the same time; stay out of `packages/director/src/runtime/claude-code*`, the Director selection code it adds, and its tests. You own `apps/server/src/application/provider-catalog.ts`, the Codex image catalog, receipt and execution code M1 changed (`apps/server/src/execution/codex-image-*.ts`, `packages/providers/src/codex-image.ts`, `packages/director/src/media/codex-image.ts`), `apps/server/src/code-plan/models.ts` and `provider-input.ts`, and their tests.

## Problem

M1 (merged) pins Codex 0.162.1. The owner's live provider configuration file (`OPENSLATE_PROVIDER_CONFIG`, outside the repository, not readable by us) still declares the Codex image profile with `runtimeVersion: "0.153.4"`. With M1 the server refuses to start: `PROVIDER_CATALOG_INVALID: The configured provider catalog could not be read or validated`. The owner would restart their studio and get nothing.

M1 also leaves every existing film locked to the 0.153.4 image profile. Saved pictures replay, but a new picture in such a film is refused until the person re-selects the keyframes model in Settings. The owner has several such films, one waiting on keyframe cards right now.

## Change

1. **Old configuration still loads.** A Codex image profile that declares the previous supported runtime `0.153.4` loads as the current runtime `0.162.1` for new work. Log one startup notice naming the file's profile id and saying to change `runtimeVersion` to `0.162.1`; `scripts/setup-readiness.mjs --doctor` says the same. Any other unsupported version, or any other invalid field, still fails as now.
2. **Old films make new pictures without a Settings step.** When a film's locked Codex image profile differs from the installed one only by runtime version (0.153.4 locked, 0.162.1 installed), a new image step dispatches on the installed 0.162.1 runtime. Steps already in the journal keep their exact keys, receipts and results and replay with no attempt. An unchanged `ctx.image` or `ctx.keyframe` call in an old film must reuse its saved picture, never buy a new one. If the step key would change, keep the journaled key's identity for reuse and apply the new runtime only to steps not in the journal. Any other difference in the profile still makes it retired, as M1 built.
3. **Nothing else moves.** No saved lock, key, receipt, price or input is rewritten. The image model stays `gpt-6-astra`.

## Tests

1. Server startup with a provider config whose Codex image profile says `0.153.4` succeeds, logs the notice, and the catalog shows the profile as ready on 0.162.1. A profile with `0.150.0` still fails with `PROVIDER_CATALOG_INVALID`.
2. M1's frozen 0.153.4 film: unchanged plan replays with zero attempts; a changed keyframe prompt dispatches one new image recording `runtimeVersion: "0.162.1"`, with no Settings change.
3. A profile differing in anything besides the runtime version stays retired and its new images are refused, as before.
4. `--doctor` output for the old file.

## Finish

Run `pnpm test`, `pnpm typecheck` and `pnpm demo:code`. Write `docs/ai/film-quality/reports/M1b-report.md`.
