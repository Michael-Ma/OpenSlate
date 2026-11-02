# Current contract

Guidance release `8.0.0`, tool contract `7.0.0`, workflow and planning contracts `1.0.0`. The application owns authority, project state, execution and app-computed previews. Read [notes](notes.md) before choosing a mutation and [edits and cards](edits.md) before the 7.0.0 edit tools.

Tools: `read_context`, `read_guidance`, `inspect_artifact`, `prepare_change`, `apply_change`, `propose_change`, `accept_proposal`, `reject_proposal`, `record_notes`, `propose_visual_style`, `make_keyframes`, `make_character_sheets`, `analyze_music`, `set_soundtrack`, `move_shot`, `move_scene`, `delete_shots`, `delete_scene`, `use_take`, `undo_edit`, `start_export`, `control_execution`, `revise_narration_draft`, `prepare_narration_speech`, `prepare_recording_transcription`.

## Reading current state

Call `read_context` with `{}` for overview or `{ "section": "shots", "offset": 0 }` for a page. Sections are `overview`, `shots`, `scenes`, `plan`, `aliases`, `grants`, `receipts`, `narration`, `audio_operations`, `notes`, `audio_library` and `characters`. Follow `page.nextOffset` until null for each collection the request needs. Overview has compact identities and `project.filmKind` (null when unset) with `project.filmKindIntake` (`ask` lists what intake must still settle). `audio_library` lists owned recordings with label, role, length, cached song timing and the current soundtrack. `characters` lists planned characters, wardrobe, sheets and issues. Never assume the first page is complete.

Compare `guard.headVersion`, `revisionId`, `activePlanId`, `graphDigest`, `capabilityLockId` and `domainCursor` across reads, and `guard.dataDigest` within one section. Restart affected pagination if they change. Missing context and size errors are not permission to guess. `grants` explains recorded authority, not new authorization; `receipts` gives outcome identities, not a replay command. If a response is unresolved, preserve its original identity, inspect evidence and stop dependent mutations until the outcome is known.

`read_guidance {package, path?}` returns one locked guidance file (`SKILL.md` when path is omitted). It is free, read-only and allowed in every turn, up to 24 reads per conversation.

## Creative preparation and application

`prepare_change` takes `variant` (`workflow`, `project` or `plan`), current integer `expectedHeadVersion`, and optional `stages`, `creative` or `source`. Never combine `creative` and `source`. For ordinary writing use `variant: "project"` with `creative` and no source. Never author image, review or video declarations, and never use `requestNewTakes`.

A stage proposal has `stageId`, existing `scopeId`, concise `reason` and optional `gaps: [{key,message}]`. Do not add design-only mode, completion, severity, approval or authority fields.

Creative fields in 7.0.0:

- `brief` and `story`. Put scene coverage, timing and narration range in story.
- `project.filmKind`: the whole film-kind@1 record `{kind, subtype?, tones?, format?: {platform?, aspect?, lengthBand?, targetSeconds?}, audience?, source?, labels?, basis?}`. Always write the whole record: read the current one, change it, write it back. `labels` names each `other` value; `basis` says per field whether it was `stated`, `asked`, `inferred` or `default`. Saving it has no media impact and applies directly.
- `project.visualStyle`: the complete look the person chose or named (`null` clears it). Prefer the style card for choosing; see `craft-visual-style`.
- `createScenes: [{key,title,purpose,beforeId?}]`; `updateScenes: [{id,title?,purpose?}]` with at least one changed value. Title is a short scene name (about 6 words, 60 characters); purpose is direction.
- `createShots`: `key`, existing scene ID or same-patch scene key in `sceneId`, `purpose`, `action`, `framing`, `motion`, integer `desiredFrames`, `imagePrompt`, `videoPrompt`, `referenceArtifactIds`, `cueId` (existing ID or null), optional compact `narration`, optional `beforeId` (a shot of the same scene). Framing is a 1–3-word label of at most 40 characters: Close-up, Medium, Wide.
- `updateShots`: existing `id` and changed `purpose`, `action`, `framing`, `motion`, `desiredFrames`, `imagePrompt`, `videoPrompt`, `narration`, or `reauthorPrompts: true` after deliberately rewriting prompts against changed direction.
- `createCharacters`, `updateCharacters`, `deleteCharacterIds` and `updateShots[].characterIds` go in their own call, without other creative fields; they apply directly and return a receipt.
- Compact narration is `{mode:"undecided"|"none"|"generated"|"uploaded",text:string,voice:"stock"|"personal"}`. It saves writing intent, not measured audio or acceptance.

Shot lengths are integer frames at 30 fps, 90–450 frames (3–15 s) per shot. Keyframes, clips and renders follow the film's aspect from `filmKind.format` (9:16, 16:9 or 1:1; 4:5 is made as 1:1, 21:9 as 16:9). Compose every keyframe for that frame.

On shots with current or retained media, including retained voice or accepted cues, changes to purpose, action, framing, motion, prompts, duration or narration use `propose_change`. Pure text without media impact applies directly. Do not submit intent hashes, revisions, measured cue times, audio acceptance or grants. Never split an intended media edit into direct and proposed pieces.

`prepare_change` returns `id`/`preparedId`, `proposalDigest`, `baseVersion`, `semanticChange`, `graphDigest`, `impactCounts` and `stageCount`. Preparation saves nothing: apply with `{ "preparedId": "…" }` while the request is current, then refresh context and read service-issued IDs. Refresh and reprepare after a revision conflict; stop after revoked authority; never release another request's hold.

## Held proposals and scene actions

`propose_change` accepts `{patch:{updateShots?:[{id,purpose?,action?,framing?,motion?,desiredFrames?,imagePrompt?,videoPrompt?,narration?}],updateScenes?:[{id,title?,purpose?}]}}`, omitting unused fields and lists. It holds one coherent change with no source, takes or generation. Link the returned `proposalId` in a typed `proposal` note choice; the person accepts the exact Now/After preview. A clear typed decision in a fresh editing turn on the person's own message uses `accept_proposal` or `reject_proposal` (see [notes](notes.md)).

When the person asks for keyframes in a fresh editing conversation, call `make_keyframes` for exactly the requested scenes or shots; read [requested keyframes](keyframes.md) first. The person may also press "Make keyframes" in Keyframes. For requested video in ready scenes, record one scene-anchored note per scene with `{kind:"confirm_video",sceneId}` and an optional `reply` choice, and say: "Confirm in this chat or in Keyframes." The person reviews returned frames, motion, narration and the actual video recipe before the click. One scene confirmation saves exact script, recording and timing together.

`prepare_recording_transcription` may start priced owned transcription only for an audio attachment sent with this fresh human editing request, when its words are requested or needed. Speech preparation and other transcription sources stay pending suggestions for a human press; never pass them to `apply_change`. The executor owns polling, technical retries and uncertain submissions; returned clips need no extra acceptance.
