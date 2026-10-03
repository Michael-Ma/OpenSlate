# Audio rehearsal without paid media

Use a disposable project/data directory with real media switches disabled to inspect writing, owned recordings, review and playback. Native Director conversations can still consume Codex account usage; choose Demo for a fully fake conversation. A disabled speech/transcription route can show/review a proposal but cannot produce a real result.

## Start separately

Build, then use a new explicit data directory so the rehearsal cannot alter production projects:

```sh
pnpm build
OPENSLATE_DATA_DIR=/absolute/path/to/a/new/audio-rehearsal pnpm start
```

Ensure inherited real-generation switches are off; use [the private config template](../../.env.example) and [doctor](LOCAL-SETUP.md) to inspect setup. Pair through the printed/opened launch link. Create a disposable demo project or select installed models for planning only.

## Script-first and recording-first

1. Create two planned shots. Choose No narration for one and an uploaded/generated voice intent for the other.
2. Open the spoken shot's Audio setup. Save a short exact line or start by importing your owned recording.
3. Listen before binding. Save the actual words or a truthful description; select the exact recording and source-local range.
4. Accept the displayed words/recording/timing. Keep the planned picture longer than a short voiceover; no padding is needed.
5. Edit the words, voice or range. Check old acceptance/speech proposal does not remain current and the other shot is preserved.
6. Continue that edit in chat using saved scope/state. The director can update writing/plan; media routes remain disabled.

If rehearsing generated speech, prepare/review its exact proposal and inspect model/voice/usage information, then stop before paid generation. For a real result follow [live testing](MANUAL-LIVE-PRODUCTION.md) with a current finite allowance.

## Transcription and music

Owned recording transcription freezes exact source bytes/settings. With the API disabled, inspect preparation/review only; no transcript should be fabricated. After a real accepted transcript exists, compare/adopt exact word/sample selections explicitly rather than treating recognition as automatically accepted writing.

Import an owned short music recording through chat **+ → Audio** or Timeline. Audition it and select background music. Library import/listening should not change narration, create creative holds or fence a Director request.

## Playback and recovery

With valid demo/supplied clips, audition Timeline picture, voiceover and music. Seek/pause/return to a later cue and check sound follows picture. Export with local FFmpeg and listen to the actual output. Reload/reopen; verify selected ranges/acceptance and output identities remain saved.

Record which UI actions passed, whether files were imported through the picker or an HTTP harness, exact duration/range behavior and any error. Use synthetic/shared-safe text in screenshots. This rehearsal proves local behavior only; real speech/transcription quality, eligibility and billing remain separate.
