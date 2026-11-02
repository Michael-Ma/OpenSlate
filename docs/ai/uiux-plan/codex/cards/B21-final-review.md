# Card B21: fix the final review findings

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it, with these changes: this card edits apps/web; do NOT edit `docs/implementation/STATUS.md` (report only in `docs/ai/uiux-plan/codex/reports/B21-final-review.md`). No git, no Chrome or browser checks (RULES item 3); you may edit browser scenarios, the lead runs them. The visual design is fixed: keep markup and CSS changes to what a fix needs, every new string in the en and zh catalogs.

Your own read-only review found six P2 defects; they are in `docs/ai/uiux-plan/codex/reports/review-final.md`. The lead reviewed them and wants all six fixed, each with a failing unit test first:

1. A note whose regeneration failed (including a failed replacement over a retained frame) must not read "Settled: … regenerated" with a check; say it failed, plainly and neutrally, and keep the note's choices available where a new request is possible.
2. Failed narration must not sit beside "✓ Nothing to check in this scene": the scene's check row names the shot whose voice line failed.
3. A clip waiting for its own missing or failed keyframe (`input_pending`) must not block repairing that keyframe: the inspector's Regenerate/Make again and the note's regenerate stay available (priced as usual); a passive dependency wait is not work in progress. Keep the lead's Stop rule (model/director.ts: an input wait counts for Stop only while its input is being made) consistent with this.
4. A recording whose subtitle pre-save is refused must show a refusal (the recording panel's own refusal state, with the server's reason), never reset silently; intermediate successes stay silent.
5. After the inspector refits (roomy/compact/pinned/scroll) and when its focus listener is installed, a focused row or action is revealed whole above the pinned actions, without moving focus.
6. Film lane fitting must not re-measure on every playhead frame: observe only what changes fitting (lane sizes, chip content, language), never the playhead's style.

Checks: `pnpm build`, the touched tests, `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`, the full `pnpm test`, `pnpm -r typecheck`, `node --check` on changed scenario files. Report with the RULES headings.
