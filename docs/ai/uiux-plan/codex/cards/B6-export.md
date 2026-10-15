# Card B6 (phase P5): export from storyboard order, demo export, hold-free film edits

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it.

## Goal
A finished film exports from the storyboard itself, with one export surface, without needing a Director-written timeline or render plan. The demo film can be exported too, clearly marked.

## Items (spec = the item's Change in docs/ai/uiux-plan/gap-storyboard.md; decision D11)
1. **SB-16**: `GET /api/projects/:projectId/exports` returns `ExportView` and `POST /api/projects/:projectId/exports` (`StartExportInput`, Idempotency-Key required) starts one, both shapes from `packages/core/src/studio-api.ts`. Build the render manifest directly from storyboard order: for each shot its current video output (same checks as `media/timeline-capture.ts`), its accepted shot-relative narration (projectAudioPlacements) and the soundtrack. Reuse LocalMediaService freeze/render/recover and the render job records with a target of {revisionId, inputs} and no plan node. Default 1280×720. Refuse with per-shot reasons (`ExportBlockerCode`). Add `POST .../exports/:exportId/cancel` and `POST .../exports/:exportId/recover` (recover never re-renders). Keep `/media/renders` working for old plans.
2. **SB-17 (server part)**: an export record with headVersion; `outdatedBy` lists what changed since (shots, order, music, narration) by comparing to the current film.
3. **SB-18 (decision D11, option a)**: an all-fixture film exports with a burned-in "Demo" mark, demo clips at their full planned length; a film mixing demo and real media is refused with `mixed_demo_media` per shot.
4. **SB-15**: music and order edits stay hold-free (card B3 did this for the storyboard route; check the soundtrack/music routes too), and the previous export stays downloadable and reported as outdated instead of disappearing.

## Out of scope
The web Film tab (the lead builds it). Timeline editing features beyond what export needs. Real provider calls.

## Tests (at least)
- A 3-shot fake-provider film exports in storyboard order (reorder two shots, export again, the order follows); narration and soundtrack are placed.
- Per-shot refusals: no clip, outdated clip, unsettled voice, empty film, too long.
- An all-fixture film exports with the Demo mark; a mixed film is refused.
- Cancel and recover; recover does not re-render; replaying the start with the same key returns the same export.
- After a music edit the last export is still listed with `outdatedBy: ["music"]`.
- Tests that need ffmpeg use the pinned test media toolchain the repo already uses (`scripts/test-toolchain.mjs`).
