# B7 implementation report

## Done

- **SB-5 / D3:** a scene or targeted keyframe press also persists the missing generated voice work. The shared estimate includes speech. Existing frames can receive a missing/revised voice without buying another image. Each returned voice is verified and attached through the existing exact generated-audio service; a fitting full line is canonically accepted automatically. An overlong line remains attached and pending, with its original measured seconds and `fits: false`. Narration edits preserve the frame and outdate the voice. Failed and uncertain speech surface as `failed` and `no_answer`; neither is silently bought again.
- **GR-3 + GR-4:** authenticated `POST /api/projects/:projectId/scenes/:sceneId/confirm` requires a command key, the exact current confirmation digest, every unfinished shot's exact opened frame, and a matching supplied estimate. One command transaction validates those inputs, creates the original human video grants, persists the scene confirmation and per-shot steps, and takes its scene hold. The installation loop advances speech publication, attachment, acceptance, then existing scene video compilation/approval. Each step freezes its input before asynchronous work and stores its result under a deterministic confirmation-derived key. A restart resolves original service receipts; it never submits a replacement paid attempt. Engine admission additionally fences scene intent and exact conditioning-frame identity, including same-spec replacements. Paid confirmation work has no automatic technical retries. Stop cancels running/blocked records and detaches unsent candidates, preserving already sent results and liability. The overview projects the confirmation and `confirmation_running` blocker.
- **SB-2 + SB-3 / D9:** authenticated `POST /api/projects/:projectId/shots/:shotId/narration-fit` requires a command key and expected head. `extend_shot` rounds up to whole seconds within the locked video model and 3–15 second studio range; `cut_to_shot` accepts only the range within the current shot. Both reuse exact canonical acceptance, return a single storyboard Undo command, preserve the keyframe, and expose the selected fit. Extension invalidates the clip recipe and refreshes its digest/quote. Cut placement carries an 80 ms fade through the playback projection, immutable local timeline and local render. The original measured source length remains visible while `fits` reflects the accepted effective range.

## Files

Changed:

- `apps/server/src/app.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/generation-quotes.ts`
- `apps/server/src/index.ts`
- `apps/server/src/media/local-media.ts`
- `apps/server/src/media/local-timeline.ts`
- `apps/server/src/media/types.ts`
- `apps/server/src/media/timeline-capture.ts`
- `apps/server/src/narration/audio-placement.ts`
- `apps/server/src/narration/narration-scope.ts`
- `apps/server/src/narration/shot-audio-routes.ts`
- `apps/server/src/scene-generation.ts`
- `apps/server/src/scene-narration-view.ts`
- `apps/server/src/scene-row.ts`
- `apps/server/test/generation-overview.test.mjs`
- `apps/server/test/local-timeline.test.mjs`
- `apps/server/test/media-rendering.test.mjs`
- `apps/server/test/timeline-capture.test.mjs`
- `apps/server/test/shot-audio-http.test.mjs`
- `packages/core/src/studio-api.ts`

Added:

- `apps/server/src/narration-fit.ts`
- `apps/server/src/scene-confirmation-state.ts`
- `apps/server/src/scene-confirmations.ts`
- `apps/server/test/helpers/confirmation-fixture.mjs`
- `apps/server/test/narration-fit.test.mjs`
- `apps/server/test/scene-confirmations.test.mjs`
- `docs/ai/uiux-plan/codex/B7-confirm-report.md`

Deleted: none. No DDL, web source edits, real-provider calls, external HTTP requests, personal credentials or port 3001 use. Integration speech uses an injected synthetic WAV HTTP response and real local normalization; image/video operations use the fake provider.

## Tests

Added integration coverage for combined and targeted image/voice pricing and attempts; voice-only replacement after a text edit; 7.4 seconds on a six-second shot; mixed none/uploaded/generated confirmation; durable progress and receipt replay; restart between speech/attach/accept/video; process death immediately after speech publication or canonical acceptance; frame, scene and estimate staleness before spend; unknown speech blocking a new key; failed/unknown speech without retries; Stop before dispatch and during already sent speech; and same-spec frame replacement before queued speech admission. Added fit range/rounding tests, both Undo paths, rejected fit inputs, immutable fade recipes and measured rendered-audio fade behavior.

Rewritten existing overview expectations:

- Combined keyframe/regeneration quotes now include the missing generated voice unit.
- An accepted cut or extended range clears the too-long blocker only when its actual accepted timing fits; original measured seconds remain visible. Two legacy shot-audio HTTP display assertions now expect the original seven-second recording rather than the accepted range; exact canonical cue/sample and replay checks remain.
- The missing-key frame-view HTTP assertion now expects 400, matching the already merged B1 `IDEMPOTENCY_KEY_REQUIRED` error mapping. The error-code and no-mutation assertions remain.

No tests were deleted. Existing scene-generation and shot-narration scope integrity tests also ran unchanged. An earlier full run found exactly the two replaced legacy measured-length assertions; both were corrected and the complete final run passes.

Verification:

- `pnpm setup:test-media` and `pnpm check:toolchain`: passed with Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1; existing installed tools were used.
- `pnpm build`: passed.
- `node scripts/run-tests.mjs apps/server/test/scene-confirmations.test.mjs apps/server/test/narration-fit.test.mjs apps/server/test/generation-overview.test.mjs apps/server/test/local-timeline.test.mjs apps/server/test/media-rendering.test.mjs apps/server/test/scene-generation.test.mjs apps/server/test/shot-narration-scope.test.mjs apps/server/test/timeline-capture.test.mjs apps/server/test/shot-audio-http.test.mjs`: 153 passed, zero failures/skips.
- `pnpm test`: 2,501 total; 2,500 passed, zero failures, one optional native skip. The final full run took 208.22 seconds.
- `pnpm -r typecheck`: all five workspace packages passed, zero failures.
- `git diff --check`: passed.

## Contract changes

Two minimal additions to `packages/core/src/studio-api.ts`:

1. `ShotNarration.state` includes `no_answer`, so uncertain paid speech is distinguishable from ordinary running work.
2. Optional `ShotOverview.quotes.regenerateKeyframe` gives the exact selected shot's image-plus-missing-voice estimate. A single scene-level regeneration price cannot represent shots with different voice requirements. The optional scene-level shortcut is emitted only when every shot has the same regeneration quote; commands still validate the exact selected-target quote.

The existing `ConfirmSceneInput`, `SceneConfirmationView`, `NarrationFitInput` and `NarrationFitReceipt` shapes are unchanged. Internal JSON entity kinds are `scene_confirmation` and `scene_confirmation_request`. Media placement adds optional `fadeOutSamples`; absent fades preserve existing recipe identities.

## Commits

No commits were made, per `RULES.md`. Proposed split (shared files split by relevant hunks):

1. `feat(server): persist scene voice and video confirmation`
   - `apps/server/src/{app.ts,index.ts,scene-confirmations.ts,scene-confirmation-state.ts,scene-generation.ts,scene-row.ts,generation-quotes.ts,generation-overview.ts,scene-narration-view.ts}`
   - `apps/server/src/execution/engine.ts`
   - `apps/server/src/narration/{narration-scope.ts,shot-audio-routes.ts}` (shared workspace extraction and host-only direct-edit sessions)
   - `packages/core/src/studio-api.ts`
   - `apps/server/test/{scene-confirmations.test.mjs,generation-overview.test.mjs,shot-audio-http.test.mjs,helpers/confirmation-fixture.mjs}`
2. `feat(server): add undoable narration fit and cut fades`
   - `apps/server/src/narration-fit.ts`, fit registration in `apps/server/src/app.ts`
   - `apps/server/src/narration/{audio-placement.ts,shot-audio-routes.ts}` (fade playback projection)
   - `apps/server/src/media/{types.ts,local-timeline.ts,local-media.ts,timeline-capture.ts}`
   - `apps/server/test/{narration-fit.test.mjs,local-timeline.test.mjs,media-rendering.test.mjs,timeline-capture.test.mjs}`
   - `docs/ai/uiux-plan/codex/B7-confirm-report.md`

## Open issues

No implementation blocker is known. Decisions and integration boundaries for the lead:

- The server retains internal dedicated shot-scope sessions under the one durable scene command, using `source: "app"` and host-only direct-edit semantics. This preserves the existing exact single-shot acceptance/provenance validators and independent Director requests. The browser neither creates nor sequences these sessions.
- The scene hold protects execution; it does not reject new human/director writing. A changed reviewed scene invalidates the old record and queued paid admission. The old record cannot adopt the later request's authority.
- `done` means the exact reviewed video plan and approvals were durably published to the engine; individual clip completion remains in the overview's media slots. Missing narration discovered during confirmation defaults to block on overflow. Choosing a fit and reviewing the new recipe precedes a new confirmation; no extra policy field was added to the contract.
- A free fit persists its intent and any extension before asynchronous canonical verification. A local verification failure can leave the longer shot with narration pending; retry uses the original frozen acceptance and never spends. Successful commands provide one Undo receipt. Restoring detached paid media on Undo remains B8's scope.
- The legacy browser chain remains unchanged, as required by the card's `apps/web` exclusion. The lead must switch the UI to the durable route and consume per-shot regeneration quotes and optional fade metadata. The server's local render applies the fade; no claim is made that the untouched legacy browser player applies it.
- This is the backend half of phase P3. No live-provider quality, browser migration, installer or production acceptance claim is made.
