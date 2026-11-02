# F5 · Codex ignores ancestor project documents and configuration

Implemented November 2, 2026, in the existing isolated `codex/f5-project-docs`
worktree. No commit, push, branch switch, stash or reset. Only F5-owned source,
tests, the compatibility probe and this report changed. No browser, port 3001,
real provider, environment file, secrets directory, personal sign-in or
`.openslate/` data was used.

## Done

F5 now pins these supported Codex 0.162.1 settings in both Director launch and
shared native setup (which supplies every new image worker configuration):

```toml
project_doc_max_bytes = 0
project_doc_fallback_filenames = []
project_root_markers = []
```

The empty marker list treats the owned native working directory as the project
root. Parent repository `.codex/config.toml`, `.codex/skills` and `.agents/skills`
are no longer discovered. The zero document budget excludes project AGENTS
files; empty fallbacks remove alternative project-document names. Private
native homes, bundled/host skill reductions, exact catalog checks, named
permission profiles and the application bridge remain in place. Application
skill snapshots under the owned workspace still work.

Setup and Director preflight now verify all three effective settings. Image
preflight already compares its complete saved launch configuration, so it also
refuses drift in any of these settings. The Director's existing empty
`instructionSources` guard is unchanged, including start/resume handling. Image
preparation now has the same fail-closed check before handing out a prepared
session or reaching `turn/start`; unexpected, missing or malformed source
metadata retains the existing redacted `native_instructions_unexpected`
diagnostic shape.

New image configurations receive new content digests. Saved configurations and
read-only image recovery are not rewritten. Execution submission intent,
unknown-outcome reconciliation and no-resubmission rules are unchanged. The
server execution adapter already classifies a preparation refusal before its
durable dispatch marker, so no server execution source change was required.

## Real binary and offline before/after evidence

Used the installed native executable, reporting **codex-cli 0.162.1**:

`/Users/michael/.nvm/versions/node/v24.15.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`

Binary SHA-256:
`74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0`.

Generated the actual experimental App Server schema with disposable homes:

```sh
HOME=/tmp/openslate-f5-schema-home CODEX_HOME=/tmp/openslate-f5-schema-codex \
  /absolute/path/to/codex app-server generate-json-schema --experimental \
  --out /tmp/openslate-f5-schema
```

The generated protocol exposes `config/read` layers and the thread response's
`instructionSources`. Configuration keys are not an exhaustive typed schema in
that response; acceptance of the three settings was verified by the real
`--strict-config` parser and effective `config/read`, rather than inferred from
the protocol schema alone. For reproducibility:

- `v2/ConfigReadResponse.json` SHA-256: `4ec77e1a3eed746037149799c3b6bb8fe7b4b593e5930fc9f410e6282de9df50`.
- `v2/ThreadStartResponse.json` SHA-256: `107fe36c99ebaeb750a371580beec807a28c6451e9c8a02cd7d451a0135f1c91`.

Ran the updated `scripts/probe-codex-compat.mjs` with that absolute binary. It
creates disposable HOME/CODEX_HOME directories and a temporary Git repository,
with its native workspace at `repository/data/test-runs/probe/native`. Synthetic
fixtures include root `AGENTS.md`, an intermediate `FALLBACK.md`, two ancestor
`.codex/config.toml` files and skills in both ancestor skill namespaces. Project
trust is explicit so the control does not merely skip an untrusted config.

| Native check | Instruction sources | Ancestor project config layers | Ancestor skills |
| --- | --- | --- | --- |
| Discovery enabled control | root `AGENTS.md`, intermediate `FALLBACK.md` | 2 | 2 enabled |
| Existing zero document budget alone | empty | 2 | 2 enabled |
| New Director configuration | empty | 0 | 0 |
| New image configuration/thread preflight | empty | 0 | Excluded by the same project-root setting; image RPC has no `skills/list` method |

The parent config's `model_verbosity = "low"` sentinel disappears in both after
checks, and every isolation setting is read back exactly. Image thread preflight
uses the worker's workspace-write/native-binary-read permission shape, built-in
image feature and forced ChatGPT login configuration, with its OpenAI base URL
redirected to loopback. No image turn is started. The full Director adapter
then verifies its bridge/catalog, preserves a newly added pinned application
skill, reaches `runtime_started` and `turn_started`, and receives the deliberate
local HTTP 401. Its definitive failed turn is the expected offline result.

The initial before-control attempt hit the outer macOS sandbox's refusal to
nest `sandbox-exec` while reading a denied ancestor (`sandbox_apply: Operation
not permitted`); it made no model request. The updated probe source uses a
read-only filesystem control for that one thread-only before case. Network and
writes remain denied, and there is no turn. Every after check and the Director
adapter retain their actual restricted permission profiles. An unchanged second
diagnostic attempt confirmed the same sandbox restriction before this control
was adjusted.

The real binary showed that the already-present zero document budget suppresses
project instruction sources in this synthetic case, but does **not** stop
ancestor config/skill discovery. This report therefore does not claim an exact
reproduction or reconciliation of V2's historical unknown image receipt. That
receipt and its possible subscription usage remain untouched.

Final native evidence:
`/private/var/folders/th/qdj8_39j7wx062tcx9pvccb40000gn/T/openslate-native-compat-p3gjqv/evidence.json`.
Probe stdout: `/tmp/openslate-f5-native-probe.log`. Raw schemas:
`/tmp/openslate-f5-schema/`. The preceding passing probe is retained in
`openslate-native-compat-KFu1eN/evidence.json` under the same temporary parent.
Across both passing probes: **2 loopback model requests, 0 upstream provider
calls, 0 image turns**. Earlier discovery experiments and failed controls made
zero model requests. No unknown provider outcome was retried.

## Tests and verification

Added **12 regression cases**: three effective-setting drift failures each for
Director, shared setup and image preflight; plus image preparation refusals for
injected, missing and malformed instruction sources. Existing Director injected
source tests still cover start/resume, redacted metadata and pre-dispatch
refusal. No test was deleted or weakened. Fixtures now include the real thread
response's empty instruction-source array on successful image preparation.

| Check | Actual result |
| --- | --- |
| `pnpm setup:test-media` | Exit 0; matching installed binaries reused |
| `pnpm check:toolchain` | Exit 0; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required media support |
| `pnpm build` | Exit 0; 5 workspace builds, existing Vite chunk/dynamic-import warnings |
| `node scripts/run-tests.mjs packages/director/test/runtime.test.mjs packages/director/test/runtime-setup.test.mjs packages/director/test/codex-image.test.mjs` | Exit 0; **168 passed, 0 failed, 0 skipped** |
| Updated real-native offline compatibility probe | Exit 0; before/after, effective settings, image thread and full Director start verified |
| `pnpm test` | Exit 0; **5,260 passed, 0 failed, 1 skipped; 5,261 total**, 1,231,232.725125 ms |
| `pnpm typecheck` | Exit 0; **5/5 workspace typechecks**, zero errors |
| `pnpm -r typecheck` | Exit 0; **5/5 workspace typechecks**, zero errors |
| `git diff --check` and new-report whitespace check | Passed at final review |

Logs: `/tmp/openslate-f5-build.log`, `/tmp/openslate-f5-touched-tests.log`,
`/tmp/openslate-f5-full-test.log`; typecheck logs are `/tmp/openslate-f5-typecheck.log` and
`/tmp/openslate-f5-recursive-typecheck.log`. The full run had no timing-sensitive
failure, so no file-level retry was needed. Its one skip is the optional
`opt-in native Codex probe never starts a model turn`; F5 ran the explicit
real-native offline compatibility probe separately above. The final quiet
portion completed the existing skills-release validation; no other session
or test process was stopped.

## Self-review

Reviewed the source/test/probe diff for launch precedence, start/resume guards,
image preparation/dispatch boundaries, historical configuration identity,
callers and cross-file effects. Review identified that the offline proof should
also preserve an explicitly pinned application skill and use the image worker's
actual permission shape; both checks were added and the real probe passed.
No important unresolved implementation defect was found. No browser or live
acceptance claim is inferred from the offline tests.

## Files and proposed commits

Changed:

- `packages/director/src/runtime/policy.ts`
- `packages/director/src/runtime/setup.ts`
- `packages/director/src/runtime/codex.ts`
- `packages/director/src/media/codex-image.ts`
- `packages/director/test/runtime-fixture.mjs`
- `packages/director/test/runtime-setup-fixture.mjs`
- `packages/director/test/codex-image-fixture.mjs`
- `packages/director/test/runtime.test.mjs`
- `packages/director/test/runtime-setup.test.mjs`
- `packages/director/test/codex-image.test.mjs`
- `scripts/probe-codex-compat.mjs`

Added: `docs/ai/film-quality/reports/F5-report.md`. Deleted: none.

Suggested single conventional commit for the lead:
`fix(codex): isolate native workspaces from ancestor project instructions`,
containing all files above and this report. **No commit was made.**

## Contract changes and open issues

Contract changes: **none** to `packages/core/src/studio-api.ts`, the plan API,
tool contracts or persistence schema.

Authenticated ChatGPT readiness and a generated image are deliberately
unverified: the disposable home has no sign-in, and card rules prohibit real
providers. The probe verifies image config and empty thread preparation only.
The V2 historical unknown receipt still requires separate reconciliation; do
not retry it blindly. The full suite and both typecheck commands passed, as
recorded in the verification table.
