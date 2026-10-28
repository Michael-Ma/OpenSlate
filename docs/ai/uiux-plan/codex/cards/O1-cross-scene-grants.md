# Card O1: after a new script, every scene's keyframes are refused with ORIGIN_NOT_AUTHORIZED

Read `docs/ai/uiux-plan/codex/RULES.md` and `_review-common.md` in this folder first, and follow them. This is a diagnose-then-fix card on real data. Do not edit `apps/web/**`; the lead does the UI.

**Data:** a copy of the owner's test studio is at
`/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad/diag-o1/openslate.sqlite`
(project `22661e3e-8bc3-4abf-96ad-10738e28b87d`; tables `entities(kind,id,project_id,body,version)`, `events`, `commands`, `projects`). Open it with `sqlite3 -readonly`, or copy it into your own temp dir before running the app against it. Never touch `~/openslate-branch-test`, port 3001, `.openslate/live-validation` or any `.env*` file. No real provider; no media may be bought.

**What happened:** the person approved a new script that changed all 10 shots (3 scenes). The Director then called `make_keyframes` for the whole film (receipt `director_keyframes_receipt` `7eeeffb9…`, request `c75f507c-…`). All three scenes were refused, none started:

| Scene being made | Refused for node | That shot's scene |
|---|---|---|
| `de6f18f6…` (scene 1) | `shot-7df7887b…/keyframe` | `61e9ea0d…` (scene 2) |
| `61e9ea0d…` (scene 2) | `shot-ce744861…/keyframe` | `7bf8ac48…` (scene 3) |
| `7bf8ac48…` (scene 3) | `shot-7df7887b…/keyframe` | `61e9ea0d…` (scene 2) |

The message is `service.ts` `finalizePreparedChange`: "Human generation authorization is required for …". Lead (verify in the data, do not assume): `generateScene` (`apps/server/src/scene-generation.ts`, around `production.authorize(…selected…)` and `applyCompiledSceneGeneration`) authorizes only the selected scene's shots, but the compiled plan it publishes also carries other scenes' image nodes whose spec changed with the new script, so their impact is `new`/`replace` and they need a grant nobody gave. Every scene is blocked by another scene's changed shot, so neither the Director nor the person's own Make keyframes press can ever get through. An earlier run (receipt `d4257862…`, before the new script) started scenes 2 and 3 fine.

**Do:**
1. Diagnose from the data: timeline, the exact impact list for each refused scene, and confirm whether the person's own Make keyframes button (human actor, no `directorActor`) fails the same way.
2. Fix the root cause in server/core. Generating one scene must publish only that scene's paid work: other scenes' changed generation nodes must not need a grant and must not be started or bought. They stay outdated/pending until their own scene is made (whatever the scene-generation design intends; B1 fixed a related case in scene composition, see `git log` for "scene" and the B1 report under `reports/`). Never weaken the grant rule for nodes that will actually run, and keep exact-scope grants.
3. Regression tests from a minimal fixture shaped like the snapshot (a multi-scene film where a new script changes every shot, then one scene, then each scene in turn, for both the Director path and the human path). They must fail before the fix. Do not commit the snapshot.
4. If the refusal needs a clearer code than `ORIGIN_NOT_AUTHORIZED` for any case that remains, say so under Open issues; do not change public codes without listing it.
5. List anything the sample film (`apps/web/src/next/fixtures`) must mirror.

Track V1 runs in parallel and edits the overview/narration and transcription views. Keep your edits away from those files.

Report to `docs/ai/uiux-plan/codex/reports/O1-report.md`.
