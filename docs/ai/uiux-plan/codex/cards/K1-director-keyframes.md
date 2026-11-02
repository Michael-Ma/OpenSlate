# Card K1: the Director can make keyframes (and their voice lines) when the person asks

Read `_review-common.md` in this folder first, with one exception: this card may amend tool contract 6.0.0 and skills v7.

The owner decided: when the person asks in the conversation for keyframes (the whole film, some scenes or some shots), the Director starts them itself; the person no longer has to press each scene's Make keyframes. Voice lines needed by those shots are made in the same run, as a scene press does today (decision D3). Video stays human-only: each scene still needs the person's Confirm frames & generate video. This replaces the "only a human press spends money" rule for keyframes, voice lines and (item 4) transcription of a file the person sent. Video, music and everything else keep that rule.

Contract 6.0.0 and skills v7 exist only on this unmerged branch and were never released. Amend them in place, and keep the identity of the current 6.0.0 catalog and v7 packages in the shipped-identity list. Projects saved on this branch then still upgrade; the pin test must cover the amended and the earlier identities. Explain it in the report.

1. **Tool.**
   - Add a `make_keyframes` tool to 6.0.0: `{ sceneIds?: string[], shotIds?: string[], regenerate?: boolean }`, with exactly one of sceneIds or shotIds.
   - It starts the same work a scene's Make keyframes press starts, scene by scene: `generateScene` kind image, plus the voice-only branch and the keyframes run for voice lines.
   - It reuses the existing composition, grants, quotes, holds and every refusal: direction_required, no_answer_in_scene, stopped, a confirmation running, and so on. A scene it cannot start is reported per scene with its code; the others still start.
   - `regenerate: true` remakes existing keyframes, and is only allowed when the person's message asked for new takes of those shots. The guidance says so; enforce what you can, for example only for explicit shotIds.
   - The tool result reports what started per scene (keyframes, voice lines, quote) and what was refused, with codes.
2. **Authority.**
   - The authority is the person's own message: a fresh human conversation request, with an editing turn that is not discuss-only.
   - Keyframe-review turns, automatic or read-only turns, and replies to a review can never start paid work.
   - Record the spend under that human request, so stop, holds and supersede behave as for a press.
   - Idempotent per tool call. An unknown outcome is never blindly resubmitted.
3. **Effects for the person.** Each turn's view (`TurnView.effects` in the web snapshot) gains `generation: DirectorGenerationEffect[]` (see `packages/core/src/studio-api.ts`). A film Stop halts what has not been sent. The overview's keyframe slots and `keyframesRun` show the work as they do for a press.
4. **Transcription of a file the person sent.** When the message carries an audio attachment (card U1) and the person asks what it says, or the line is needed, the Director may start its transcription through the existing owned-transcription path, priced and recorded as a `DirectorGenerationEffect` of kind "transcription". It still never attaches or accepts the result by itself.
5. **Guidance.**
   - Update skills v7 and the host guidance (`film-planning-guidance.ts`, `director-input.ts`) for 6.0.0. When the person asks for keyframes, call make_keyframes and say what started and its price.
   - Never call it just to improve quality, and never for scenes or shots the person did not ask about.
   - Video always needs the person's scene confirmation: tell them which scenes are ready for it.
   - Keep 5.0.0 and older guidance untouched.
6. **Old rule.** The ORIGIN_NOT_AUTHORIZED / awaiting_human_generation path still refuses plan declarations for video, and refuses make_keyframes from epochs that are not allowed (older contracts, review turns).
7. **Tests**:
   - a message asking for all keyframes starts every scene's keyframes and voice lines, once, with the quote in the effect;
   - a scene that cannot start is reported while the others start;
   - Stop halts unsent work;
   - review and read-only turns are refused;
   - an older contract is refused;
   - replaying the tool call does not buy twice;
   - regenerate without shotIds is refused;
   - video can never be started this way.

Files: the server application layer (tool-invocations, director-*, scene generation entry points), `packages/core/src/tools.ts` (6.0.0 only), `packages/director` (bridge and catalog tests), and `skills/v7`. Card U1 runs at the same time and edits the message route and Director input for attachments; keep your edits there minimal.
