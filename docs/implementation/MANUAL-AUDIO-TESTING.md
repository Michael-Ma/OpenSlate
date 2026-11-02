# Audio rehearsal without paid media

Use the disposable fake-provider studio to inspect narration, owned recordings, fit and playback. Native Director conversations can still consume account usage; select the demo Director for a fully fake conversation. Do not rely on missing keys alone to disable media in a real installation.

## Start separately

```sh
pnpm studio:fixture --film last-ferry
```

This creates disposable state on 3101, including synthetic narration and fake media. For UI development, after shared packages are built run `pnpm --filter @openslate/web dev` in another terminal; its 5173 proxy targets 3101 by default. The browser-only `?fixture=last-ferry` uses a separate simulated transport. Neither path proves real speech or transcription quality. Card sandboxes must leave browser launching to the lead.

For a real local recording-import rehearsal instead use an explicitly separate `OPENSLATE_DATA_DIR`, with all real media routes explicitly disabled according to [activation](MEDIA-EXECUTION-LAUNCHER.md), and preserve any production instance. Importing/listening to owned audio does not itself require a provider request.

## Storyboard narration and fitting

1. Open a storyboard film with two shots: one explicit **No narration**, one generated/owned narration intent. In Plan/Keyframes save a short script and selected stock voice, or import an owned recording.
2. A recording press imports, measures and attaches that shot's audio in one keyed command. Fitting audio is accepted automatically under that human command. The user need not operate the retired browser session/accept workflow.
3. Listen and compare saved words/description with the actual source. Audio is measured at 48 kHz. A short voice may end before a six-second picture ends; no padding is needed.
4. For overlong measured audio, check the free **Make N s** / **Keep N s** choices: extend within model limits, or retain shot length and cut audio with a short fade. Undo restores eligible prior narration/media state. No provider call is needed for fitting.
5. Change the script/mode/voice and check old speech readiness no longer appears current, while unrelated shots/picture remain. Scene **Generate keyframes** also requests missing voice lines; use only the fake provider for this rehearsal.
6. A scene video confirmation is one server-owned durable command. The browser does not sequence speech/attach/accept/video itself; missing/failed/unknown voice blocks the appropriate step rather than buying replacement speech after reload.

Exact shot/session provenance and source/range validation remain internal invariants even though the old session HTTP/UI workflow is retired. Real speech results require a separately scoped [live test](MANUAL-LIVE-PRODUCTION.md).

## Transcription, music and code films

Transcription recognizes exact owned audio/settings as candidate evidence for Director attachments. With the API disabled there should be no fabricated real transcript. Human transcript adoption remains unavailable; rewritten text is not automatic audio alignment.

The owned audio library can import/listen/select background music without changing narration or creating a creative hold. In Film, check placement/gain/mute. Code films use separate journaled `ctx.speech`/`ctx.music` and `ctx.render` placements rather than storyboard fit commands. Lyria is a paid route; use fake music for an offline rehearsal.

## Playback and recovery

Audition muted picture with accepted narration/music on Film's common playback clock. Seek, pause, return to a cue and switch views. Export locally and listen to the actual MP4. Reopen/reload and verify saved audio/ranges, fit and original command identities; restoring an unsent draft must not submit it.

Record actual controls exercised, import method, measured duration/range, reuse/restart behavior and errors. Exclude credentials/private project text. This establishes local behavior only; real audio quality, account eligibility and billing require their own evidence. [Narration reference](../technical/NARRATION.md), [shot audio](SHOT-AUDIO.md), [owner tests](../ai/code-plan/TEST-INSTRUCTIONS.md).
