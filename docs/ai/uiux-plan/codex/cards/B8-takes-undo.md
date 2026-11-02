# Card B8 (phase P3, part 2): keep the current take until a new one succeeds, use an earlier take, undo that restores media

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it.

## Goal
Regenerating or editing never silently throws away paid media, and Undo puts back what it took away.

## Items (spec = the item's Change in docs/ai/uiux-plan/gap-generation.md and gap-storyboard.md; decisions D8, D9)
1. **GR-6 / LG-16 (decision D8)**: a keyframe regenerate keeps the current keyframe bound until the new take succeeds; only then does the new take become current, the old one becomes an earlier take, and the shot's clip (if any) is outdated. A failed regenerate leaves the current keyframe and clip untouched. The overview's `takeCount` and `previous` stay right.
2. **Use an earlier take**: `GET /api/projects/:projectId/shots/:shotId/takes` returns `ShotTakes`; `POST /api/projects/:projectId/shots/:shotId/takes/:artifactId/use` (Idempotency-Key required) rebinds an earlier keyframe artifact as current with no new grant, re-verifying its bytes, outdates the dependent clip, and returns `UseTakeReceipt` with a storyboard `commandId` for Undo.
3. **SB-9 (decision D9)**: single-step undo of the last storyboard command restores the media bindings that command detached, but only when the restored intent, prompt and duration are exactly equal to what those outputs were made for; it also undoes narration-fit decisions (card B7) and take switches. Undo is refused (`UNDO_UNAVAILABLE`) once a paid job has used the state after the command.

## Out of scope
Director proposals and their undo (P4). Anything in apps/web.

## Tests (at least)
- Regenerate a shot that has a clip: until the new take lands, the overview still shows the current keyframe and clip; after it lands, the clip is outdated and takeCount is 2; a failed regenerate changes nothing.
- Use an earlier take: bytes verified; clip outdated; no grant minted; undo switches back.
- Undo after a prompt edit restores the keyframe and clip bindings; undo after an edit that a paid job already used is refused; undo after narration-fit restores the duration and the cue.

## Added by the lead after merging B5 and B7
- In the merge, the lead added an upfront check to `SceneConfirmationRunner.confirm` (apps/server/src/scene-confirmations.ts): an open blocking Director note refuses the confirm with RECOMMENDATION_OPEN before any voice line is bought. Add a test for it (combine the notes fixture in apps/server/test/director-notes.test.mjs with the confirmation fixture in apps/server/test/helpers/confirmation-fixture.mjs): no speech attempt, no grant, no record.
- The confirm runner saves voice lines with `language: "en"` hard-coded (scene-confirmations.ts, saveWriting). Derive the language from the line's text (CJK characters → "zh", else "en") or from the project, and test a Chinese line.
