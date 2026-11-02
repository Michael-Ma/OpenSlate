# F5b · Private Codex homes retain no inherited project trust

Implemented November 2, 2026, in `codex/f5b-trust`. No commit, push, branch
switch, stash or reset. All changes are within F5b's source/test ownership and
this report. No browser, port 3001, real provider, personal credentials,
environment file, secrets directory or `.openslate/` data was used.

## Done

`preparePrivateCodexHome` now removes an existing regular `config.toml` before
each launch, including repeated setup and cached image-worker preparation. It
does not parse or copy any settings from the selected native home. This removes
old project trust, all other tables and top-level settings together. A config
symlink or directory remains an error; the linked target is untouched. Directory
alias checks run before cleanup. Other private instruction/settings inputs are
still refused. Read-only verification requires a config-free private home and
continues to work without sign-in; it never repairs authentication or dispatches
a model turn.

Every new setup, Director launch and image configuration explicitly pins:

```toml
[projects."<exact application workspace>"]
trust_level = "untrusted"
```

This table is an application-written CLI override, not a file copied from the
owner. Each image workspace gets its own exact entry rather than inheriting the
setup projection's entry. Setup and Director preflight compare the complete
effective project map; the image worker's existing complete-config comparison
checks it too. Unexpected trusted entries or extra projects are refused. The
existing F5 discovery settings and empty `instructionSources` guards on Director
start/resume and image preparation remain in force.

Authentication is unchanged: `auth.json` is still a symlink to the selected
owner login, including an already linked source. Credential bytes are neither
opened nor copied by private-home preparation. Existing auth-link repair,
missing-login and signed-out image-history tests remain in the suites.

New image configuration digests include the new workspace trust override.
Historical configuration/receipt files are not rewritten; legacy read-only
recovery, durable dispatch markers, unknown-outcome reconciliation and replay
rules are preserved. An old config-contaminated home is cleaned by the next
setup/preparation; read-only lookup alone refuses contamination rather than
repairing the home or resubmitting work.

## Root cause and real-native evidence

The inspected implementation does **not** copy the owner's `config.toml`.
The real binary independently writes the same trust entry: a persistent image
thread using the worker's workspace-write permission profile auto-trusts the
containing Git root. The previous verifier allowed native trust records only
inside the application root; Git-root trust outside that root would fail
subsequent private-home verification. That refusal is also classified as
`native_instructions_unexpected`; the category alone does not prove a thread
loaded project instructions. Pinning the application workspace
untrusted prevents this native write; cleanup also repairs existing homes.

Binary used:

`/Users/michael/.nvm/versions/node/v24.15.0/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`

Version: `codex-cli 0.162.1`. SHA-256:
`74c6a6d263f40d65f99c27a815275f5b4ed0bcc2baecc396b4cf3255498bdfc0`.

The updated `scripts/probe-codex-compat.mjs` creates a disposable HOME and
source Codex home whose config trusts a temporary Git repository. That
repository contains root `AGENTS.md`, ancestor configs/fallback instructions and
ancestor skills, with the application workspace inside `repository/data/`.
It seeds the private home with the synthetic source trust config, then tests
existing-home cleanup and actual persistent native threads. Every endpoint is
a loopback refusal server; no real login or image turn is used.

| Native check | Instruction sources | Private `config.toml` after thread |
| --- | --- | --- |
| Trusted-source/private-copy control, discovery enabled | Root `AGENTS.md` and intermediate `FALLBACK.md` | Synthetic trusted Git-root entry retained |
| F5 settings with that trusted private config | Empty | Trusted entry retained |
| Clean home, F5 settings, persistent image workspace-write profile, no trust pin | Empty | Codex writes the trusted Git-root entry itself |
| F5b cleanup and explicit untrusted workspace, persistent Director thread | Empty | Absent |
| F5b cleanup and explicit untrusted workspace, persistent image thread | Empty | Absent |

**Reproduction limit:** the requested V3 inherited-instruction failure was not
reproduced with the F5 zero document budget in this disposable fixture. Both
before and after that exact setting report empty sources, even when the private
home trusts the repository. The discovery-enabled control shows the inherited
source and the final threads show none, but this is not claimed as an exact
before/after reproduction of V3. The native trust-file creation and its
prevention were reproduced directly. The historical V3 data was not inspected
or changed under the card's data-access rules.

The passing probe additionally verifies zero ancestor config layers/skills,
unchanged source config/auth link, exact effective isolation/project settings,
the named permission profile and a pinned application skill. The full Director
adapter reaches MCP readiness and `turn_started`, then receives the intentional
local HTTP 401. All discovery and image-thread checks make zero requests; the
full adapter makes exactly one loopback model request and fails definitively.

Passing evidence:
`/private/var/folders/th/qdj8_39j7wx062tcx9pvccb40000gn/T/openslate-native-compat-taKLQn/evidence.json`.
Stdout: `/tmp/openslate-f5b-native-probe-final.log`.

Additional bounded offline experiments: the unchanged F5 probe passed once
(`openslate-native-compat-IumbHl`, one loopback refusal); two four-variant,
thread-only investigations made zero requests (read-only vs workspace-write,
trusted/clean/untrusted workspace/untrusted repository); the first updated probe
attempt used the Director's read-only profile for the auto-trust assertion and
failed with no request (`openslate-native-compat-OlsFk0`). Correcting that
experiment to the image worker's actual workspace-write profile passed once
(`openslate-native-compat-VacbvV`); final review then applied that same profile
to the trusted-home F5 control (`openslate-native-compat-QD8Qis`, passed), and
aligned every image control's provider/login/image-feature overrides before
the final passing run above. Total: **4 loopback model requests, 0 upstream provider
calls, 0 image turns**. No unknown outcome was retried.

## Tests and verification

Added three trust-drift refusal cases (setup, Director and image preflight),
a cached-image cleanup case, and a separate config-alias/directory refusal
case. Rewrote the old accepted-private-trust test to require cleanup on the next
setup and every preparation. Expanded Director auth repair to cover old trust
cleanup on repeated turns. Replaced the two image readiness/preparation tests
that expected regular config drift to block: F5b now requires those boundaries
to clean it. Start/lookup still refuse unexpected post-preparation config drift.
No money, integrity or uncertain-outcome protection was deleted.

| Check | Actual result |
| --- | --- |
| `pnpm setup:test-media` | Exit 0; matching installed FFmpeg/ffprobe reused |
| `pnpm check:toolchain` | Exit 0; Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required media/font support |
| `pnpm build` | Exit 0; 5 workspace builds; existing Vite chunk/dynamic-import warnings |
| `node scripts/run-tests.mjs packages/director/test/runtime.test.mjs packages/director/test/runtime-setup.test.mjs packages/director/test/codex-image.test.mjs` | Exit 0; **171 passed, 0 failed, 0 skipped** |
| Updated real-native offline compatibility probe | Exit 0; results above |
| `pnpm test` | Exit 0; **5,273 passed, 0 failed, 1 skipped; 5,274 total**, 1,296,746.949 ms |
| `pnpm typecheck` | Exit 0; **5/5 workspace typechecks**, zero errors |
| `pnpm -r typecheck` | Exit 0; **5/5 workspace typechecks**, zero errors |
| `git diff --check` and new-report whitespace check | Passed at final review |

Logs: `/tmp/openslate-f5b-build.log`, `/tmp/openslate-f5b-touched-tests.log`,
`/tmp/openslate-f5b-full-test.log`, `/tmp/openslate-f5b-typecheck.log` and
`/tmp/openslate-f5b-recursive-typecheck.log`. No timing-sensitive test failed,
so no file-level retry was needed. The one skip is the optional
`opt-in native Codex probe never starts a model turn`; the explicit offline
native compatibility probe above ran separately. The quiet final portion was
the existing skills-release validation, which also passed.

## Self-review

Reviewed the source/test/probe diff for existing-home repair, filesystem aliases,
authentication-link behavior, concurrent cleanup, config precedence, per-image
workspace identity, instruction guards and historical recovery. The review
caught that a persistent thread's auto-trust control must use the image worker's
workspace-write profile; the corrected native check passes. Explicit pinned
application skills still work in the untrusted workspace. No further important
implementation issue was found. Full-suite results are recorded above.

## Files and proposed commits

Changed:

- `packages/director/src/runtime/private-home.ts`
- `packages/director/src/runtime/setup.ts`
- `packages/director/src/runtime/codex.ts`
- `packages/director/src/media/codex-image.ts`
- `packages/director/test/runtime-setup-fixture.mjs`
- `packages/director/test/runtime-setup.test.mjs`
- `packages/director/test/runtime-fixture.mjs`
- `packages/director/test/runtime.test.mjs`
- `packages/director/test/codex-image-fixture.mjs`
- `packages/director/test/codex-image.test.mjs`
- `scripts/probe-codex-compat.mjs`

Added: `docs/ai/film-quality/reports/F5b-report.md`. Deleted: none.

Suggested single commit for the lead:
`fix(codex): clear private-home trust and pin workspaces untrusted`, containing
all files above. **No commit was made.**

## Contract changes and open issues

Contract changes: **none** to `packages/core/src/studio-api.ts`, plan/tool APIs
or persistence schema.

Exact V3 instruction-source reproduction remains unresolved as described above.
Authenticated readiness and generated-image acceptance require the lead's
separate live run; this task used synthetic auth tests and offline native
thread checks only. No historical uncertain media receipt was retried.
