# Storyboard studio

The studio is an editable treatment/scenes/shots workspace with a Director conversation, owned media, generation review and a lightweight Timeline. October 3 refinement adds flexible pane/composer sizing, safe Markdown, stable background updates and compact settings. App-wide design-system adoption and a larger plan-card proposal remain human choices.

## Film flow

1. Start in conversation or bring a UTF-8 text/Markdown brief. Inspect the director's interpretation and confirm the proposed film plan before it becomes canonical.
2. Edit treatment, scene purpose and shot direction inline. Add scenes/shots, reorder through handles or keyboard controls, delete a shot, or undo the latest eligible edit.
3. Decide narration per shot: **No narration**, script-generated voice or owned recording. Audio setup opens the compact script/recording/listen/accept flow for that shot.
4. Discuss a selected shot or whole-film request to update relevant prompts/plan. Direct edits save intent without launching media. A covering message can continue multiple saved edits together.
5. Review intended generation and usage, inspect the returned keyframe and motion on each card, then approve the exact video work. The generated clip replaces its frame and can be previewed.
6. Audition picture, accepted narration and optional owned music in Timeline. Render/export locally and inspect the final result. Assets retains uploaded/generated media; chat **+** imports it.

## Editing and authority

Stable shot IDs survive reorder/undo. Revision-checked commands save canonical intent, fence old director authority and hold affected work. Image/video intent changes invalidate only relevant candidates/downstream results; motion-only edits can retain the keyframe. Topology/music changes invalidate assembly. Late outputs remain historical evidence and cannot overwrite a new selection.

Saved edits retain owner/scope. A fresh covering request transfers all fully covered eligible holds atomically; a partial, foreign or changed proof fails. This is continuation of creative work, not media spending permission. Undo restores creative content, not spent grants or old approval authority.

## Audio and timing

Explicit silence uses the planned shot duration and no synthetic recording. Undecided narration remains visible as a decision. Script-first and recording-first paths end with acceptance of saved words/description, exact recording and source range. Compact within-shot voiceover may end before the planned 3–15 second picture. An explicit duration change can match an eligible recording; existing sources are never padded or relabeled.

Narration-writing changes retain visual media while blocking stale speech/video intent until current audio/plan is ready. Legacy absolute placements preserve their meaning. The owned audio library can import/listen/select music without changing narration or creating edit holds. Existing eligible provider voice IDs can be registered; new cloning enrollment remains pending. See [shot audio](../implementation/SHOT-AUDIO.md) and [personal voice](../implementation/PERSONAL-VOICE.md).

Timeline synchronizes muted picture with accepted narration/music and supports seek/pause/buffering cleanup. FFmpeg defines the exact final output. Native generated clip sound is removed. Limits are 360 seconds, 64 cuts, 65 audio placements/sources and eight simultaneous lanes. Waveforms, transitions and advanced mix controls remain later work.

## Flexible workspace and quieter settings

Drag the divider beside the Director to resize its width. Focus it and use Left/Right arrows (Shift for a larger step), Home/End, or double-click to reset. The browser remembers the preferred width and clamps it to the available workspace; the divider is hidden in the phone layout. Drag the composer's lower edge to resize it vertically.

Chat renders headings, emphasis, lists, links, fenced code and GFM tables/task lists. Tables scroll inside the pane; raw HTML is not enabled and model-supplied image URLs become links rather than automatic external image loads. Owned image attachments remain in their verified viewer.

Background project refresh keeps current connected content visible. Saved-edit Continue rows are hidden while the Director works; their owned holds remain saved and return when continuation is useful. Ordinary planning and script writing need no generation/spending permission. Compatible shipped guidance upgrades before the first context/dispatch of an eligible fresh native request; old epochs retain their original locks.

Project settings lead with Director, Keyframes, Video and Narration, with optional transcription/accounts/local setup/existing voice identities. Separate Director/media save results remain clear. A no-pending-impact Save applies its exact server preview without an empty confirmation; changed unfinished work receives an actual impact review. Unknown responses retain the same request for recovery.

Minimal design-system examples and a larger **Change / Keep / Next** plan-card direction await user selection. The present refinement does not claim a new global theme or full plan-card redesign. [October 3 review](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) records the final full gate, fixture checks and reviewed response-order fix.

## Implementation and verification

- [Storyboard handler](../../apps/server/src/storyboard.ts), [continuation](../../apps/server/src/application/pending-edit-continuation.ts), [generation permission](../../apps/server/src/generation-permission.ts)
- Web `App.tsx`, `StoryboardControls.tsx`, `ShotAudioPanel.tsx`, `Timeline.tsx` and shared typography/surface styles.
- Core/API tests cover stale revisions, unknown fields, scope, candidate reuse/invalidation, narration and undo. The [October 3 refinement](../implementation/OCTOBER-3-REFINEMENT-REVIEW.md) has the 2,207-test full gate plus disposable UI/synthetic-SSE checks; final verification includes the reviewed supplemental fixes. Earlier [October 1 audio/Timeline evidence](../implementation/V1-COMPLETION-REVIEW.md) keeps its dated scope.
