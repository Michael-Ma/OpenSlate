# V2 · The same topical demo, directed by Claude Code · Opus 5.5

The owner asked to rerun the V1 demo with Claude Code · Opus 5.5 as the Director, on the same news topic, with Opus writing its own film. They approved running outside the sandbox with a **$3 total** budget, as for V1. Read `docs/ai/uiux-plan/codex/RULES.md` and `docs/ai/film-quality/cards/V1-topical-demo-video.md`; V1's hard rules 1, 2, 4 and 5 apply unchanged. Reuse `scripts/demo/` (README there) and fix it where it needs fixing.

## What changes from V1

1. **Data lives in the repository's ignored `data/` folder.** Use one run folder, `/Users/michael/SideProject/OpenSlate/data/test-runs/20261102-v2-opus/`, with the studio's data in `studio/`, raw recordings in `raw/` and the finished files in `outputs/`. Never use or create a data folder in the home directory.
   Start the side instance from this worktree after `pnpm build`:
   `OPENSLATE_DATA_DIR=/Users/michael/SideProject/OpenSlate/data/test-runs/20261102-v2-opus/studio node --env-file=/Users/michael/SideProject/OpenSlate/.env.live.local --import=/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/port-5173.mjs apps/server/dist/index.js --serve-web --no-open`. The printed link now names 5173 (F1).
2. **Director: Claude Code · Opus 5.5.** Create the Code plan film, then before the first message open Settings › Models and choose **Claude Code · Opus 5.5** for the Director; check the Director panel says it uses the Claude plan. Record this step. If Claude Code is not ready (not signed in, usage limit), stop and report; do not fall back to Codex.
3. **Same topic, a new film.** Use the same news item as V1 (The Indian Express, November 2, 2026, tiny snakes that cartwheel: https://indianexpress.com/article/lifestyle/pets-animals/these-tiny-snakes-cartwheel-at-speeds-of-up-to-13-kmph-10936966/). Do **not** give the Director V1's story, characters, shots, captions or title, and do not read V1's film to it. The brief is the topic and the constraints only: English, 15–25 seconds, a light comedy, no real people or brands. Let Opus choose the idea, the orientation and the shots; answer its keyframe cards (first-frame input, as in V1) and its questions as the owner would.
4. **Narration** says once, early, that this film is directed by Claude Code running Opus 5.5 on the owner's Claude plan, and otherwise describes each stage as in V1.
5. **Outputs:** `outputs/2026-11-02-opus-making-of.mp4` and `outputs/2026-11-02-opus-film.mp4`.

## Finish

Write `docs/ai/film-quality/reports/V2-report.md`: the brief as sent, Opus's plan in short, every paid step and the total (studio spend line plus narration), timings, output paths, every OpenSlate problem met, and a short comparison with V1 (story, number of turns and plan versions, time to finished film, cost). Stop the side instance when done.
