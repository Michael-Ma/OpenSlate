# N3 · Background music for code plans

Worktree: `codex/n3-music`. Implemented offline; one search-scope deviation from the card’s hard rules is recorded below. No commit or push was made. Checks are complete; the full suite has one intermittent failure in unchanged Store startup code, detailed below.

## Done

- **N3.1 — adapter and audio:** `gemini-lyria` calls exactly one synchronous Gemini Interactions POST for `lyria-3.5`. It shares the Gemini origin, header/authentication, bounded JSON reader and cancellation/timeout implementation with song analysis. Prompts include approximate seconds, a clean final chord and default instrumental/no-vocals wording. Audio is selected by block type after text; MP3 and WAV are both retained by MIME and strict canonical base64. The HTTP timeout is 300 s, the code-plan deadline at least 360 s, the response bound 96 MiB and the decoded/raw audio bound 32 MiB. The existing bounded importer, decoder, probe, resampler and managed-audio installer produce owned measured 48 kHz stereo PCM. Results expose `leadInSamples` and `durationSamples`; lead-in means the first stereo frame above -60 dBFS. All-silent output reports its whole length as lead-in.
- Durable dispatch/result records and owned output spools allow local recovery without repeating POST. Safety refusal has `retry: none`; 429 is busy/safe with N1’s two automatic retries; auth/billing/free-tier refusals name the need for billing on the key’s Google project. Proven connect failures are not submitted. Post-send loss stays unknown/may-have-charged, then local reconciliation reports terminal lost-response/consent retry. Missing/invalid returned audio retains possible charge with a clear error. Generic provider failures never become proof of no charge. Explicit retries retain every earlier liability.
- **N3.2 — installation:** fixed `gemini-music` credential alias reads the same `OPENSLATE_GEMINI_API_KEY` as analysis. The installable `music` profile pins $0.08 (`80000` micros), the model and execution version. Catalog selection preserves the chosen music profile in the film lock; normal readiness/credential/tool/registration checks apply. Startup enables configured music by default, with explicit host disable available. Egress is limited to the compiled-in `generativelanguage.googleapis.com` origin and fixed paths; redirects are refused. The technical guide contains the owner’s catalog JSON and `.env.live.local` variable instructions; that file was neither read nor created.
- **N3.3 — Studio:** `ctx.music({model?, prompt, durationSeconds, instrumental?, variant?})` crosses the existing bounded QuickJS JSON bridge. Normalized defaults/content identity provide replay reuse; a deliberate variant creates new work. Paid music uses the existing ceiling, human holds, Stop, profile concurrency, version/lease and one-use submission fences. `read_film.models` lists the Lyria price, SynthID and “length is approximate; trim and fade at the cut”. Fake demo music remains explicitly synthetic.
- **N3.4 — rendering:** code-plan audio accepts `fadeOutSamples`. Capture passes it into persisted local timelines and frozen manifests; FFmpeg fades after source trim/gain. The validator bound is shared at **240,000 samples / 5 s**, limited further by placement duration. Storyboard narration producers still clamp to **4,800 samples / 0.1 s**. Source duration remains measured; `durationSamples` trims overlong music at the picture cut.
- **N3.5 — guidance:** the Studio reference and two-shot example make music once the cut length is known, skip measured lead-in, check usable length, trim exactly, fade the final two seconds, use about -14 dB under speech or -6 dB without speech, name mood/instruments/tempo, explain variants and disclose SynthID. The current package digest is re-pinned; archived 0.1.0 guidance is unchanged.
- **N3.6–7 — tests and documentation:** offline loopback API fixtures, actual local MP3/WAV ingestion/render checks, failure/retry/ceiling/replay tests and backup closure regression were added. Technical provider/timeline documentation and implementation status are updated. P2c’s HTTP choice/edit/restart/graph flow includes the added fixture music, with final spend **$0.44 under $1**, eight final reused steps and no duplicate attempt submissions.

## Files

The complete changed-file inventory follows. Narrow shared changes are necessary for installation, typed execution/spool roles, atomic source publication and backup integrity. They do not add music to the graph DSL or change graph generation admission. No `apps/web/**`, `packages/core/src/studio-api.ts` or `apps/server/src/code-plan/port.ts` was edited.

Changed:

- `apps/server/src/application/director-capabilities.ts`
- `apps/server/src/application/media-execution-config.ts`
- `apps/server/src/application/media-execution-runtime.ts`
- `apps/server/src/application/provider-catalog.ts`
- `apps/server/src/application/provider-credentials.ts`
- `apps/server/src/code-plan/execution.ts`
- `apps/server/src/code-plan/identity.ts`
- `apps/server/src/code-plan/index.ts`
- `apps/server/src/code-plan/models.ts`
- `apps/server/src/code-plan/provider-authority.ts`
- `apps/server/src/code-plan/provider-input.ts`
- `apps/server/src/code-plan/records.ts`
- `apps/server/src/code-plan/sandbox.ts`
- `apps/server/src/execution/fixture-ingester.ts`
- `apps/server/src/execution/output-store.ts`
- `apps/server/src/execution/provider-use.ts`
- `apps/server/src/media/local-media.ts`
- `apps/server/src/media/local-timeline.ts`
- `apps/server/src/media/timeline-capture.ts`
- `apps/server/src/persistence/installation-backup-closure.ts`
- `apps/server/src/persistence/store.ts`
- `apps/server/test/code-plan-director.test.mjs`
- `apps/server/test/code-plan-e2e-fixture.mjs`
- `apps/server/test/code-plan-e2e.test.mjs`
- `apps/server/test/fal-lipsync-execution.test.mjs`
- `apps/server/test/local-timeline.test.mjs`
- `apps/server/test/media-execution-config.test.mjs`
- `apps/server/test/provider-credentials.test.mjs`
- `docs/implementation/STATUS.md`
- `docs/technical/PROVIDERS-ARTIFACTS.md`
- `docs/technical/TIMELINE-RENDERING.md`
- `packages/core/src/contracts.ts`
- `packages/core/src/workflow/index.ts`
- `packages/providers/src/execution.ts`
- `packages/providers/src/fake.ts`
- `packages/providers/src/gemini-audio.ts`
- `packages/providers/src/index.ts`
- `skills/code-plan/SKILL.md`
- `skills/code-plan/references/example-plan.ts`
- `skills/code-plan/references/studio.d.ts`

Added:

- `apps/server/src/execution/gemini-lyria-execution.ts`
- `apps/server/src/execution/spool-music-ingester.ts`
- `apps/server/test/code-plan-music.test.mjs`
- `apps/server/test/gemini-music-fixture.mjs`
- `docs/ai/code-plan/reports/N3-report.md`
- `packages/providers/src/gemini-http.ts`
- `packages/providers/src/gemini-lyria.ts`
- `packages/providers/test/gemini-lyria.test.mjs`

Deleted: none. No schema, dependency, database, provider output file, key, generated build output or protected state is part of the diff. The embedded MP3 fixture contains only synthetic sine/silence, compressed inside test source for portability to FFmpeg builds without an MP3 encoder.

## Tests

**33 tests added**, across `packages/providers/test/gemini-lyria.test.mjs` (13) and `apps/server/test/code-plan-music.test.mjs` (20). Existing tests were updated in six test files plus the P2c helper: credential metadata now includes the deliberately shared Gemini alias; environment configuration includes the music switch; the pinned example includes one music result/audio placement; local timeline validation accepts fades beyond the former 0.1 s bound while rejecting invalid/source-overrun fades; P2c counts/prices/reuse include the extra music step. No test was deleted, disabled or newly skipped.

Coverage includes MP3 and WAV after preceding text, large responses above the old 4 MiB limit, missing/duplicate audio and invalid base64, safety/busy/billing/key errors, post-send loss versus proven connection failure, bounded safe retries, consent retry retaining liability, exact $0.08 ceiling admission, holds/Stop, disabled/missing-key refusal, invalid dry-run inputs, deliberate variants, immutable receipts, restart at dispatch/ingestion boundaries, lead-in measurement, actual rendered trim/fade, the shared five-second maximum, installation backup and missing provenance. Existing song-analysis, speech/output-store, narration placement and graph integration regressions are included.

| Command | Observed result |
| --- | --- |
| `pnpm setup:test-media` | Passed; existing FFmpeg/ffprobe 8.1.1 matched, no download |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders |
| `pnpm build` | Passed, all five workspaces; existing Vite chunk/mixed-import warnings only |
| Focused 24-file `node scripts/run-tests.mjs …` | **369 passed, zero failed/skipped/cancelled/todo**, 82.059 s |
| Normal full `pnpm test` with case-progress tracing | **4,763 passed, one failed, one optional native skip; 4,765 total**, zero cancelled/todo, 645.791 s. Failure: concurrent Store creation hits `SQLITE_BUSY` at `journal_mode = WAL` |
| Additional touched fal test file | **18 passed, zero failed/skipped/cancelled/todo**, 4.500 s |
| `pnpm -r typecheck` | **5/5 workspace typechecks passed**, zero TypeScript errors |
| `pnpm demo:code` | Passed: versions 1 → 2, two choices, eight reused steps, one new video/render, one lookup recovery, zero duplicates, $0.44 / $1, final `done` |
| Schema isolated rechecks | **10/10 passed twice**, once with and once without the progress preloader; no schema test or initialization code changed |
| Guidance pin | Current `342c2137529bdd25f51886d32133b9ed60e2422532f17293e5fcf4a4c460a6ee`; archived v1 remains `d3811c72395713445f2167bb281273de28b058098189f9d8bec441d7b3d0052e` |

The earlier focused run passed **363/363** before adding the backup regression; a separate music gate passed **20/20** including backup. Preliminary failures exposed publication ordering, test expectations for the changed example/fade bound and fixture backup filenames; all were corrected. The first full run additionally found `a fal key enables lip sync with the default fal CDN hosts and disabling it returns explicit empty configuration`: its expected startup object omitted `music: false`. That assertion was corrected and the fal file passed 18/18.

Three preliminary full runs and one isolated diagnostic run were interrupted, producing no aggregate totals. Quiet buffered output was initially misdiagnosed as a shutdown stall. A temporary completion-mode runner did not resolve it; resource snapshots isolated the unfinished file to `scripts/test/skills-release.test.mjs`, while the other 393 files completed. Read-only `beforeEach`/`afterEach` progress tracing then showed that file actively executing slow filesystem publication tests. No runtime fix, test deletion, force-exit acceptance, or waived failure is based on that mistaken diagnosis. The final normal `pnpm test` uses only this temporary progress logger (`NODE_OPTIONS=--import=/tmp/openslate-n3-skills-progress.mjs`), which records case names and changes no assertions, test selection or exit behavior. The completed normal-run totals are in the table. That run used no force-exit option.

Self-review covered the complete source/new files, callers, content/receipt identity, money/retry boundaries, graph effects, backup, normalized/raw media and guidance pins. It corrected artifact/source publication order, retained terminal billing meaning for generic failures, kept `failure()`’s existing return shape, added backup recognition/immutability and preserved the narration producer’s 0.1 s policy. Final `git diff --check`, forbidden-path diff checks and both current/archived guidance digest checks passed. There is no remaining actionable N3 diff finding; the unrelated-path concurrency result below remains visible.

Logs: `/tmp/openslate-n3-{build-final,focused-acceptance,full-verified,fal-config,typecheck,demo}.log`; preliminary `full`, `full-final`, `full-completion` and `skills-isolated` logs are diagnostic, not acceptance. The case-progress log is `/tmp/openslate-n3-skills-progress.log`. Tests use temporary state, synthetic audio and bounded loopback listeners. No actual billing or musical-quality result is claimed.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. The lead’s pre-added `music` step kind is used as supplied. `apps/server/src/code-plan/port.ts`: **none**.

Internal shared types: `OperationKind` gains `music`; execution/spool roles accept MP3 only for music; code-plan successful music results add measured `leadInSamples`/`durationSamples`; model descriptions add the Lyria note/watermark. No new browser or graph tool is added.

## Commits

No commits created, per the card’s no-commit rule. Proposed lead-owned split:

1. `feat(code-plan): generate Lyria music and trim faded audio at the cut` — all source, test and skill files in the inventory, including the guidance digest pin. These belong together because the updated example, runtime and integration assertions depend on one another.
2. `docs(code-plan): document music setup and N3 verification` — `docs/technical/PROVIDERS-ARTIFACTS.md`, `docs/technical/TIMELINE-RENDERING.md`, `docs/implementation/STATUS.md`, `docs/ai/code-plan/reports/N3-report.md`.

## Open issues

- The completed full run failed `two independent Store processes safely recheck concurrent fresh creation after waiting for a writer` (`apps/server/test/schema.test.mjs:162`): a child returned `SQLITE_BUSY` at the existing `journal_mode = WAL` pragma in the Store constructor. N3 does not change this constructor or schema-initialization logic. Both isolated schema runs passed 10/10, so this appears timing-sensitive; it is not claimed fixed or waived. The lead should check this startup race before treating the entire repository gate as green. All N3/focused behavior tests passed.

- The lead owns UI/profile-selection integration and the live paid check. Install the documented profile and pin its id in a new code film; existing film capability locks are unchanged. A billing-enabled Gemini project is required. No live provider experiment was run here.
- Lyria does not guarantee duration or a clean ending; callers must check measured usable samples and trim/fade. Music longer than the local 360 s/32 MiB raw-media bounds fails closed while retaining dispatch/result evidence and liability; it is not silently truncated or regenerated.
- A process loss after the send marker without a saved result has no vendor lookup. It remains unknown until the maximum dispatch window expires; no automatic resubmission is possible. Returned bytes that were never durably spooled cannot be recreated without an explicit new attempt.
- The five-second fade bound is deliberately shared; the narration producers remain at 0.1 s. The report lists narrow shared edits for lead review, including core operation typing, runtime/catalog, output-store MIME selection, persistence and backup closure.
- Process deviation: an early broad `rg --hidden` search scanned the tracked `.env.example` template, contrary to the blanket `.env*` reading prohibition. It returned no template content or credentials. No personal environment file was explicitly opened or written. Subsequent inspection stayed within named source/test/doc paths.
- No browser, real provider, secrets/`.openslate` read, port-3001 listener, commit, push or subagent was used. The only external traffic was the card-authorized plain GET of its music-generation and pricing documentation pages.
