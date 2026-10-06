# Narration and accepted audio

Writing intent, measured audio, transcript evidence and human acceptance are separate records. Text in a shot card does not prove that a usable recording exists or that its words/timing were accepted.

## Human paths

- **No narration:** save explicit `none`; use planned shot frames with no fabricated silent recording.
- **Script first:** save words, choose stock or eligible personal voice, request speech with the configured model, then listen and accept the recording/range.
- **Recording first:** upload/import owned audio, listen, save actual words or a truthful description, bind the exact range and accept it.
- **Transcription:** review recognition of the exact owned recording; a returned transcript is candidate evidence until the human adopts words/timing.

Ordinary script writing, guidance compatibility and configured-provider usage require no separate approval. An explicit speech/transcription request executes its exact saved input without another generation-approval step. Audio acceptance is a decision about the returned recording and range rather than an API-key, spending or usage gate.

## Canonical state

Narration sections have immutable script revisions, selected source/audio, cue sample ranges and independent accepted writing/audio/timing decisions. Compact shot audio owns one shot and a fixed section pin. It cannot borrow a broader request or mutate a different section through collection updates.

Canonical synchronization derives current project cues and audio placements. Accepted within-shot narration follows its shot through reordering and earlier duration changes. A one-second voiceover may play inside a six-second picture; the recording is not padded or misrepresented. Legacy absolute placements keep their saved semantics.

Changing script/mode/voice invalidates stale speech proposals and readiness at review, admission and dispatch. Writing-only changes retain picture outputs; visual intent changes need explicit prompt/plan changes. A new accepted cue can update derived assembly through bounded narration rebase while preserving picture reviews, attempts and grants.

## Owned media and voice

Audio is locally decoded/normalized and measured as 48 kHz PCM before authoritative ranges/acceptance. Importing into the owned audio library for audition/music does not create narration acceptance or creative holds. Transcription word timestamps map to source samples; rewritten text is not automatically aligned.

The personal-voice registry stores an already-created provider identity plus explicit project consent/revocation. Existing eligible OpenAI custom IDs are dispatched exactly; stock fallback is rejected. Enrollment from a recording is not implemented. See [personal voice](../implementation/PERSONAL-VOICE.md).

## Source and checks

- [Narration service](../../apps/server/src/narration/service.ts), [canonical synchronization](../../apps/server/src/narration/canonical.ts), [shot routes](../../apps/server/src/narration/shot-audio-routes.ts)
- [Speech proposals/reviews](../../apps/server/src/narration/narration-speech-service.ts), [owned transcription](../../apps/server/src/narration/owned-transcription-service.ts), [transcript selection](../../apps/server/src/narration/transcript-selection.ts)
- [Audio placement](../../apps/server/src/narration/audio-placement.ts), [personal voices](../../apps/server/src/narration/personal-voices.ts)
- Tests cover exact source/revision/range authority, cross-section/foreign-hold rejection, stale speech, canonical rebase, transcript adoption, short overlay timing and actual local FFmpeg mixing.

See [shot audio](../implementation/SHOT-AUDIO.md), [audio rehearsal](../implementation/MANUAL-AUDIO-TESTING.md) and [live testing](../implementation/MANUAL-LIVE-PRODUCTION.md).
