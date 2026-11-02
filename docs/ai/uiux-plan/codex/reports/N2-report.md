# N2 — bind the Codex image worker to the verified private home

## Done

- **N2.1:** Readiness, preparation and the held image process now use the canonical private `CODEX_HOME` returned by `setupLocalCodex`, including its exact sign-in-link descriptor. New saved configurations bind that home and the verified environment digest. Structured `savedPath` output reads use its `generated_images` namespace, or the exact owned workspace.
- **N2.2:** Internal configuration version 2 distinguishes new private-home work from immutable version 1 history. Public prepared-session and server-receipt versions remain 1. Old configuration digests are neither rewritten nor relabelled; V1 lookup uses the original environment and personal output root. Neither configuration can borrow the other's output root. Lost prepared processes cannot be recreated, resumed or dispatched again. Missing/changed configurations remain unknown for the existing human release flow; durable never-dispatched proofs and local receipt/spool recovery remain unchanged.
- **N2.3:** The fake app-server now discovers synthetic MCP state from its actual `CODEX_HOME`. Personal servers are enabled while the private home has none. Regression coverage includes personal-server changes after cached setup, private output/reconstruction after sign-out, private instruction/configuration/alias drift, late V1 output, digest integrity and lost preparations.
- **N2.4:** Audited every other native launch path. No additional home mismatch required a fix; details below.

`--strict-config`, MCP-disabled validation, disabled skills, permission-profile comparison, no-network policy, binary/configuration digests, explicit filtered environment, bounded methods/deadlines, exact output-path checks and no-follow file ingestion remain. Private-home directory/instruction guards run before every new launch and before a held turn dispatch. Read-only recovery verifies the existing private directory without requiring current sign-in or repairing its link.

## Files

Changed:

- `packages/director/src/media/codex-image.ts`
- `packages/director/src/runtime/private-home.ts`
- `packages/director/test/codex-image-fixture.mjs`
- `packages/director/test/codex-image.test.mjs`
- `docs/implementation/STATUS.md`

Added:

- `packages/director/test/codex-image-legacy.test.mjs`
- `docs/ai/uiux-plan/codex/reports/N2-report.md`

Deleted: none. No `apps/web/**` source changed.

## Tests and verification

**Regression sensitivity:** executed the pre-fix `HEAD` image-worker source in a temporary module with the corrected fake home discovery. `checkReadiness()` returned `blocked`, `code: CODEX_IMAGE_MCP_UNEXPECTED`; `prepare()` threw that same code. Two setup launches used the private home with zero MCP names, and both subsequent image launches used the personal home with an enabled synthetic server. Zero turns were dispatched. Temporary module and fake homes were removed. This was synthetic Node fixture execution, not a real Codex process.

Added **23 tests**: 15 current-home regressions and 8 directly authored V1 snapshot regressions. Rewrote one existing output/reconstruction test to require the private namespace and recovery after removing the synthetic sign-in source. Strengthened the existing MCP-drift assertion to require `CODEX_IMAGE_MCP_UNEXPECTED`. No tests deleted or disabled.

Verification commands (run from this worktree):

```sh
pnpm setup:test-media
pnpm check:toolchain
pnpm build
node scripts/run-tests.mjs packages/director/test/codex-image.test.mjs packages/director/test/codex-image-legacy.test.mjs packages/director/test/runtime-setup.test.mjs packages/director/test/runtime.test.mjs packages/director/test/probe.test.mjs apps/server/test/codex-image-execution.test.mjs
pnpm test
pnpm -r typecheck
git diff --check
```

Toolchain setup/preflight and `pnpm build` passed with Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. The six-file focused gate passed **199/200**, zero failures/cancelled/todo and one optional native-probe skip. Final `pnpm test` passed **4,240/4,241**, zero failures/cancelled/todo and one optional native-probe skip (`opt-in native Codex probe never starts a model turn`). All **five** package/app typechecks passed. `git diff --check` and syntax checking of the report's readiness example passed. No unrelated failing test remains. The build retains its existing frontend chunk-size warning.

## Native entry-point audit

| Entry point | Discovery/configuration home and launch home |
| --- | --- |
| `runtime/setup.ts` | Private home in returned `options.env` is used by the version check and both discovery/verification processes. |
| `runtime/codex.ts`, `runtime/policy.ts` | Descriptor must match `env.CODEX_HOME`; preparation and version/app-server launches use those options. |
| `apps/server/src/application/local-director.ts` | Keeps setup's runtime options, including environment/descriptor, when changing only skill configuration. |
| `probe/run.ts` | Synthetic config and version/schema/app-server processes share one disposable isolated home. |
| `scripts/storyboard-review.mjs` | Delegates unchanged setup to the controller. Its native mode runs a real Director turn and is not a readiness command. |
| `scripts/setup-readiness.mjs` | Version-only check with no discovery, thread, turn or image operation; no discovery/launch split. |

## Offline readiness commands for the lead

The fixture command above verifies behavior without invoking any native Codex binary or accessing personal sign-in/configuration.

For the machine's actual pinned binary and account, the following read-only readiness command launches only version/setup/check RPCs. It creates no thread, starts no turn and generates no image. Run it from this worktree after `pnpm build`; the binary path below is the selected path recorded by D1, not newly verified by N2. Change the three explicit path arguments if the selected installation differs.

```sh
node --input-type=module - \
  "$HOME/.local/share/openslate-codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex" \
  "$HOME" "$HOME/.codex" <<'NODE'
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexImageWorkerTransport } from './packages/director/dist/index.js';
const [file, nativeHome, codexHome] = process.argv.slice(2);
const directory = await realpath(await mkdtemp(join(tmpdir(), 'openslate-n2-readiness-')));
const worker = new CodexImageWorkerTransport({
  command: { file }, nativeHome, codexHome, directory,
  env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, SHELL: '/bin/sh', NO_COLOR: '1', CI: '1' },
});
try {
  const readiness = await worker.checkReadiness();
  console.log(JSON.stringify(readiness, null, 2));
  if (readiness.status !== 'ready') process.exitCode = 1;
} finally {
  await worker.close();
  await rm(directory, { recursive: true, force: true });
}
NODE
```

The allowed readiness RPCs are `initialize`, `config/read`, `skills/list`, `account/read` with `refreshToken: false`, `model/list` and `modelProvider/capabilities/read`; initialization also sends `initialized`. The pinned tool permission profile has network disabled, but that does not establish that the native app-server itself makes no startup/catalog network requests. Use the fixture command for a strictly offline proof. The host reads no authentication contents or personal configuration values and prints only the sanitized readiness result. N2 did **not** run this machine/account command. A ready result establishes setup/readiness, not successful image generation.

## Contract changes

None to `packages/core/src/studio-api.ts` or public provider/receipt shapes. Only the backend's saved image configuration has a new V2 branch; V1 remains readable without migration. No schema/DDL changes.

## Review

Self-review and independent source/recovery/entry-point reviews found a prepare-to-start guard gap during implementation; it was fixed by verifying the private home before dispatch. Setup's exact sign-in descriptor is retained for new launches. Final diff review covered correctness, edge cases, callers, cross-file effects and test coverage; no outstanding must-fix issue remains.

## Commits

No commits made, as required by `RULES.md`. Proposed split:

1. `fix(director): bind image workers to the verified private Codex home`
   - `packages/director/src/media/codex-image.ts`
   - `packages/director/src/runtime/private-home.ts`
   - `packages/director/test/codex-image-fixture.mjs`
   - `packages/director/test/codex-image.test.mjs`
   - `packages/director/test/codex-image-legacy.test.mjs`
2. `docs(director): record N2 recovery and offline readiness verification`
   - `docs/ai/uiux-plan/codex/reports/N2-report.md`
   - `docs/implementation/STATUS.md`

## Open issues

- No implementation blocker. Real native readiness and image-generation acceptance were intentionally not run under this card's scope. The lead can run the exact read-only readiness command above; generation acceptance is separate.
- Decision: preserve V1 recovery in its original personal home under the existing read-only RPC allowlist. Do not migrate receipts or reinterpret an unknown outcome as never dispatched. Missing history/configuration/output remains unresolved until existing reconciliation or human release can act.
- Decision: V2 recovery may read existing private history after sign-out; it verifies directory/instruction integrity but does not recreate the home, demand authentication or repair a sign-in link. New readiness/preparation retain sign-in-link preparation.
