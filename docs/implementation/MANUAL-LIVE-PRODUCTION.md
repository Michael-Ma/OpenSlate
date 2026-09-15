# Manual live production validation

This run uses real services and consumes your account usage or API credits. You perform the live generation and choose each allowance in the app. This guide does not authorize unattended tests by the development agent. Release remains on hold.

Start with one six-second shot. Validate a second image-provider option in a separate project before trying a longer film. The earlier [offline rehearsal](MANUAL-AUDIO-TESTING.md) remains available if you want to inspect the UI without media calls.

## Choose how images are generated

| Choice in Media models | Authentication | What is consumed |
|---|---|---|
| Codex images | Existing ChatGPT login in the pinned local Codex runtime | Codex subscription usage; amount is not estimated by OpenSlate |
| GPT Image 2 · medium keyframes | `OPENSLATE_OPENAI_API_KEY` | OpenAI image API billing |

Both choices are automatic: OpenSlate invokes the selected provider, saves the returned PNG and shows it for review. There is no fallback from Codex to the API, or from the API to Codex. The conversation director is configured independently and can keep using your Codex login with either image option.

Codex's built-in image model is managed by Codex. The current official documentation describes GPT Image 2, but the pinned native interface does not expose an exact image-model/snapshot or quality selector. Canvas dimensions are requested preferences; inspect the returned frame. One approved attempt allows one native turn, not a guaranteed single internal image call or known number of quota units. The USD accounting value of zero means no direct image API charge; it does not mean free or unlimited generation.

Audio generation/transcription still use the OpenAI API key. Viggle video uses its own key. Codex login does not replace either of those credentials.

## 1. Prepare the local installation

Use Node 24, pnpm 10.33.0, FFmpeg and ffprobe. From the repository:

```sh
cd /Users/michael/SideProject/OpenSlate
pnpm install --frozen-lockfile
pnpm build
npm install --prefix "$HOME/.local/share/openslate-codex" --save-exact @openai/codex@0.153.4
"$HOME/.local/share/openslate-codex/node_modules/.bin/codex" --version
```

The last command must show `codex-cli 0.153.4`. The bundled desktop-app runtime may have updated. Keep the separate pinned installation; do not point OpenSlate at an incompatible version. If the pinned runtime needs authentication, run its `login` command locally and sign in with ChatGPT. The Codex image worker requires that authentication mode, not an API-key login. OpenSlate does not copy your login credentials.

Create a separate ignored `.env.live.local` file locally. Do not paste its contents into a conversation or commit it. Use absolute paths for the two path settings below:

```dotenv
OPENSLATE_DATA_DIR=/Users/michael/SideProject/OpenSlate/.openslate/live-validation
OPENSLATE_PROVIDER_CONFIG=/Users/michael/SideProject/OpenSlate/examples/live-provider-profiles.example.json
OPENSLATE_CODEX_IMAGE_BINARY=/Users/michael/.local/share/openslate-codex/node_modules/.bin/codex

# Fill locally. The OpenAI key is optional for Codex images plus your own recording.
OPENSLATE_OPENAI_API_KEY=
OPENSLATE_VIGGLE_API_KEY=

# Enable only the image route(s) you intend to test.
OPENSLATE_ENABLE_CODEX_IMAGE_GENERATION=1
OPENSLATE_ENABLE_IMAGE_GENERATION=0

# The video profile must be enabled when creating the production project.
OPENSLATE_ENABLE_VIGGLE_H3_GENERATION=1
OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS=storage.googleapis.com
OPENSLATE_ENABLE_H3_GENERATION=0

# Leave audio APIs off for the initial uploaded-recording run.
OPENSLATE_ENABLE_SPEECH_GENERATION=0
OPENSLATE_ENABLE_TRANSCRIPTION=0
```

For API images, set `OPENSLATE_ENABLE_IMAGE_GENERATION=1` and fill the OpenAI key. You may enable both image routes and select one per project. A route's enable switch is separate from its in-app allowance.

`storage.googleapis.com` comes from the documented Viggle example. Your account may return a different download hostname. If downloading is blocked, inspect the known job in Viggle and add only its actual trusted hostname to the comma-separated setting. Restart to recover the same job; do not submit another video because a download failed.

Set the file's permissions and start the built app:

```sh
chmod 600 .env.live.local
node --env-file=.env.live.local apps/server/dist/index.js --serve-web
```

Open http://127.0.0.1:3001. Read the local token file identified by the launcher and paste it into the connection screen yourself. That token is unrelated to API keys. Restart with the same command/data directory to keep your projects and attempt history.

## Conversation: Codex usage or API billing

The director uses the Codex runtime in both cases. Its existing setup supports ChatGPT login or API-key login; this is not a separate direct Responses API director.

- **Codex usage:** use your existing ChatGPT login and leave the director's optional **Codex account folder** blank.
- **OpenAI API billing:** create a separate account folder, then log the pinned Codex binary into that folder using its `login --with-api-key` command. The command reads the key from standard input. For example, with `OPENAI_API_KEY` already set privately in your local shell:

```sh
mkdir -p "$HOME/.local/share/openslate-director-api"
printenv OPENAI_API_KEY | CODEX_HOME="$HOME/.local/share/openslate-director-api" "$HOME/.local/share/openslate-codex/node_modules/.bin/codex" login --with-api-key
```

In the project's director **Local installation** section, set **Codex account folder** to that folder's absolute path. Choose a model available to that account and complete the setup check before the first conversation. Do not change your ordinary ChatGPT login to test this option: the automatic Codex image worker still requires ChatGPT login in its separately configured account folder. `OPENSLATE_OPENAI_API_KEY` is for media APIs; it does not automatically switch the director's billing route.

## 2. Create a production project

Create a new project and expand **Media models**, or open an existing project’s **Project settings → Models & usage**, and select:

- **Keyframes:** Codex images OR GPT Image 2 · medium keyframes.
- **Video:** Viggle H3 · first 6-second live shot.
- Audio profiles only if you want the optional audio API tests below.

Do not use the demo button or an old default-demo project. Model choices and local assembly are saved when the project is created; restarting with different environment settings does not replace those saved choices. The included Viggle profile deliberately permits only six-second requests and one concurrent attempt, with no automatic regeneration. Configured dollar estimates are examples, not verified prices or hard vendor billing caps.

Set up the project's native director with the same pinned Codex binary and your desired supported model. Complete its setup check. This is separate from the automatic Codex image worker configuration.

Send:

> Create a one-shot, six-second leather boots commercial for production validation. Use the models saved in this project. Show a close-up of a brown leather boot on a workshop bench, warm side lighting, a slow camera push-in, no lettering or logos. Save the story, scene and shot intent. I will attach a six-second recording and approve its timing before video generation. Stop for my reviews; do not replace completed media automatically.

Check that there is one shot and the selected model names are correct. Request changes in conversation if the agent chose the wrong intent. Do not approve an image or video allowance until its saved prompt and operation match your intent.

## 3. Supply real timing before video

Current video execution requires an accepted, measured audio cue whose duration equals the shot and requested video duration. Detaching narration or merely saying “silent video” does not satisfy that requirement. Automatic script alignment and automatic duration repair are not implemented.

For a simple spoken run, record a short line such as “Built by hand. Ready for the miles ahead.” Keep the complete spoken line under six seconds. You can use FFmpeg to pad the recording to exactly six seconds:

```sh
ffmpeg -i /absolute/path/to/your-recording.m4a -af apad -t 6 -ar 48000 -ac 2 -c:a pcm_s16le /absolute/path/to/boots-six-seconds.wav
```

Use a new output filename. Listen to the result: this command would truncate a source longer than six seconds, so do not accept it if any speech was cut off. For a visual-only test, an actual six-second silent WAV is also possible, but describe it honestly as intentionally silent rather than a spoken transcript.

In **Story & narration**:

1. Explicitly continue the current edit into narration if prompted.
2. Save one finished section containing the actual spoken words and their meaning; choose **My recording** as its source. For intentional silence, use a truthful non-spoken editorial description, such as “Six-second silent product detail; no spoken narration,” with the actual silent recording. Empty writing cannot be accepted.
3. Upload the six-second WAV using **Choose a narration recording**, listen, and attach it to that section.
4. Set the source timing to 0–6 seconds and project placement to 0. Save the timing.
5. Separately accept the saved writing, recording and timing after reviewing each.
6. Under **Connect narration to your shots**, link shot 1 to that section. Select **Review before applying**, inspect the impact, then **Apply this narration**.
7. Use **Continue with the director** and ask it to update the shot's prompts and execution plan for that exact accepted six-second cue, retaining the chosen providers and stopping at review gates.

Do this before reviewing the final keyframe/video specification: applying narration can change shot intent and invalidate earlier review. Do not invent acceptance or edit the database to bypass a blocked cue.

## 4. Generate and review one keyframe

Ask the director to prepare and apply the plan for the one shot. In the spending/usage review, inspect the exact image candidate and selected profile. Approve only one start:

- Codex image choice: confirm that it uses Codex allowance. The amount of subscription quota is unknown in advance.
- API image choice: inspect the configured estimate and approve a small finite API allowance you are comfortable spending.

The worker should run automatically once the current plan, generation permission, edit holds and allowance permit it. Check the resulting image at full size. It must be an actual image, not a **FIXTURE PREVIEW**. Save its attempt/result identity and note which account's usage changed.

Review the exact keyframe on the shot card. Approving an image-generation start and approving the returned keyframe for video are separate actions. If the image needs changing, request a new take explicitly; OpenSlate should not automatically regenerate it for aesthetic reasons.

## 5. Generate one Viggle take and export

After reviewing the keyframe, inspect the video candidate: one six-second shot, the Viggle profile, exact motion prompt and reviewed first frame. Approve a separate allowance for one video start. Check the current price/credit balance in your Viggle account yourself before approval; the example profile's estimate is not an actual billing quote.

Expected flow:

1. One submission produces a saved Viggle video ID.
2. OpenSlate polls that same job, downloads its result and validates/normalizes the take locally.
3. The current plan assembles and renders the shot with your accepted narration.
4. The exported MP4 plays for six seconds with the expected picture and your recording.

Viggle's native generated soundtrack is currently removed by OpenSlate's video normalization. The assembled soundtrack comes from the accepted narration; there is no native-H3-audio mixing, music generation or professional finishing workflow in this validation.

Review the saved job and actual account charge. Refresh, then stop/restart OpenSlate. Confirm the same take/export remains and no additional generation was submitted. If a submission is uncertain, keep that attempt and investigate its existing evidence; an unknown result is not permission to generate again.

## 6. Compare image options and test a scoped edit

Create a second project with the other image provider and repeat the small run. There is deliberately no silent migration of the first project's provider identity. This compares authentication, usage and results without confusing old allowances.

Next expand a successful project to two six-second shots with appropriate accepted timing for each. Request a change to only shot 2. Check that shot 1's image/take identity is retained, only affected reviews are renewed, and the final edit is updated. Avoid a minutes-long batch until these checks pass.

## 7. Optional real speech and transcription APIs

To validate generated narration, select the speech/transcription profiles in a new project's Media models, fill the OpenAI API key, enable the corresponding audio switches and restart. Then follow the [audio review walkthrough](MANUAL-AUDIO-TESTING.md), replacing its disabled-worker rehearsal with your explicit finite live allowances.

- Speech: save a short exact section with **Generated audio** as its source; prepare its speech plan; review words/voice/instructions; approve one API start; listen to and attach the result. Audio attachment and writing/audio/timing acceptance remain separate.
- Transcription: upload or select a short actual recording; prepare recognition of that exact recording; review the plan; approve one API start; compare the returned words and timings to what you hear. Human adoption remains separate.

Generated speech may not be exactly six seconds. Validate its audio independently first. Before using it for this video profile, choose a valid exact six-second source range only if the recording actually contains that range, or explicitly create and re-import a padded recording as described above. Do not silently trim spoken words or claim that transcription automatically aligns rewritten text.

## What to send back

For each checkpoint, report pass/fail and any confusing screen:

- Selected image provider and account-usage route; actual generated keyframe quality/dimensions.
- Audio import, playback, acceptance and six-second cue mapping.
- One Viggle job ID, observed completion time and account charge.
- Export duration, picture, narration and restart behavior.
- Scoped-edit reuse; optional speech/transcription quality.
- Error code and whether failure occurred before submission, during processing or while downloading.

Do not include keys, local tokens, signed download URLs or native credential files. A blocked/uncertain run is useful validation feedback; keep its saved state for diagnosis.

References: [Codex image generation and usage](https://learn.chatgpt.com/docs/image-generation), [OpenAI API authentication](https://developers.openai.com/api/reference/overview), [Viggle creation contract](https://docs.viggle.ai/v1/api-reference/videos/create-from-text). Provider access, current quotas and actual pricing are checked by you during the live run.

### Changing choices and watching progress

Existing projects now have **Project settings** in the header and sidebar. Preview and apply media model changes there; review the preserved work and start the next planning conversation explicitly. Director choices apply to the next idle turn. Saving settings never starts generation or grants spending. See [settings and live updates](PROJECT-SETTINGS-AND-UPDATES.md) for compatibility limits and a no-spend walkthrough.

The browser uses one authenticated SSE stream while visible. **Live updates** means streaming is connected; **Periodic updates** indicates the slow reconnect fallback. Provider job polling remains separate. Restart the local app after upgrading this build, then reconnect the browser with your existing token.
