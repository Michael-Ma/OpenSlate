# M3 · Codex 0.170.0 and GPT‑6.2

## Done

M3.1 pins both the Director and new Codex image turns to 0.170.0. A matching configured executable wins. A mismatched configured executable falls back to the verified versioned install and produces a notice. The manual and doctor give the exact side-by-side install command. The 0.170.0 npm package was installed offline from cached tarballs into the worktree for the probes. The owner's 0.162.1 installation supplied the comparison binary. The throwaway install, caches, probe homes and temporary data were removed after verification.

The catalog and doctor recognize exactly the two historical image runtimes, 0.153.4 and 0.162.1. Startup validates the whole profile after substituting the current runtime in memory and names the affected profile in its notice. Other mismatches retain their existing validation. Existing code films preserve the original profile digest for admission and step keys. A changed image prompt can dispatch on the installed runtime when the locked profile matches in every other respect. Receipt verification also recognizes the historical 0.153.4 lock with a 0.162.1 worker. History lookup uses the recorded executable and verifies its hash and configuration.

M3.2 defaults new native Director selections to `gpt-6.2-sol` at the existing high effort. Settings continues to get visible models from the selected runtime's catalog. The browser fixture offers both GPT‑6.2 choices first. Reopen tests cover saved `gpt-6.1-sol` and `gpt-6-astra` selections. New Codex images record 0.170.0 and `gpt-6-astra`.

## Real-binary schema comparison

Both npm launchers ran `app-server generate-json-schema --experimental` with disposable native homes. The regenerated old snapshot matched the checked-in 0.162.1 fixture byte for byte. The structural comparison identified changes in 5 existing root schemas and 14 existing nested definitions. The new fixture contains 30 schema roots, each with its raw source hash, and all 161 referenced definitions (150 before). Its SHA-256 is `1684e491d7defda4f7c9ec5c0ed1e1ae5bf65d643e793c23ec43e827aa6596e0`.

| Adapter surface | 0.162.1 → 0.170.0 evidence and handling |
| --- | --- |
| JSONL transport, `initialize`, `initialized` | Client request methods increased from 170 to 184. All 170 prior methods remain. The 11 server request identities and the single client notification are identical. Initialize capabilities add optional `requiredHumanApproval`. The bounded stdio transports retain their explicit method lists. |
| `config/read`, `skills/list` | Config adds optional `client_search_provider`. The skill request, path, enabled flag and errors retain their shapes. Real preflight checked effective permissions, feature flags, instruction discovery and the bridge configuration. |
| `account/read`, `model/list` | Account responses add optional `userId`, ChatGPT accounts add optional `workspaceName`, and the account union adds GCP. Plan types add `sci` and `sci_plus`. Model listing adds an optional provider filter. Existing identity, visibility, label, effort and pagination fields retain their shapes. |
| `mcpServerStatus/list` | Status adds optional `toolListMeta`. The real Director verified the connected OpenSlate server and its exact tool catalog. |
| `thread/start`, `thread/resume`, `thread/read` | Thread metadata adds optional `attachedToThreadId`. Read responses add optional `readState`. The named profile, instruction sources, legacy history, IDs and turns used by the adapters retain their shapes. Director and image thread start were exercised on the binary. Resume and saved image history were exercised with fixtures. |
| `turn/start`, `turn/interrupt`, `modelProvider/capabilities/read` | Turn start adds optional `responsesapiClientMetadataPatch`. Audio input admits a file ID as well as a URL. OpenSlate emits text, skill and image inputs. Interrupt and the image-generation capability check retain their shapes. |
| `turn/started`, `turn/completed`, `item/started`, `item/completed`, `item/tool/requestUserInput` | All consumed methods retain their names. Server notifications increased from 84 to 86 with read-state and section changes. Completed items can report `contentTokenCount`, and thread items can carry their own timestamps. The existing question, reasoning and tool-activity projections remain valid. |
| `agentMessage` | New optional moderation display metadata can suppress the text. The Director excludes hidden or blocked messages, and moderated messages without an explicit show decision, before emitting or collecting assistant text. |
| `imageGeneration` | The required image source is now a union of `result` and `fileId`. Optional `generationId` and observed `inputImages` describe the generation. The worker accepts inline PNG or the exact bounded `savedPath` for an attachment. It compares the attachment ID across completion messages. An ID without readable bytes stays unresolved. A file ID is never interpreted as a filesystem path or fetched from a provider. |

Other transitive changes add optional context names, retained tool output, encrypted response content, output-text annotations/log probabilities, several response statuses, and the error variants `policyCapacityUnavailable` and `modelNotFound`. These fields do not enter application state, image inputs or receipt digests. The global client-request schema SHA-256 changed from `f1425525dae2903cb5b658ee412530ff7a8fcaf78887f182c169b299e7f6b09b` to `65732f3423753191ce8565e43b7b4f54a3545f47d55db9f41689fb1bd8eb5820`.

## Native preflight and model catalog

The 0.170.0 binary ran `debug models --bundled` and the app-server returned the following catalog through `model/list` with hidden entries included. The disposable home had no signed-in account. A separate bundled-catalog query against the old 0.162.1 binary returned zero GPT‑6.2 entries.

| Visibility | In app-server order within each group |
| --- | --- |
| Visible (11) | `gpt-6.2-sol`, `gpt-6.2-astra`, `gpt-6.1-terra`, `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5` |
| Hidden (3) | `gpt-daybreak-blue-latest`, `gpt-daybreak-red-latest`, `codex-auto-review` |

The reproducible native check is `node scripts/probe-codex-compat.mjs ABSOLUTE_BINARY EXISTING_EVIDENCE_DIRECTORY --preflight-only`. It uses synthetic credentials and an isolated loopback refusal endpoint. All 22 disabled features read back false. An unknown disabled feature was omitted before strict startup. The production preflight verified the required enabled flags, the exact named permissions, project isolation, pinned skill discovery and MCP catalog. The Director and image threads both returned empty instruction sources with the production isolation settings. The Director reached `runtime_started` and cancelled before dispatch, with 0 turns, 0 requests to the refusal endpoint and 0 real provider calls.

## Tests and self-review

Two synthetic frozen completed films exercised the production journal and receipt validators. The 0.162.1 fixture was captured from baseline `bde07cb1` with a 16 × 16 PNG and fake transports. Each film replayed and re-submitted its original source with 0 new attempts and 0 additional spend. Changing one image prompt created exactly 1 current-runtime attempt in each film. Assertions compare the old journal keys, prices, inputs, locks, receipts, reservations and spend across restart. Further tests retain pending-turn reconciliation and historical lookup against the original hashed binary.

Self-review found two upgrade edges beyond swapping version strings. Receipts created by the previous upgrade need the intermediate forward version pair. Also, the synthetic worker's global dispatch count included historical markers when replaying a saved film. The fixture now checks the marker for the exact attempted thread and detects a second start on that thread.

| Check | Result |
| --- | --- |
| Pinned toolchain | Node 24.15.0, pnpm 10.33.0, FFmpeg and ffprobe 8.1.1. Media setup used installed tools. |
| `pnpm build` | 5 packages passed, 0 failed. Existing Vite chunk-size and mixed-import warnings. |
| `node scripts/run-tests.mjs` on all 22 modified test files | 444 passed, 0 failed, 0 cancelled, 0 skipped. The final run used no test-name filter. |
| `pnpm -r typecheck` | 5 packages passed, 0 failed, 0 type errors. |
| `pnpm demo:code` | 1 offline flow passed. Versions 1 → 2 → 3 → 4, 2 choices answered, 4 reused steps on edit, 1 lookup recovery, 0 duplicate submissions, final state `done`. Fixture spend $0.40 of $4.00. |
| `git diff --check` | Passed. |

Nine added cases cover the second frozen film, original-binary recovery, startup/doctor and saved-model variants, forward-only version pairs, attachment-only completion and unresolved output, and message display restrictions. Existing pin, protocol and model expectations were updated. No tests were deleted. The existing launcher-template test ran with a test-only filesystem shim that redirected its two disposable filenames to `synthetic-template.txt` and `synthetic-settings.txt`. This exercised template creation, permissions and preservation of existing content. Literal on-disk dotenv filenames were outside the permitted check. The M3 doctor tests ran with ordinary filesystem I/O for both historical runtime versions.

## Contract changes

None in `packages/core/src/studio-api.ts`.

## Open issues

The lead owns the full suite, the side-by-side home install, and the signed-in Director turn. A signed-in account's model entitlement, inference, image delivery and quota were outside the offline check. For a file-ID-only image without a usable saved path, recovery can only wait for readable evidence. The two example provider JSON files outside M3 ownership still declare 0.162.1 and will trigger the tested upgrade notice.

## Files and proposed commit

One proposed commit, `feat(codex): support 0.170.0 and default new films to GPT-6.2`, covers the runtime and its version-dependent Director default together. No commit was created. The complete file list follows.

### Modified (43)

- `apps/server/src/application/local-director.ts`
- `apps/server/src/code-plan/models.ts`
- `apps/server/src/execution/codex-image-execution.ts`
- `apps/server/test/code-plan-providers-fixture.mjs`
- `apps/server/test/codex-binary.test.mjs`
- `apps/server/test/codex-image-execution-fixture.mjs`
- `apps/server/test/codex-image-execution.test.mjs`
- `apps/server/test/codex-runtime-upgrade.test.mjs`
- `apps/server/test/director-guidance-maintenance.test.mjs`
- `apps/server/test/director-start-refusals.test.mjs`
- `apps/server/test/installation-status.test.mjs`
- `apps/server/test/local-director.test.mjs`
- `apps/server/test/provider-catalog.test.mjs`
- `apps/web/src/next/fixtures/routes/computer.ts`
- `apps/web/src/next/fixtures/routes/settings.ts`
- `apps/web/test/next/settings-computer.test.mjs`
- `apps/web/test/next/settings-director.test.mjs`
- `apps/web/test/next/start-commands.test.mjs`
- `apps/web/test/next/store.test.mjs`
- `docs/implementation/MANUAL-LIVE-PRODUCTION.md`
- `packages/director/src/media/codex-image.ts`
- `packages/director/src/runtime/codex.ts`
- `packages/director/src/runtime/policy.ts`
- `packages/director/src/runtime/setup.ts`
- `packages/director/test/codex-image-binary.test.mjs`
- `packages/director/test/codex-image-fixture.mjs`
- `packages/director/test/codex-image-legacy.test.mjs`
- `packages/director/test/codex-image.test.mjs`
- `packages/director/test/codex-protocol.test.mjs`
- `packages/director/test/runtime-fixture.mjs`
- `packages/director/test/runtime-images.test.mjs`
- `packages/director/test/runtime-setup-fixture.mjs`
- `packages/director/test/runtime-setup-skills.test.mjs`
- `packages/director/test/runtime-setup.test.mjs`
- `packages/director/test/runtime.test.mjs`
- `packages/providers/src/codex-image.ts`
- `packages/providers/test/codex-image-policy.test.mjs`
- `scripts/browser/next-start.mjs`
- `scripts/codex-protocol-schema.mjs`
- `scripts/probe-codex-compat.mjs`
- `scripts/setup-readiness.mjs`
- `scripts/storyboard-review.mjs`
- `scripts/test/setup-readiness.test.mjs`

### Added (3)

- `apps/server/test/codex-image-0.162.1-film.json`
- `docs/ai/film-quality/reports/M3-report.md`
- `packages/director/test/fixtures/codex-protocol-0.170.0.json`

Deleted files (0).
