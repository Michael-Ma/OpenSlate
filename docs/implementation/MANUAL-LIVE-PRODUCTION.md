# Human live production testing

Start with one six-second shot and a small finite allowance per operation. This walkthrough uses real account usage/API credits; the human reviews and starts the generation in OpenSlate. Existing keys, route enablement and old allowances do not authorize an unattended test campaign.

## 1. Prepare the local studio

Run `./start.sh --doctor`, then `./start.sh` (or `--restart` after configuration/code changes). Use Node 24, pnpm 10.33.0 and FFmpeg/ffprobe. [Setup](LOCAL-SETUP.md) explains the private ignored `.env.live.local`; [activation](MEDIA-EXECUTION-LAUNCHER.md) lists exact switches and server-only keys. Use an explicit data directory/catalog and preserve existing projects.

If native Codex is not yet installed, install the supported pinned version in a separate local prefix:

```sh
npm install --prefix "$HOME/.local/share/openslate-codex" --save-exact @openai/codex@0.153.4
"$HOME/.local/share/openslate-codex/node_modules/.bin/codex" --version
```

Expected version: `codex-cli 0.153.4`. Sign in locally with that binary if needed. Configure its absolute path for the director/image worker; do not copy auth tokens into the repository or chat. The image worker uses ChatGPT login. Director account setup is separate and can use its selected supported Codex account; `OPENSLATE_OPENAI_API_KEY` only configures media API routes.

| Job | Select installed supported profile | Account consumed |
|---|---|---|
| Keyframe | Codex images or OpenAI image profile | Codex usage or separate OpenAI API billing |
| Video | Viggle H3 (six-second example) | Separate Viggle account |
| Speech | OpenAI speech profile | OpenAI API billing |
| Recognition | OpenAI transcription profile | OpenAI API billing |

Profiles are exact saved definitions, not automatic fallbacks. Example dollar estimates are not vendor quotes. Codex image quota/internal image-call count is unknown before a native start. Video result hosts must be explicitly trusted; correct a failed download to recover the existing job rather than submitting another.

## 2. Create and refine one shot

Create a disposable production project and choose its models; in an existing project use the model settings save/review flow. Completed/in-flight work remains on its original definitions. Set up the native Director and complete the zero-turn local check.

Example request:

> Create one six-second product film shot. Show a brown leather boot on a workshop bench, warm side lighting, slow camera push-in, no lettering. Save story, scene, shot and prompts using this project's models. Save no narration explicitly; stop for my generation reviews.

Inspect saved intent, models and one-shot duration. Iterate in chat or edit the card. Existing material can be brought through Bring a brief; confirm the proposed plan after inspecting it. Saving writing/import interpretation starts no media. A selected-shot discussion should preserve other shots.

Compatible narration guidance is an application capability, not spending authorization. Before the first context/dispatch of an eligible fresh native turn, shipped older guidance upgrades automatically so the next conversation can write individual shot narration. Already-started epochs retain their saved capability. If customized/unavailable guidance reports an application error, retain the state/error for diagnosis rather than repairing its database.

## 3. Choose silence or accept short voiceover

For picture only, choose **No narration**. Undecided is a visible choice, not implicit silence.

For voiceover, open Audio setup on the shot. Save a short script and generate stock speech under exact review/one-start allowance, or import your owned recording. Listen, bind actual words/description and range, then accept the displayed words/bytes/timing together. A one-second accepted voice may sit inside the planned six-second shot; **do not pad it to six seconds**. Trim overlong audio or deliberately change picture duration. Existing personal voices need eligible registered IDs; creating a new clone is pending.

Continue the edit to update its plan when needed. Check stale speech proposals are unavailable after script/mode/voice changes. Audio acceptance does not authorize another synthesis call.

## 4. Generate and review a keyframe

Open generation review from the treatment controls. Review selected shot/operation intent and confirm the creative permission. Then inspect the exact candidate/profile and approve a finite one-start usage/spending allowance you accept.

Once matching plan, holds/readiness and current authority permit, the selected worker runs automatically. Inspect the returned actual image (not a fixture), its dimensions/provenance and account usage. Record attempt/result identity. If it is wrong, request a new take explicitly; aesthetic disappointment is not an automatic retry.

Inspect that actual frame and its motion plan, then use the shot card's approval control. Returned-frame/motion approval is distinct from the image-generation start.

## 5. Generate one video and export

Review a separate six-second video candidate bound to the selected profile, exact approved conditioning frame and effective motion. Check account credit/current price and approve one video start.

Expected result: one saved vendor job, polling of that same job, downloaded/normalized owned video and a playable shot card. Audition picture/accepted voice/music in Timeline, export locally, and inspect duration/picture/sound in the actual MP4. Generated clip sound is removed; the soundtrack uses accepted narration and optional owned music.

Refresh and restart/reopen. Confirm the same attempt/take/export identities remain and no duplicate create occurred. Unknown submission must stay attached to its original attempt/liability until reconciled; missing output is not permission to start over.

## 6. Validate the other live routes and scoped reuse

- **API images:** test the alternate image route in a separate small project so account/provider identity stays clear.
- **Speech:** generate one exact short stock-voice script, listen/accept current bytes/range and verify overlay playback/export.
- **Transcription:** recognize one short owned recording; compare returned words/timing with what you hear, then explicitly adopt only the intended evidence. Rewritten text is not automatically aligned.
- **Two-shot edit:** after a successful small run, add a second shot and revise only that shot. Confirm the first image/take is reused, only affected reviews renew and export reflects the edit.
- **Longer film:** expand only after the small flows pass. Synthetic six-minute tests do not prove real long-form quality.

## Report results

Record pass/fail, confusing controls, selected models/account route, actual attempt/vendor job identities, latency, generated dimensions, source/export durations, observed account usage and scoped reuse/restart behavior. Configured estimates remain separate from actual charges.

For an error, record its code and phase: before submission, unknown create, vendor processing, download, normalization or export. Keep saved state for diagnosis. Exclude keys, local tokens, signed result URLs, credential files and private project text.

See [current status](STATUS.md), [readiness checkpoint](HUMAN-TESTING-READINESS.md), [review semantics](SPENDING-REVIEW.md) and [audio rehearsal](MANUAL-AUDIO-TESTING.md).
