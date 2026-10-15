# Card B9 (phase P4, part 2): held proposals with previews, accept / reject / undo, edits alongside the Director

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it. Card B5 (contract 5.0.0, V6, notes) is merged in your tree.

## Goal
The Director can propose a change that a person sees as Now / After and accepts, rejects or undoes. Accepting, resolving and hand edits never stop the Director, and a person's edit always wins over a Director change based on older state.

## Items (spec = the item's Change in docs/ai/uiux-plan/gap-agent.md; decision D1)
1. **DC-2 + decision D1**: tool `propose_change` in contract 5.0.0 (if B5 left it out of the 5.0.0 catalog, add it there only if 5.0.0 has never been released outside this branch; this branch is unreleased, so you may extend 5.0.0 and refreeze its digest). Input is a creative patch only (updateShots fields desiredFrames, motion, imagePrompt, videoPrompt, narration; updateScenes purpose); allowed in read_only epochs; no holds. Store `director_proposal`; routes `GET /api/projects/:projectId/director/proposals` (`ProposalList`), `POST .../director/proposals/:proposalId/accept` (`AcceptProposalInput`), `.../reject`, `.../undo`, all keyed. A note choice of kind `proposal` now resolves through accept (replace B5's PROPOSAL_UNAVAILABLE). Per D1, the V6 guidance says: changes that outdate paid media or change duration or narration are proposed; others may be applied directly with a receipt.
2. **DC-3**: pure `previewCreativePatch` in core producing `ProposalPreview` (contract in `packages/core/src/studio-api.ts`), `previewDigest`, and rebase-or-expire (stale with SHOT_CHANGED when a touched shot or scene revision changed). Accept recomputes and refuses PROPOSAL_PREVIEW_CHANGED on a mismatch.
3. **DC-4**: undo of an accepted proposal applies the inverse field by field only where the field still equals the accepted value; others are `leftAlone`; the proposal becomes `undone` and its note reopens.
4. **DC-5**: a `beginRequest` concurrency mode `alongside` (own holds and audit, never supersedes other requests or revokes epochs) used by storyboard field edits, proposal accept/reject/undo, note resolve, narration edits and narration-fit. A Director prepare or propose touching a shot field a person changed after the turn's context capture fails with `HUMAN_EDITED_FIELD`. Card B3 already stopped storyboard edits from revoking the Director; unify that `directEdit` path with `alongside` rather than keeping two mechanisms.

## Out of scope
Keyframe projection to the Director, review turns, progress reporting (card B10). Anything in apps/web.

## Tests (at least)
- Core: preview for a duration change (timeline and film seconds, keeps_keyframe and clip_remade effects), for a prompt change (keyframe_remade), rebase-or-expire.
- Accept publishes the patch without revoking a running Director turn; reject leaves the film; replay with the same key; stale proposals cannot be accepted; PROPOSAL_PREVIEW_CHANGED on a changed preview.
- Undo leaves a field the person changed after accepting; the note reopens.
- HUMAN_EDITED_FIELD when the Director proposes on a field the person edited after capture.
