# M1 · Codex 0.162.1 and the new-film Director default

Status: complete in the assigned `codex/m1-latest-codex` worktree; uncommitted. Final build, tests, both typecheck commands and offline code demo passed. Live authenticated generation remains explicitly unverified.

## Implemented

- Director and Codex-image execution pin `0.162.1`. The supported prefix is `~/.local/share/openslate-codex-0.162.1`. No install, upgrade, deletion or write was made in the owner's home. The original `~/.local/share/openslate-codex` remains untouched.
- A supported explicit binary wins. An unsupported configured Director/image binary uses a verified supported prefix when available; otherwise its existing setup version refusal remains. Version probes are bounded and local. Director selection records are not rewritten. The effective executable is recorded in successful setup evidence.
- Director setup/model responses expose the existing `DIRECTOR_CODEX_VERSION_MISMATCH` shape as **`codexNotice`** after successful fallback; **`codexDiagnostic` remains for blocking failures**. The image runtime logs the same notice and `--doctor` explains the fallback/install command. The lead's Settings UI should render `codexNotice` as informational: putting it in `codexDiagnostic` would make the current UI incorrectly block a working fallback.
- New-film defaults use `gpt-6.1-sol` in the local Director, storyboard-review script and web fixtures. The checked fixture catalog puts it first. Saved native model selections remain unchanged. Model discovery continues to use the native paginated catalog, including the existing selected-hidden-model handling. Director effort stays **high**; image effort stays **low**.
- Image execution still uses **`gpt-6-astra`**. The fixture image label is independent of the Director default.
- Pure receipt/input reconstruction accepts `0.153.4` and `0.162.1` with their recorded version in the digest. Saved profile, mapping and native versions must agree. New catalog definitions, first dispatch and worker preparation require `0.162.1`.
- Old code-film profile locks remain available to reconstruct their exact journal keys even after the installed catalog changes. This exception is limited to validated historical Codex image profiles. A fresh operation on that retired profile is still refused before an attempt/turn. No saved profile, key, receipt, input, price or lock is migrated.
- Historical image history lookup uses the **original saved, hashed executable** and its exact configuration, even when the configured current binary changes. It only initializes and reads the original thread; it cannot prepare/resume/start a new turn. Missing/changed original native state still stays unresolved.

## Real-binary protocol comparison

Both installed official binaries were used with disposable `HOME` and `CODEX_HOME`, without personal auth/configuration:

```sh
/path/to/codex app-server generate-json-schema --experimental --out /tmp/.../schema-VERSION
```

Compared the real `0.153.4` binary at the old supported prefix with the existing `0.162.1` CLI. The new versioned prefix was absent and was not installed. Generated experimental schemas for all 12 RPC methods used across `runtime/codex.ts`, `runtime/setup.ts`, `runtime/transport.ts`, `runtime/policy.ts`, `media/codex-image.ts` and its image transport were checked, including transitive item/input/permission/configuration definitions.

| Adapter surface | 0.153.4 → 0.162.1 |
| --- | --- |
| `initialize` / `initialized` | Existing request/response fields unchanged; capabilities add optional `explicitGatewayOauth`. |
| `config/read` | Used fields unchanged; `AppConfig` adds optional `omit_tools_from`. Named permission fields and their null serialization are unchanged. |
| `skills/list` | Metadata `path` changes its schema reference from `AbsolutePathBuf` to `LegacyAppPathString`; both remain strings. Existing exact absolute-path checks remain. |
| `account/read` | Adds optional `workspaceRouting`; account fields used by setup/image checks remain compatible. |
| `model/list` | Adds optional `availableAccessPrograms` on model metadata; model identity/label/visibility/modalities/effort/pagination remain compatible. |
| `mcpServerStatus/list` | Adds optional request `serverName`; status adds optional `httpOrigin`, `serverCapabilities`, `toolsError`. Runtime status and tool catalog checks remain compatible. |
| `thread/start` | Adds optional request `daybreakEnabled` and response `disabledPluginIds`. Existing named permissions, instruction sources, legacy history and thread identity remain compatible. |
| `thread/resume` | Adds optional response `collaborationMode` and `disabledPluginIds`. Existing request fields remain compatible. |
| `turn/start` | Adds optional request `disabledPluginIds`, `parentTurnId`, `rootTurnId`; a turn adds optional `rootTurnId`. Existing effort, text/skill/local-image and permissions fields remain compatible. |
| `turn/interrupt` | Used request and response shapes unchanged. |
| `thread/read` | Used request/response/history fields remain compatible, including image-generation items. |
| `modelProvider/capabilities/read` | Removes `namespaceTools`; image worker only consumes the unchanged required `imageGeneration`. Updated the synthetic response fixture accordingly. |
| `turn/started`, `turn/completed`, `item/started`, `item/completed`, user-input requests | Method/notification identities and used fields remain compatible. Fixture notifications now include schema-required timestamps, turn item arrays, and user-input identity/blocking fields. |

Nested differences were also checked:

- `MessagePhase` adds `partial_answer`. The existing adapter preserves unrecognized phases as `unknown`, and still prefers an explicit final answer; no authority is derived from any phase.
- `UserInput.image` becomes `url OR fileId`, with the existing optional detail. The URL branch emitted by OpenSlate remains valid. The analogous function-output image union also gains a file-ID source.
- MCP tool-call items add optional `mcpAppUi`; sub-agent activity items add optional `model`/`reasoningEffort`. Image-generation fields consumed by the worker are unchanged. New fields are ignored by the existing projection.
- Global client methods: **155 → 170**, with 16 additions and removal of unused `thread/rollback`. Global server notifications: **81 → 84**, adding gateway-OAuth, attachment and prediction notices. No used method or notification was removed. Server-request method identities are unchanged.
- Client-request schema SHA-256: old `05c82ead1a820c765c23d3a1d262e4ae54889785276ee1acf7c494141fd94d70`; new `f1425525dae2903cb5b658ee412530ff7a8fcaf78887f182c169b299e7f6b09b`.

The checked-in `packages/director/test/fixtures/codex-protocol-0.162.1.json` contains 30 real schema roots, their required transitive definitions and individual source hashes. It is generated by `scripts/codex-protocol-schema.mjs`; descriptions are omitted, structural schemas are retained. Tests validate actual adapter fixture requests and representative consumed notifications against these shapes, including start/resume, image-worker inputs and the new image union.

### Configuration finding and fix

A deliberate unknown false feature sent directly to the **real** strict app-server failed before initialize with `unknown configuration field features.openslate_compatibility_probe_unknown`. The adapter now removes unrecognized **false** feature reductions before native launch; an unverified **enabled** feature is refused locally. Strict config stays enabled. The known disabled-feature set is shared between setup and the Director. The real binary's `config/read` confirmed every disabled flag remains false, with the three existing required feature flags retained. No reasoning effort was increased.

### Official npm binary layout

A real-package check found that the installed `0.153.4` prefix has a sibling platform package, while the installed global `0.162.1` CLI has it nested under `@openai/codex/node_modules`. The image worker previously assumed the sibling layout. It now follows the official launcher's `createRequire(launcher).resolve("@openai/codex-PLATFORM-ARCH/package.json")` lookup, without executing JavaScript to discover the native child. It still validates the native executable header, exact version and full binary hash. Synthetic tests cover both layouts and a direct binary. Resolving both real launchers then running only their native `--version` returned `0.153.4` and `0.162.1` respectively. No home installation was changed.

## Real native run and limits

Ran `node scripts/probe-codex-compat.mjs /absolute/path/to/codex /tmp/openslate-m1-evidence`. It creates instruction-free disposable homes and routes every model endpoint to its own loopback-only refusal server. No real provider, personal sign-in, production data, browser or port 3001 is used.

The successful compatibility probe reached:

1. Initialize and native `model/list`, with `gpt-6.1-sol` and `gpt-6-astra` present in the binary's unauthenticated/offline catalog.
2. Strict configuration readback, all disabled flags false, unknown disabled flag omitted.
3. Actual `CodexDirectorRuntime` preflight, native thread creation, exact connected OpenSlate MCP catalog and `runtime_started`.
4. Actual `turn/start` acknowledgment and `turn_started`, followed by a definitive failed turn after the intentional local HTTP 401. The final probe made **one loopback model request**, with request/stream retries disabled in its custom provider.

The first bounded turn probe used the native custom-provider retry defaults and made six loopback 401 requests before failure. The final probe made one. **Total real upstream/provider calls: zero; local model-endpoint requests across these runs: seven.** Earlier failed startup/configuration probes made no model requests. This proves protocol/configuration/bridge/turn-start compatibility, not GPT inference, ChatGPT entitlement or image generation. No authenticated ChatGPT sign-in exists in the disposable home; production account readiness, actual GPT output and a real generated image remain for the lead's explicitly scoped live acceptance.

Raw schemas and native evidence are under `/tmp/openslate-m1-evidence`; final passing native evidence is in `openslate-native-compat-Jkb88g/evidence.json`. The reproducible schema snapshot and probe sources are included in this change; disposable raw output is not tracked.

## Tests and review

**15 new test cases** cover binary priority/fallback/notices/missing-prefix instruction, new-film vs saved-model selection, historical receipt reconstruction/replay without another attempt or charge, current image runtime/model recording, stale-profile dispatch refusal, original-binary read-only history, strict unknown-feature handling and real-schema compatibility.

Existing current-pin fixtures/assertions were rewritten from `0.153.4` to `0.162.1`. Historical examples remain `0.153.4`, including the old image receipts, spending-display input and retained historical successful-check display. No integrity, unknown-outcome or no-double-charge test was deleted. Browser-test expectation strings were updated for the new default; no browser was launched.

The frozen old-film fixture is synthetic JSON rows plus tiny generated fixture PNG bytes, not a copied customer database/media file. Reopening it, native-receipt lookup, replay and resubmitting unchanged source preserve full receipt/lock/attempt/key records, spend/reservation totals and provider counters. A changed input under its old profile fails before a new attempt.

Self-review found and fixed three cross-file issues: historical code-film models were initially removed by the current-catalog equality check, preventing stable-key replay; and readiness fallback initially accepted a relative configured image path that server startup would reject. The final packaging check also found and fixed the nested npm platform-package lookup described above. Regression tests cover these boundaries. Final review also checked saved-vs-effective binary identity and history-only dispatch boundaries.

Verification results:

| Check | Result |
| --- | --- |
| `pnpm setup:test-media` / `pnpm check:toolchain` | Passed; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1, required encoders available. No download/install needed. |
| `pnpm build` | Passed, including the npm-layout fix. |
| Targeted files, `node scripts/run-tests.mjs ...` | 450 passed / 0 failed in the broad targeted pass; 112 passed / 0 failed after the npm-layout and host-isolation test updates. The additional historical binary recovery file also passed 9/9. |
| First `pnpm test` | 5,121 passed / 0 failed / 2 skipped (5,123 total). |
| Final `pnpm test` after npm-layout fix | **5,124 passed / 0 failed / 2 skipped (5,126 total)**; completed in 793.6 seconds. |
| `pnpm -r typecheck` | 5/5 workspace packages passed, zero type errors. |
| `pnpm typecheck` | Passed; builds the three packages and typechecks all 5/5 workspace packages, zero type errors. |
| `pnpm demo:code` | Passed; versions 1 → 2 → 3 → 4, two choices answered, four reused steps on edit, zero duplicate submissions, one lookup recovery, final state `done`. Placeholder media and prices only; no real film export or paid call. |
| `git diff --check` | Passed. |

The two full-suite skips are the installed decoder's unsupported animated WebP and the opt-in native no-turn probe. Explicit real-native compatibility was checked separately above. No timing-sensitive test failure has occurred; deterministic new-test fixture mistakes during implementation were fixed and rerun.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. No shared film-quality tool contract or web implementation files were changed. `codexNotice` is an additive field in Director setup/model responses, reusing the existing diagnostic shape, for the lead's UI follow-up.

## Lead follow-up / open issues

- Install `@openai/codex@0.162.1` into the versioned prefix using the documented exact command, then restart only after review. Keep the old prefix for any running process and original history recovery.
- Render `codexNotice` informationally in Settings. It must not be treated as `codexDiagnostic`/blocked readiness.
- The two `examples/live-provider-profiles*.example.json` files still advertise `runtimeVersion: "0.153.4"`; they are outside this card's owned paths and were left untouched. Before using those examples for a **new** catalog, set that runtime field to `0.162.1`, keep `directorModel: "gpt-6-astra"`, and choose the current profile explicitly. Existing saved locks stay immutable. Other dated design/live-validation documents continue to describe their historical version.
- An existing film locked to the retired image profile replays saved work, but a fresh image on that retired profile is refused until the person selects the updated installed profile. This preserves the old lock and exact step identities instead of silently replacing its input.
- Authenticated production inference/image acceptance and browser rendering are not claimed. No work was committed or pushed.

## Proposed conventional-commit split

No commit was made. Suggested split (stage the noted shared-file hunks separately):

### 1. feat(codex): support 0.162.1 and preserve saved image work

Files below. In `local-director.ts` and its test, leave the new-film model-default hunk/test for split 2. Web tests here only align current-version diagnostic fixtures.

- `apps/server/src/application/codex-binary.ts`
- `apps/server/src/application/local-director.ts`
- `apps/server/src/application/media-execution-runtime.ts`
- `apps/server/src/application/provider-catalog.ts`
- `apps/server/src/code-plan/models.ts`
- `apps/server/src/code-plan/provider-input.ts`
- `apps/server/src/execution/codex-image-execution.ts`
- `apps/server/src/execution/codex-image-receipts.ts`
- `apps/server/test/code-plan-providers-fixture.mjs`
- `apps/server/test/codex-binary.test.mjs`
- `apps/server/test/codex-image-execution-fixture.mjs`
- `apps/server/test/codex-image-execution.test.mjs`
- `apps/server/test/director-guidance-maintenance.test.mjs`
- `apps/server/test/director-start-refusals.test.mjs`
- `apps/server/test/installation-status.test.mjs`
- `apps/server/test/local-director.test.mjs`
- `apps/server/test/provider-catalog.test.mjs`
- `apps/web/test/next/settings-computer.test.mjs`
- `apps/web/test/next/settings-director.test.mjs`
- `apps/web/test/next/start-commands.test.mjs`
- `apps/web/test/next/store.test.mjs`
- `docs/implementation/MANUAL-LIVE-PRODUCTION.md`
- `packages/director/src/media/codex-image.ts`
- `packages/director/src/runtime/codex.ts`
- `packages/director/src/runtime/policy.ts`
- `packages/director/src/runtime/setup.ts`
- `packages/director/test/codex-image-fixture.mjs`
- `packages/director/test/codex-image-legacy.test.mjs`
- `packages/director/test/codex-image.test.mjs`
- `packages/director/test/runtime-fixture.mjs`
- `packages/director/test/runtime-images.test.mjs`
- `packages/director/test/runtime-setup-fixture.mjs`
- `packages/director/test/runtime-setup-skills.test.mjs`
- `packages/director/test/runtime-setup.test.mjs`
- `packages/director/test/runtime.test.mjs`
- `packages/providers/src/codex-image.ts`
- `packages/providers/test/codex-image-policy.test.mjs`
- `scripts/setup-readiness.mjs`
- `scripts/test/setup-readiness.test.mjs`
- `apps/server/test/codex-image-0.153.4-film.json`
- `apps/server/test/codex-runtime-upgrade.test.mjs`
- `packages/director/test/codex-image-binary.test.mjs`
- `packages/director/test/codex-protocol.test.mjs`
- `packages/director/test/fixtures/codex-protocol-0.162.1.json`
- `scripts/codex-protocol-schema.mjs`
- `scripts/probe-codex-compat.mjs`

### 2. feat(director): default new films to gpt-6.1-sol

- `apps/server/src/application/local-director.ts` — default-model hunk only.
- `apps/server/test/local-director.test.mjs` — new-film/saved-model regression only.
- `apps/web/src/next/fixtures/routes/computer.ts`
- `apps/web/src/next/fixtures/routes/settings.ts`
- `scripts/storyboard-review.mjs`
- `scripts/browser/next-start.mjs`
- `docs/ai/film-quality/reports/M1-report.md`

### File inventory

Modified: **43**. Added: **8**. Deleted: **0**. All changes stay within card ownership. No examples, shared contracts, other-card implementation or production web components were edited.

Added files:

- `apps/server/test/codex-image-0.153.4-film.json`
- `apps/server/test/codex-runtime-upgrade.test.mjs`
- `docs/ai/film-quality/reports/M1-report.md`
- `packages/director/test/codex-image-binary.test.mjs`
- `packages/director/test/codex-protocol.test.mjs`
- `packages/director/test/fixtures/codex-protocol-0.162.1.json`
- `scripts/codex-protocol-schema.mjs`
- `scripts/probe-codex-compat.mjs`
