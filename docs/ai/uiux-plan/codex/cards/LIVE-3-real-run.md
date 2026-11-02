# Card LIVE-3: the real run again, checking what the second run found

LIVE-2 (`docs/ai/live-test-20261016b/REPORT.md` in the main checkout's docs, and your own copy) completed the film for about $0.12. Card B23 and a lead UI fix then changed what it found. This worktree has been updated to that code. Run the same flow a third time and check each fix with real providers.

Everything in `LIVE-1-real-run.md` and `LIVE-2-real-run.md` still applies (the hard rules, the setup, recording per phase, pace, the report), with these changes:

- **Data:** a fresh directory, `OPENSLATE_DATA_DIR=$HOME/openslate-live-test-20261016c`. **Evidence:** `docs/ai/live-test-20261016c/`.
- **Money:** about $0.12 has been spent so far, so the remaining cap is **$0.88**. Plan the same two silent 6-second shots (about $0.12). One paid retry per shot at most; no resubmission of an unknown outcome.
- **Check each fix and record pass or fail with a screenshot:**
  1. **Preview:** with the real square keyframes, the Keyframes preview shows the whole frame (side bars), and the caption and scrubber sit under the picture, not over it. Screenshot it at 1440 × 900 and at 1366 × 768.
  2. **Panel while making:** while keyframes are being made, the scene panel says they are being made, never "Every frame is opened".
  3. **Director after saving:** after the Director saves the plan, its message does not say saving was blocked.
  4. **Labels:** the shot framing is a short shot-size label and the scene title is a short name. If not, record what was written.
  5. **Film player:** before playing, it shows the first shot's frame, whole, with side bars, as the export does.
  6. **Assets:** a clip longer than its shot says how much the film uses.
  7. **Restart:** after the export, stop the studio once (one interrupt) and wait. It must exit within about 10 seconds. The same command must then start it at once (no `INSTALLATION_IN_USE`), with the film, takes and export intact and nothing resubmitted.
  8. **Settings after the restart:** the Director shows its last successful check, not "Not checked".
- Anything new that is wrong or confusing goes into the ranked problem list as before.

Your final message: the step table, the per-fix pass/fail list, the paid tally, the ranked problem list, and the paths of the report, the phase clips, the export and its ffprobe output.
