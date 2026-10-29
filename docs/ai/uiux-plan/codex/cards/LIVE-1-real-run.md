# Card LIVE-1: a real end-to-end run of the Last Ferry studio

You are the test engineer. The owner wants one real production run of the new studio (branch `feature/last-ferry-ui`, this worktree) with real providers, to find what breaks or confuses a person. You run without a sandbox for this card only, so you can start the studio, let it call the Codex CLI, and drive Chrome. That trust comes with hard rules.

## Hard rules (break none; stop and report instead)

1. **Secrets.** Never open, print, copy, grep, diff or list the contents of any `.env*` file, anything under `secrets/`, `~/.codex/` auth files, keychains or tokens. The studio process loads the owner's settings with Node's `--env-file` (below); you never look inside. Never put a key, token, launch code, signed URL or cookie in a log, report, screenshot or recording. If a screen shows one, do not capture it.
2. **The owner's data.** Use only the fresh data directory below. Never touch `/Users/michael/SideProject/OpenSlate/.openslate` or `.openslate/live-validation`. The real studio listens on 127.0.0.1:3001 (hard-coded). Before you start, check that nothing listens there; if something does, stop and report. Do not stop or signal any process you did not start.
3. **Money.** Viggle costs about $0.01 a second of generated video. The owner's cap is **$1.00 total, about 100 seconds of video submitted, including retries**. Plan the film so a first full pass costs at most about $0.30 (no more than 30 seconds). Keep a running tally of every video submission (shot, seconds, vendor job id, outcome). Never resubmit a job whose outcome is unknown: reconcile it through the studio. At most one paid retry per shot. Stop paid work before any action that would take the tally past $1.00. Codex subscription usage (Director, keyframes) is not metered; still, do not loop: at most 3 keyframe regenerations in total.
4. **Code.** Do not change application source (`apps/`, `packages/`). You may add a test driver under `scripts/live/` and write the report and evidence under `docs/ai/live-test-20261016/`. No git commands. If a defect blocks the flow, record it precisely (screen, steps, error code, server log excerpt), try a different path through the UI if one exists, and otherwise stop and write the report.
5. **The machine.** Write only inside this worktree, the data directory below and `/tmp`. Do not install global software. When you finish, stop the studio you started (Ctrl+C or the process you spawned) and leave its data directory for inspection.

## Setup

- Worktree: this directory (already installed and built). Data: `OPENSLATE_DATA_DIR=$HOME/openslate-live-test-20261016` (create it).
- Start the studio so it reads the owner's settings without you reading them, and without opening the owner's browser:

  ```sh
  OPENSLATE_DATA_DIR="$HOME/openslate-live-test-20261016" node --env-file=/Users/michael/SideProject/OpenSlate/.env.live.local scripts/start-local.mjs --no-open
  ```

  Variables already set in your shell win over the file, so the data directory above is the one used. If the launcher refuses (setup not ready), run the same command with `--doctor` and report what it says (it is redacted). Read `docs/implementation/MANUAL-LIVE-PRODUCTION.md`, `MEDIA-EXECUTION-LAUNCHER.md` and `LOCAL-LAUNCHER.md` for how pairing and providers work; pair your browser through the studio's own launch flow (`apps/server/dist/studio-launcher.js`), never by printing the credential.
- Drive the studio with `playwright-core` (already a dev dependency) and the system Chrome (`channel: "chrome"`), headless is fine, viewport 1440 x 900. Record the whole session as video (`recordVideo` on the context) and take a screenshot at every step below and at every problem. Save both under `docs/ai/live-test-20261016/` (screenshots as `NN-step.png`). Keep the driver small and readable; it may be interactive step by step rather than one script.

## The run: one silent film under 30 seconds

Models: Director = the Codex subscription Director; keyframes = Codex images; video = Viggle H3; narration = none (silent); no OpenAI speech or transcription. Music: none, or an owned file only if the flow asks for one.

1. **Start view.** Create a new film (for example "Harbour test"). Choose the models above in the New film sheet; record what the sheet says about readiness and prices.
2. **Director.** Ask the Director in the composer for a short silent film: 2 or 3 shots, 5 or 6 seconds each, total at most 18 seconds, no narration, a simple visual subject (for example: a paper boat on a rain puddle at dusk; close-up, then wide, then a slow push-in). Wait for its reply and its plan; record latency and what it changed. If it asks a question, answer briefly.
3. **Plan view.** Check story, scene(s), shots, durations and prompts; set narration to "No narration" on every shot if it is not already; make one small edit and Undo it.
4. **Keyframes.** Generate the keyframes (Codex images). Open each frame; record time to first frame, image quality issues, and anything the inspector, cards, banner or Director notes say. Regenerate at most one keyframe if one is clearly wrong (note the price shown and the take strip).
5. **Video.** Confirm frames and generate video (Viggle). Before pressing, record the displayed price; after, watch progress, the Stop control and the cards. Reload the page once while clips are being made and check nothing is resubmitted. Record each vendor job id (from the studio's own screens or API responses, not from secrets) and duration.
6. **Film view.** Play the film, check the timeline, export the MP4, and run `ffprobe` on the export (duration, size, frame rate, audio track). The film must be under 30 seconds.
7. **Restart.** Stop and restart the studio with the same command; reopen and confirm the film, takes and export are intact and nothing new was submitted.
8. **Assets and Settings.** Look at both once; note anything wrong.

## Report

Write `docs/ai/live-test-20261016/REPORT.md` in English:
- a step table: step, pass/fail/partial, time taken, screenshot names;
- the paid tally (shot, seconds, job id, outcome, estimated cost) and its total;
- every problem, ranked: severity (blocker, major, minor, polish), what you did, what happened, what you expected, screenshot/video timestamp, server log excerpt (redacted), and your guess at the cause with file paths if you can tell;
- ffprobe output of the export;
- anything confusing for a person, even when it worked.

Your final message: the step table, the tally, and the ranked problem list (short), plus the paths of the report, the recording and the export.
