# Card LIVE-4: a short real run that ends at the Director's keyframe review

LIVE-3 (`docs/ai/live-test-20261016c/REPORT.md`) found two remaining problems. The Director's automatic keyframe review could not save its notes: `record_notes` sent `anchor.shotId` where contract 5.0.0 needs `anchor.shotIds`, and was refused with a generic error. And the scene's check row showed a green "Nothing to check" while that review ran. Card B24 and a lead UI fix changed both; this worktree has that code. Check them with real providers. **This run makes no video and spends nothing on Viggle.**

Everything in `LIVE-1-real-run.md` and `LIVE-2-real-run.md` still applies (hard rules, setup, recording per phase, pace, report), with these changes:

- **Data:** `OPENSLATE_DATA_DIR=$HOME/openslate-live-test-20261016d` (fresh). **Evidence:** `docs/ai/live-test-20261016d/`.
- **Money:** never press Confirm frames & generate video, or any other Viggle action. The Viggle tally for this run must be **0 seconds, $0.00**. Keyframes use the Codex subscription.
- **The run:**
  1. Start a new film.
  2. Ask the Director for two silent 6-second shots with a simple subject, as before.
  3. In Keyframes, make both keyframes.
  4. Wait for the Director's automatic review of the new keyframes.
  5. Stop the studio.
- **Check and record pass or fail, with a screenshot each:**
  1. **During the review:** while it runs, the scene's check row says the Director is reviewing these keyframes (a neutral line, no green check).
  2. **Notes saved:** after the review, its notes are saved. Lettered notes appear in the Director column and the banner or card chips, the review's message does not say notes could not be saved, and the studio's notes read (`/api/projects/<film>/...` snapshot `notes`) lists them.
  3. **A refused save, if any:** if a save is refused, the person sees the plain line about it, and the Director corrects the call in the same turn. Record the refusal reason the tool returned (redacted).
  4. **After the notes:** the check row and banner agree with the notes, with no green all-clear while a note is open.
- If the review saves no notes because it judged the frames fine, record its message. That is a pass only if it says so plainly, without claiming a save failure.

Your final message: the step table, the per-check pass/fail list, the Viggle tally (it must be zero), the ranked problem list, and the report path.
