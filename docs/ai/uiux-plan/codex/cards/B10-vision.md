# Card B10 (phase P4, part 3): the Director sees keyframes, reviews new batches, reports honestly; Last Ferry demo

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it. Cards B5 and B9 are merged in your tree.

## Goal
The Director can actually look at the keyframes it comments on, reviews each new batch by itself when allowed, and the thread tells the truth about what it is doing. A scripted demo reproduces the design end to end.

## Items (spec = the item's Change in docs/ai/uiux-plan/gap-agent.md; decision D4)
1. **Codex image input check first (decision D4)**: find out, without a model call if possible, whether the pinned Codex runtime accepts image input in a turn and whether MCP tool results with images reach the model (for example `codex app-server generate-json-schema` or the protocol types in the installed package). Write the finding in your report. Only if the schema cannot settle it, you may make at most two bounded native Codex turns with a tiny test image through the existing local Director path, and record exactly what you ran and the outcome. Never run anything else live.
2. **DC-7**: a KeyframeProjector that attaches the current keyframes of in-scope shots to scene- or shot-scoped turns and review turns: at most 4 images (user references first), else one contact sheet (ffmpeg tile, ≤ 4096 px, ≤ 512 KiB) with its tile order in the context; `request_keyframe_projection` records what was attached; `record_notes.seenKeyframe` must match it; fixture (SVG) keyframes are described, not attached.
3. **DC-8**: when every image node of one keyframes press is terminal and the Director is idle, and the per-project setting `directorReviewsKeyframes` (default on; a setting route or field the settings UI can toggle) allows it, start one discuss-only application request (source "app", editing false, scope = the scene's shots, key = digest of the batch) whose turn may only read context, record notes and propose changes. Busy checks for presses ignore these turns.
4. **DC-16 + DC-17**: honest turn progress and endings (a turn that ends with no reply says so; a failed turn says it failed) exposed in the snapshot for the thread; structured answers to Director questions (the answer carries the chosen option index as well as text).
5. **DC-13 (rest)**: a Last Ferry demo: `node scripts/storyboard-review.mjs --fixtures --film last-ferry` seeds the 3-scene, 8-shot Last Ferry film from `apps/web/src/next/fixtures/last-ferry.ts`'s data (copy the data into the script or a shared JSON; do not import web code from the server) in the prototype's starting state, with the scripted Director's notes (a) and (b) on Scene 2.

## Out of scope
Anything in apps/web.

## Tests (at least)
- Projection: ≤ 4 keyframes attach as images, more become one contact sheet; seenKeyframe mismatch rejects the note; fixture keyframes are not attached.
- Review trigger: runs once per batch, only when idle and allowed; ignored by press busy checks; never shows as a user message.
- Turn endings: no-reply and failed endings are reported; structured answers keep the option index.
- The Last Ferry seed starts in the prototype's state (Scene 1 saved, Scene 2 keyframes back with 2.2 and 2.3 not opened and 2.3's line 7.4 s on a 6 s shot, Scene 3 not started).
