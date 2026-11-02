# V1 · A funny topical film made in OpenSlate, and a narrated recording of how it was made

The owner approved this run outside the sandbox, with a hard budget of **$3 in total** (all providers plus the narration voice). Read `docs/ai/uiux-plan/codex/RULES.md` first; its rules apply except where this card says otherwise for this run.

## Hard rules

1. **Never touch port 3001** or the data directory `~/openslate-code-20261029-2351`. They are the owner's. Check nothing of ours listens on 3001; never stop or connect to what does.
2. **Never read, print or copy** `.env*` files or any key. Start the studio so it loads the file itself, and give scripts keys only through `node --env-file=...`, never on a command line or in a log.
3. **Side instance only.** From this worktree, after `pnpm build`:
   `OPENSLATE_DATA_DIR=$HOME/openslate-filmq-20261101 node --env-file=/Users/michael/SideProject/OpenSlate/.env.live.local --import=/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/72ad4e96-05c6-43a3-b1fc-50ac771fee4e/scratchpad/port-5173.mjs apps/server/dist/index.js --serve-web --no-open`
   It listens on `127.0.0.1:5173`; the log prints a one-time `#connect=` code (valid 60 s) to open it at `http://127.0.0.1:5173/#connect=<code>`. Create a new film in that data directory; do not copy it or touch other films there.
4. **Money.** Before any paid step, set the film's spend limit to **$2.40**. On keyframe cards choose **Keyframe as first frame** (the cheapest input). Two or three shots of about 6 seconds, at most two retakes in all. Music (Lyria, $0.08) is optional. Narration voice: at most $0.10. If the run would pass $3 in total, or anything fails twice, stop spending and report.
5. **Don't push or commit.** Large media never goes into the repository.

## The film

- **Topic:** search the web for news from today, 2026-11-02, and pick one light, harmless item that invites gentle comedy (a quirky science find, a viral animal, an odd local record). No disasters, deaths, wars, crime, elections, politics, health scares or anything someone could be hurt by. No real, identifiable person, logo or brand as a character: use a generic stand-in. Note the source link.
- **Language:** English everywhere: the studio UI (switch it to English), every message to the Director, the film's title, any captions. 15–25 seconds, vertical or horizontal as suits the idea.
- **Process:** create a **Code plan** film, give the Director a short brief in English, answer its keyframe cards, let it cut, render and finish. Talk to it like the owner would; do not write its plan for it.

## The making-of recording

Record the browser with Playwright (Chrome channel, as `scripts/browser-check.mjs` does), English locale, 1920×1080 viewport, `recordVideo` on. Capture each stage as its own clip or with timestamps:

1. Start and the New film dialog (Code plan chosen).
2. The brief going to the Director, and its plan reply.
3. References and keyframes being made: the Plan page's References row and "Making…" placeholders, the run strip's "Making …" line.
4. The keyframe cards, looking at a keyframe larger, and confirming the video input.
5. Clips being made (run strip, Film page rows), then the render.
6. The finished film playing in Film, and the Assets page (references, keyframes, clips).

Long waits stay in the raw recording; in the edit, speed them up or cut them with a short "a few minutes later" card.

## Narration and edit

- Write one natural, conversational English voice-over per stage (one to three sentences: what is happening and why it matters). Make the voice with OpenAI speech (`gpt-4o-mini-tts`, a natural voice such as `marin` or `cedar`), through a small script that reads the key from the environment loaded by `--env-file`.
- Edit with FFmpeg: a short title card, each stage with its narration over it (the screen audio, if any, ducked), sped-up waits, then the **finished film at full speed with its own sound**, and an end card. 1080p H.264 + AAC, loudness about -14 LUFS.
- Outputs, outside the repository: `~/Movies/OpenSlate/2026-11-02-making-of.mp4`, `~/Movies/OpenSlate/2026-11-02-film.mp4` (the studio's export), and the raw recordings in `~/Movies/OpenSlate/raw-2026-11-02/`.
- Put the reusable scripts (recording driver, narration, edit) in `scripts/demo/` with a short README on how to run them again. Keep them free of keys and personal paths beyond defaults that can be overridden.

## Finish

Write `docs/ai/film-quality/reports/V1-report.md`: the topic and its source link, the brief and the Director's plan in short, every paid step with its price and the total spent (from the studio's spend line, plus the narration), timings of each stage, the output paths, and every problem you met in OpenSlate (bugs, confusing UI, slow steps), with what you did about it. Stop the side instance when done.
