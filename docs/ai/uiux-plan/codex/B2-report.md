# B2 — generation overview, durable Opened, estimates

## Done

- **GR-1:** extracted `sceneRow` as a pure projection, kept a frozen original scene-view oracle, and exercised both across the generation, concurrency and undercoverage fixtures. The project overview reads one production snapshot and inspects review once per project event cursor; repeated reads return cached, isolated copies. Ambiguous alternatives become `choose_take`. Commands and overview share target selection. The confirmation token uses the existing scene-read digest, including existing narration/version/request evidence.
- **GR-2:** authenticated frame-view commands require an Idempotency-Key. Content-keyed `frame_view` entities store principal/project/shot/artifact/hash/time. Exact retries replay their original receipt. A different key for an already viewed current frame adds no duplicate record. A stale artifact returns `FRAME_STALE`. Views mint no messages, holds, grants or approvals.
- **GR-5 / SB-11 / D15:** pure lock-based flat estimates for keyframes, one-image regeneration, unfinished video plus unmade generated voice lines, and voice alone. Zero and Codex prices are unknown. Optional `expectedEstimateMicros` is validated before any generation authority is created.
- **GR-7:** empty scenes reject generation with `SCENE_EMPTY`; newly added shots carry explicit placeholder metadata and reject with `DIRECTION_REQUIRED` plus shot IDs. Authored storyboard or Director direction clears the metadata without interpreting prompt strings.
- **GR-9:** slot failures expose the persisted failure code, technical/retry flags, remaining automatic retries, reservation-derived charge state and observation time. Exhausted failures and uncharged refusal remain distinguishable.
- **GR-11:** storyboard detachment records prior output and changed fields. History supplies older-project fallback previews. New successful output clears old edit metadata; unchanged bindings in later plan publications preserve it and repeated edits accumulate their field causes. Old artifacts remain immutable.
- **GR-12:** changed-only durable `node_wait` records and events, cleared within admission transactions. Slots distinguish capacity (including actual model jobs ahead), edit holds, Stop, review, voice and timing. Held candidates remain pending in the legacy read. Only actual queueing codes are persisted; invalid/unauthorized evidence still rejects without writes.
- **GR-17:** in-flight slots carry actual attempt phase, creation time and attempt ID.
- **GR-14:** startup uses the process time origin; only pre-start unknown submissions are restart casualties. A real child-process read verifies this and durable Opened without submitting or reconciling any job.
- **Narration:** uses current/accepted narration evidence, exact sample-derived seconds where available, word/CJK text estimates otherwise, fit checks and descriptive accepted fit metadata. Editing narration clears the previous fit label. No paid behavior was added.
- **Scene/control/Director projection:** one helper derives a first-sentence scene title; control authority, pause state and active turn/question scopes come from existing records.

## Files

Added:

- `apps/server/src/generation-overview.ts`
- `apps/server/src/generation-quotes.ts`
- `apps/server/src/scene-row.ts`
- `apps/server/test/generation-overview.test.mjs`
- `apps/server/test/helpers/generation-fixture.mjs`
- `apps/server/test/helpers/b2-scene-reference.ts`
- `apps/server/test/helpers/scene-row-parity.mjs`
- `docs/ai/uiux-plan/codex/B2-report.md`

Changed:

- `apps/server/src/app.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/narration/canonical.ts`
- `apps/server/src/narration/shot-audio-routes.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/src/scene-narration-view.ts`
- `apps/server/src/storyboard.ts`
- `apps/server/test/scene-generation.test.mjs`
- `apps/server/test/scene-review-concurrency.test.mjs`
- `apps/server/test/scene-undercoverage.test.mjs`
- `apps/server/test/shot-audio-http.test.mjs`
- `packages/core/src/contracts.ts`
- `packages/core/src/workflow/index.ts`

Deleted: none. No web files, migrations, credentials, databases, media, dependencies or build output are part of the changes.

## Tests

Added **19 tests**: 18 overview tests and one audio HTTP test. No existing tests were rewritten, deleted or weakened. Three scene suites gained original-versus-extracted row comparisons at fixture reads and teardown. The sole comparison adjustment is GR-12's intentionally corrected held-candidate pending flags; separate integration assertions cover the new behavior. Existing audio tests gained overview measurements/fit assertions. The new overview suite covers state aggregation, exact legacy digest parity, ambiguity, caching, frame identity/replay/staleness, pricing and no-grant rejection, placeholders, failures/charges/retries, outdated history, waiting states, progress, Director scopes, narration, and restart detection. Audio coverage includes a changed-script estimate without any provider call.

- Pinned toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. `pnpm setup:test-media` found the matching local tools; `pnpm check:toolchain` passed without downloads.
- Before extraction: existing generation/concurrency/undercoverage suites **30 passed, 0 failed**.
- After pure extraction, before GR-12's intentional correction: the same suites **30 passed, 0 failed**.
- Latest focused gate: **102 passed, 0 failed, 0 skipped** across generation overview, three scene suites, shot audio HTTP, canonical narration, application-input gates and owned-transcription execution.
- Final `pnpm build`: **passed** (all five workspace packages/apps).
- Final `pnpm test`: **2,499 passed, 0 failed, 1 optional skip; 2,500 total** (308.1 seconds).
- Final `pnpm -r typecheck`: **5 workspace targets passed, 0 errors**.

The initial full run exposed no-write regressions from recording invalid admissions as waits; these are fixed by persisting only actual queueing codes, with the original integrity assertions retained. The initial full run also hit `process cancellation and timeout await actual child exit, with bounded diagnostics` (`Missing expected exception` for ESRCH); that unchanged test passed both an isolated rerun and the final full run. The final full gate has no remaining failures.

All provider execution was disposable fake-provider execution; the voice-status test admits an injected offline speech fixture without dispatch (zero HTTP/credential calls). No external network call, real provider call, native Codex run or port-3001 server was used. The existing build emits its bundle-size advisory.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. Server routes and read shapes implement the existing contract.

Internal `ShotRecord` gains optional `promptState` and descriptive `narrationFit`; `NodeBinding` gains optional outdated evidence. Both new persisted kinds use the existing JSON entity store. Only `DIRECTION_REQUIRED` exposes its bounded shot-ID error details through the shared error handler.

## Commits

No commits were created, as required by `RULES.md`. Proposed conventional split (shared files require staging the relevant hunks):

1. `refactor(server): extract pure scene generation rows`
   - `apps/server/src/scene-row.ts`
   - extraction hunks in `apps/server/src/scene-generation.ts`
   - `apps/server/test/helpers/b2-scene-reference.ts`
   - `apps/server/test/helpers/scene-row-parity.mjs`
   - the three existing scene test files
2. `feat(server): persist generation status and narration fit evidence`
   - `apps/server/src/execution/engine.ts`
   - `apps/server/src/storyboard.ts`
   - `apps/server/src/narration/canonical.ts`
   - `apps/server/src/narration/shot-audio-routes.ts`
   - `apps/server/src/scene-narration-view.ts`
   - `packages/core/src/contracts.ts`
   - `packages/core/src/workflow/index.ts`
   - `apps/server/test/shot-audio-http.test.mjs`
3. `feat(server): expose generation overview and pinned price checks`
   - `apps/server/src/generation-overview.ts`
   - `apps/server/src/generation-quotes.ts`
   - command/digest-sharing hunks in `apps/server/src/scene-generation.ts`
   - `apps/server/src/app.ts`
   - `apps/server/test/generation-overview.test.mjs`
   - `apps/server/test/helpers/generation-fixture.mjs`
   - `docs/ai/uiux-plan/codex/B2-report.md`

## Open issues

- No unfinished B2 requirements remain. The points below record integration boundaries and decisions for the lead.
- Existing cross-scene compilation can reject `STALE_PROMPT_INTENT` after a prompt edit leaves another scene's retained plan stale. B2 preserves that refusal: changing generation semantics beyond the three explicitly allowed additions is out of scope. Outdated evidence remains available, and plan republication is separately tested for metadata retention.
- Placeholder metadata clears on authored action, framing or explicit image/video prompt writes; unrelated duration changes do not clear it. No historical placeholder strings are guessed.
- B4 owns expanded Stop/release behavior. B2 projects the existing paused control as stopped, counts unsettled sent jobs and reports zero detached jobs because the existing control does not detach candidates. It does not introduce a new Stop command or authorize resubmission.
- B3 owns durable scene confirmations and moving speech into the generation chain. B2 reuses the legacy confirmation digest and preserves the current command checks; no new `/confirm` endpoint or confirmation runner is introduced.
- Titles use the purpose's first sentence until B6 supplies a title. Historical shots lacking `promptState` are treated as authored; historical outdated output may have a preview but no recoverable field list. Historical narration without a stored fit choice does not invent one.
- A mixed video/speech quote has a known aggregate `micros` and total operation `units`; its heterogeneous `unitMicros` is `"0"`. `priceUnknown` is determined from the underlying model prices, not this aggregate unit field. Regenerate quotes are exactly one image unit per the card; they do not include a speculative replacement clip.
- UI integration and subjective acceptance belong to the lead. No `apps/web` source was edited.
