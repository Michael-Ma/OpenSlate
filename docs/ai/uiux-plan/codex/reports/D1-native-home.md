# Done

- **D1.1 — private home:** setup creates `native/<project>/runtime/director-home` under installation storage. Its only studio-created file is an `auth.json` symlink to the selected Codex home's `auth.json`. The studio uses filesystem metadata only, never opens or copies credential bytes, and repairs missing, redirected or regular-file replacements. Missing selected homes, missing sign-ins, directories and dangling auth links give `SETUP_AUTH_REQUIRED`. Canonical path/alias checks keep the home separate from projections, immutable skill snapshots, native state, logs and selected authentication storage.
- **D1.2 — refusal and explanation:** the instruction-source guard remains before `turn/start`, including resume. It retains bounded, printable file/folder identities, redacts the person's home to `~`, and drops source contents and arbitrary native fields. The safe diagnostic is persisted on its own turn and projected through both current Director status and historical snapshot turns. Exact requested English/Chinese copy appears in the conversation, fallback header and Settings. A later cleanup/event-consumer failure retains previously detected instruction evidence.
- **D1.3 — setup/selection/turn parity:** the selected sign-in home stays the user's saved selection; setup returns the private launch environment and a backend-only preparation descriptor. Setup checks it before each native subprocess; the runtime checks it again for each turn. Existing installations therefore adopt it on their next process start without changing saved selections or requiring migration/person action. `skills.bundled.enabled=false` prevents the pinned binary from installing builtin instruction files into the private home; setup and turn preflight verify that setting. Existing exact catalog/policy checks remain.
- **D1.4 — tests/evidence:** regressions cover personal instruction files and a selected auth symlink, private-home launch, per-turn and between-setup-session link repair, metadata-only credential handling, missing sign-in, path aliases, instruction/config contamination, unexpected runtime sources, redaction, durable projection and bilingual copy. Existing native and money/integrity tests remain enabled.

## Real pinned-binary evidence

Verified `/Users/michael/.local/share/openslate-codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`: exact output `codex-cli 0.153.4`. The default PATH binary is a different version and was not used for compatibility evidence. The disposable harness was `node /private/tmp/d1-linked-auth-probe/probe.mjs`; all credentials were synthetic and removed afterward. The probes did not access personal Codex configuration, instruction or sign-in files; no personal token was read/copied/printed.

- `login status` and app-server `initialize` → `account/read {refreshToken:false}` recognized linked ChatGPT auth with **zero HTTP requests**.
- `account/read {refreshToken:true}` refreshed through `CODEX_REFRESH_TOKEN_URL_OVERRIDE` pointed at an ephemeral `127.0.0.1` `/oauth/token` stub. `lstat`/`readlink` confirmed the private link survived; synthetic backing-file comparisons confirmed the refreshed values reached the selected target. A two-link chain (private → selected → synthetic backing file) also preserved both links and updated the backing file.
- `thread/start` with `project_doc_max_bytes=0` reported a selected-home `AGENTS.md` as an absolute **string** source; the private home reported `instructionSources: []`. Both real strings and earlier object-path fixtures are handled safely.
- Without the bundled-skills setting, the binary installed `skills/.system` despite `features.skip_host_skill_discovery=true`. With `skills.bundled.enabled=false`, `config/read` confirmed the override, forced `skills/list` returned zero skills/errors, and no skills directory appeared after thread start. With external state/log directories and shell snapshots disabled, only native runtime bookkeeping (`.sandbox_migration`, `installation_id`, `tmp`) and the auth link appeared.
- Total bounded synthetic probes: **6 app-server processes, 6 successful loopback refresh POSTs, 5 thread starts, 0 turn starts, 0 model/provider calls**. No external-network request occurred. Refresh testing necessarily used the permitted loopback stub; the read-only auth checks used no network at all. No unknown outcome was retried.

# Files

Added:

- `packages/director/src/runtime/private-home.ts`
- `apps/web/test/next/d1-native-diagnostic.test.mjs`
- `docs/ai/uiux-plan/codex/reports/D1-native-home.md`

Changed:

- `packages/core/src/studio-api.ts`
- `packages/director/src/runtime/setup.ts`
- `packages/director/src/runtime/policy.ts`
- `packages/director/src/runtime/codex.ts`
- `packages/director/src/runtime/native-diagnostic.ts`
- `packages/director/test/runtime-setup.test.mjs`
- `packages/director/test/runtime-setup-fixture.mjs`
- `packages/director/test/runtime.test.mjs`
- `packages/director/test/runtime-fixture.mjs`
- `packages/director/test/native-startup.test.mjs`
- `packages/director/test/codex-image.test.mjs`
- `apps/server/src/application/director-supervisor.ts`
- `apps/server/src/application/director-turn-view.ts`
- `apps/server/src/application/native-diagnostics.ts`
- `apps/server/test/director-supervisor.test.mjs`
- `apps/web/src/next/i18n/catalog/errors.ts`
- `apps/web/src/next/i18n/translate.ts`
- `apps/web/src/next/model/types.ts`
- `apps/web/src/next/model/director.ts`

Deleted: none. The four named web source files are explicitly permitted by D1. The image test's only change supplies a temporary synthetic auth marker for the shared setup precondition; image-worker production behavior is unchanged. No frozen catalog/skill, DDL, shipped migration or implementation status file changed.

# Tests

**25 regression cases added**, one existing exact setup-launch assertion rewritten because its selected-home behavior is replaced by private-home launch. No tests deleted, disabled or weakened. Existing replay, unknown-outcome, stale-authority and charging/integrity protections were checked and retained.

- `pnpm setup:test-media` and `pnpm check:toolchain`: passed, Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**.
- Final `pnpm build`: passed all five workspace packages/apps. The existing Vite large-chunk warning remains informational.
- Final targeted command: `node scripts/run-tests.mjs packages/director/test/runtime-setup.test.mjs packages/director/test/runtime.test.mjs packages/director/test/native-startup.test.mjs packages/director/test/codex-image.test.mjs apps/server/test/director-supervisor.test.mjs apps/server/test/local-director.test.mjs apps/web/test/next/d1-native-diagnostic.test.mjs apps/web/test/next/native-diagnostics.test.mjs apps/web/test/next/director-parity.test.mjs` — **258 passed, 0 failed/cancelled/skipped/todo**.
- Initial root targeted run: **146 passed, 1 failed**. New test `D1 a refused current turn explains its cause under the matching message and suppresses the duplicate header` inherited fake mode, which correctly displayed the scripted-mode line. Its isolated rerun reproduced **6 passed, 1 failed**. Corrected the test fixture to native mode; the three related web files then passed **42/42**, and the final 258-test run passed. No production workaround or assertion weakening was used.
- Final `pnpm test`: **3,926 passed, 0 failed/cancelled/todo, 1 skipped (3,927 total)** in 320.724 seconds. The skip is the existing `opt-in native Codex probe never starts a model turn`; the bounded manual pinned-binary checks above supply this card's separate native evidence.
- Final `pnpm -r typecheck`: **all five packages/apps passed**, zero failures.

Self-review used ordinary file diffs against temporary pre-edit copies; an independent review checked native dispatch ordering, metadata boundaries, persisted/request-scoped projection and browser mappings. Review found and fixed missing-selected-home error handling, link drift between setup sessions, the pinned source-string shape, bundled-skill installation, malformed metadata controls/path segments and loss of instruction evidence during cleanup. A final independent integration review found no material remaining issue; all 22 changed/added files also passed a whitespace check. No outstanding must-fix issue remains. No browser was launched.

# Contract changes

`packages/core/src/studio-api.ts`: added NativeDiagnostic category `native_instructions_unexpected` and optional `instructionFiles?: string[]` (at most 32 printable file paths, at most 4096 characters each, home redacted to `~`). No other shared contract changed. Internal web current/historical turn types now accept that diagnostic; server JSON turn entities persist it without DDL.

# Commits

No commits or other Git mutations made; the lead owns review and commits. Proposed conventional split:

1. `fix(director): use a private native home with linked sign-in` — `packages/director/src/runtime/{private-home.ts,setup.ts,policy.ts}`, `packages/director/test/{runtime-setup.test.mjs,runtime-setup-fixture.mjs,codex-image.test.mjs}`.
2. `fix(director): explain inherited instruction refusals` — `packages/core/src/studio-api.ts`, `packages/director/src/runtime/{codex.ts,native-diagnostic.ts}`, `packages/director/test/{runtime.test.mjs,runtime-fixture.mjs,native-startup.test.mjs}`, `apps/server/src/application/{director-supervisor.ts,director-turn-view.ts,native-diagnostics.ts}`, `apps/server/test/director-supervisor.test.mjs`, all five listed web files, and this report. Both parts form one reviewable D1 delivery; validate the combined changes before merging.

# Open issues

- No implementation blocker. The lead's one owner-authorized real Director turn remains the live acceptance step specified by the card. No production process/state, port 3001, browser, real model or real media provider was used here.
- Decision: private-home instruction/settings contamination fails closed with `SETUP_INSTRUCTIONS_UNEXPECTED`; it is not silently removed. Studio-owned sign-in links are repaired automatically. Runtime bookkeeping from the trusted binary may persist, while instructions, config, prompts, rules, skills and plugins are rejected.
- Decision: missing or malformed source metadata uses localized copy without a file list; Director-specific no-send/no-charge copy is not reused for image failures. File evidence is bounded/deduplicated, rejects control/bidi characters and traversal, and retains no contents.
- Decision: the image adapter retains its existing selected-home policy/output behavior; D1 changes the Director and its shared setup precondition. Its existing 40 native-image tests remain in targeted/full verification.
