# Recorded OpenSlate demonstration

These tools record a real side studio, generate six short AI voice-over passages,
and edit a 1920×1080 H.264/AAC making-of. Media, pairing logs, usage ledgers and
edit manifests belong outside the repository. They do not start media generation
or write a Director program: interact with the studio's own UI.

Requirements: the repository's pinned Node/pnpm/FFmpeg toolchain, system Google
Chrome, `playwright-core` from this workspace, Python 3 with `openai` and `Pillow`.
Run only with an authorized live scope and budget. Never use the owner's port
3001. Build before starting the side studio. Let Node load the environment file;
do not read or log its contents.

## Record

Start the side studio using the card's approved preload and data directory.
Keep its output in a private local log. The V1 preload moves the listener and
Director bridge to 5173, although the printed pairing link still says 3001.
`pair` extracts only the code and navigates to `DEMO_ORIGIN`, never that link.
The code expires in 60 seconds.

```sh
pnpm build
# Set DEMO_ENV_FILE and DEMO_PORT_PRELOAD to authorized local files.
OPENSLATE_DATA_DIR="$PWD/data/test-runs/<YYYYMMDD>-demo/studio" \
  node --env-file="$DEMO_ENV_FILE" --import="$DEMO_PORT_PRELOAD" \
  apps/server/dist/index.js --serve-web --no-open > /tmp/demo-studio.log 2>&1
# In another terminal (keep stdin open):
node scripts/demo/record.mjs
```

`DEMO_ORIGIN` defaults to `http://127.0.0.1:5173`. `DEMO_RAW_DIR` defaults to
`data/test-runs/<YYYYMMDD>-demo/raw` in this repository (git-ignored). Keep every run's studio data, raw
recordings and outputs under one `data/test-runs/<run>/` folder, never in the home folder.
Chrome uses an English locale, a 1920×1080 viewport and matching `recordVideo`
size. The browser can request only the side studio's origin.

Send one JSON object per line. Inspect `snapshot` and `controls` before acting.
Use selectors from the current UI; paid presses must follow an inspected card.

```json
{"op":"pair","log":"/tmp/demo-studio.log"}
{"op":"mark","stage":"01-start"}
{"op":"snapshot"}
{"op":"controls"}
{"op":"click","selector":"[data-act=all-films]"}
{"op":"screenshot","file":"start.png"}
{"op":"close"}
```

Other operations: `fill` (`selector`, `value`), `select`, `press` (`key`),
`scroll`, `wait` (`ms`, at most 30000), `read` (project-scoped GET `path`, optional
`file`), and `download` (`selector`, absolute `path`). `click` also accepts `role`
and exact accessible `name`. `mark` saves relative stage times to `recording.json`.
`close` flushes the raw WebM and records its path. EOF also closes cleanly.
Playwright records pictures without system audio; narration is therefore the
only screen-section audio. The studio export retains its own audio.

## Narrate and edit

Create a local JSON manifest alongside the raw video. Paths resolve relative to
the manifest. Six entries in `narration` map to the six `stages`; each passage is
one to three conversational English sentences, at most 450 characters.

```json
{
  "raw": "recording.webm",
  "film": "../2026-11-02-film.mp4",
  "output": "../2026-11-02-making-of.mp4",
  "cards": {
    "title": ["No Legs, No Problem", "A topical film made in OpenSlate", "AI-generated narration"],
    "later": ["A few minutes later", "Waiting time shortened"],
    "end": ["Made in OpenSlate", "Story inspired by The Indian Express, November 2, 2026", "AI-generated narration · cedar"]
  },
  "narration": [{ "id": "01", "text": "I start a Code plan film and set its spending limit." }],
  "stages": [{ "id": "01", "segments": [{ "start": 0, "duration": 12, "speed": 1 }] }]
}
```

```sh
node --env-file="$DEMO_ENV_FILE" scripts/demo/narrate.mjs /path/to/demo.json
node scripts/demo/edit.mjs /path/to/demo.json
node scripts/run-tests.mjs scripts/demo/demo.test.mjs
```

Narration uses the requested `gpt-4o-mini-tts` and `cedar` through the OpenAI
Python SDK. It makes one request per stage, disables retries, reserves $0.015
per pending request against $0.10, and records SSE token usage plus its computed
price ($0.60/M input, $12/M output). This reservation is conservative for these
short passages; it is not a provider-enforced token ceiling. Official model
pricing: <https://developers.openai.com/api/docs/models/gpt-4o-mini-tts>.
The model is scheduled to shut down January 6, 2027; revalidate before reuse.

`narration/ledger.json` records intent before each call. A failed or interrupted
request remains unknown and prevents automatic resubmission. Completed entries
replay without another purchase. A process lock prevents concurrent purchases;
after a crash, reconcile the ledger before manually removing a stale lock.
Do not delete a ledger to bypass a refusal.

The editor joins chosen intervals (use `speed` for accelerated waits; a segment
may use `image` for a held screenshot from the recording), pads a
short screen interval to its narration, inserts optional `beforeCard` cards,
then appends the entire studio export at normal speed with its sound and an end
card. It masters the assembled audio with two-pass loudness normalization to
-14 LUFS, -1.5 dBTP. Intermediates and measurements remain in `edit/` beside the
manifest. Overrides: `PYTHON`, `FFMPEG`, `FFPROBE`, `DEMO_FONT` (a TrueType font;
defaults to macOS Arial). The editor is local and makes no provider calls.
