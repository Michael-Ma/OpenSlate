# Human testing readiness

Local installation audited October 1, 2026, after commit `842b28c`. The verified build has been loaded into the real studio at `http://127.0.0.1:3001`, and a paired browser is open at the generation review. This is a readiness checkpoint, not completed live-provider acceptance.

## Verified current state

- Local doctor passes with Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe, the pinned Codex runtime and existing server-side keys.
- Both saved projects retain their head versions, pause states and active hold counts. Their media attempt and active plan counts remain zero after restart.
- Existing Codex-image and Viggle routes are enabled. OpenAI API-image, speech and transcription routes remain disabled pending explicit activation approval.
- The installed catalog contains the exact API image, speech and transcription choices. The configured OpenAI key returned HTTP 200 from the documented [model-list endpoint](https://developers.openai.com/api/reference/resources/models/methods/list); all three exact configured model IDs were listed. This does not prove paid generation access, quota, image organization verification or custom-voice eligibility.
- No generation or transcription call was made during this audit. No keys or project text appear in the [sanitized evidence](human-testing-readiness-evidence.json).

## Pending activation

The proposed change sets only `OPENSLATE_ENABLE_IMAGE_GENERATION`, `OPENSLATE_ENABLE_SPEECH_GENERATION` and `OPENSLATE_ENABLE_TRANSCRIPTION` to `1`, preserving keys, data path, catalog and other switches, then performs a graceful restart. It is waiting for explicit approval in this chat. Enabling routes does not create an allowance or authorize generation.

## Human walkthrough after activation

1. In an older project, open **Project settings → Director → Project guidance → Enable audio planning** for V4. A new project uses the current guidance automatically. The update does not accept narration or spend usage.
2. Select **GPT Image 2 · medium keyframes** for API images, **Viggle H3 · first 6-second live shot** for video, and the OpenAI audio choices when testing audio. Model selection has its own impact preview; existing projects keep their saved choices until applied.
3. Start with one six-second shot. Choose **No narration**, or save and explicitly accept a short uploaded/stock-generated voiceover. Choosing a personal voice requires an existing eligible registered voice; new cloning enrollment still needs provider/account selection.
4. Open **Generation and costs**, select the shot and intended operations, and explicitly continue saved edits across the film when their scope requires it. Review the creative permission, then review the exact candidate and a finite usage/spending allowance.
5. Inspect the returned keyframe and motion, approve that exact review, and separately approve the video start. An uncertain submission is recovered as the same job.
6. Audition picture, accepted narration and optional music in **Timeline**. Render the current plan locally and inspect its output. Refresh/reopen and check no duplicate attempt appeared before expanding to more shots.

Record what was selected, actual attempt/job identities, errors, export duration and account usage. Configured cost estimates are not verified vendor prices. The detailed [manual live production guide](MANUAL-LIVE-PRODUCTION.md) and [audio walkthrough](MANUAL-AUDIO-TESTING.md) remain the test instructions.

## Completion boundaries

The implementation gate passed 2,173 tests plus builds/typechecks before this runtime audit. Real API image/speech/transcription acceptance, full conversational production and user quality acceptance are still human testing work. New voice enrollment and broader installer packaging remain pending; this checkpoint does not claim they are finished.
