# Storyboard studio

The studio follows the supplied [Frame Studio Day/Night design](OPENSLATE-LIGHT.md). React/Radix controls use neutral grayscale zones, purple-blue actions, local Inter Variable/PingFang and rounded outline icons. A resizable Director conversation sits beside **Plan / Keyframes / Assets / Film** views. The large selected-shot preview, inspector and Scene → Shot shelves share canonical project state.

Use the header language menu for English or Simplified Chinese. The initial choice follows the browser language, and your selection is remembered. Switching keeps drafts, references, selected shots and pending tools; existing creative text and conversation history stay in their original language.

## Film flow

1. Start in conversation or import a UTF-8 text/Markdown brief. Inspect and confirm the proposed film plan before it becomes canonical.
2. **Plan** displays the saved brief, story, Scene → Shot hierarchy, intent, prompts and media state. **Keyframes** provides a full-frame preview, shot inspector and every scene's shot shelf. Select a shot or add an @ scene/shot reference to scope further discussion; chips locate saved objects.
3. Use the conversation editing tool or inspector shortcuts to change direction, prompts, timing and narration. These revision-checked writing commands save intent without starting media. Narrow referenced messages cannot implicitly resume a stopped whole film.
4. Generate missing keyframes per scene or explicitly regenerate selected shots. Unaffected current results and earlier artifacts remain available. Inspect an actual current selected frame and click its green confirmation. Hidden prefetch, thumbnails and earlier takes cannot qualify. A previously viewed exact frame remains eligible after scrolling to the inspector or returning to the phone conversation.
5. Check the scene's exact images, motion, duration, model and settings, then generate video. Returned clips are available to inspect without another acceptance gate. Configured providers need no separate key approval or usage allowance; requested speech/transcription needs no generation-review dialog.
6. **Film** auditions current picture, accepted narration and owned music. Drag/reorder shots or use keyboard controls; plan timing is distinct from source trimming. Music start, gain and mute persist and are shared by audition/export. Import and local rendering/export remain reachable in the conversation and header.

## Editing and authority

Stable shot IDs survive reorder/undo. Revision-checked commands save canonical intent, fence old director authority and hold affected work. Image/video intent changes invalidate only relevant candidates/downstream results; motion-only edits can retain the keyframe. Topology/music changes invalidate assembly. Late outputs remain historical evidence and cannot overwrite a new selection.

Saved edits retain owner/scope. A fresh covering request transfers all fully covered eligible holds atomically; a partial, foreign or changed proof fails. This is continuation of creative work, not media spending permission. Undo restores creative content, not spent grants or old approval authority.

## Current plan and unfinished edits

The compact Director plan widget shows the saved brief, scene/shot counts and timing. Its expanded status answers two questions: **Saved** shows the current storyboard and current-plan media that exist; **Next** identifies the action supported by present state. It reads the project snapshot, Director status, exact review and saved job/hold evidence. Saved direction is the recorded request, not an inferred creative plan.

| Current state | What the card offers |
|---|---|
| Director running | **Updating your plan**; wait for the result or a question |
| Answerable question | **Answer in chat**, linked to that saved question |
| Eligible unfinished edit | Saved scope/direction and **Resume this edit** |
| Direct storyboard changes | Saved changes and **Review generation** to prepare matching work |
| Work stopped | **Write next direction**; a fresh message continues from saved state |
| Unconfirmed provider outcome | **Review job status** for the existing submission |
| Media jobs active | **View generation** for jobs already in progress |
| Exact current frames ready | **Review frames** before video generation |
| Current rendered film available | **Watch the film** in Timeline |

**Resume this edit** appears only for an eligible request whose active held scopes are fully covered by the current conversation scope. It sends a new Director message carrying that request's explicit continuation identity and saved scope. The server still checks and transfers authority; the button does not replay old model authority or start media generation. Running work, pending answers, Stop and uncertain/in-progress jobs suppress Resume. A manual storyboard edit is a saved change needing a matching production plan, rather than evidence that a Director request was interrupted.

Scene review references the saved shots and actual recipes without adding a second result gallery. Conversation cards and workbench shortcuts use the same scoped decisions. Video approval requires the exact current conditioning images to load successfully in the active right view; already viewed exact images remain eligible when returning to the Director on a phone.

An unfinished edit alone does not tell the UI which new shot writing or media the Director will propose. Review the saved direction, resume when appropriate, and iterate on the Director's actual response. Scene generation actions and review of exact keyframes/motion and actual video are distinct decisions; configured provider usage needs no additional approval.

## Audio and timing

Explicit silence uses the planned shot duration and no synthetic recording. Undecided narration remains visible as a decision. Script-first and recording-first paths end with acceptance of saved words/description, exact recording and source range. Compact within-shot voiceover may end before the planned 3–15 second picture. An explicit duration change can match an eligible recording; existing sources are never padded or relabeled.

Narration-writing changes retain visual media while blocking stale speech/video intent until current audio/plan is ready. Legacy absolute placements preserve their meaning. The owned audio library can import/listen/select music without changing narration or creating edit holds. Existing eligible provider voice IDs can be registered; new cloning enrollment remains pending. See [shot audio](../implementation/SHOT-AUDIO.md) and [personal voice](../implementation/PERSONAL-VOICE.md).

Film synchronizes muted picture with accepted narration/music and supports seek/pause/buffering cleanup, persisted shot order/3–15 second plan timing, zoom and panel resizing. Music drag/keyboard placement, gain and mute use the same sample geometry in browser audition and render. FFmpeg defines the exact final output. Native generated clip sound is removed. Limits are 360 seconds, 64 cuts, 65 audio placements/sources and eight simultaneous lanes. Arbitrary source trim/split, redo, adoption of earlier generated versions, waveforms, transitions and multiple independently arranged music/effect lanes remain later work.

## Flexible workspace and quieter settings

Drag the divider beside the Director to resize its width. Focus it and use Left/Right arrows (Shift for a larger step), Home/End, or double-click to reset. The browser remembers the preferred width and clamps it to the available workspace; the divider is hidden in the phone layout. Drag the composer's lower edge to resize it vertically.

Chat renders headings, emphasis, lists, links, fenced code and GFM tables/task lists. Tables scroll inside the pane; raw HTML is not enabled and model-supplied image URLs become links rather than automatic external image loads. Owned image attachments remain in their verified viewer.

Background project refresh keeps current connected content visible. The current-plan card updates its status and next action while retaining saved work; request-owned holds stay authoritative. Ordinary planning and script writing need no approval. Compatible shipped guidance upgrades before the first context/dispatch of an eligible fresh native request; old epochs retain their original locks. Requested speech/transcription uses the configured provider without a separate generation-review step.

**Models for this project** leads with Director, Keyframes, Video and Narration, with optional transcription/accounts/local setup/existing voice identities. Director/media choices have separate saves and results. A no-pending-impact Save applies its exact server preview without an empty confirmation; changed unfinished work receives an actual impact review. Unknown responses retain the same request for recovery. Model settings are an inline conversation tool. A protected save blocks closing it or switching projects; the conversation scroll keeps every control reachable on phones.

The reusable controls, tokens and responsive contract are defined in [Studio Day/Night](OPENSLATE-LIGHT.md). Its implementation and disposable browser verification are recorded in the [October 7 review](../implementation/OCTOBER-7-DAY-NIGHT-REVIEW.md); the earlier [October 3 review](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) retains its dated UI/runtime findings.

## Implementation and verification

- [Storyboard handler](../../apps/server/src/storyboard.ts), [continuation](../../apps/server/src/application/pending-edit-continuation.ts), [generation permission](../../apps/server/src/generation-permission.ts)
- Web `App.tsx`, `FrameWorkspace.tsx`, `FrameDecision.tsx`, `ReferenceComposer.tsx`, `ConversationActions.tsx`, `ProjectEditor.tsx`, `PlanImport.tsx`, `DirectorPlan.tsx`, `director-plan-model.ts`, `InlineField.tsx`, `ShotAudioPanel.tsx`, `Timeline.tsx`, `ui.tsx` and shared Day/Night/typography styles.
- Core/API tests cover stale revisions, unknown fields, scope, candidate reuse/invalidation, narration and undo. The [October 7 workbench review](../implementation/OCTOBER-7-DAY-NIGHT-REVIEW.md) records the current full gate, offline integration and desktop/mobile browser checks. New state-transition tests cover exact continuation scope, runtime/question/Stop priority, historical evidence, saved output counts and shot selection after reordering/removal. Earlier [October 3 UI/runtime](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) and [October 1 audio/Timeline evidence](../implementation/V1-COMPLETION-REVIEW.md) keep their dated scope.
