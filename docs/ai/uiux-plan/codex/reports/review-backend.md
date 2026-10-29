Found ten defects, ordered by your requested priorities. No files changed. Verification was source-only: compiled server outputs are absent, so running the existing tests would require a build.

1. **High — Stop can later dispatch a known-unsent transcription.** [engine.ts:352](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/execution/engine.ts:352)  
   Stop counts every nonterminal attempt as sent, including `preparing` attempts whose retained proof says no provider request occurred. It preserves their bindings and writes `candidate_stop`, but preparation eligibility never checks that marker. After Continue, reconciliation can submit the paid request without another generation press.  
   **Fix:** cancel and detach preparations with no possible dispatch, release their unspent reservations, and recheck the Stop fence before dispatch.

2. **High — Edit followed by Undo disconnects an already-paid video.** [storyboard-history.ts:59](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/storyboard-history.ts:59)  
   Video A is running; the person edits its prompt, then immediately undoes the edit. The captured binding has empty outputs, so Undo restores the original intent with `candidateId: null`. A’s eventual completion cannot attach because the candidate no longer matches. Its paid clip becomes historical, with no video take-selection route.  
   **Fix:** reconnect the exact previously submitted operation without restoring retry authority; recover verified outputs if it already completed.

3. **Medium — An unknown replacement charge is hidden behind the retained keyframe.** [generation-overview.ts:89](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/generation-overview.ts:89)  
   Regenerate existing frame A, then let replacement B become `submission_unknown`. The overview returns `ready` for retained A before inspecting B, omitting B’s `attemptId` and unknown status. The Inspector consequently offers no release action, while another generation is rejected with `ATTEMPT_EXISTS`.  
   **Fix:** expose replacement status and recovery identity alongside the retained frame, either through explicit replacement metadata or the existing status/`previous` fields.

4. **High — A running Director can overwrite a person’s newer Brief or Story.** [human-fields.ts:31](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/application/human-fields.ts:31)  
   Alongside treatment edits preserve the Director epoch, but the field recorder and conflict checker cover only shots and scenes. After a person changes Brief or Story, that Director can read the current version and publish its older wording; `HUMAN_EDITED_FIELD` never fires.  
   **Fix:** record and enforce project-field fences, using the turn’s original captured cursor.

5. **Medium — Proposal acceptance bypasses the accepted-narration duration floor.** [service.ts:597](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/application/service.ts:597)  
   An eight-second shot has accepted seven-second narration. Accepting a proposal shortening it to six seconds succeeds, although the storyboard route rejects that edit. The accepted cue remains, but timing becomes `audio_pending`, blocking video and export.  
   **Fix:** move the accepted-cue duration invariant into shared publication validation, including proposal acceptance.

6. **Medium — Undoing a narration proposal does not restore accepted readiness.** [director-proposals.ts:137](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/application/director-proposals.ts:137)  
   Start with accepted narration X, accept a proposal changing it to Y, then undo without generating anything. The inverse restores X through `applyCreativePatch`, which sets `narrationPending: true` and clears fit information. The original accepted cue survives, but the previously ready shot stays blocked.  
   **Fix:** capture and conditionally restore the exact narration acceptance, pending and fit state, while preserving later audio edits.

7. **Medium — A personal project-default voice invalidates its own confirmation.** [scene-confirmations.ts:182](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/scene-confirmations.ts:182)  
   Set the project default to a ready personal voice while a generated shot retains `voice: "stock"`. The runner resolves the custom selector, then `saveWriting` changes the shot’s tag to `"personal"`. Its saved intent digest still represents `"stock"`, so its next freshness check fails with `SCENE_REVIEW_STALE`; the confirmation blocks and queued speech cannot dispatch.  
   **Fix:** preserve the authored voice tag during materialization, or normalize it atomically before capturing confirmation digests.

8. **Medium — Failed confirmations advertise retries the executor forbids.** [generation-overview.ts:97](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/generation-overview.ts:97)  
   A confirmed video fails technically under a profile with retries available. Overview reports `queued` and positive `autoRetriesLeft`, but admission explicitly forbids retries belonging to scene confirmations. The completed confirmation has nothing left to advance, leaving the scene indefinitely displayed as `making_video`. Stop-fenced candidates have the same mismatch.  
   **Fix:** share effective retry eligibility between admission and projection; prohibited retries must project as failed.

9. **Medium — Releasing an unknown voice job leaves confirmation blocked.** [generation-overview.ts:125](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/generation-overview.ts:125)  
   The speech selector includes released attempts. After releasing an unknown narration submission, overview still reports `no_answer` and adds `no_answer_in_scene`. The studio disables Confirm even though the backend now permits another human press.  
   **Fix:** exclude released speech attempts from current status and blockers, retaining their liability evidence separately.

10. **Medium — Listed conditioning-frame takes cannot be selected.** [shot-takes.ts:26](/Users/michael/SideProject/OpenSlate/.claude/worktrees/cx-review/apps/server/src/shot-takes.ts:26)  
    Supported plans can condition video on an owned image or shared image node without a shot-owned image operation. Take history lists those videos’ earlier conditioning frames, but selecting any of them fails because `useShotTake` requires exactly one shot-owned image binding.  
    **Fix:** support rebinding the actual conditioning source, or create a dedicated shot binding while preserving siblings using the shared source.

