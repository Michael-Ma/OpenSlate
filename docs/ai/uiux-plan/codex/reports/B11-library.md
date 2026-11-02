# B11 library implementation report

## Done

- **SB-13:** Added optional scene titles and `sceneTitle`, `deleteScene`, `moveScene` storyboard commands, HTTP schemas and the existing 64-scene/shot bounds. Titles preserve all media bindings (including assembly), grants, existing holds and Director epochs. Generation overview uses the explicit title with the existing purpose fallback; Director overview and scene pages expose titles. Deletion requires `withShots: true` for populated scenes and refuses unresolved work in their shots, including speech whose node has no direct shot ID. It detaches the deleted shots while retaining artifacts, attempts and historical associations in Assets. Scene order controls shot-relative playback without altering historical acceptance.
- **SB-14:** Added keyed rename/archive/unarchive routes. Rename checks the expected head and changes no bindings, messages, holds or authority. Archive refuses unresolved paid work, including released unknown submissions, and pending local exports. Archived projects remain readable and retain their files/receipts; the engine does not dispatch their queued work. The project list returns the exact `ProjectListItem` fields, hides archived films by default, and supports `includeArchived=true`.
- **SB-21:** Assets joins project-local artifacts, attempts, bindings, narration scope/proposal/canonical records and historical storyboard revisions. Rows follow `AssetItem`, with all six roles, scene/shot associations, stable successful-take indices, current flags, sources, labels, timestamps and available measured duration. Filters run before 40-item pagination. Audio records and their corresponding published artifacts are deduplicated by identity; exports retain the Demo export label. Public references contain no storage paths or receipts.
- **SB-24:** Owned audio uploads carry music/voice/upload roles; library reads filter by role before paging. Soundtrack selection and narration attachment tag their library role without changing immutable audio provenance. Added a keyed project narrator setting and shared default resolver for new shot generation, scene narration choices and host shot-script materialization. Existing scripts, accepted audio and captured requests retain their selected voice. The personal narration flag requires a ready, consented project voice; dispatch still checks revocation/provider eligibility.

## Files

Changed:

- `packages/core/src/contracts.ts`
- `apps/server/src/app.ts`
- `apps/server/src/application/context-projection.ts`
- `apps/server/src/asset-library.ts`
- `apps/server/src/execution/engine.ts`
- `apps/server/src/generation-overview.ts`
- `apps/server/src/narration/audio-library-routes.ts`
- `apps/server/src/narration/service.ts`
- `apps/server/src/narration/shot-audio-routes.ts`
- `apps/server/src/narration/types.ts`
- `apps/server/src/persistence/store.ts`
- `apps/server/src/scene-narration-view.ts`
- `apps/server/src/storyboard.ts`
- `apps/server/test/asset-library.test.mjs`
- `apps/server/test/audio-library-http.test.mjs`
- `apps/server/test/mapped-speech-intent.test.mjs`
- `apps/server/test/requested-narration-scope-persistence.test.mjs`
- `apps/server/test/shot-audio-http.test.mjs`
- `apps/server/test/storyboard.test.mjs`

Added:

- `apps/server/src/project-library.ts`
- `apps/server/src/narration/audio-library-role.ts`
- `apps/server/src/narration/default-voice.ts`
- `apps/server/test/project-library.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B11-library.md`

Deleted: none. No web files, database migrations, credentials or installed runtime state changed.

## Tests

New cases cover title binding/hold preservation and projections; populated/empty scene deletion, running-job refusal and retained media; scene reorder, HTTP validation and cap rollback; keyed/stale rename, exact list counts, archive/unknown/local-render refusal, bodyless archive, hidden archives, unarchive and retained receipts; mixed asset roles, take numbering/current state, scope/role/kind filtering; audio-role persistence/filtering/idempotency; stock/personal narrator defaults, readiness/revocation and unchanged old writing; and host materialization with an omitted voice.

Existing tests rewritten:

- `asset-library.test.mjs`: audio is now included and `source` uses the public contract's `imported` value. The legacy `source=uploaded` query remains an alias. Updated pagination totals accordingly.
- `mapped-speech-intent.test.mjs` and the personal-voice case in `shot-audio-http.test.mjs`: register a consented ready offline identity before selecting the personal flag. All stale-intent, reservation, no-extra-dispatch and historical-result assertions remain.
- `shot-audio-http.test.mjs`: the scene-order playback assertion now uses the actual `moveScene` command instead of mutating stored scenes directly.

15 tests added. No tests deleted. No money/integrity assertions removed. An earlier full run exposed five personal-voice fixture assumptions and the dropped Demo export label; both were corrected before the passing final gate.

Pinned toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. Setup required no download. No live provider calls or personal credentials were used.

- `pnpm setup:test-media` and `pnpm check:toolchain`: passed.
- `pnpm build`: passed.
- Final targeted files plus unchanged storyboard export regression: **86 passed, 0 failed**.
- Final `pnpm test`: **2,526 passed, 0 failed, 1 skipped** (2,527 total; optional live native probe skipped), 372.679 seconds.
- Final `pnpm -r typecheck`: **all 5 workspace packages passed**, zero failures (core, providers, director, server and web).
- `git diff --check`: passed.

## Contract changes

None in `packages/core/src/studio-api.ts`. Project/domain records add optional scene `title`, `archived`, `narratorVoice` and `updatedAt` fields. Audio records may carry a role; library entries always expose their role. The narrator setting is `GET/POST /api/projects/:projectId/settings/voice`; POST takes `{ narratorVoice, expectedHeadVersion }` and an Idempotency-Key. Personal IDs use the existing public voice selector (`personalVoices[].id`, e.g. `openai-custom:voice_...`).

## Commits

None created, as required by RULES.md. Proposed split:

1. `feat(library): add scene project and audio library management`
   - `packages/core/src/contracts.ts`
   - `apps/server/src/app.ts`, `application/context-projection.ts`, `asset-library.ts`, `execution/engine.ts`, `generation-overview.ts`, `project-library.ts`, `persistence/store.ts`, `scene-narration-view.ts`, `storyboard.ts`
   - `apps/server/src/narration/audio-library-role.ts`, `audio-library-routes.ts`, `default-voice.ts`, `service.ts`, `shot-audio-routes.ts`, `types.ts`
   - `apps/server/test/asset-library.test.mjs`, `audio-library-http.test.mjs`, `mapped-speech-intent.test.mjs`, `project-library.test.mjs`, `requested-narration-scope-persistence.test.mjs`, `shot-audio-http.test.mjs`, `storyboard.test.mjs`
2. `docs(library): record B11 validation and integration decisions`
   - `docs/ai/uiux-plan/codex/reports/B11-library.md`

## Open issues

- Decision: use the card's POST archive/unarchive paths rather than the older gap document's DELETE suggestion. Archive accepts no body or `{}`; optional `expectedHeadVersion` adds stale-head protection. Unknown submissions remain blockers even after human release, because release does not settle liability. Pending/interrupted exports must finish, fail or be cancelled first.
- Decision: a blank scene title is refused, consistent with existing storyboard text edits. Existing untitled scenes retain purpose-based labels; no migration is needed.
- Decision: `current` means an active selected binding/accepted voice/current export. Retained takes for deleted shots are historical. Muting selected music does not deselect it. A new default voice affects new commands only; saved voice choices remain authoritative.
- Decision: roles on mutable library-label records preserve immutable recording provenance. Selecting a recording as music/voice tags it accordingly; currently selected soundtrack music takes precedence on reads. Uploads can declare a role through `?role=music|voice|upload`.
- Audio download integration: owned audio that has not been published as a canonical artifact remains playable/downloadable through the existing `/narration/audio/:audioId/content` route; published generated audio uses the artifact content route. Assets exposes public audio identities without copying files or bypassing either route's ownership checks.
- Compatibility: project lists intentionally return the agreed `ProjectListItem` shape instead of the old `shotCount/headVersion/activePlanId` list fields; asset sources use `generated/imported/demo`, with legacy source query aliases retained. Frontend integration belongs to the lead.
- B7's keyframe/voice command is not present in this branch. Its existing host materialization entry point now supports an omitted voice and resolves the project default, with a passing regression. B7 should omit the voice for new lines or call the shared default resolver when freezing its command; explicit saved voice choices must remain pinned.
- Historical artifacts without a recorded creation timestamp use their attempt time, then the project's first recorded event; new artifacts/recordings store exact insertion timestamps in the JSON `asset_metadata` kind. This is metadata fallback, not a fabricated historical generation time.
- No remaining implementation blocker. Verification is offline only; no real-provider or browser/UI acceptance is claimed.
