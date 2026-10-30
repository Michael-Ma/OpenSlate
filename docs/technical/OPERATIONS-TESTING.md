# Operations and testing

V0 is a source-checkout application for one user/computer. The launcher starts a loopback production API and built UI, acquires installation ownership and gracefully stops scheduler/director/event streams/storage. It is not an installer or multi-host deployment service.

## Local operation

Use Node 24 and pnpm 10.33.0. Run `./start.sh`, `--status`, `--restart`, `--doctor` or `--init-config` from the repository. The launcher loads private `.env.live.local`, with exported variables taking precedence, and preserves existing configuration/data. A verified running instance reconnects; changed builds/configuration need a restart.

Use one explicit `OPENSLATE_DATA_DIR` across start/development modes. Keep it outside `apps/web/dist`. Private pairing/token and provider credentials are different: normal launch uses a short-lived code/HttpOnly session; provider keys stay in the backend.

FFmpeg/ffprobe enable media import/export. Native director/image setup requires the exact supported Codex version/configuration. Readiness checks can verify local tools/credential presence without making provider calls; actual account access and media generation require separate live evidence.

## Checks

| Command | Scope |
|---|---|
| `pnpm check` | Build, isolated offline tests, all workspace typechecks |
| `pnpm studio:fixture` | Disposable fake First Light studio on port 3101; add `--film last-ferry` for the three-scene/eight-shot server seed |
| `pnpm check:browser` | Build and rendered next-UI scenarios in system Chrome against disposable state; card sandboxes reserve launching for the lead |
| `pnpm demo:headless` | Fake two-shot edit/restart and uncertain-submission proof |
| `pnpm demo:code` | Real code-plan HTTP/runtime/fake-Director flow: frame choices, one-motion edit, lost-reply lookup and restart |
| `pnpm probe:workflow` | Fake sixty-shot/six-minute workflow and scoped recovery |
| `pnpm probe:toolchain` | SQLite/schema and optional FFmpeg H.264/AAC support |
| `pnpm probe:runtime --codex /absolute/path/to/codex` | Installed compatibility with zero model turns |
| `pnpm probe:launcher` | Disposable real process on port 3001; no model/media calls |

The browser-only `?fixture=last-ferry` sample uses its own simulated transport; it is distinct from the fake-provider server seed. Neither is real-provider evidence. The only UI is `apps/web/src/next`.

Tests bind loopback and use temporary databases/media. Optional native probes are separate from paid model turns. Real media experiments must identify their explicitly authorized scope and exact job/attempt outcomes; unknown dispatch is reconciled before any retry. The studio has no separate usage-allowance or API-key approval step.

`demo:code` always creates and removes its own temporary directory. It uses Fastify HTTP injection with real session pairing, CSRF and command keys; it opens no listener, reads no private configuration and does not use `.openslate/` or port 3001. It advances the normal Director/engine/code-plan tick functions directly, with no scheduler sleeps. Its separate durable fake-vendor database provides a test-only lookup oracle for an accepted job whose POST reply was lost. Repeated unknown lookups never authorize another submit. The reported $0.36 / $1.00 uses explicit fixture prices, and the final MP4 is labeled placeholder media from the fixture renderer; this does not prove FFmpeg assembly or real-provider output quality.

The motion edit eventually reuses seven steps and adds one video plus one render. Its stored dry-run receipt reports what the dry run reaches (seven reused steps and one new video, `dependsOnPending: true`): the example runs its shots as concurrent pipelines, so only the render waits for the new clip result. The demo prints both observations. The card's request for a complete two-step forecast in that immediate receipt remains a lead-owned preview-contract decision; see the [P2c report](../ai/code-plan/reports/P2c-report.md).

## Recovery and evidence

Only the current database schema opens; data directories from earlier prototype builds need a new `OPENSLATE_DATA_DIR`. Complete installation backups include owned media/receipts/locked skills and restore only to the original empty canonical data path. Recovery installs quarantine and unused-authority fences; human release keeps projects paused.

The [October 3 refinement record](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) has the 2,207-test full gate, actual React against disposable fixtures and rapid synthetic SSE; final integrated verification and the repaired bounded native guidance rerun passed. Record actual commands/results and limitations. Keep offline tests, bounded native turns, real media and subjective human acceptance separate. Do not carry old test totals forward as a current run or treat a read-only model list as media access. Sanitized evidence excludes credentials/private project content; backups are private.

## Source and guides

- [Setup](../implementation/LOCAL-SETUP.md), [launcher](../implementation/LOCAL-LAUNCHER.md), [live testing](../implementation/MANUAL-LIVE-PRODUCTION.md)
- [Schema](DATA-PERSISTENCE.md#schema), [backup/recovery](../implementation/INSTALLATION-RECOVERY.md), [evidence index](../implementation/VALIDATION-EVIDENCE.md)
- `scripts/start-local.mjs`, `scripts/setup-readiness.mjs`, `apps/server/src/index.ts`, studio/installation CLIs, and corresponding script/server tests.

Installer packaging, broader clean-machine/OS verification, portable relocation and complete real conversation-to-film acceptance remain outstanding.
