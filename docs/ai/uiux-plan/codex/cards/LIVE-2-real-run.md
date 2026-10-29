# Card LIVE-2: the real end-to-end run, second attempt

The first attempt (LIVE-1, report in `docs/ai/live-test-20261016/REPORT.md`) stopped at keyframes on `409 SCENE_REVIEW_STALE` and spent $0.00. Cards B22 and a lead UI fix have since repaired what it found: the generation fences after a Plan edit and Undo, the first-film setup sheet, the Director's choice of the pinned Codex (with version diagnostics), long-turn progress and timeout wording, and subscription price wording. This worktree has been updated to that code. Run the same flow again and take it to the end.

Everything in `docs/ai/uiux-plan/codex/cards/LIVE-1-real-run.md` still applies (hard rules 1 to 5, the setup, the run, the report), with these changes:

- **Data:** a fresh directory, `OPENSLATE_DATA_DIR=$HOME/openslate-live-test-20261016b`. Do not reuse the first run's data.
- **Evidence:** write to `docs/ai/live-test-20261016b/`. Reuse and improve your drivers in `scripts/live/`.
- **Temporary files:** Chrome's throwaway automation profile may live in the operating system's temporary directory (`/var/folders/...` or `/tmp`); that is allowed. Never use or open the owner's own Chrome profile.
- **Recording:** do not record one long session. Record each phase in its own browser context with `recordVideo` (Start, Director, Plan, Keyframes, Video, Film and export, Restart), close the context at the end of the phase, and do not record while you only wait for providers. Keep each clip short, and name them `phase-NN-name.webm`. Screenshots at every step as before.
- **Pace:** drive the flow with a script that waits on the studio's own state (selectors, API reads) with sensible timeouts. Do not leave the browser idle for long stretches between steps.
- **Director:** setup should now pick the pinned Codex `0.153.4` by itself. Record what the setup screen says; use the Settings workaround only if it does not, and report that as a failure of B22.3. Keep the first request small (two shots of 5 or 6 seconds, silent, simple subject). If a turn times out, record what the timeout message says was saved, then send one shorter request.
- **Plan:** repeat the small edit and Undo; then Keyframes must work. If `SCENE_REVIEW_STALE` or any other refusal appears again, record it fully and stop.
- **Money:** the $1.00 Viggle cap is unchanged, and nothing has been spent so far. Plan about 12 seconds of video (two 6-second clips, about $0.12). At most one paid retry per shot, and never a resubmission of an unknown outcome.
- **Prices:** record what the keyframe and video buttons show for price (Codex plan wording, Viggle per-clip estimate).
- **Finish:** export the MP4, run `ffprobe` on it (it must be under 30 seconds), restart the studio with the same command and confirm the film, takes and export are intact with no new submission, then visit Assets and Settings. Stop the studio you started.

Your final message: the step table, the paid tally, the ranked problem list, and the paths of the report, the phase clips, the export and its ffprobe output.
