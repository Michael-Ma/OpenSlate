# Card LIVE-4b: LIVE-4 again, on a quiet machine

LIVE-4 (`docs/ai/live-test-20261016d/REPORT.md`) could not make its keyframes: the first Director setup and all four Codex image attempts failed after about 15 s. The likely cause was a cold native start under heavy load (the lead's browser suite was running at the same time). Card B25 now keeps the cause of a native failure, explains it, and gives a cold start 60 s. Nothing else is running this time.

Do exactly `docs/ai/uiux-plan/codex/cards/LIVE-4-review-notes.md` again, with all its rules (no Viggle action at all: the tally must be 0 seconds and $0.00), with these changes:

- **Data:** `OPENSLATE_DATA_DIR=$HOME/openslate-live-test-20261016e` (fresh).
- **Evidence:** `docs/ai/live-test-20261016e/`.
- **Native failures:** if Director setup or a keyframe fails, record the new diagnostic category and message the studio shows (B25), with a screenshot, and the setup or attempt timings. Make at most one new keyframe press for failed frames before you stop.
- **Real frames:** with real keyframes, the review must look at the actual images. Record whether its notes are saved, appear in the Director column, banner and chips, and say something about the images. Confirm the check row showed the reviewing line while it ran.
