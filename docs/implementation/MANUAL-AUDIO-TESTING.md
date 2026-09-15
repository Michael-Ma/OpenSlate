# Manual testing before real media generation

This checklist exercises the conversation and human review workflow. It does not call Viggle, speech, transcription or image APIs. Native Codex conversation uses your existing Codex access. Real media quality, recognition, vendor billing and production validation belong to the next stage after your explicit go-ahead.

## Start a separate local test workspace

From the OpenSlate repository, use Node 24 and pnpm 10.33.0:

```sh
cd /Users/michael/SideProject/OpenSlate
pnpm install --frozen-lockfile
pnpm build
OPENSLATE_DATA_DIR="$PWD/.openslate-manual-audio" \
OPENSLATE_PROVIDER_CONFIG="$PWD/examples/audio-review-profiles.example.json" \
OPENSLATE_ENABLE_IMAGE_GENERATION=0 \
OPENSLATE_ENABLE_H3_GENERATION=0 \
OPENSLATE_ENABLE_VIGGLE_H3_GENERATION=0 \
OPENSLATE_ENABLE_SPEECH_GENERATION=0 \
OPENSLATE_ENABLE_TRANSCRIPTION=0 \
pnpm start
```

Do not load `.env.local` for this rehearsal. All real media execution switches are explicitly off, including the legacy H3 route. The profile example contains no key and uses illustrative $0.10-per-attempt estimates for review; these are not vendor prices or an authorization to spend. The separate data directory preserves your existing projects. FFmpeg and ffprobe must be installed for recording import; the launcher checks the usual local paths.

Open [OpenSlate locally](http://127.0.0.1:3001). The launcher prints the local token file's path. Open that file yourself and paste its contents into the connection screen; do not send the token in chat. Stop the server with Ctrl+C. Restart using the same command and data directory.

When creating a new project, expand **Media models** and select the speech and transcription profiles from the example. Image/video can remain the defaults. Existing projects retain their saved model choices; loading a new profile file does not replace them. Use **Project settings → Models & usage** to preview and apply a change. Audio work with an existing dedicated review is preserved and requires a new audio proposal/review to adopt a different model.

OpenSlate currently tests Codex **0.153.4**. The installed Codex app updated to **0.154.0-alpha.6.2** during this work, so its bundled binary will be rejected by the compatibility check. Keep a separate pinned installation for this rehearsal:

```sh
npm install --prefix "$HOME/.local/share/openslate-codex" --save-exact @openai/codex@0.153.4
"$HOME/.local/share/openslate-codex/node_modules/.bin/codex" --version
```

In the director setup, select native Codex and enter the full binary path `/Users/michael/.local/share/openslate-codex/node_modules/.bin/codex` instead of the bundled-app suggestion. Use your existing login and complete the setup check. This installation is separate from the app and the project dependencies. If setup reports authentication is missing, run the pinned binary's `login` command locally; do not send credentials in chat. Fresh projects use V3 audio guidance; an older project needs **Enable audio planning** in narration guidance after the current conversation finishes.

## 1. Writing-first conversation

Send:

> I want a short leather boots commercial. Please save two finished English narration sections, each one or two sentences, with generated audio as the source. Keep the voice and profile choices unset initially. Do not generate media yet.

Open **Story & narration** and confirm that two separate saved sections appear. The draft should remain unaccepted. Then send:

> Prepare a speech plan for the first saved section using the available OpenAI narration profile, cedar voice, and “Warm, calm delivery.” Keep the exact saved words. Stop for my review.

Expected:

- The agent reads current saved context and prepares a speech proposal.
- The conversation identifies the saved proposal and directs you to review it; it does not claim audio already exists.
- Under **Generate narration → Saved speech plans**, choose the new plan. Check the exact text, voice, delivery instructions, model and estimate.
- If narration editing requests a continuation, explicitly continue the displayed conversation request. This carries that edit into human review.
- **Approve speech plan** creates the reviewed generation candidate. It does not approve spending or accept narration.
- **Review speech spending** opens the matching candidate. With the provider disabled, the UI should explain missing setup and no audio should be created. Do not enable media workers during this rehearsal.

You can also prepare the same kind of proposal directly from the saved-section controls. Avoid reviewing a second equivalent proposal unless you intend another take later.

## 2. Check a scoped edit

Before approving a fresh proposal, change the first section in conversation:

> Change only the first section to say “Built by hand. Ready for the miles ahead.” Keep the second section unchanged. Do not generate media.

Refresh the old speech plan. Its review must be unavailable because its section revision changed. Ask the agent to prepare a fresh plan for the revised first section. Confirm the second section and other existing work are retained.

For an already approved but unstarted speech plan, an edit to its section must prevent the old words from starting. Historical proposals remain visible. Editing another narration section should not silently rewrite the first section's speech request.

## 3. Recording-first conversation

Record a five-to-ten-second voice memo, for example:

> These boots are made one pair at a time. Built by hand, ready for the road.

In a second new project with the transcription profile selected, open **Story & narration**, start the review session if prompted, and use **Choose a narration recording** to upload the file yourself. A script or narration section is not required. Choose the recording in the saved library and listen to it.

Send:

> I uploaded an English narration recording. Prepare transcription of that exact recording as an independent transcript. I have not written a script yet. Stop before generation or spending approval.

Expected:

- The agent finds the owned recording and prepares a transcription proposal without inventing a script first.
- Under **Transcribe a recording → Saved transcription plans**, the proposal shows the intended recording, model, English language and word timing.
- You can approve the transcription plan separately from its spending allowance. The disabled provider prevents execution.
- No transcript text or timing is fabricated. Actual recognition waits for the later live-testing stage.

The browser file-picker path needs your manual confirmation: earlier automation did not complete that upload. Report an upload error rather than repeatedly submitting the same file.

## 4. Refresh and restart

Refresh the browser and reconnect with the local token if needed. Stop and restart the app with the exact command above. Check both projects retain their sections, uploaded recording, proposals and review history. Stale proposals must remain stale; approved plans must not gain another candidate just from a reload.

When an action reports an uncertain response, use its existing **Check the same…** action if offered. Do not create a different request just to retry an unconfirmed result.

## Send back these results

- Writing-first: sections saved; agent prepared the correct speech plan.
- Speech review: exact words/voice shown; no audio generated.
- Scoped edit: old first-section proposal blocked; second section unchanged.
- Recording-first: file picker/import/playback worked; agent prepared the intended recording.
- Refresh/restart: saved work retained, no duplicate work.
- Any confusing screen or error message; omit local tokens and API keys.

After your feedback, we can decide whether to enable a small, explicitly budgeted real speech/transcription test. Live Viggle H3 tests remain on hold until you resume them; the earlier $1 ceiling does not override that hold. Release work also waits until this manual-testing gate is complete.
