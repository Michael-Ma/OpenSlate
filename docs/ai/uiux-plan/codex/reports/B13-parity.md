# B13 classic UI server parity

Implemented October 15, 2026 in `cx/b13`. Work is uncommitted for the lead's review, as required by `codex/RULES.md`. No web source, shipped migration, frozen tool catalog or skill package changed.

## Done

1. **B13.1 — Director holds (SB-1/DC-5/GR-12):** completed, failed, interrupted and unknown turns (including timeout and owner loss) release only their request's resolved holds. Superseding a request retires its holds after validating any explicit continuation. Pending preparations and live held proposals retain their holds; accepting/rejecting or expiring a proposal permits release. Supervisor ticks reconcile historical terminal requests without replaying a model call. A pending question remains unfinished until answered or abandoned. The authenticated keyed, bodyless `POST /api/projects/:projectId/requests/:requestId/release-holds` returns `{requestId, releasedHolds}`, refuses queued/running turns with `DIRECTOR_WORKING`, and fences that request and its epochs before releasing its holds. Its stale prepared changes cannot borrow another request's authority. Overview `edit_pending` names the scoped owner; an old saved engine wait cannot keep reporting a released hold. Abandoned questions no longer project as active Director work.
2. **B13.2 — Restored inspection:** quarantine permits all requested studio reads, including project lists/snapshots, generation, Director/proposals/setup/models/tools, assets, exports, media, existing settings reads, takes, artifact bytes, narration audio/playback/library/personal-voice reads, installation status and stock voices. Explicit registered route patterns remain the allowlist; writes and unknown GET patterns remain fenced. The recovery read retains `receipt.backupCreatedAt` and the existing `projects`, `knownJobs`, `unknownJobs`, `nativeRequests` counts. `preparingJobs` is now always numeric, including zero. Reads do not release quarantine, dispatch work or mutate restored records.
3. **B13.3 — Shot recording and stock voices (SB-5/SB-9/SB-24):** `POST /api/projects/:projectId/shots/:shotId/narration/recording?expectedHeadVersion=N` accepts owned raw audio as `application/octet-stream`, with the existing managed-upload byte limit and local audio normalization/type/duration checks. It imports, sets uploaded narration, attaches the measured take, and accepts its full range when it fits. An overlong take returns `fits:false`, `measuredSeconds` and sample identity and remains pending for the existing free narration-fit command. The operation runs alongside the Director and creates no provider grant or paid attempt. One keyed command and Undo restore the previous narration, canonical placement and draft; later project/narration edits fence Undo. Capture/publication checks cover async imports and acceptance, and Undo preserves exact paid media that finishes during either window. Same-key retries preserve the original result across restart and later edits; changed input under the same key refuses. Storyboard narration `voice` now accepts the stock selectors, which override the film default for new lines and remain pinned through queued work/restart. Stale generated writing cannot override a newly chosen shot voice. Authenticated `GET /api/narration/voices` works without media setup, lists stock selectors and marks the default; optional `?projectId=` marks that film's default.
4. **B13.4 — Cross-scene moves (SB-13/SB-15/SB-16):** verified the existing `moveShot` route supports another scene, explicit insertion and empty destinations. New tests prove shot identities, prompts, revisions, narration data and paid keyframe/clip bindings survive; only timeline/render bindings become outdated. Scene membership and labels update, stale/foreign/self targets refuse atomically, keyed replay creates no work, and Undo restores the original scene.

## Files

Added:

- `apps/server/src/narration/shot-recording-routes.ts`
- `apps/server/test/request-holds.test.mjs`
- `apps/server/test/shot-recording-http.test.mjs`
- `apps/server/test/storyboard-cross-scene.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B13-parity.md`

Changed source:

- `apps/server/src/app.ts`
- `apps/server/src/application/audio-operation-context.ts`
- `apps/server/src/application/director-proposals.ts`
- `apps/server/src/application/director-supervisor.ts`
- `apps/server/src/application/installation-recovery.ts`
- `apps/server/src/application/recovery-routes.ts`
- `apps/server/src/application/service.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/narration/default-voice.ts`
- `apps/server/src/narration/routes.ts`
- `apps/server/src/scene-narration-view.ts`
- `apps/server/src/storyboard-history.ts`
- `apps/server/src/storyboard.ts`
- `packages/core/src/contracts.ts`
- `docs/implementation/STATUS.md`

Changed existing tests:

- `apps/server/test/api.test.mjs`
- `apps/server/test/audio-request-flow.test.mjs`
- `apps/server/test/director-guidance-maintenance.test.mjs`
- `apps/server/test/director-supervisor.test.mjs`
- `apps/server/test/generation-permission.test.mjs`
- `apps/server/test/installation-recovery-http.test.mjs`
- `apps/server/test/owned-transcription-http.test.mjs`
- `apps/server/test/owned-transcription-review.test.mjs`
- `apps/server/test/pending-edit-continuation.test.mjs`
- `apps/server/test/pending-edit-http.test.mjs`
- `apps/server/test/plan-imports.test.mjs`
- `apps/server/test/prepared-change-publication.test.mjs`
- `apps/server/test/scene-generation.test.mjs`
- `apps/server/test/service.test.mjs`
- `apps/server/test/tool-invocations.test.mjs`
- `apps/server/test/transcription-preparation-backup.test.mjs`

Deleted: none.

## Tests

Added 44 cases: 21 hold lifecycle/route cases, 17 recording/voice cases, three cross-scene cases, and three recovery HTTP cases. They exercise success and refusal, owner isolation, terminal outcomes, restart, stale writes, exact replay, fit/Undo, async media completion, the complete GET matrix, exact audio content, and backup/job/request counts. The existing quarantine write-refusal matrix includes the recording route.

Rewrote obsolete assertions in the API, supervisor, guidance maintenance, pending-edit continuation, scene generation and owned-transcription review tests that expected superseded requests to keep holds or transfer retired authority after Stop. Scene presses explicitly retire superseded whole-film holds and preserve an independent active sibling owner. Where a test needs two live independent owners (audio requests, plural permissions/continuations, imports, service/tool isolation and rollback), its fixture now explicitly creates alongside requests. Every rollback snapshot, grant/candidate boundary, stale-version check, replay check and unknown-outcome/no-resubmission assertion remains. The transcription backup zero-count expectation now uses numeric zero. No tests were deleted or skipped to make the gate pass.

Pinned verification uses Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1. `pnpm setup:test-media` reused matching local tools without a download; `pnpm check:toolchain` passed. Final `pnpm build` passed for all five packages. All **302 tests across the 19 touched test files passed**, zero failures/skips/todo, through `node scripts/run-tests.mjs` with every changed/added test file listed above. The earlier stock-line guard regression found during development was fixed in source; existing narration-fit, scene-confirmation and shot-audio checks passed without changing their assertions.

Final required checks, in order:

- `pnpm build`: all five packages passed.
- Touched-file command above: **302 passed, zero failed/skipped/todo**.
- `pnpm test`: **3,021 total, 3,020 passed, zero failed, one optional native-probe skip, zero todo**. The skipped case is the existing opt-in native Codex probe; no model turn was run. No unchanged failing test remains.
- `pnpm -r typecheck`: **all five packages passed**, zero failures.

Additional validation: `pnpm demo:headless` passed its offline edit/restart proof with **four initial fake accepts plus two scoped replacements, zero duplicate acceptances after restart, and the untouched shot preserved**. Independent review covered hold ownership, stale proposals, restore reads and both asynchronous recording Undo windows. `git diff --check` passed, and `git diff --exit-code HEAD -- apps/web packages/core/src/studio-api.ts` confirmed neither boundary changed.

## Contract changes

None to `packages/core/src/studio-api.ts`: `WaitingReason.requestId?: string` was already present in HEAD. The domain type `ShotRecord.narration.voice` in `contracts.ts` adds the existing stock selector IDs. New route response shapes are described above. No DDL or historical catalog digest changed.

## Commits

Proposed split; nothing staged, committed or pushed:

- `fix(server): retire resolved Director request holds` — `app.ts` release-route hunk; `application/{service,director-supervisor,director-proposals}.ts`; `generation-overview.ts`; `request-holds.test.mjs`; the API, audio-request, guidance, supervisor, permission, owned-transcription, pending-edit, import, prepared-publication, scene-generation, service and tool-invocation test changes listed above.
- `fix(server): allow restored studio inspection reads` — `application/{installation-recovery,recovery-routes}.ts`; `installation-recovery-http.test.mjs`; `transcription-preparation-backup.test.mjs`.
- `feat(narration): import shot recordings and choose stock voices` — `app.ts` stock-read registration; `application/audio-operation-context.ts`; `narration/{default-voice,routes,shot-recording-routes}.ts`; `scene-narration-view.ts`; `storyboard{,-history}.ts`; `packages/core/src/contracts.ts`; `shot-recording-http.test.mjs`.
- `test(server): preserve paid media across scene moves` — `storyboard-cross-scene.test.mjs`.
- `docs: record B13 parity behavior and verification` — this report and `docs/implementation/STATUS.md`.

## Open issues

- All four B13 items and required checks are complete. No known implementation blocker remains. The lead owns review, commits and merge; nothing has been staged, committed or pushed.
- Pending questions and unapplied preparations deliberately retain request-owned holds. An unapplied preparation is identified conservatively by absence of its `change.applied` event; explicit abandonment or supersede retires it. Abandonment supersedes only that request and revokes its epochs, rather than releasing a hold while leaving stale publication authority alive.
- Stock selectors are the shipped provider selector list. Without a film, the read marks `cedar`; with a film, it returns `defaultNarratorVoice`. A personal film default is returned as such, and no stock entry is falsely marked default. Existing takes retain their frozen voice when only the film default changes.
- Recording transport matches the existing audio import (`application/octet-stream`), rather than adding a second set of MIME/size rules. Overlong recordings remain attached and pending; no implicit truncation or speech/transcription purchase occurs. A default label supplies section text when the shot has no written line; it is not a transcription.
- Narration Undo is conservatively unavailable after any later narration workspace edit or paid submission. The owned imported recording remains in the audio library after Undo. No media file or immutable acceptance history is deleted.
- Validation uses disposable stores, synthetic audio and fake transports only. No real provider/model call, personal credential read, external network request, production-state access/restart or port 3001 listener was used. Browser rendering and real-provider quality acceptance are outside this server card.
