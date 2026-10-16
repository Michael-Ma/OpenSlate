# B18 narration feedback follow-up

The lead's B18 run passed 163/164 browser scenarios. `next-narration-words-not-added` exposed a real regression: the recording's internal subtitle save inherited the common Inspector's Saved/Undo toast. After the recording was refused and its words restored, that internal success toast remained beside the correct refusal note.

## Done

- Recording subtitle preparation and its exact rollback now publish no toast or independent Undo. They do not dismiss or replace another action's existing toast. Error observation, recovery-state refresh, request-key settlement, field comparisons, baseline updates and epoch/revision checks remain intact; the recording's add result or refusal note provides feedback.
- Composite narration suppresses all intermediate success messages. Only after the last step and its ownership check succeed does it publish one final message with the final command's Undo. A failed or superseded sequence publishes no partial success; genuine Save errors remain visible.
- Feedback/retain-editor intent belongs to the saved request identity as well as its current draft. Explicit same-key reconciliation remains silent after a lost reply, including Cancel/reopen, without changing the original POST body. A later ordinary human Save regains normal Saved/Undo feedback.
- `useSustained.ts` and the lead's integrations in Inspector, FilmView and VoicePanel are byte-for-byte unchanged. No UI source or browser scenario was changed.

## Files

Modified:

- `apps/web/src/next/store/store.ts`
- `apps/web/src/next/store/state.ts`
- `apps/web/src/next/model/recording-words.ts`
- `apps/web/src/next/model/narration-edits.ts`
- `apps/web/test/next/recording-words.test.mjs`
- `docs/implementation/STATUS.md`

Added:

- `apps/web/test/next/narration-edits-feedback.test.mjs`
- `docs/ai/uiux-plan/codex/reports/B18-narration-feedback.md`

Deleted: none.

## Tests

Added 11 regression cases; no existing assertions were weakened, deleted or disabled. The recording test first reproduced the actual Saved/Undo dispatch, and all six initial composite cases failed before the fix. The Cancel/reopen reconciliation case also failed before feedback intent was bound to the saved request.

Coverage includes silent pre-save and rollback, preserving an unrelated toast, silent rollback refusal with retained error observation, landed/lost exact replay, normal later Save feedback, no intermediate composite toast, exactly one final toast/Undo, partial failure, new typing, film/epoch changes and Cancel/reopen. The final focused recording/composite/conflict/store run passed 52/52.

Final verification passed under Node 24.15.0, pnpm 10.33.0 and FFmpeg/ffprobe 8.1.1:

- `pnpm build`: all five packages passed, including the final source rebuild.
- Web runner: **672 passed**, zero failures/skips/cancelled/todo.
- Web typecheck and `pnpm -r typecheck`: all five packages passed, zero errors.
- Full `pnpm test`: **3,109 passed**, zero failures/cancelled/todo, **one optional native-probe skip** (**3,110 total**), in **224,463 ms**. This includes the final Cancel/reopen reconciliation regression.

All final processes exited zero. The existing nonblocking Vite chunk-size warning remains. Independent review found no outstanding issue in scope. Direct hash comparisons confirmed the sustained-wait hook and all three UI integrations remain unchanged.

Logs: `/tmp/b18-feedback-full-test.log`, `/tmp/b18-feedback-final-{build,web-tests,web-typecheck,typecheck}.log`, `/tmp/b18-feedback-final-targeted.log`; tests-first reproduction logs `/tmp/b18-feedback-recording-red.log` and `/tmp/b18-feedback-reopen-red.log`.

All validation uses fake transports and disposable fixtures. No browser was launched and no new browser pass count is claimed.

## Contract changes

None. The feedback options and pending-request metadata are internal browser state; wire bodies and browser-facing API shapes are unchanged.

## Commits

No Git command or commit was run. Proposed: `fix(web): keep narration feedback scoped to the human action`, with all source, tests and documentation listed above.

## Open issues

The lead must replay `next-narration-words-not-added` and composite narration feedback outside the sandbox. No real provider/model call, external network request, credential read, production-state access/restart or port 3001 listener occurred.
