# Exact audio proposals

These V3 tools prepare one requested operation for human review. They do not start providers, consume spending approval, select a resulting recording, adopt recognized words or accept narration. Preserve unrelated sections and the full current plan.

Read `read_context({"section":"audio_operations","offset":0})` and follow its pages. It supplies path-free owned recording identities/digests, supported saved profiles and choices, and saved proposal outcomes. Compare the context guards across pages. Read narration for exact saved section/revision IDs. An installed profile does not prove that the host is enabled, has a key or has usable media tools.

For an existing recording, call `prepare_recording_transcription` with exactly:

- `expectedHeadVersion`, `audioId`, `sourceRecordDigest`, `profileId`, and `language` from current context.
- `target: {"kind":"recording"}` for independent recognition, including when there are no narration sections.
- Or `target: {"kind":"section","segmentId":"saved section","segmentRevisionId":"saved revision","audioId":"same recording"}` for a section already bound to that recording.

Do not invent an upload, copy a path, choose an artifact with merely matching bytes, or create a section solely to request independent recognition. Word timings are suggestions against the complete exact source, not forced alignment to a script. Human adoption and timing review remain separate.

For requested generated narration, first save the intended words with `revise_narration_draft` when needed. Then call `prepare_narration_speech` with exactly `expectedHeadVersion`, `segmentId`, `segmentRevisionId`, `profileId`, `voice`, and `instructions`. Use `instructions: ""` when no delivery instruction is needed. The application reads the exact saved text; the tool has no replacement-text field. Instructions have a 256-byte limit, and text plus instructions must satisfy the current supported speech policy. If a saved section is too long, discuss an appropriate section split; do not silently truncate it. Do not invent a voice, profile or pronunciation decision absent context or the user's request.

Both tools return `proposalId`, `proposalDigest`, `kind`, and `state: "ungranted"`. They are audio proposal identities, not generic prepared-change IDs. Tell the human which exact work is ready for review in Story & narration. Human plan review creates the bounded generation candidate; finite spending approval is a separate action. The executor still checks current inputs, pause/holds and host readiness before its durable first-submit marker. A proposal does not bypass those requirements.

After a lost response or cancellation, inspect `audio_operations` and receipt context. Do not create a second proposal with another identity to guess whether the first worked. Application reconciliation reads the original keyed command receipt and never repeats preparation. A changed section, project head or profile requires a fresh read and a deliberate new proposal. A restored proposal cannot issue new permission.

Completed generated audio stays an available take until the human listens and attaches it. Existing transcripts remain unreviewed candidates until a human separately chooses wording or valid timing. Neither operation automatically accepts script, performance, timing or canonical narration.
