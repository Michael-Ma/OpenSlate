# Storyboard studio

The studio in `apps/web/src/next` is the only web UI. It follows the [Last Ferry design](../ai/prototypes/last-ferry/DESIGN.md): a dark workspace, local Inter, a Director column and **Plan / Keyframes / Assets / Film**. Start and Settings are separate views. The previous [Day/Night design](OPENSLATE-LIGHT.md) is historical.

## Film flow

1. Create or open a film, or explore the Last Ferry sample. Start from a conversation or import a text/Markdown brief and review its proposed changes.
2. **Plan** edits the saved brief, story, scene titles/order and shot fields. Preview selection is viewing state. Add an explicit @ scene/shot target to focus a Director message.
3. **Keyframes** generates missing frames and voice lines for a scene, or regenerates a selected frame. The current paid frame remains visible while a replacement runs. Earlier eligible frames are available in Takes.
4. Open each current frame. Check its actual motion, timing, narration and video recipe beside the scene video decision. The application records the exact shown frame identity; thumbnail prefetch and old takes do not qualify.
5. Confirm the scene once. The server saves that command, settles missing voice and starts the clips. Closing/reloading the browser does not own this work. Returned clips can be inspected without another acceptance gate.
6. **Film** plays current clips with accepted narration and music in storyboard order. Edit shot order/planned duration and music placement, gain or mute. Its export panel checks readiness, records history and changes, and downloads the resulting MP4. All-demo films export with a Demo stamp.

Configured providers need no separate API-key approval or usage allowance. The two scene generation decisions remain keyframes first, then the reviewed video recipe. An uncertain submission keeps the original request identity; check it before making a replacement.

## Editing, notes and recovery

Direct writing, note decisions, narration fitting and proposal acceptance can run alongside the Director. Later human field edits fence old proposals without needlessly stopping unrelated work. Only changed media intent outdates paid outputs; historical takes remain owned. Undo restores compatible media and leaves newer human edits alone where the command supports a selective inverse. It never recreates old spending authority.

Lettered Director notes anchor to saved scenes/shots and may require action before video. A held proposal shows application-computed Now/After fields, timing and media effects. Accept, reject and Undo recheck the current preview. A Director suggestion cannot start paid generation. Application checks such as an overlong line remain separate from Director suggestions.

Stop detaches unsent jobs; submitted jobs may finish and be charged. Continue clears the Stop control but does not send detached jobs. Giving up on a no-answer attempt frees its slot while reconciliation continues; a late result becomes an earlier take. An unfinished request's release action only releases that request's holds.

Offline, expired sessions, restored-installation quarantine and disconnect have distinct controls. Quarantine allows inspection and refuses writes until the recovery review is completed. The browser retains unsent composer words and explicit scope; restoring them never submits a command. Same-request recovery preserves the original identity.

## Audio, assets and settings

A shot can be silent, use generated narration or use an owned recording. Keyframes can generate the voice early so actual length is known before video. A fitting returned line is accepted by the server; a longer line offers free **Make N s** or **Keep N s** fit decisions. Raw recording import measures and attaches the file in one command, accepts it when it fits, and otherwise leaves fitting pending. Audio is not padded to imply longer accepted coverage.

**Assets** lists images, clips, voices, music and exports with source/scene/shot filters and imports. The music library is independent from narration acceptance. **Settings** separates media models, Director setup and automatic picture review, narrator/personal voices, this computer and language. Existing eligible provider voice IDs support consent and revocation; new cloning enrollment remains pending.

English and Simplified Chinese use stable message IDs. Changing language keeps writing, selection and pending commands; creative content stays in its original language. Narrow layouts use a Director drawer and view-specific controls.

## Sources and verification

- [Next UI/reference](../technical/REVIEW-UI.md), [application routes](../technical/APPLICATION-API.md), [narration](../technical/NARRATION.md), [Film/export](../technical/TIMELINE-RENDERING.md)
- [Browser contract](../../packages/core/src/studio-api.ts), [storyboard commands](../../apps/server/src/storyboard.ts), [durable confirmation](../../apps/server/src/scene-confirmations.ts), [notes](../../apps/server/src/application/director-notes.ts), [proposals](../../apps/server/src/application/director-proposals.ts)
- `pnpm studio:fixture` starts the disposable fake studio; `pnpm studio:fixture --film last-ferry` selects the three-scene/eight-shot server seed. `?fixture=last-ferry` is the separate browser-only sample.
- `pnpm check:browser` is the rendered-browser gate. Node tests and fake media checks do not establish browser usability or real-provider quality. [Status](../implementation/STATUS.md) records delivered cards, actual checks and remaining acceptance. Dated October 1–9 UI reports retain their historical scope.
