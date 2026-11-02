# Current contract

Guidance package `7.0.0`, tool contract `6.0.0`, workflow and planning contracts `1.0.0`. The eleven tools include `record_notes`, `propose_change` and `make_keyframes`. The application owns authority, project state, execution and app-computed previews. Read [notes](notes.md) before choosing a mutation.

## Reading current state

Call `read_context` with `{}` for overview or `{ "section": "shots", "offset": 0 }` for a page. Sections are `overview`, `shots`, `scenes`, `plan`, `aliases`, `grants`, `receipts`, `narration`, `audio_operations` and `notes`. Follow `page.nextOffset` until null for each collection needed by the request. Overview has compact identities; read `shots` and `scenes` for full intent records. Never assume the first page is complete.

Compare `guard.headVersion`, `revisionId`, `activePlanId`, `graphDigest`, `capabilityLockId` and `domainCursor` across reads, and `guard.dataDigest` within one section. Restart affected pagination if they change. The raw `cursor` tracks audit events and is not a content freshness guard. Missing context and size errors are not permission to guess.

For a separate timeline/render edit, read all `plan` source chunks in returned offset order (`utf16_characters`) and all `aliases` pages. Preserve current operation identities and untouched source. Historical aliases with `current: false` are not current operations. If retaining the saved source would require authoring image, review or video declarations, use the studio's Film/export controls instead of rebuilding generation work.

`grants` explains recorded authority, not new authorization. `receipts` supplies compact outcome identities, not an automatic replay command. If a response is unresolved, preserve its original identity, inspect application evidence and stop dependent mutations if the outcome cannot be established. Never send a new creative interpretation or candidate to recover an unknown result.

## Creative preparation and application

`prepare_change` accepts a change with `variant` (`workflow`, `project` or `plan`), current integer `expectedHeadVersion`, and optional `stages`, `creative` or `source`. At least one stage, creative patch or source is required. Use the exposed schema for the transport shape.

Never combine `creative` and `source` in one call. For ordinary writing use `variant: "project"`, `creative` and no source. Never author image, review or video declarations, and never use `requestNewTakes`. The application builds all keyframe and video work; `make_keyframes` requests keyframes and needed voice lines, while video requires human scene confirmation. Only separate timeline and render source may remain, where needed; Film exports do not require Director-authored source.

A stage proposal has `stageId`, existing `scopeId`, concise `reason` and optional `gaps: [{key,message}]`. Do not add design-only mode, completion, severity, approval or authority fields. Application checks determine coverage.

Creative fields in 6.0.0:

- `brief` and `story`; global `narrationScript` and `narrationSource` are unavailable. Put scene coverage, timing and narration range in story.
- `createScenes: [{key,title,purpose}]`. Use a short scene name for `title` (at most about 6 words or 60 characters), and direction for `purpose`. `updateScenes` takes `{id,title? ,purpose?}` with at least one changed value.
- `createShots`: `key`, existing scene ID or same-patch creation key in `sceneId`, `purpose`, `action`, `framing`, `motion`, integer `desiredFrames`, `imagePrompt`, `videoPrompt`, `referenceArtifactIds` and `cueId` (existing ID or null); optional compact `narration` intent. Framing is a short 1–3-word label, at most 40 characters: Close-up, Medium, Wide. Put descriptive composition in purpose, action and prompts.
- `updateShots`: existing `id` and changed `purpose`, `action`, `framing`, `motion`, `desiredFrames`, `imagePrompt`, `videoPrompt`, `narration`, or `reauthorPrompts: true`. When directly saving an eligible intent update, deliberately rewrite or reconfirm prompts against the changed direction before setting that flag. Reference and cue updates are unsupported by this patch.
- Compact narration is `{mode:"undecided"|"none"|"generated"|"uploaded",text:string,voice:"stock"|"personal"}`. It saves writing intent, not measured audio or acceptance. Explicit none clears only that shot's cue through the application.

On shots with current or retained media, including retained voice or accepted cues, changes to purpose, action, framing, motion, prompts, duration or narration use `propose_change`. Pure text without media impact applies directly. Do not submit intent hashes, revisions, measured cue times, audio acceptance or grants. `PROPOSAL_REQUIRED` identifies a change that must use a human preview; never split an intended media edit into direct and proposed pieces to evade it.

`prepare_change` returns compact `id`/`preparedId`, `proposalDigest`, `baseVersion`, `semanticChange`, `graphDigest`, `impactCounts` and `stageCount`. Preparation does not save the writing. Apply with `{ "preparedId": "the returned identity" }` while the request is current. Refresh context after a successful receipt and read service-issued IDs; do not guess IDs from creation keys.

Refresh and reprepare after a revision conflict. Stop old-request mutations after revoked authority. Holds and pause remain application controls; never release another request's hold. A later human message may explicitly continue earlier work; the model cannot invent that continuation.

## Held proposals and scene actions

`propose_change` accepts `{patch:{updateShots?:[{id,purpose?,action?,framing?,motion?,desiredFrames?,imagePrompt?,videoPrompt?,narration?}],updateScenes?:[{id,title?,purpose?}]}}`. Each entry changes at least one field; omit unused fields and lists. Use the same short framing/title rules. It holds one coherent creative change, with no source, new takes or generation. Link the returned `proposalId` in a typed `proposal` note choice; the person can accept the exact application-computed Now/After preview in chat. A proposal does not apply itself.

When the person clearly asks to accept or decline a specific proposal in a fresh editing turn answering their own `source: "user"` message, call `accept_proposal` or `reject_proposal` with `{proposalId}`. Identify it by its app-assigned letter, subject, or a clear reference to the only held proposal. Read current proposals and notes; use the exact ID if letters repeat. If several are open and the message is ambiguous, including only "ok" or "好的", ask which one; never guess. App-message, keyframe-review, automatic and read-only turns cannot make proposal decisions. The application uses the current preview. Only a successful application receipt establishes a proposal decision; use its reported state for the next action. After success, say in one line what changed and that an accepted change can be undone, then continue other requested work, such as new keyframes, using the accepted prompts.

In Plan save direction first. When the person asks for keyframes in a fresh editing conversation, call `make_keyframes` for exactly the requested scenes or shots. The person may also press "Make keyframes" in Keyframes. For requested video in ready scenes, record one scene-anchored note per scene with `{kind:"confirm_video",sceneId}` and an optional `reply` choice. Say: "Confirm in this chat or in Keyframes." They review returned frames, motion, narration and the actual video recipe before the click. One scene confirmation saves exact script, recording and timing together. Listening and recording edits are optional; no separate narration acceptance is required. Film holds clips, soundtrack and export; Assets holds saved media. Name these labels directly.

Read [requested keyframes](keyframes.md) for the `make_keyframes` contract and authority limits. `prepare_recording_transcription` may start priced owned transcription only for an audio attachment sent with this fresh human editing request, when its words are requested or needed. Speech preparation and other transcription sources remain pending suggestions for a human press. Suggestions cannot be applied with `apply_change`. Configured credentials need no separate key approval or usage allowance. The executor owns polling, technical retries and uncertain submissions; returned clips need no additional acceptance gate.
