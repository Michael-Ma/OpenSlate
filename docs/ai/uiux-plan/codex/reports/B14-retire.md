# B14 — classic HTTP retirement and current studio documentation

October 16, 2026 · worktree `cx-b14` · branch `cx/b14`.

## Done

- **Item 1 — dead server surface:** audited all 119 expanded baseline HTTP method/path pairs, including generated registrations and optional modules. The complete table below records Next UI, scripts, CLI, launcher, Director bridge, runner and baseline test callers. Final source retains 82 routes and removes 37 (13 GET, 24 POST); no route was added.
- **GR-19:** `GET /api/projects/:projectId/review` uses `engine.inspectReview` for historical-plan diagnostics in ordinary operation and restoration quarantine. It always returns `id: null`; there is no GET-created approval snapshot or cursor cache. `POST /approvals` and `/generation-permission` are removed. The engine's persisted review and exact-input approval remain available to scene confirmation and historical execution evidence.
- **Item 2 — other classic adapters:** removed unused project-provider reads, manual Director-tool HTTP adapters, project narration workspace/session/edit/acceptance/transcript projections, staged speech/transcription proposal/review adapters and shot narration session/script/initialize/accept adapters. Shared narration workspace, canonical, provenance, paid request and runner logic remain unchanged. Retired recovery-inspection entries are removed too.
- **Item 3 — documentation:** README, contributor guidance, STATUS and technical/design guides describe the only current Next UI, P0–P6/cards and UI areas, browser message IDs/tokens, actual scene generation/confirmation, narration-fit, takes, notes, proposals, exports, assets, installation status and recording. Fixture commands distinguish simulated browser Last Ferry from the seeded local studio. Dated validation evidence remains historical.

## Files

### Server source

- `apps/server/src/app.ts`
- `apps/server/src/application/recovery-routes.ts`
- `apps/server/src/generation-permission.ts` (deleted)
- `apps/server/src/narration/narration-speech-routes.ts`
- `apps/server/src/narration/owned-transcription-routes.ts`
- `apps/server/src/narration/routes.ts`
- `apps/server/src/narration/shot-audio-routes.ts`

### Tests and fixtures

- `apps/server/test/api.test.mjs`
- `apps/server/test/artifact-fixture.test.mjs`
- `apps/server/test/director-tools-upgrade.test.mjs`
- `apps/server/test/generated-narration-http.test.mjs`
- `apps/server/test/generation-permission.test.mjs` (deleted)
- `apps/server/test/helpers/confirmation-fixture.mjs`
- `apps/server/test/installation-recovery-http.test.mjs`
- `apps/server/test/narration-http.test.mjs`
- `apps/server/test/narration-speech-http.test.mjs`
- `apps/server/test/owned-transcription-http.test.mjs`
- `apps/server/test/provider-catalog.test.mjs`
- `apps/server/test/request-source.test.mjs`
- `apps/server/test/scene-confirmations.test.mjs`
- `apps/server/test/scene-review-concurrency.test.mjs`
- `apps/server/test/shot-audio-http.test.mjs`
- `apps/server/test/shot-recording-http.test.mjs`
- `apps/server/test/transcript-review-http.test.mjs`
- `apps/server/test/within-shot-export.test.mjs`
- `apps/server/test/workspace.test.mjs`
- `apps/server/test/narration-service-harness.mjs`
- `apps/server/test/retired-routes.test.mjs`

### Documentation

- `AGENTS.md`
- `README.md`
- `docs/design/AUTHORITY-AND-WORKFLOW-REVIEW.md`
- `docs/design/IMPLEMENTATION-PLAN.md`
- `docs/design/OPENSLATE-LIGHT.md`
- `docs/design/README.md`
- `docs/design/STORYBOARD-STUDIO.md`
- `docs/implementation/STATUS.md`
- `docs/technical/APPLICATION-API.md`
- `docs/technical/NARRATION.md`
- `docs/technical/OPERATIONS-TESTING.md`
- `docs/technical/PRODUCTION-WORKFLOW.md`
- `docs/technical/README.md`
- `docs/technical/REVIEW-UI.md`
- `docs/technical/TIMELINE-RENDERING.md`
- `docs/ai/uiux-plan/codex/reports/B14-retire.md`

No `apps/web` source, `packages/core/src/studio-api.ts`, DDL/migration, frozen tool catalog or skill package changed. Dependencies, databases, output/media and build artifacts are not part of the source diff.

## Tests

Verification uses Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1. `pnpm setup:test-media` and `pnpm check:toolchain` passed using installed matching media binaries, with no download.

Final ordered gate:

| Command | Actual result |
|---|---|
| `pnpm build` | All five package builds passed |
| `node scripts/run-tests.mjs` with the 18 changed/added `.test.mjs` files listed above | 196 passed; zero failures/cancelled/skips/todo |
| `pnpm test` | 2,968 passed; zero failures/cancelled/todo; one optional native probe skipped (2,969 total) |
| `pnpm -r typecheck` | All five package typechecks passed; zero failures |
| `git diff --check` | Passed |

The optional skip is `opt-in native Codex probe never starts a model turn`. The full suite's build also passed. The final suite completed in 224.7 seconds. These are the counts observed on this next-only worktree; older STATUS counts describe their original source snapshots. No browser check was run.

### New and rewritten coverage

- Added `retired-routes.test.mjs`: all 37 removed routes return 404, with every projects/entities/events/commands row unchanged and no redispatch of an existing `submission_unknown` paid attempt.
- Rewrote review metadata tests to compare all those tables before/after repeated GETs, an unrelated cursor change and tampered frame bytes. The latter becomes unready immediately instead of reusing an HTTP snapshot cache. Image-only plans remain empty/read-only; recovery tests verify ordinary/quarantined/released inspection all stay read-only while the engine can still create a fresh snapshot explicitly.
- Rewrote approval-key/subset and scoped-replacement assertions against `ProductionService.approve`; exact replay, changed command input and stale review refusal remain. Public API authentication/forged-field checks now exercise the current scene-confirm route. Message-based historical review reply tests remain intact.
- Provider catalog tests call the existing immutable project projection. Director upgrade tests retain real controller methods and exact replay/predecessor/epoch/stale/malformed/busy checks, plus 404 assertions for retired HTTP adapters.
- Narration tests use a test-only data/service harness for removed operation labels; these are not mounted routes or HTTP/auth/schema emulation. Tests still call the actual attachment, transcription, speech, workspace and canonical services. The harness's session records only arrange fixture state; obsolete assertions about its removed orchestration were discarded. Stale writing is checked directly against `workspace.saveWriting`.
- Added current direct speech/transcription HTTP auth, schema, exact-source/section, single-publication/replay and disconnect-before-publication tests. Real retained playback/content/recording/upload requests, scene confirmation, Stop/unknown outcomes and restart remain exercised through actual injection or loopback transport.
- Confirmation/within-shot/export tests arrange narration through shared services, then still drive the real confirmation runner, measured audio and FFmpeg output. The one-second voice/six-second shot test keeps audible-range, silent-tail and music assertions. Recording import/Undo race tests retain their actual HTTP commands and newer unrelated-edit/paid-result assertions.

### Removed or narrowed obsolete tests

- Deleted `generation-permission.test.mjs` (seven tests) with its removed route. The supported scene path's scoped one-use grants, stale/foreign scope, Stop, changed holds, rollback and unknown-outcome checks remain in scene-generation/confirmation, pending-edit-continuation and service suites; the new retirement test also proves the removed path cannot grant or resubmit.
- Deleted two browser `/initialize` orchestration tests from `scene-review-concurrency.test.mjs`; current scene-generation same-head human-request fencing remains there. Actual shot workspace stale-writing and current paid commands retain their own version/replay tests.
- Deleted old full-project narration session-continuation and recording-library GET orchestration tests. Removed actor/path/extra-field and HTTP command-wrapper assertions belonging only to retired session/edit/import/apply routes; retained real service revision, exact acceptance, cross-project/provenance, upload replay and cleanup checks.
- Deleted six old owned-transcription browser-session continuation cases and the full-project workspace-session alongside case because they would only test fixture-created session logic. Current shot/recording/fit alongside requests and human-edit fences remain tested.
- Changed the owned-restoration test to actual retained audio-content/transcription HTTP quarantine checks, rather than asserting a test harness guard.

## Contract changes

None to `packages/core/src/studio-api.ts`. HTTP compatibility changes are explicit in the inventory: 37 routes return 404 and the retained diagnostic `/review` never returns a persisted snapshot ID. Next UI call sites need no edits.

## Commits

No commit, stash, checkout, reset or push was run. The card's RULES reserve review, commits and merges for the lead. Suggested split:

1. `chore(server): retire classic HTTP adapters and make review read-only` — all server source and test/fixture files listed above, including deletion of generation-permission implementation/tests.
2. `docs(studio): document next-only UI and B14 route retirement` — all documentation files listed above, including this report and its complete inventory.

## Open issues

- No implementation blocker remains after the recorded checks. Browser replay stays with the lead outside this sandbox under RULES.md; B14 did not launch a browser or run `pnpm check:browser`.
- Keep `/review` and `/api/installation/status` as bounded authenticated diagnostics despite no current production source caller. The former is useful for inspecting historical plans; neither grants media authority. Lead can remove them in a later compatibility change.
- Keep `/media/renders` for old Director-authored plans as the card requires. Current Film uses storyboard `/exports`.
- Keep direct `/narration/speech`, `/narration/transcriptions` and `/narration/shots/:shotId/generate`: their standalone saved-section/owned-recording/current-shot paid behavior has real integrity/transport tests; owned-recording transcription has no scene-confirm equivalent. They do not retain the deleted browser saga.
- Out-of-repository clients are not observable from this source audit; the removed paths are documented compatibility breaks.
- Checks use disposable stores, fake provider transports and synthetic local media. No real provider/model call, external-network request, personal credential/state read, production restart or port 3001 listener occurred. No live-provider or rendered-browser acceptance is claimed.

## Complete HTTP route inventory

Audit date: October 16, 2026. Source inventory starts from this worktree's unchanged `HEAD` registrations and records the final B14 disposition below. Original source line numbers are audit anchors; removals move later lines.

The baseline has **119 explicit method/path pairs**, including routes emitted by loops. The integrated source currently has **82 explicit pairs**; **37 baseline pairs were removed** and **0 added**. Fastify's automatically exposed `HEAD` for each `GET` is implicit, not an additional application registration.

`P` means `/api/projects/:projectId`; `N` means `P/narration`. Every row is one expanded route. Next UI evidence is under `apps/web/src/next/` (short filenames identify that tree). Test names mean `apps/server/test/<name>.test.mjs` unless explicitly identified as a probe. Test callers are the baseline callers checked before retirement; the B14 report lists rewrites/deletions and final checks. A test-only path does not by itself establish a production client.

## Caller coverage and dynamic paths

- Searched every TypeScript registration in `apps/server/src`, resolving `base`, `path`, recovery constants and route loops. Project library emits rename, archive, unarchive and settings/voice; proposal actions emit reject and undo; export actions emit cancel and recover; transcript actions emit words and timing. `/*` serves the installed document and built assets; unknown API/internal paths still return 404.
- Next UI paths are often project-relative. Checked `store.read`, `store.command`, the central `path(...)` helper, model request builders, raw-upload XHR, direct audio `fetch`, artifact fetching and SSE, rather than grepping `/api/` alone. Fixture-only pseudo-routes and comments are not production HTTP callers.
- `scripts/local-server.mjs` calls health; `scripts/browser/*` are test callers of the active UI and have direct reads for projects/session and image uploads. `scripts/storyboard-review.mjs` and `scripts/fixtures/*` seed through application services, not old HTTP endpoints. No browser/probe/server was launched for this inventory.
- `studio-cli.ts` delegates to `studio-launcher.ts`, which POSTs studio/launch; the launcher opens the returned document URL. `installation-cli.ts` uses backup/restore filesystem services directly and calls no HTTP route.
- The Director's only application HTTP surface is `POST /internal/projects/:projectId/tools/:tool` through `packages/director/src/tools/bridge.ts` (also the fake-MCP probe). The `:tool` parameter is dynamically validated against the pinned tool contract, not a collection of browser endpoints.
- Server confirmation, keyframe narration, recording and fit runners do **not** fetch these HTTP routes. They share `createShotNarrationSession`, `createShotAudioWorkspace` (`detail`, `saveWriting`, `actorForShot`, `accept`), narration attachment/canonical services and `NarrationSpeechService.request`. Retiring an HTTP adapter does not retire those service behaviors. `engine.approve` remains used by scene generation.
- Spending, budget and allowance HTTP routes were already unmounted before B14. Their accounting, reservation, admission and reconciliation services remain. The obsolete `/spending` recovery-allowlist entry is removed with retired routes; it was not an HTTP registration.
- Conditional mounting remains: session routes require `studioSessions`; restoration/SSE require a service; narration/media/image routes require their configured service ports; scene confirm/fit require a confirmation runner; the document wildcard requires built web assets. GET health and common authenticated routes remain registered without those optional services, returning the established service-unavailable error where appropriate.

## Complete route table


### Application and runtime

| Method and route | Registration before B14 | Next UI caller | Other production HTTP caller | Baseline test callers | Final disposition |
| --- | --- | --- | --- | --- | --- |
| `POST P/requests/:requestId/release-holds` | `app.ts:83` | held edit: `director/HeldEdits.tsx` | none | request-holds | kept; active caller |
| `GET /api/health` | `app.ts:133` | none | `scripts/local-server.mjs` launcher readiness probe | api; launcher-smoke | kept; active caller |
| `GET /api/providers` | `app.ts:147` | Start, Settings: `model/start-commands.ts`, `SettingsView.tsx` | none | api; provider-catalog; project-library | kept; active caller |
| `GET /api/installation/status` | `app.ts:148` | none | none | installation-status; installation-recovery-http | kept; installation diagnostic contract |
| `GET P/providers` | `app.ts:159` | none | none | provider-catalog; installation-recovery-http | removed; no production HTTP caller |
| `GET P/settings/models` | `app.ts:166` | Settings: `SettingsView.tsx`, `ModelsPanel.tsx` | none | project-model-settings; installation-recovery-http | kept; active caller |
| `POST P/settings/models/preview` | `app.ts:167` | Settings: `model/settings.ts` | none | project-model-settings; installation-recovery-http | kept; active caller |
| `POST P/settings/models/apply` | `app.ts:178` | Settings: `model/settings.ts` | none | project-model-settings; installation-recovery-http | kept; active caller |
| `POST /api/projects` | `app.ts:186` | Start: `model/start-commands.ts` | none | api; provider-catalog; project-library | kept; active caller |
| `GET P` | `app.ts:197` | canonical snapshot: `store/store.ts` | none | workspace; api; installation-recovery-http | kept; active caller |
| `GET P/director` | `app.ts:198` | Director state: `store/store.ts` | none | workspace; api; installation-recovery-http | kept; active caller |
| `GET P/director/setup` | `app.ts:202` | Start, Settings: `model/start-commands.ts`, `SettingsView.tsx` | none | local-director; installation-status; installation-recovery-http | kept; active caller |
| `GET P/director/models` | `app.ts:206` | Settings computer check: `ComputerPanel.tsx` | none | local-director; installation-status; installation-recovery-http | kept; active caller |
| `GET P/director/tools` | `app.ts:210` | none | none | director-tools-upgrade; installation-recovery-http (GET) | removed; no production HTTP caller |
| `POST P/director/tools/upgrade` | `app.ts:214` | none | none | director-tools-upgrade | removed; no production HTTP caller |
| `POST P/director/setup` | `app.ts:220` | Start, Settings: `model/start-commands.ts`, `model/settings-director.ts` | none | local-director; installation-status; installation-recovery-http | kept; active caller |
| `POST P/director/change` | `app.ts:226` | Settings: `model/settings-director.ts` | none | director-model-change | kept; active caller |
| `POST P/messages` | `app.ts:233` | Director message/answer: `store/store.ts` | none | api; request-source; director-images; local-director | kept; active caller |
| `POST P/demo` | `app.ts:260` | Start demo: `model/start-commands.ts` | none | workspace; api; provider-catalog | kept; active caller |
| `GET P/review` | `app.ts:294` | none | none | workspace; artifact-fixture; api; installation-recovery-http | kept read-only; historical-plan diagnostic |
| `GET P/artifacts/:artifactId/content` | `app.ts:320` | verified media: `api/client.ts`; Film download: `FilmView.tsx` | none | artifact-fixture; api; media-http | kept; active caller |
| `POST P/approvals` | `app.ts:336` | none | none | workspace; api; installation-recovery-http | removed; no production HTTP caller |
| `POST P/controls` | `app.ts:342` | Stop/Continue: `store/store.ts` | none | api; stop-release; pending-edit-http | kept; active caller |
| `POST P/attempts/:attemptId/release` | `app.ts:353` | give up waiting: `store/store.ts` | none | stop-release; takes-undo | kept; active caller |
| `POST /internal/projects/:projectId/tools/:tool` | `app.ts:364` | none | `packages/director/src/tools/bridge.ts`; fake-MCP probe | api; tool-invocations; Director bridge tests | kept; active caller |

### Other registered surfaces

| Method and route | Registration before B14 | Next UI caller | Other production HTTP caller | Baseline test callers | Final disposition |
| --- | --- | --- | --- | --- | --- |
| `POST P/director/notes/:noteId/resolve` | `application/director-notes.ts:139` | note choices: `store/store.ts` | none | director-notes | kept; active caller |
| `GET P/director/proposals` | `application/director-proposals.ts:181` | proposal refresh: `store/store.ts` | none | director-proposals | kept; active caller |
| `POST P/director/proposals/:proposalId/accept` | `application/director-proposals.ts:182` | proposal accept: `store/store.ts` | none | director-proposals | kept; active caller |
| `POST P/director/proposals/:proposalId/reject` | `application/director-proposals.ts:184` | proposal reject: `store/store.ts` | none | director-proposals | kept; active caller |
| `POST P/director/proposals/:proposalId/undo` | `application/director-proposals.ts:184` | proposal Undo: `store/store.ts` | none | director-proposals | kept; active caller |
| `GET P/settings/director-review` | `application/keyframe-review.ts:53` | Settings: `SettingsView.tsx` | none | keyframe-review | kept; active caller |
| `POST P/settings/director-review` | `application/keyframe-review.ts:54` | Settings: `model/settings-director.ts` | none | keyframe-review | kept; active caller |
| `GET P/events` | `application/project-event-stream.ts:69` | SSE: `api/client.ts` | none | project-event-stream; api | kept; active caller |
| `GET /api/installation/recovery` | `application/recovery-routes.ts:14` | restore review: `store/store.ts`, `model/recovery.ts` | none | installation-recovery-http | kept; active caller |
| `POST /api/installation/recovery/release` | `application/recovery-routes.ts:16` | finish restore review: `store/store.ts` | none | installation-recovery-http | kept; active caller |
| `GET P/assets` | `asset-library.ts:88` | Assets: `views/assets/useAssetList.ts` | none | asset-library; installation-recovery-http | kept; active caller |
| `GET P/generation` | `generation-overview.ts:180` | generation overview: `store/store.ts` | none | generation-overview | kept; active caller |
| `POST P/shots/:shotId/frame-views` | `generation-overview.ts:181` | frame-open evidence: `store/store.ts` | none | generation-overview | kept; active caller |
| `POST P/generation-permission` | `generation-permission.ts:12` | none | none | generation-permission | removed; no production HTTP caller |

### Media and imports

| Method and route | Registration before B14 | Next UI caller | Other production HTTP caller | Baseline test callers | Final disposition |
| --- | --- | --- | --- | --- | --- |
| `GET P/images` | `media/image-routes.ts:35` | import capabilities: `views/assets/ImportSheet.tsx` | none | image-http; installation-recovery-http | kept; active caller |
| `POST P/images/uploads` | `media/image-routes.ts:47` | PNG import: `model/assets-import.ts`, `views/assets/upload.ts` | none | image-http; installation-recovery-http | kept; active caller |
| `GET P/media` | `media/routes.ts:66` | Film current/old render state: `views/film/FilmView.tsx` | none | media-http; installation-recovery-http | kept; active caller |
| `GET P/exports` | `media/routes.ts:72` | Film export: `views/film/FilmView.tsx` | none | storyboard-export; installation-recovery-http (GET) | kept; active caller |
| `POST P/exports` | `media/routes.ts:73` | Film export: `views/film/FilmView.tsx` | none | storyboard-export; installation-recovery-http (GET) | kept; active caller |
| `POST P/exports/:exportId/cancel` | `media/routes.ts:83` | Film cancel: `views/film/FilmView.tsx` | none | storyboard-export; installation-recovery-http (GET) | kept; active caller |
| `POST P/exports/:exportId/recover` | `media/routes.ts:83` | Film reconcile: `views/film/FilmView.tsx` | none | storyboard-export; installation-recovery-http (GET) | kept; active caller |
| `POST P/media/uploads` | `media/routes.ts:98` | video import: `model/assets-import.ts`, `views/assets/upload.ts` | none | media-http; installation-recovery-http | kept; active caller |
| `POST P/media/renders` | `media/routes.ts:124` | none | none | media-http; installation-recovery-http | kept; old-plan compatibility required by B14 |
| `GET P/media/renders/:jobId` | `media/routes.ts:131` | none | none | media-http; installation-recovery-http | kept; old-plan compatibility required by B14 |
| `POST P/media/renders/:jobId/run` | `media/routes.ts:132` | none | none | media-http; installation-recovery-http | kept; old-plan compatibility required by B14 |
| `POST P/media/renders/:jobId/cancel` | `media/routes.ts:138` | none | none | media-http; installation-recovery-http | kept; old-plan compatibility required by B14 |
| `POST P/media/renders/:jobId/recover` | `media/routes.ts:142` | none | none | media-http; installation-recovery-http | kept; old-plan compatibility required by B14 |

### Other registered surfaces

| Method and route | Registration before B14 | Next UI caller | Other production HTTP caller | Baseline test callers | Final disposition |
| --- | --- | --- | --- | --- | --- |
| `POST P/shots/:shotId/narration-fit` | `narration-fit.ts:71` | free fit: `store/store.ts` | none | narration-fit | kept; active caller |

### Narration and recording

| Method and route | Registration before B14 | Next UI caller | Other production HTTP caller | Baseline test callers | Final disposition |
| --- | --- | --- | --- | --- | --- |
| `GET P/audio-library` | `narration/audio-library-routes.ts:25` | Assets, Film music: `ImportSheet.tsx`, `useMusicLibrary.ts` | none | audio-library-http | kept; active caller |
| `POST P/audio-library/uploads` | `narration/audio-library-routes.ts:47` | audio import: `model/assets-import.ts`, `views/assets/upload.ts` | none | audio-library-http | kept; active caller |
| `GET N/speech-options` | `narration/narration-speech-routes.ts:27` | none | none | narration-speech-http; shot-audio-http (POSTs) | removed; no production HTTP caller |
| `GET N/speech-proposals` | `narration/narration-speech-routes.ts:30` | none | none | narration-speech-http; shot-audio-http (POSTs) | removed; no production HTTP caller |
| `GET N/speech-proposals/:proposalId` | `narration/narration-speech-routes.ts:33` | none | none | narration-speech-http; shot-audio-http (POSTs) | removed; no production HTTP caller |
| `POST N/speech-proposals` | `narration/narration-speech-routes.ts:36` | none | none | narration-speech-http; shot-audio-http (POSTs) | removed; no production HTTP caller |
| `POST N/speech-reviews` | `narration/narration-speech-routes.ts:45` | none | none | narration-speech-http; shot-audio-http (POSTs) | removed; no production HTTP caller |
| `POST N/speech` | `narration/narration-speech-routes.ts:52` | none | none | narration-speech-http; shot-audio-http (POSTs) | kept; paid request compatibility/integrity tests |
| `GET N/transcription-options` | `narration/owned-transcription-routes.ts:41` | none | none | owned-transcription-http | removed; no production HTTP caller |
| `GET N/transcription-proposals` | `narration/owned-transcription-routes.ts:48` | none | none | owned-transcription-http | removed; no production HTTP caller |
| `GET N/transcription-proposals/:proposalId` | `narration/owned-transcription-routes.ts:52` | none | none | owned-transcription-http | removed; no production HTTP caller |
| `POST N/transcription-proposals` | `narration/owned-transcription-routes.ts:56` | none | none | owned-transcription-http | removed; no production HTTP caller |
| `POST N/transcription-reviews` | `narration/owned-transcription-routes.ts:66` | none | none | owned-transcription-http | removed; no production HTTP caller |
| `POST N/transcriptions` | `narration/owned-transcription-routes.ts:73` | none | none | owned-transcription-http | kept; paid request compatibility/integrity tests |
| `GET N/personal-voices` | `narration/personal-voice-routes.ts:13` | Settings Voice: `SettingsView.tsx` | none | personal-voice-http | kept; active caller |
| `POST N/personal-voices` | `narration/personal-voice-routes.ts:18` | Settings Voice: `model/settings-voice.ts` | none | personal-voice-http | kept; active caller |
| `POST N/personal-voices/:identityId/revoke` | `narration/personal-voice-routes.ts:31` | Settings Voice: `model/settings-voice.ts` | none | personal-voice-http | kept; active caller |
| `GET N` | `narration/routes.ts:90` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `GET N/generated-recordings` | `narration/routes.ts:91` | none | none | generated-narration-http | removed; no production HTTP caller |
| `GET N/audio/:audioId/transcripts` | `narration/routes.ts:94` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `GET N/transcripts/:candidateId/words` | `narration/routes.ts:97` | none | none | transcript-review-http | removed; no production HTTP caller |
| `GET N/transcripts/:candidateId/selection` | `narration/routes.ts:100` | none | none | transcript-review-http | removed; no production HTTP caller |
| `GET N/audio/:audioId/content` | `narration/routes.ts:103` | verified audio: `keyframes/narration-media.ts`, `views/assets/media.ts`, `useLiveAudio.ts` | none | narration-http; audio-library-http; installation-recovery-http | kept; active caller |
| `POST N/sessions` | `narration/routes.ts:115` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/segments` | `narration/routes.ts:138` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/bindings` | `narration/routes.ts:141` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/generated-audio-bindings` | `narration/routes.ts:144` | none | none | generated-narration-http | removed; no production HTTP caller |
| `POST N/transcript-words` | `narration/routes.ts:153` | none | none | transcript-review-http | removed; no production HTTP caller |
| `POST N/transcript-timing` | `narration/routes.ts:153` | none | none | transcript-review-http | removed; no production HTTP caller |
| `POST N/cues` | `narration/routes.ts:162` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/placements` | `narration/routes.ts:165` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/acceptances` | `narration/routes.ts:168` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/audio-acceptances` | `narration/routes.ts:171` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/prepare` | `narration/routes.ts:174` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/apply` | `narration/routes.ts:177` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `POST N/audio` | `narration/routes.ts:182` | none | none | narration-http; generated-narration-http; transcript-review-http; shot-audio-http | removed; no production HTTP caller |
| `GET N/shots/:shotId` | `narration/shot-audio-routes.ts:422` | shot inspector: `keyframes/NarrationPanel.tsx` via `useResource` | none | shot-audio-http; generated-narration-http; scene-confirmations; within-shot-export | kept; active caller |
| `POST N/shots/:shotId/sessions` | `narration/shot-audio-routes.ts:426` | none | none | shot-audio-http; generated-narration-http; scene-confirmations; within-shot-export | removed; no production HTTP caller |
| `POST N/shots/:shotId/script` | `narration/shot-audio-routes.ts:452` | none | none | shot-audio-http; generated-narration-http; scene-confirmations; within-shot-export | removed; no production HTTP caller |
| `POST N/shots/:shotId/generate` | `narration/shot-audio-routes.ts:497` | none | none | shot-audio-http; generated-narration-http; scene-confirmations; within-shot-export | kept; paid request compatibility/integrity tests |
| `POST N/shots/:shotId/initialize` | `narration/shot-audio-routes.ts:688` | none | none | shot-audio-http; generated-narration-http; scene-confirmations; within-shot-export | removed; no production HTTP caller |
| `POST N/shots/:shotId/accept` | `narration/shot-audio-routes.ts:804` | none | none | shot-audio-http; generated-narration-http; scene-confirmations; within-shot-export | removed; no production HTTP caller |
| `GET N/playback` | `narration/shot-audio-routes.ts:853` | Film narration/music: `views/film/FilmView.tsx` | none | shot-audio-http; within-shot-export; installation-recovery-http | kept; active caller |
| `GET /api/narration/voices` | `narration/shot-recording-routes.ts:19` | stock voices: `keyframes/NarrationPanel.tsx` | none | shot-recording-http | kept; active caller |
| `POST P/shots/:shotId/narration/recording` | `narration/shot-recording-routes.ts:32` | recording import: `model/narration-recording.ts`, `NarrationPanel.tsx` | none | shot-recording-http | kept; active caller |

### Other registered surfaces

| Method and route | Registration before B14 | Next UI caller | Other production HTTP caller | Baseline test callers | Final disposition |
| --- | --- | --- | --- | --- | --- |
| `POST P/plan-imports` | `plan-imports.ts:9` | Start/Plan import: `model/start-commands.ts`, `views/plan/commands.ts` | none | plan-imports | kept; active caller |
| `GET P/plan-imports` | `plan-imports.ts:30` | Plan pending import: `views/plan/PlanView.tsx` | none | plan-imports | kept; active caller |
| `POST P/plan-imports/:requestId/confirm` | `plan-imports.ts:42` | Plan confirm: `views/plan/commands.ts` | none | plan-imports | kept; active caller |
| `POST P/plan-imports/:requestId/discard` | `plan-imports.ts:45` | Plan discard: `views/plan/commands.ts` | none | plan-imports | kept; active caller |
| `GET /api/projects` | `project-library.ts:35` | film library: `store/store.ts`, `model/start-commands.ts` | none | api; provider-catalog; project-library | kept; active caller |
| `POST P/rename` | `project-library.ts:52` | film library: `model/start-commands.ts` | none | project-library; scene-confirmations (voice POST) | kept; active caller |
| `POST P/archive` | `project-library.ts:52` | film library: `model/start-commands.ts` | none | project-library; scene-confirmations (voice POST) | kept; active caller |
| `POST P/unarchive` | `project-library.ts:52` | film library: `model/start-commands.ts` | none | project-library; scene-confirmations (voice POST) | kept; active caller |
| `POST P/settings/voice` | `project-library.ts:52` | Settings: `model/settings-voice.ts` | none | project-library; scene-confirmations (voice POST) | kept; active caller |
| `GET P/settings/voice` | `project-library.ts:81` | Settings: `SettingsView.tsx` | none | project-library; scene-confirmations (voice POST) | kept; active caller |
| `POST P/scenes/:sceneId/confirm` | `scene-confirmations.ts:226` | scene confirm: `store/store.ts` | none | scene-confirmations; scene-generation; scene-undercoverage; scene-review-concurrency | kept; active caller |
| `GET P/scenes/:sceneId/generation` | `scene-generation.ts:190` | exact generation read: `store/store.ts` | none | scene-confirmations; scene-generation; scene-undercoverage; scene-review-concurrency | kept; active caller |
| `POST P/scenes/:sceneId/generate` | `scene-generation.ts:197` | keyframe generation: `store/store.ts` | none | scene-confirmations; scene-generation; scene-undercoverage; scene-review-concurrency | kept; active caller |
| `GET P/shots/:shotId/takes` | `shot-takes.ts:63` | takes: `model/keyframes-takes.ts` | none | takes-undo | kept; active caller |
| `POST P/shots/:shotId/takes/:artifactId/use` | `shot-takes.ts:65` | use take: `model/keyframes-takes.ts` | none | takes-undo | kept; active caller |
| `POST P/storyboard` | `storyboard.ts:537` | Plan/Film/inspector edits: `store/store.ts`, `views/plan/commands.ts`, `FilmView.tsx` | none | storyboard; storyboard-cross-scene; within-shot-export | kept; active caller |
| `POST /api/studio/launch` | `studio-sessions.ts:61` | none | `studio-cli.ts` → `studio-launcher.ts` | studio-sessions; web-assets | kept; active caller |
| `POST /api/session` | `studio-sessions.ts:62` | pairing: `api/client.ts` | none | studio-sessions; web-assets | kept; active caller |
| `GET /api/session` | `studio-sessions.ts:69` | session/CSRF: `api/client.ts`, `views/assets/upload.ts` | none | studio-sessions; web-assets | kept; active caller |
| `POST /api/session/logout` | `studio-sessions.ts:74` | disconnect: `store/store.ts` | none | studio-sessions; web-assets | kept; active caller |
| `GET /*` | `web-assets.ts:83` | installed studio document/assets: `boot.tsx` | none | web-assets | kept; active caller |

## Removal boundaries

The retired project-provider and Director-tool adapters had no Next, scripts, CLI, launcher, bridge or runner HTTP caller. Provider catalog tests now inspect immutable `projectView` directly. Tool-upgrade tests retain direct `tools`/`upgradeTools` checks for exact replay, immutable predecessor/epoch binding, stale inputs, malformed fields and busy epochs. Automatic compatible upgrades still run in the native input preparation path.

`GET P/review` is retained as a read-only historical-plan inspection path. It uses `engine.inspectReview`; it creates no `review_snapshot` entity and grants no video authority. The current UI reads `GET P/generation`, records exact frame views and calls scene confirm. `POST P/approvals` and generation-permission are removed; scene confirmation retains `engine.approve` with its current frame/motion fences.

The old browser narration saga routes can be retired independently of the service methods used by scene confirm, recording import and free narration-fit. Relevant money/integrity tests must continue through retained requests or direct services: unknown-outcome reconciliation, no duplicate provider dispatch, exact writing/frame versions, generated provenance, accepted sample ranges, Stop/holds and idempotent replay remain required.

## Open issues

No repository source caller was found for the retained installation diagnostic or read-only historical review. They are retained deliberately as bounded diagnostics. This source audit cannot establish unknown out-of-repository clients; removed routes return 404 and are documented in B14. No runtime credentials, saved installation state, external provider or external network was accessed.
