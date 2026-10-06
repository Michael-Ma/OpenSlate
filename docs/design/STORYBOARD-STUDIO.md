# Storyboard studio

The studio is an editable treatment/scenes/shots workspace with a Director conversation, owned media, generation review and a lightweight Timeline. The selected **A · Light workspace** is implemented as [OpenSlate Light](OPENSLATE-LIGHT.md), using Radix Themes components and shared color, typography, spacing and interaction rules. White surfaces sit on a pale gray canvas, with blue actions and selection.

## Film flow

1. Start in conversation or bring a UTF-8 text/Markdown brief. Inspect the director's interpretation and confirm the proposed film plan before it becomes canonical.
2. The right Project view always shows the saved Scene → Shot hierarchy. Each shot keeps its direction, image/video prompts, separate keyframe and video, narration and current state together. Use **Edit** in the left conversation to change treatment, scene purpose or a shot, add/reorder/delete shots, or undo the latest eligible edit. Choose a shot in the discussion-scope selector to focus chat.
3. Decide narration per shot: **No narration**, script-generated voice or owned recording. Audio setup opens the compact script/recording/listen/accept flow for that shot.
4. Discuss a selected shot or whole-film request to update relevant prompts/plan. Direct edits save intent without launching media. A covering message can continue multiple saved edits together.
5. Use each scene's green action in the conversation to generate keyframes from its direction. Inspect the entire returned images on the right and the motion and actual video recipe, then use its second action to approve and generate video. Returned clips are available to inspect; green completion means current media is saved. No separate API-key, usage, spending or post-generation acceptance step appears.
6. Audition picture, accepted narration and optional owned music in Timeline. Render/export locally and inspect the final result. Assets retains uploaded/generated media; conversation **Import** and **+** import it. **Export** in the conversation contains rendering and music controls. The right Timeline contains playback only.

## Editing and authority

Stable shot IDs survive reorder/undo. Revision-checked commands save canonical intent, fence old director authority and hold affected work. Image/video intent changes invalidate only relevant candidates/downstream results; motion-only edits can retain the keyframe. Topology/music changes invalidate assembly. Late outputs remain historical evidence and cannot overwrite a new selection.

Saved edits retain owner/scope. A fresh covering request transfers all fully covered eligible holds atomically; a partial, foreign or changed proof fails. This is continuation of creative work, not media spending permission. Undo restores creative content, not spent grants or old approval authority.

## Current plan and unfinished edits

The Director's current-plan card answers two questions: **Saved** shows the current storyboard and current-plan media that exist; **Next** identifies the action supported by present state. It reads the project snapshot, Director status, exact review and saved job/hold evidence. Saved direction is the recorded request, not an inferred creative plan.

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

The right result view does not add another gallery during scene review. Scene action cards on the left reference the saved shots and actual recipes. Video approval requires the exact current conditioning images to load successfully in the active right view; already viewed exact images remain eligible when returning to the Director on a phone.

An unfinished edit alone does not tell the UI which new shot writing or media the Director will propose. Review the saved direction, resume when appropriate, and iterate on the Director's actual response. Scene generation actions and review of exact keyframes/motion and actual video are distinct decisions; configured provider usage needs no additional approval.

## Audio and timing

Explicit silence uses the planned shot duration and no synthetic recording. Undecided narration remains visible as a decision. Script-first and recording-first paths end with acceptance of saved words/description, exact recording and source range. Compact within-shot voiceover may end before the planned 3–15 second picture. An explicit duration change can match an eligible recording; existing sources are never padded or relabeled.

Narration-writing changes retain visual media while blocking stale speech/video intent until current audio/plan is ready. Legacy absolute placements preserve their meaning. The owned audio library can import/listen/select music without changing narration or creating edit holds. Existing eligible provider voice IDs can be registered; new cloning enrollment remains pending. See [shot audio](../implementation/SHOT-AUDIO.md) and [personal voice](../implementation/PERSONAL-VOICE.md).

Timeline synchronizes muted picture with accepted narration/music and supports seek/pause/buffering cleanup. FFmpeg defines the exact final output. Native generated clip sound is removed. Limits are 360 seconds, 64 cuts, 65 audio placements/sources and eight simultaneous lanes. Waveforms, transitions and advanced mix controls remain later work.

## Flexible workspace and quieter settings

Drag the divider beside the Director to resize its width. Focus it and use Left/Right arrows (Shift for a larger step), Home/End, or double-click to reset. The browser remembers the preferred width and clamps it to the available workspace; the divider is hidden in the phone layout. Drag the composer's lower edge to resize it vertically.

Chat renders headings, emphasis, lists, links, fenced code and GFM tables/task lists. Tables scroll inside the pane; raw HTML is not enabled and model-supplied image URLs become links rather than automatic external image loads. Owned image attachments remain in their verified viewer.

Background project refresh keeps current connected content visible. The current-plan card updates its status and next action while retaining saved work; request-owned holds stay authoritative. Ordinary planning and script writing need no approval. Compatible shipped guidance upgrades before the first context/dispatch of an eligible fresh native request; old epochs retain their original locks. Requested speech/transcription uses the configured provider without a separate generation-review step.

**Models for this project** leads with Director, Keyframes, Video and Narration, with optional transcription/accounts/local setup/existing voice identities. Director/media choices have separate saves and results. A no-pending-impact Save applies its exact server preview without an empty confirmation; changed unfinished work receives an actual impact review. Unknown responses retain the same request for recovery. Model settings are an inline conversation tool. A protected save blocks closing it or switching projects; the conversation scroll keeps every control reachable on phones.

The selected system's reusable controls and states are defined in [OpenSlate Light](OPENSLATE-LIGHT.md). Its implementation and disposable browser verification are recorded in the [October 5 review](../implementation/OCTOBER-5-LIGHT-WORKSPACE.md); the earlier [October 3 review](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) retains its dated UI/runtime findings.

## Implementation and verification

- [Storyboard handler](../../apps/server/src/storyboard.ts), [continuation](../../apps/server/src/application/pending-edit-continuation.ts), [generation permission](../../apps/server/src/generation-permission.ts)
- Web `App.tsx`, `ProjectResults.tsx`, `ConversationActions.tsx`, `ProjectEditor.tsx`, `PlanImport.tsx`, `DirectorPlan.tsx`, `director-plan-model.ts`, `InlineField.tsx`, `ShotAudioPanel.tsx`, `Timeline.tsx`, `ui.tsx` and shared Light/typography styles.
- Core/API tests cover stale revisions, unknown fields, scope, candidate reuse/invalidation, narration and undo. The [October 5 Light workspace](../implementation/OCTOBER-5-LIGHT-WORKSPACE.md) has the 2,222-pass full gate plus disposable actual-React/browser checks. New state-transition tests cover exact continuation scope, runtime/question/Stop priority, historical evidence, saved output counts and shot selection after reordering/removal. Earlier [October 3 UI/runtime](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) and [October 1 audio/Timeline evidence](../implementation/V1-COMPLETION-REVIEW.md) keep their dated scope.
