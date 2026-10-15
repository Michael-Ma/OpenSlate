# Card B11 (phase P5): scene titles, delete and reorder; project rename and archive; asset library; music vs voice

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it.

## Goal
The backend supports the Plan, Assets, Settings and Start views (decision D16).

## Items (spec = the item's Change in docs/ai/uiux-plan/gap-storyboard.md)
1. **SB-13**: storyboard kinds `sceneTitle` (a new optional `title` on scenes; detaches nothing; no hold), `deleteScene` (an empty scene, or with its shots after an explicit `withShots: true`; refused while attempts in it are running; media stays in the library) and `moveScene` (`beforeId`). Update the JSON schema, caps and the Director context projection. Scene title falls back to the purpose. The generation overview's `SceneOverview.title` uses the real title once this lands (card B2 put the fallback behind one helper).
2. **SB-14**: `POST /api/projects/:projectId/rename {name, expectedHeadVersion}` (keyed, no hold, detaches nothing); archive as `POST /api/projects/:projectId/archive` and `.../unarchive` (soft; refused while attempts are running or unknown; artifacts stay on disk); `GET /api/projects` returns `ProjectListItem` rows (contract in `packages/core/src/studio-api.ts`) with an `includeArchived` query. Duplicate is out of scope (decision D16).
3. **SB-21**: `GET /api/projects/:projectId/assets` returns `AssetItem` rows with role, scene/shot, take index, current flag, source, label and created time, filterable by `sceneId`, `shotId`, `role`. Include audio (voice lines, music, uploads) and exports.
4. **SB-24**: audio-library records carry role music | voice | upload and filter by role; a project setting `narratorVoice` (stock voice id or a ready personal voice id) is the default for new voice lines (including card B7's keyframes press); the storyboard narration field `voice` may be set to personal only when a ready personal voice exists.

## Out of scope
Anything in apps/web.

## Tests (at least)
- sceneTitle detaches nothing; deleteScene refusals and success with withShots; moveScene order; schema and caps.
- rename keyed and hold-free; archive refused while a job runs; list counts; archived hidden by default.
- assets: a film with keyframe takes, a clip, a voice line, music and an export lists each with the right role, shot, take and current flag; filters work.
- narratorVoice default reaches new voice jobs; personal voice refused when none is ready.
