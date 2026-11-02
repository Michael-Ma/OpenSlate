# F1 — Launch links use the bound studio port

## Done

- After `app.listen`, startup reads `app.server.address()` and uses its TCP port for the readiness address and the URL passed to both the printed-link and automatic-browser paths. A listener redirected from 3001 to 5173 now advertises 5173.
- `studioUrl(code, port = 3001)` accepts an explicit numeric port. Both URL construction and the existing browser-opener validator remain restricted to `http://127.0.0.1` on 3001 or 5173 with a bounded launch code. No validator widening.
- A served studio bound elsewhere fails before announcing readiness or printing/opening a pairing link, reports `Unsupported studio port <port>; expected 3001 or 5173`, and shuts down with exit code 1.
- The standalone launcher's default destination stays 3001; `--dev` explicitly selects 5173. Pairing credentials, expiry, origin checks, cookies and CSRF behavior are unchanged.

## Files

Changed:

- `apps/server/src/index.ts`
- `apps/server/src/studio-launcher.ts`
- `apps/server/src/studio-cli.ts`
- `apps/server/test/studio-sessions.test.mjs`

Added:

- `apps/server/test/studio-launcher.test.mjs`
- `docs/ai/film-quality/reports/F1-report.md`

Deleted: none. No changes to other cards' files, the web app, provider catalog, code-plan implementation, or startup/restart scripts.

## Tests

Added four launcher regression tests:

1. The actual server listener is redirected to 5173 by a test-owned preload; readiness and the printed URL name 5173, and exchanging the printed code at that origin succeeds.
2. The automatic-open path passes a 5173 URL to a stubbed child-process opener; no browser is launched.
3. A listener assigned an unsupported ephemeral port exits 1 with the explicit diagnostic and no studio link or browser-open attempt.
4. The standalone CLI prints 3001 by default and 5173 with `--dev`; its launch-code HTTP request is stubbed.

Rewritten: the existing URL-validation test now passes the explicit port instead of a development boolean. It retains the default-3001 assertion and adds rejection checks for unsupported/non-numeric ports, non-loopback hostnames, misleading hostname suffixes and extra fragment parameters. No tests deleted.

Verification uses Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1:

| Command | Result |
| --- | --- |
| `pnpm setup:test-media` | Exit 0; matching installed media tools reused; no download |
| `pnpm check:toolchain` | Exit 0; pinned versions and encoder profile pass |
| `pnpm build` | Exit 0; all five workspace builds pass |
| `node scripts/run-tests.mjs apps/server/test/studio-launcher.test.mjs apps/server/test/studio-sessions.test.mjs scripts/test/local-server.test.mjs` | Exit 0; 21 passed, 0 failed, 0 skipped |
| `pnpm test` | Stalled after the last printed result; observed 5,181 passing, 6 failing and 2 skipped result lines. No final aggregate summary or exit code; see below |
| `node scripts/run-tests.mjs apps/server/test/code-plan-last-frame-crop.test.mjs apps/server/test/code-plan-music.test.mjs` | Exit 0; 35 passed, 0 failed, 0 skipped |
| `node scripts/run-tests.mjs apps/server/test/code-plan-retry.test.mjs apps/server/test/director-keyframes.test.mjs packages/director/test/claude-code.test.mjs packages/director/test/runtime.test.mjs` | Exit 1; 162 passed, 1 failed, 0 skipped. All four original failures in these files passed; a different Claude timeout fixture failed |
| `node scripts/run-tests.mjs packages/director/test/claude-code.test.mjs` (isolated rerun, 180-second process deadline) | Exit 0; 66 passed, 0 failed, 0 skipped; deadline not reached |
| `pnpm typecheck` | Exit 0; all 5 package typechecks pass (includes package builds) |
| `pnpm -r typecheck` | Exit 0; all 5 package typechecks pass |

The new server tests use temporary data, no inherited provider configuration, loopback 5173 or an ephemeral loopback port, and a fake browser opener. No listener was started on 3001. The CLI's 3001 destination is checked through a fake HTTP response. No browser checks or real-provider experiments were run.

All four new F1 tests also passed inside the full run. Its six initial failures were outside the changed launcher files; each original failure passed when its file was rerun:

| File | Initial failing test | File rerun |
| --- | --- | --- |
| `apps/server/test/code-plan-last-frame-crop.test.mjs` | `saved pre-Q2b receipts without lastFrameCrop retain their uncropped last upload and replay identity` | Passed |
| `apps/server/test/code-plan-music.test.mjs` | `code-plan Lyria LYRIA_BUSY retains honest retry and price evidence` | Passed |
| `apps/server/test/code-plan-retry.test.mjs` | `MiniMax connect rejection is safe in the shared code-plan bridge and an explicit portrait ratio follows its first frame` | Passed |
| `apps/server/test/director-keyframes.test.mjs` | `stop during isolated keyframe composition prevents old paid publication` | Passed |
| `packages/director/test/claude-code.test.mjs` | `Claude init timeout and failed event consumer cannot complete or open the bridge gate` | Passed |
| `packages/director/test/runtime.test.mjs` | `host close cleans up a noncooperative process while interruption is still waiting and fences new turns` | Passed |

The grouped four-file rerun failed a different test, `Claude timeout kills the entire process group`, with `Fixture did not reach its barrier` at `packages/director/test/claude-code.test.mjs:160`. The isolated rerun of that complete file passed all 66 tests, including that case. No out-of-scope test or runtime implementation was edited.

The full runner stopped producing output after `doctor explains the old Codex profile runtime upgrade without changing the file`. It retained open processes rather than finalizing. `lsof` tied its log writers to this worktree and the parent chain 13771 → 13787 → 14035 → 14104; PID 14104 is the full Node test runner. Sending that verified task-owned process SIGINT was denied by the sandbox (`kill EPERM`). Therefore the full run has **no confirmed terminal exit or aggregate counts**; the counts above are observed result lines, not a claim that the suite completed. These failures did not reproduce in their original cases, but their root cause and the retained handle/process were not established here.

Local verification logs:

- `/tmp/openslate-f1-build.log`
- `/tmp/openslate-f1-targeted.log`
- `/tmp/openslate-f1-full-test.log`
- `/tmp/openslate-f1-retry-media.log`
- `/tmp/openslate-f1-retry-remaining.log`
- `/tmp/openslate-f1-retry-claude.log`
- `/tmp/openslate-f1-typecheck.log`
- `/tmp/openslate-f1-recursive-typecheck.log`

## Self-review

Reviewed the source and test diff for URL validation, startup failure cleanup, launch-code handling, and every `studioUrl` caller. The caller check identified the standalone CLI's `--dev` behavior as compatibility coverage to retain; the explicit mapping and CLI regression test cover it. No further correctness issues found. `git diff --check` passes.

## Contract changes

None to `packages/core/src/studio-api.ts` or the film-quality contract. The server-local helper's second parameter changes from a boolean development selector to an explicit numeric port; all repository callers were checked and updated where needed.

## Commits

No commits made. Proposed single conventional commit:

`fix(server): derive studio launch links from the bound port`

Files: all six files listed above.

## Open issues and boundaries

- Only 3001 and 5173 remain valid studio-link ports. Other ports require a separate deliberate validator change.
- This card does not add port configuration or discovery to the standalone reconnect/restart scripts. The local launcher API still targets 3001, with the existing `--dev` browser destination retained.
- Real browser launching is intentionally unverified under the card's hard rules; the opener's exact URL and argument path are tested with a stub.
- Build output retains existing web dynamic-import/chunk-size warnings; no web files were changed.
- The full test runner remains open without a final summary, and the sandbox denied stopping it. The lead needs to stop the verified task-owned runner outside this sandbox and investigate the fixture cleanup/timing boundary. The report preserves the initial failures and each rerun separately; all initially failed cases passed on file reruns.
