# Exact requested audio operations

The existing V4 JSON tools, bound to this V5 guidance package, publish one explicitly requested operation through the application. Configured providers require no additional approval step. These operations do not select a resulting recording, adopt recognized words or accept narration. Preserve unrelated sections and the full current plan.

The `prepare_*` names and tool-contract-4 descriptions are retained for historical compatibility. For this current locked V5 package, this contract defines their behavior: an explicit requested input is published for execution directly, without human generation or spending review. Do not reintroduce the old proposal-only approval flow from a historical tool description.

Read `read_context({"section":"audio_operations","offset":0})` and follow its pages. It supplies path-free owned recording identities/digests, supported saved profiles and choices, and saved proposal outcomes. Compare the context guards across pages. Read narration for exact saved section/revision IDs. An installed profile does not prove that the host is enabled, has a key or has usable media tools.

For an existing recording, call `prepare_recording_transcription` with exactly:

- `expectedHeadVersion`, `audioId`, `sourceRecordDigest`, `profileId`, and `language` from current context.
- `target: {"kind":"recording"}` for independent recognition, including when there are no narration sections.
- Or `target: {"kind":"section","segmentId":"saved section","segmentRevisionId":"saved revision","audioId":"same recording"}` for a section already bound to that recording.

Do not invent an upload, copy a path, choose an artifact with merely matching bytes, or create a section solely to request independent recognition. Word timings are suggestions against the complete exact source, not forced alignment to a script. Human adoption and timing review remain separate.

For requested generated narration, read current `audio_operations.savedShotScripts` or canonical narration sections. A saved shot script supplies virtual `segmentId` (the shot ID) and `segmentRevisionId` (the exact saved-intent digest); the application materializes its owned mapped section automatically within the original shot/scene scope. Do not ask the human to open a panel or create a section. Within an application-issued narration authoring session, use `revise_narration_draft` for allowed draft changes. Call `prepare_narration_speech` with exactly `expectedHeadVersion`, the returned `segmentId` and `segmentRevisionId`, `profileId`, `voice`, and `instructions`. Choose an actual allowed voice/default from `options.speech.voices`, or a ready `options.speech.personalVoices` identity when the saved intent is personal; the `stock`/`personal` intent label is not a synthesis voice ID. Never substitute stock for a personal choice. Use `instructions: ""` when no delivery instruction is needed. The application reads the exact saved text; the tool has no replacement-text field. Instructions have a 256-byte limit, and text plus instructions must satisfy the current supported speech policy. If a saved section is too long, discuss an appropriate section split; do not silently truncate it. Do not invent a voice, profile or pronunciation decision absent context or the user's request.

Reread context after every requested audio operation: materialization/publication can advance the project head, and the next input must use its current guard and saved script digest.

Both tools retain `proposalId`, `proposalDigest`, and `kind`, add the application's exact operation identities and return `state: "requested"`. These are audio operation identities, not generic prepared-change IDs. Tell the human which exact recording or saved words are being processed. The executor checks current inputs, pause/holds and host readiness before its durable first-submit marker. There is no separate synthesis/transcription plan approval, spending review or usage allowance.

After a lost response or cancellation, inspect `audio_operations` and receipt context. Do not create a second operation with another identity to guess whether the first worked. Application reconciliation reads the original keyed command receipt and never repeats preparation or provider submission. A changed section, project head or profile requires a fresh read and a deliberate new request. A restored historical operation cannot start another generation.

Completed generated audio stays an available take until the human listens and attaches it. Existing transcripts remain unreviewed candidates until a human separately chooses wording or valid timing. Neither operation automatically accepts script, performance, timing or canonical narration.
