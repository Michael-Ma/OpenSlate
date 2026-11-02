# Card R5: Director proposals tell the whole truth and cannot bypass the person

Read `_review-common.md` in this folder first. Files:
- `apps/server/src/application/director-proposals.ts`, `apps/server/src/application/director-notes.ts`
- `apps/server/src/application/service.ts`: validateHeldCreativePatch, releaseFinishedRequestHolds and the Director prepare/apply path only
- `apps/server/src/application/tool-invocations.ts`
- `packages/core/src/proposal-preview.ts`
- `packages/core/src/tools.ts`: validation message rendering only, never descriptors, schemas or catalogs
- a new pure module for shot prompt derivation, and tests

Card R1 edits `storyboard.ts`. If you move `editedPrompt` out of it, replace it there with an import and nothing else.

1. **director-proposal-inflight-discard.**
   - The preview adds `{shotId, effect: "discards_running"}` for every shot that has a non-terminal paid attempt (keyframe, clip, a replacement, or a voice line) that the change would outdate. Include running candidates in the preview bindings.
   - Accepting stays allowed; the person decides with the effect shown.
   - Tests: a clip in flight gives the effect; nothing in flight does not.
2. **director-orphan-proposal-holds.**
   - Held proposals take no holds, as the propose_change description says, so releaseFinishedRequestHolds no longer waits on them.
   - When a person resolves a note by any choice other than its proposal, reject the linked held proposals in the same command.
   - Check card B13's report for why holds were kept, and say in your report why releasing them is safe: accepting later is checked against the current revision and shows discards_running.
   - Tests: "Keep it" leaves no hold and rejects the proposal; an unlinked proposal does not hold queued work.
3. **director-proposal-floor-unchecked.** propose_change runs `assertAcceptedNarrationDurationFloor` on the patched project. A held proposal that can no longer be published reads as stale (with a reason), not held. Tests.
4. **director-note-cross-scene-regenerate.** record_notes refuses a regenerate_keyframe choice whose shots are not all in one scene, with a path-level message. Test.
5. **Prompts follow accepted direction.** This is the lead's finding: a proposal that changes only `motion` leaves the stale `videoPrompt` that the video model actually uses.
   - When an accepted proposal changes motion, or (with card R6's catalog) purpose, action or framing, without an explicit prompt, derive the image and video prompts exactly as a person's storyboard edit does: `editedPrompt` and the same field rules in storyboard.ts.
   - Put that logic in one shared pure helper used by both paths.
   - The derived prompt changes appear in `preview.changes`, so the person sees them before accepting.
   - desiredFrames proposals use the person's bounds, 90 to 450 frames (3 to 15 s), plus the locked video profile bounds. Anything outside them is refused at propose time with a clear message.
   - Tests: motion-only, frames out of bounds, and an explicit prompt winning over derivation.
6. **skills-current-1 (server enforcement).**
   - In 5.0.0 and later epochs, a Director prepare_change or apply_change creative update to an existing shot is refused with `PROPOSAL_REQUIRED`, naming the fields, when it would outdate that shot's current or retained paid outputs:
     - image intent or image prompt, on a shot with a keyframe;
     - video intent, video prompt or desiredFrames, on a shot with a clip;
     - narration, on a shot with a voice line or an accepted cue.
   - The tool result tells the Director to use propose_change, or to ask the person to edit the field in Plan.
   - Pure text changes with no media impact still apply directly. Older contracts are unchanged.
   - Tests for each case and for the pass-through.
7. **skills-current-5.**
   - propose_change and prepare_change validation errors carry the failing path and the allowed fields at that path, using the same safe renderer as record_notes. Never echo supplied values.
   - Check that the catalog digests pinned in `packages/director/test/tools.test.mjs` do not change.
