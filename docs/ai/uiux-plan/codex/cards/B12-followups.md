# Card B12: server follow-ups found while building the P5 views

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it. All earlier cards (B1 to B11) are merged in your tree.

## Items
1. **This computer**: `GET /api/installation/status` returns `InstallationStatus` (contract in `packages/core/src/studio-api.ts`): whether the pinned Codex runtime is found, its version and the pinned version, whether it is signed in (null when unknown without a model call), ffmpeg/ffprobe availability and versions (the media toolchain the server already probes), and whether real providers are configured. No film needed. Never return secrets, keys or full filesystem paths. The Start and Settings views read it.
2. **Codex version in `/director/setup`**: include the detected Codex version alongside the existing setup fields.
3. **Personal voices**: the list includes each voice's full id and the consent dates (granted, and revoked if any).
4. **Taken-off slots**: the overview's `MediaSlot.takenOff` is "stopped" for candidates Stop detached (card B4's `outdatedReason: "stopped"`) and "released" for slots whose no-answer job was released, until a new press binds a candidate.
5. **Export while stopped**: storyboard exports render locally and spend nothing, so `prepareExport` and `run` allow them while the film is stopped (keep the refusal for anything that calls a paid provider). Test it.
6. **One command for a multi-field shot edit**: storyboard kind `shotFields` with `{ id, fields: { imagePrompt?, motion?, desiredFrames?, videoPrompt?, framing?, purpose?, action? }, expectedHeadVersion }` applies all fields as one command (one Undo restores all of them, card B8's media restore applies), with the same validation, outdating and hold rules as `shot`. It runs alongside the Director (card B9).
7. **Narrator default for voice lines made with keyframes**: verify that the keyframes-with-voice path (card B7) uses the project's narrator voice (card B11) for lines without a pinned voice, and a pinned personal voice only when it is ready; add a test if one is missing.

## Out of scope
Anything in apps/web. Removing routes the classic UI uses (a later card, after the classic UI is deleted).

## Tests (at least)
Each item has an HTTP-level test; the status route never leaks a path or secret (assert on the serialized body); export while stopped succeeds and a paid generate while stopped still refuses; shotFields applies and undoes atomically and refuses a duration below an accepted line.
