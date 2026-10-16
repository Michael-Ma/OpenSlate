# Narration and accepted audio

Writing intent, measured audio, transcript evidence and human acceptance are separate records. Text in a shot card does not prove that a usable recording exists or that its words/timing were accepted.

## Current studio paths

- **No narration:** save explicit `none`; use planned shot frames with no fabricated recording.
- **Generated voice:** save words and a stock or eligible personal voice. Scene keyframe generation also makes missing voice lines, so measured length is available at review. A fitting line is accepted by the server; durable scene confirmation can settle any remaining missing voice.
- **Fit an overlong line:** `POST /api/projects/:projectId/shots/:shotId/narration-fit` with `extend_shot` or `cut_to_shot`. It lengthens within the model's bounds or keeps picture length and cuts audio with a short fade. It uses existing measured audio, makes no provider call and returns an Undo command.
- **Owned recording:** `POST /api/projects/:projectId/shots/:shotId/narration/recording?expectedHeadVersion=N` accepts raw audio with an idempotency key. It imports, normalizes, measures and attaches in one command, accepting only when it fits. An overlong recording remains attached for narration-fit; Undo restores compatible narration and media.
- **Owned transcription:** recognition of exact owned audio remains candidate evidence until adopted; saved words alone do not prove alignment.

The next UI reads `GET /narration/shots/:shotId` for the shot and `/narration/playback` for accepted Film placements. It does not coordinate narration-session POSTs in the browser. The durable scene runner owns the speech/attach/accept/video sequence and exact replay identities. Internal narration services retain source, revision, range and provenance checks.

Ordinary writing, guidance compatibility and configured-provider usage need no separate approval. The human scene-video decision binds current frames, recipe and narration. Audio acceptance concerns exact measured content and timing; it is not an API-key or usage gate. Unknown speech outcomes must be reconciled before any replacement.

## Canonical state

Narration sections have immutable script revisions, selected source/audio, cue sample ranges and independent accepted writing/audio/timing decisions. Compact shot audio owns one shot and a fixed section pin. It cannot borrow a broader request or mutate a different section through collection updates.

Canonical synchronization derives current project cues and audio placements. Accepted within-shot narration follows its shot through reordering and earlier duration changes. A one-second voiceover may play inside a six-second picture; the recording is not padded or misrepresented. Legacy absolute placements keep their saved semantics.

Changing script/mode/voice invalidates stale speech proposals and readiness at review, admission and dispatch. Writing-only changes retain picture outputs; visual intent changes need explicit prompt/plan changes. A new accepted cue can update derived assembly through bounded narration rebase while preserving picture reviews, attempts and grants.

## Owned media and voice

Audio is locally decoded/normalized and measured as 48 kHz PCM before authoritative ranges/acceptance. Importing into the owned audio library for audition/music does not create narration acceptance or creative holds. Transcription word timestamps map to source samples; rewritten text is not automatically aligned.

The personal-voice registry stores an already-created provider identity plus explicit project consent/revocation. Existing eligible OpenAI custom IDs are dispatched exactly; stock fallback is rejected. Enrollment from a recording is not implemented. See [personal voice](../implementation/PERSONAL-VOICE.md).

## Source and checks

- [Narration service](../../apps/server/src/narration/service.ts), [canonical synchronization](../../apps/server/src/narration/canonical.ts), [shot reads](../../apps/server/src/narration/shot-audio-routes.ts), [recording command](../../apps/server/src/narration/shot-recording-routes.ts), [fit command](../../apps/server/src/narration-fit.ts), [scene runner](../../apps/server/src/scene-confirmations.ts)
- [Speech proposals/reviews](../../apps/server/src/narration/narration-speech-service.ts), [owned transcription](../../apps/server/src/narration/owned-transcription-service.ts), [transcript selection](../../apps/server/src/narration/transcript-selection.ts)
- [Audio placement](../../apps/server/src/narration/audio-placement.ts), [personal voices](../../apps/server/src/narration/personal-voices.ts)
- Tests cover exact source/revision/range authority, cross-section/foreign-hold rejection, stale speech, canonical rebase, transcript adoption, short overlay timing and actual local FFmpeg mixing.

See [shot audio](../implementation/SHOT-AUDIO.md), [audio rehearsal](../implementation/MANUAL-AUDIO-TESTING.md) and [live testing](../implementation/MANUAL-LIVE-PRODUCTION.md).
