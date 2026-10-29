# Card B15: fix the backend review findings

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it. A read-only review of the branch's backend found ten defects; the full findings with file:line and scenarios are in `docs/ai/uiux-plan/codex/reports/review-backend.md`. The lead reviewed them and wants all ten fixed. For each one: first write a failing test that reproduces the scenario, then fix it, then keep the test.

1. Stop must not let a known-unsent preparation dispatch later: cancel and detach preparations with no possible dispatch, release their unspent reservations, and recheck the Stop fence right before any dispatch (engine admission and the transcription/speech preparation paths).
2. Undo after an edit must not orphan an in-flight or finished paid clip: when Undo restores the exact intent that a still-running or completed attempt was submitted for, reconnect that candidate (never restoring retry authority), and attach verified outputs that completed meanwhile.
3. A replacement in progress must be visible: when a retained current output is shown, the slot reports the replacement's own state through `MediaSlot.replacement` (now in packages/core/src/studio-api.ts) with its attemptId, phase and failure, so a no-answer replacement can be released and a failed one explained.
4. Human-field fences cover project fields: record person edits of brief, story and narration script, and refuse a Director change to them made after the turn's captured cursor with HUMAN_EDITED_FIELD, as for shot and scene fields.
5. The accepted-narration duration floor applies to every publication path, including proposal acceptance (shared validation, not only the storyboard route).
6. Undoing a narration proposal restores the exact narration acceptance, pending and fit state it changed, while preserving later audio edits.
7. A personal project-default voice must not invalidate its own confirmation: keep the authored voice tag during materialization, or normalize it atomically before confirmation digests are captured.
8. One retry-eligibility rule for admission and projection: retries that admission forbids (scene confirmation steps, Stop-fenced candidates) project as failed, never as queued with retries left; a scene must not stay "making_video" forever.
9. A released unknown voice job no longer blocks: exclude released speech attempts from current narration status and from the no_answer_in_scene blocker, keeping their liability evidence.
10. Takes the shot cannot switch to are marked `selectable: false` in `ShotTakes` (contract updated), and `use` refuses them with a clear code; switching to a selectable take keeps working.

## Tests
One reproducing test per item (failing before the fix), the full `pnpm test`, and typecheck.
