# Human live production testing

Use a disposable film and a deliberately bounded real-account test. A configured provider is ready for requested use, without a separate API-key approval or usage allowance. It is not authorization for an unattended test campaign. Offline fixtures and the owner's [Chinese test guide](../ai/code-plan/TEST-INSTRUCTIONS.md) complement this walkthrough.

## Local setup

Use Node **24.15.0**, pnpm **10.33.0** and the FFmpeg/ffprobe **8.1.1** pair for development checks. Application startup supports Node 24. Run `pnpm install --frozen-lockfile`, `pnpm setup:test-media` and `pnpm check:toolchain`. [Setup](LOCAL-SETUP.md) and [activation](MEDIA-EXECUTION-LAUNCHER.md) document server-only configuration.

Keep one absolute data directory for every launch/restart:

```sh
export OPENSLATE_DATA_DIR="$HOME/openslate-data"
node scripts/start-local.mjs --doctor
node scripts/start-local.mjs --no-open
```

The launcher loads private `.env.live.local`; exported variables take precedence. It prints a browser pairing link for the studio on 3001. Stop an existing instance in its own terminal before changing checkout or data directory; do not kill an arbitrary listener. Use the same command with `--restart` only for the verified installation you intend to rebuild. Never move an existing data directory to fix a setup failure. Older schema versions need a new directory; schema 4 installations remain usable.

## Codex

Install the exact supported version side by side:

```sh
npm install --prefix "$HOME/.local/share/openslate-codex-0.162.1" --save-exact @openai/codex@0.162.1
"$HOME/.local/share/openslate-codex-0.162.1/node_modules/.bin/codex" --version
"$HOME/.local/share/openslate-codex-0.162.1/node_modules/.bin/codex" login
```

Expected version: **`codex-cli 0.162.1`**. Preserve older installations while other studios use them. `OPENSLATE_CODEX_BINARY` selects the Director executable; `OPENSLATE_CODEX_IMAGE_BINARY` selects the separate image worker. Startup can discover the versioned install. A configured old executable uses that supported install with a notice when available, or setup refuses. Historical model choices, media inputs and receipts are not rewritten.

Settings → Models → Director reads actual models from the runtime/account. New selections default to **`gpt-6.1-sol`**, and turns reason at high effort. Choose another returned model if desired; do not assume every account has the same catalog. Existing films retain their chosen model. Run the zero-model-turn setup check before a small writing turn. The image worker uses ChatGPT login and **`gpt-6-astra`** internally; changing the Director model does not change it. `OPENSLATE_OPENAI_API_KEY` is for media API routes, not that ChatGPT login.

## Optional Claude Code

The adapter supports **Claude Code 2.1.312 or later 2.x**, authenticated locally on a Claude Pro/Max/Team/Enterprise plan. Install/sign in with the user's own Claude Code application; `claude --version` and `claude auth status` are local setup checks. Configure `OPENSLATE_CLAUDE_BINARY` if the executable is not `~/.local/bin/claude`. Keep credentials out of the repository, fixtures and chat.

Create a **Code plan (experimental)** film, then select **Claude Code · Opus 5.5** or **Claude Code · Sonnet 5.5** in Settings → Models → Director and save. Setup checks version and plan login without starting a model turn. The selection is unavailable for storyboard films. Claude directs through the same validated code-plan MCP tools; API-key login/fallback is refused. Start with a writing-only message and verify the saved reply's runtime. Codex images still require Codex/ChatGPT setup; video/music/speech still use their separate provider accounts.

## Choose a small route

| Job | Implemented route | Account consumed |
|---|---|---|
| Image | Codex images or OpenAI image profile | ChatGPT subscription usage or OpenAI API billing |
| Video | Viggle H3; direct MiniMax H3 also implemented | Separate configured provider account |
| Music | Lyria 3.5 for code films | Gemini billing-enabled project |
| Speech / recognition | OpenAI speech / transcription | OpenAI API billing |
| Additional code-film video | Seedance (ModelArk), fal Kling/Veo/Wan | Corresponding key, profiles and account/model/region eligibility; live acceptance remains separate |

Profiles are saved exact definitions. Example costs are estimates, not vendor bills. Native image quota/internal call counts are not predictable. A failed result download must recover the existing job rather than submit another.

## Code-plan film

1. Create **Code plan (experimental)** → **Talk to the Director**, and choose Codex or set Claude Code as above. Check the limit: new default **$4**, unless this browser has a saved new-film preference.
2. Request one five- or six-second shot, no narration/music/captions for the first test. Inspect the Director's explanation, selected model and estimated cost. Saving a program may generate images; stop at its keyframe confirmation card before any video.
3. Inspect the actual keyframe and available priced video-input choices. Selecting a thumbnail only opens the viewer. Confirm the intended input: keyframe plus references, references only, or keyframe as first frame, as supported by the model. First-frame mode holds opening composition more closely; reference mode may reframe.
4. Plan shows shared references and the shot's keyframe/clip progress. Cards stay in their original reply; the run strip links to outstanding choices. Change a shot prompt or reject the story in chat and check affected cards retire after the Director publishes the changed plan. Stale cards cannot be answered. Retirement depends on plan reachability, not a chat keyword.
5. Observe the original attempt/vendor task through completion. If the program requests `ctx.review`, the Director sees bounded contact sheets, not sound. Film plays the completed render; inspect picture, duration and sound in the actual MP4.
6. Add music or short speech only as another bounded test. Lyria length is approximate; the plan trims/fades to picture length. Generated clip sound is removed during normalization. Code-film captions, speed/holds/zoom and local effects are program features, not a general timeline editor.
7. Reopen/restart using the same directory. An unchanged plan should reuse its saved steps, choices and outputs. Revise one shot and verify unrelated paid results remain reused.

Code-film accounting retains charged, possible and in-flight liabilities. Lowering below them is refused. A lost submission is not permission to retry; inspect/reconcile the original attempt. Consent to retry may mean paying twice. Proven non-submission has bounded safe retries; no-status Viggle outcomes have bounded account-list settlement before the app decides whether a safe retry is justified.

## Storyboard film

1. Create **Storyboard**, configure the native Codex Director and installed models, then request one six-second product shot: brown boot on a workshop bench, warm side light, slow push-in, no lettering and explicit **No narration**. Inspect saved scene/shot/prompts. Importing text/Markdown produces a proposal to confirm; writing starts no media.
2. For speech, save a short script and select a stock voice, or import an owned recording. Scene keyframe generation makes missing voice lines. A fitting measured line is accepted automatically; an overlong line offers free **Make N s** / **Keep N s** fit decisions. A one-second voice can sit within six seconds of picture. New voice cloning is unimplemented.
3. Press **Generate keyframes**, inspect each actual current returned frame, motion, timing, narration and video model. Revise/regenerate only the intended scope. Earlier eligible keyframes remain available in Takes.
4. Press the scene's video confirmation after all required frames have been opened and narration fits. That one durable server command survives a closed browser/restart and settles any remaining voice before video. There is no separate spending approval or returned-clip acceptance gate.
5. Audition Film in storyboard order, adjust timing/music, export locally and inspect the actual MP4. Reopen and do one scoped edit, verifying original attempts and unaffected media are preserved.

For transcription, recognize one short owned recording and compare words/timing by listening. It remains candidate evidence for Director attachments; human transcript adoption is unavailable. Rewritten text does not prove alignment.

## Report results

Record selected runtime/model/account route, pass/fail, confusing controls, attempt/vendor task identities, latency, dimensions, source/export duration, observed account use, reuse and restart behavior. Keep configured estimates separate from charges. Record errors by code and phase: before submit, unknown create, processing, download, normalization or export. Preserve the original state for diagnosis; exclude keys, tokens, signed URLs and private project content.

The [status](STATUS.md), [film-quality results](../ai/film-quality/RESULTS.md), [runtime reference](../technical/DIRECTOR-RUNTIME.md) and [audio rehearsal](MANUAL-AUDIO-TESTING.md) preserve implementation and evidence boundaries. Expand to longer films only after the small flows and human quality review pass.
