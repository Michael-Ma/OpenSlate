# Card B3 (phase P1): edits leave the Director and other shots alone

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it.

## Goal
A person can edit a shot, or press a paid button in one scene, without stopping the Director, freezing the whole film or throwing away paid media that did not change.

## Items (spec = the item's Change in gap-storyboard.md and gap-generation.md)
1. **SB-1 (decision D10, P1 part)**: direct storyboard edits no longer revoke the running Director turn and no longer supersede other requests. Edits that do not touch media (music, order, adding a scene or shot, title) place no hold. A shot edit holds only that shot and releases the hold when the edit commits. The Director's later apply based on an old version is still refused by the existing version checks. Keep audit records.
2. **SB-12**: Brief, Story and scene-direction edits outdate only the shots whose intent digest actually changed (compare per shot), instead of detaching every shot's media.
3. **SB-8**: refuse a shot duration shorter than its accepted narration: 409 `SHOT_SHORTER_THAN_NARRATION` with `{ shotId, narrationFrames, requestedFrames }` so the web can offer "keep the line and cut it" or "make the shot longer".
4. **GR-16**: the busy check for a paid press counts only Director turns and pending questions whose scope intersects the pressed scene or shots (a whole-film turn still intersects everything). Add a `beginRequest` mode that does not supersede active requests outside the command's scope, and use it for scene presses.

## Out of scope
Request `source` and Idempotency-Key (B1, which also edits `beginRequest`; keep your change to its options additive so the two merge cleanly). The overview (B2). Stop (B4). Held Director proposals and "your edit wins" field checks (later card in P4). Anything in apps/web.

## Tests (at least)
- A duration edit on 2.3 while a Director turn runs: the turn stays running, no film-wide hold, only 2.3 is held and the hold is released after the commit.
- Music or order edits place no hold.
- A Director apply based on the pre-edit version is still refused.
- A Brief edit that changes no shot intent detaches nothing; a scene-direction edit outdates only the shots whose intent changed.
- SHOT_SHORTER_THAN_NARRATION with the documented fields.
- A pending question scoped to Scene 3 does not block a Scene 2 generate; one scoped to shot 2.2 does; a press in Scene 2 does not supersede a Scene 3 editing request.
