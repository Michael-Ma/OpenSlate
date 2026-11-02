> Evidence appendix for ../UIUX-IMPLEMENTATION-PLAN.md, produced by a code-grounded gap analysis on 2026-10-14 against commit 2c4b6e3. Item ids (DC, GR, SB, WA, LG) are referenced from the plan.

# Director agent contract and the conversation

**Conclusion: the design's Director features cannot be built on today's contract.** Five things block it.

1. **The Director can only produce prose.** It writes free text (`director-supervisor.ts:141-150`). None of its 8 tools records a note, an anchor, a choice or a resolved state (`packages/core/src/tools.ts:7-9, 70-96`).
2. **Changes apply at once.** prepare and apply happen in the same turn (`service.ts:493-503`). Only plan import can hold a draft for a person (`plan-imports.ts`, `service.ts:506-530`).
3. **A prepared change is fragile and says little.** It goes stale on any head move (`service.ts:538`). Its impact list is empty for a creative patch (`service.ts:286`).
4. **There is no Undo for Director changes.**
5. **Every hand edit or press revokes the running turn.** Any human edit, Make or accept opens an editing request that supersedes the turn and revokes its epoch (`service.ts:127-131`, `storyboard.ts:393`, `scene-generation.ts:652`). The supervisor then aborts the turn (`director-supervisor.ts:109-110`).

**The Director cannot see generated keyframes.**
- Only human-selected, non-fixture PNGs reach it (`director-images.ts:55-58`).
- Only at turn start, at most 4 images and 512 KiB in total (`runtime/images.ts:13`, `codex.ts:184`).
- Tool results can carry text only (`tools/stdio.ts:92`).
- Fake keyframes are SVG (`providers/src/fake.ts:103-104`), so they cannot be shown to the Director at all.

**The conversation still shows synthetic user messages.** About 20 `beginRequest` call sites write app text as if the user said it. The snapshot filters out only storyboard edits (`service.ts:602-606`). The Director's context also reads that text as the user's words (`context-projection.ts:235`).

**Recommended contract: a new tool contract 5.0.0 with V6 guidance.** It adds:
- `record_notes`: typed notes anchored to shots, with app-assigned letters, typed choices and a resolved state.
- `propose_change`: a held proposal, allowed in discuss-only turns, that places no holds. It is rebased while the touched shots are unchanged and shows an app-computed Now / After preview.
- Accept, Reject and Undo routes that run as "alongside" human requests and do not revoke the turn.
- A keyframe projection from the app: thumbnails or a contact sheet at turn start, recorded with the image hashes so a note knows exactly which picture it described.
- A discuss-only review turn that the app starts when a scene's keyframes land.
- A `source` field on requests, plus a migration, so app-written messages stop appearing as user bubbles.
- A scripted fake Director that calls the same tools.

**Corrections to the research files:**
- `agent.md` is right that V5 audio tools start paid speech. It misses a second path: `finalizePreparedChange` creates speech and transcription grants for any Director plan that contains speech nodes (`service.ts:334-335`).
- The tool-contract 3 and 4 descriptions still say the audio tools "never generate", but under V5 they do (`tools.ts:74-80` against `tool-invocations.ts:183-197`).
- The synthesis claim that prepare_change "already returns" usable impact counts is false, as the review digest found.
- Scene scope needs no server work: the server already accepts scene ids (`service.ts:120-122, 208-211`). Only the web's composer keeps it to shot ids (`composer-draft-cache.ts:21-23`, `App.tsx:952`).

## DC-1 Typed, shot-anchored Director notes (record_notes tool + director_note record) [core, L, compatible_today=False, deps=DC-11]
- Design: Lettered notes (a)/(b) anchored to shots, each with typed actionable choices and a resolved state; lettered callouts on shot cards
- Current: Director output is only free text: DirectorSupervisor.output stores {text, phase} per turn, max 32k chars per message and 100 per turn (apps/server/src/application/director-supervisor.ts:141-150). The runtime emits only assistant_message, pending_input and diagnostic events (packages/director/src/runtime/types.ts:38-44). The tool catalogs hold 8 tools and none of them record notes (packages/core/src/tools.ts:7-9, 70-96). The web renders assistant text as markdown (apps/web/src/App.tsx:1401-1413).
- Gap: Letters, shot anchors, choice types and resolution cannot be derived reliably from prose. The model's own labels would disagree with app labels, which is audit finding 5 again. Nothing persists after the turn to say a note was settled.
- Change: core: a new ToolContractVersion "5.0.0" in packages/core/src/tools.ts, with toolHandlerId 'director-tools@5' and a descriptor 'record_notes' taking {notes:[1..6]{anchor:{sceneId?|shotIds[1..4]}, kind:'observation'|'recommendation', blocking:boolean, text<=600, seenKeyframe?:{shotId,artifactId,sha256}, choices:[1..3] of {kind:'accept',label} | {kind:'proposal',proposalId} | {kind:'regenerate_keyframe',shotIds} | {kind:'edit_field',shotId,field:'narration'|'imagePrompt'|'motion'} | {kind:'reply'}}]}. Choice labels such as 'Make 2.3 8 s' are rendered by the app from the typed action; the model never writes them. server: a new case in apps/server/src/application/tool-invocations.ts that writes a director_note record {id, projectId, requestId, turnId, epochId, letter (app-assigned per turn: a, b, ...), anchor, kind, blocking, text, seenKeyframe, choices, state:'open', version:1}, emits a director.note event and returns the letters. It uses a non-mutating assertActor, so it works in discuss-only (read_only) epochs; it validates that anchors exist and are inside the request scope; it adds a reconciliation branch in reconcileEpoch. snapshot() returns notes (service.ts:594-629).
- Risk: Adding a catalog version touches about 30 hard-coded '4.0.0' sites (DC-11). Notes are not authority: a choice of kind 'proposal' or 'regenerate_keyframe' must still go through a human route. Keep each note's text and choices small so the 1 MiB tool-result limit (tool-invocations.ts:15) and the 512 KiB context page are never reached.
- Tests: core: parseToolArguments accepts and rejects the record_notes schema; the 5.0.0 catalog digest is frozen in packages/director/test/tools.test.mjs. server, in apps/server/test/tool-invocations.test.mjs: notes allowed in a read_only epoch, an out-of-scope anchor rejected with SCOPE_DENIED, letters assigned in order, an idempotent call-id replay, reconcileEpoch confirms the effect.

## DC-2 Held proposals (propose_change) distinct from today's prepare+apply [server, XL, compatible_today=False, deps=DC-1,DC-3,DC-5,DC-6,DC-11]
- Design: DIRECTOR RECOMMENDS banner: one structured change waiting for the person to Accept or Reject (for example 'Make 2.3 8 s')
- Current: prepare_change requires an editable, active request and calls holdRequest (service.ts:254-264). apply accepts only the epoch that prepared the change (service.ts:493-503), so the Director prepares and applies in the same turn and no person reviews it. The only held draft is plan import: apply is blocked with IMPORT_REVIEW_REQUIRED (tool-invocations.ts:162-163, service.ts:494), the draft is shown at GET /plan-imports (plan-imports.ts:30-40) and confirmPlanImport republishes it (service.ts:506-530). A discuss-only turn gets a read_only epoch (service.ts:178), which cannot prepare (service.ts:255, 203-205).
- Gap: There is no way for the Director to leave a change waiting for the person. The design's recommendation would be applied before the person sees it, and in a discuss-only turn it cannot be expressed at all.
- Change: core/server: a new tool 'propose_change' (contract 5.0.0) whose input is limited to a creative patch (updateShots fields desiredFrames, motion, imagePrompt, videoPrompt, narration; updateScenes purpose). No plan source and no requestNewTakes in version 1. It runs parseChangeProposal, applyCreativePatch and checkFootprint without holds, and is allowed in read_only epochs. It stores director_proposal {id, requestId, turnId, epochId, patch, baseVersion, baseShotRevisions, state:'held'|'accepted'|'rejected'|'stale'|'undone', noteId?, previewDigest} and emits a proposal.changed event. New routes, each keyed by an idempotency key: GET /api/projects/:id/director/proposals, which returns each proposal with a live preview (DC-3); POST /director/proposals/:pid/accept {previewDigest}; POST /director/proposals/:pid/reject. Accept factors the publish kernel out of confirmPlanImport: it captures the rebased next project, records a Prepared change owned by a new human request with source 'application' (DC-6), and calls publishPreparedChange. Keep today's prepare/apply for changes the user asked for in change mode.
- Risk: Proposals must lose authority when their originating project was restored from a recovery import, the same way questions do (service.ts:620-622, which uses recovery.isImported). Treat a proposal like a note: a person's accept is the authority, so it should outlive a supersede of its originating request but go stale when the touched shots change. Money: a proposal must never carry a grant, so restricting it to creative patches keeps paid work out.
- Tests: server unit: a read_only epoch can propose and no holds are created; accept publishes exactly the patch; reject changes nothing; replaying an accept key is idempotent; an accept by a different principal is denied. HTTP tests in a new apps/server/test/director-proposals.test.mjs. Integration: a Director proposal accepted while a hand edit landed in between, on another shot, is rebased and applied.

## DC-3 App-computed Now/After preview and rebase-or-expire rule for proposals [core, L, compatible_today=False, deps=DC-2]
- Design: Now / After timeline preview of the proposed change, computed by the app
- Current: For a creative patch with no plan source, the impact list is empty, so impactCounts are all 0 (service.ts:286, tool-invocations.ts:170-174). Whether media becomes outdated is derived later by comparing intent digests; the image digest leaves out desiredFrames and motion (packages/core/src/planning/index.ts:83-87). A prepared change goes stale on any head move (service.ts:538), and every hand edit, Make or narration action advances the head.
- Gap: The app has no per-shot effect to show (old and new durations, keeps keyframe, outdates clip, film length change). Without a rebase, a held recommendation would die on the person's next unrelated edit.
- Change: core: a pure function previewCreativePatch(before, patch, bindingsByShot) that returns per-shot field diffs, before and after desiredFrames, the scene and film duration change, and per-shot media effects computed from shotIntentDigest for image and video against bindings that have outputs ('keeps keyframe', 'clip will need remaking', 'no media yet'). server: rebaseProposal(currentProject, proposal) re-applies the patch only if every touched shot or scene revisionId equals baseShotRevisions, and otherwise marks the proposal stale with reason SHOT_CHANGED. The GET route (DC-2) returns the preview and a previewDigest; accept recomputes both and rejects PROPOSAL_PREVIEW_CHANGED if the digest differs. web: a pure recommendation-model.ts that builds the Now / After timeline bars from the preview only, with no client-side diffing.
- Risk: Accepting has different media rules from a hand edit: a Director creative publish never detaches bindings, while storyboard edits do (storyboard.ts:445-467). Decide on one rule before shipping (open question), or the preview will lie on one of the two paths. Field-level rebase can combine with a newer human edit to the same field; checking the revisionId prevents that.
- Tests: core: table tests for previewCreativePatch, covering duration-only (keeps keyframe), motion, prompt (outdates keyframe) and a no-op. server: rebase succeeds after an edit to another shot and goes stale after an edit to the same shot; accept with an old previewDigest is rejected. web: recommendation-model renders 6 s to 8 s and a total of +2 s.

## DC-4 Undo for an accepted recommendation [server, M, compatible_today=False, deps=DC-2,DC-3,DC-5]
- Design: Undo on the recommendation banner after Accept
- Current: There is no revert API. Project revisions are stored (service.ts:548) but cannot be restored. Storyboard undo works only on the single latest hand edit while the head is unchanged (storyboard.ts:341-352), and kind 'undo' skips the field exclusions, so it detaches more media (storyboard.ts:445). Director changes have no undo record.
- Gap: The banner's Undo has nothing to call, and the existing undo would destroy media.
- Change: server: when a proposal is accepted, save {touchedFields: {shotId, field, before, after}[]} on director_proposal. POST /director/proposals/:pid/undo applies the inverse patch, field by field, only where the field still equals 'after'; other fields are reported as leftAlone. It goes through the same alongside publish path (DC-5), never through storyboard kind 'undo', and the proposal becomes 'undone' while its note reopens. The response includes the preview of the inverse change, so a duration-only undo correctly says the keyframe stays.
- Risk: Undoing after a video was made from the new duration outdates that clip. Show this in the inverse preview, and leave restoring the earlier media to the takes area. Limit undo to the latest accepted proposal touching those fields.
- Tests: server: accept then undo gives back the original desiredFrames and the keyframe binding untouched; undo after a later hand edit to the same field leaves that field alone and reports it; a second undo is idempotent.

## DC-5 Hand edits, accepts, rejects and note resolutions must not revoke the running Director turn [server, XL, compatible_today=False, deps=DC-6]
- Design: Hand edits and accepted recommendations do not kill a running Director turn
- Current: beginRequest with editing:true marks every other active editing request superseded and revokes every epoch (service.ts:127-131). This path is used by storyboard edits (storyboard.ts:393-412), scene generation (scene-generation.ts:652-663), the narration routes (narration/narration-scope.ts:101, narration/routes.ts:124) and plan import (plan-imports.ts:22). The supervisor tick aborts the turn when its request is superseded or its epoch revoked (director-supervisor.ts:109-110), and pending questions become unanswerable (service.ts:620-622, director-supervisor.ts:63). Scene generation is refused with WAITING_USER while any turn is queued or running, or a question is pending (scene-generation.ts:275-284, 448-449).
- Gap: Under the design, editing a shot or pressing Accept or Regenerate during a turn would silently kill the turn and its question.
- Change: server: add beginRequest option concurrency:'alongside'. Such a request gets its own holds and audit record but does not supersede other requests or revoke epochs. Use it for storyboard field edits, proposal accept/reject/undo, note resolve and narration edits. Typed messages keep today's behaviour (send now = interrupt). To stop the Director overwriting a person's edit, director_context already stores the head at capture (director-context.ts:94); add a check in prepare and propose: a Director patch that touches a shot field a human changed after the turn's capture fails with HUMAN_EDITED_FIELD, so the human edit wins and the model re-reads. Scene generation: leave discuss-only application turns (DC-8) out of the busy check; for change-mode turns, refuse only when the turn's scope covers the target shots, and return a human-readable reason. The Regenerate press itself must use the alongside mode.
- Risk: Several invariants assume that the latest editing request is the active one. confirmPlanImport requires the import to be the latest editing message (service.ts:513), and GET /plan-imports derives stale the same way (plan-imports.ts:35-36). Both must ignore alongside requests. The hold and continuation logic (pending-edit-continuation.ts:15-27) groups holds by owner, so alongside requests will appear as pending edits unless their holds are released when they publish. Ship this behind tests for every route that calls beginRequest.
- Tests: server integration in director-supervisor.test.mjs and storyboard.test.mjs: a running fake turn survives a storyboard edit and a proposal accept; the Director's later prepare on the hand-edited shot fails with HUMAN_EDITED_FIELD; a typed message still interrupts; plan-import confirm still works after an alongside edit. Browser: edit a field while the Director is working and the thread keeps going.

## DC-6 No synthetic user messages: request source + legacy migration + Director context split [server, M, compatible_today=False, deps=]
- Design: A conversation with no synthetic user messages
- Current: snapshot.conversation shows every message.recorded event except those with source 'storyboard' (service.ts:602-606). App-written texts reach the thread, including:
- app.ts:288 'Review the displayed keyframes'
- app.ts:296 'Stop the current conversation and new generation.' and 'pause'/'resume'
- app.ts:235 the demo text
- scene-generation.ts:655 'Generate keyframes for this reviewed scene.'
- plan-imports.ts:22, which puts the whole imported document into the user bubble
- service.ts:522
- generation-permission.ts:42
- the narration routes (routes.ts:124, narration-scope.ts:101, audio-request-session.ts:17, personal-voice-routes.ts:25/36, audio-library-routes.ts:60), media/routes.ts:36/79, media/image-routes.ts:56 and allowance-routes.ts:44/55/66
The Director's context lists all of these as messages (context-projection.ts:235), and its turn input text is that message text (director-input.ts:40). The web shows snapshot.conversation as is (apps/web/src/model.ts:401-413, App.tsx:1401).
- Gap: The design's thread contains only real user words and Director output. Today the thread, and the Director's context, contain app-authored 'user' sentences.
- Change: server: RequestRecord gains source:'human'|'application' and action (for example 'scene_generation', 'stop', 'review', 'proposal_accept', 'plan_import'). Every call site passes it, and beginRequest stores it. snapshot.conversation emits human messages only; application requests become activity items {action, scopeIds, at, requestId} for small system rows ('You regenerated 2.2', 'You accepted (a)'). The context projection splits messages into humanMessages and applicationActions so the Director sees presses as events, not words. For plan import, the document goes into the context as attached material and not as the message text. Migration: classify legacy rows by the key in the commands table (scope `${principal}:${project}:message`, service.ts:109) using the prefixes storyboard:, scene-generation:, control:, review:, demo:, plan-import:, confirm-import:, generation-permission:, media:, image-upload:, video-upload:. Keys with the 'question:' prefix are human answers. web: conversation() renders activity rows separately.
- Risk: Changing the context changes contextDigest and director input identity (director-input-identity.ts). Fresh turns only; do not rewrite the digests of past turns. Legacy rows with no command key default to 'human' so no real words are lost.
- Tests: server: the snapshot has no application text after a scene generation, a stop and an import; the context's applicationActions contain them; the migration classifies a fixture database. web: a conversation-model test shows activity rows and never a user bubble for a press.

## DC-7 Let the Director see generated keyframes (app-selected keyframe projection) [server, L, compatible_today=False, deps=DC-1,DC-8]
- Design: The Director comments on what a generated keyframe looks like ('the coat came out maroon')
- Current: Image input accepts only human-selected supplied PNGs from the reference library: origin supplied_image, fixture false, image/png (director-images.ts:53-59, 64-67). It is native mode only (local-director.ts:62-64, 98-100). Images are attached once at turn/start (packages/director/src/runtime/codex.ts:184). The runtime allows at most 4 images, 512 KiB in total and 4096 px (runtime/images.ts:13, 77-91). Server thumbnails are at most 768 px and 128 KiB each (director-images.ts:17). MCP tool results are text-only (packages/director/src/tools/stdio.ts:92). The reasoning effort is 'low' (codex.ts:185, 245). Skill guidance tells the Director to defer visual judgment when it lacks images (skills/v5/production/references/continuity-review.md:13).
- Gap: The Director cannot see any generated picture, so a note such as 'the coat came out maroon' would be invented. Fake keyframes are SVG (packages/providers/src/fake.ts:103-104), which the runtime rejects (png, jpeg and webp only).
- Change: server: generalise DirectorImageProjector into a KeyframeProjector. In native prepareInput, for scene- or shot-scoped requests and for review turns (DC-8), select the current image outputs of in-scope shots from the active plan's node_binding outputs (non-fixture png or jpeg) and project each to a 768 px JPEG. Budget: user references first, then keyframes, at most 4 images in total. If more shots remain, build one contact sheet with the ffmpeg tile filter (4096 px or less, 512 KiB or less), with its tile order given in the context. Save request_keyframe_projection keyed by requestId: [{shotId, nodeId, candidateId, artifactId, sha256, thumbnailSha256, tile}]. Add context.attachedKeyframes, stating that the images are frozen at turn start and that later results are not visible. record_notes.seenKeyframe must match the projection, or the note is rejected; a note becomes stale when the shot's current keyframe sha changes. Later option B: a 'view_keyframe' MCP tool returning image content, only if Codex 0.153.4 forwards MCP image results (unverified).
- Risk: Model cost and latency grow with images. A contact sheet loses detail, so prefer single frames when there are 4 or fewer. The design adds the hash of every attached image to director input identity, which existing tests freeze. Fixture SVGs are never projected, so the demo needs DC-13. FFmpeg is required, so the feature must degrade with a stated reason when it is missing.
- Tests: server in director-images.test.mjs: a projection picks current in-scope keyframes and skips fixtures and SVGs; a 5-shot scene builds a contact sheet within the limits; the receipt replays identically; a note with a seenKeyframe that does not match is rejected. director package: prepareDirectorImages accepts the projected JPEGs.

## DC-8 App-started discuss-only review turn when a scene's keyframes land [server, M, compatible_today=False, deps=DC-6,DC-7,DC-1,DC-2]
- Design: Director notes about freshly generated keyframes appear without the person typing
- Current: Every turn starts from a human request (director-supervisor.ts:38-41 requires human.kind 'human'). After a plan is applied, a 500 ms executor loop runs the jobs with no agent involved (apps/server/src/index.ts), and nothing reacts when a keyframe batch completes. Discuss-only requests (editing:false) do not supersede other requests and place no holds (service.ts:127).
- Gap: Without a trigger, the Director could comment on new keyframes only after the person types something.
- Change: server: a KeyframeReviewTrigger, a pure decision function plus an executor hook. When every requested image node of one scene-generation request is terminal, and the Director is idle, the mode is native (or the scripted demo) and the per-project setting allows it, it creates an application request (source 'application', action 'keyframe_review', editing:false, scope = the scene's shots). Its key is a digest of the batch, so it runs once per batch, and it enqueues a turn. The input text is an application instruction that is never shown as a user message. The turn may only read context, record notes (DC-1) and propose changes (DC-2). Busy checks used by scene generation and video confirm ignore these turns (DC-5).
- Risk: Unexpected model usage: show it in settings and in the thread as 'Director is looking at Scene 2's frames'. It must never start anything paid, which holds because it is read_only. A user message supersedes it, as happens today.
- Tests: server: completing a fake keyframe batch enqueues exactly one review turn; restarting the server does not enqueue it again; the turn's epoch is read_only; scene video confirm is not blocked by the turn. Fake end-to-end with DC-13.

## DC-9 Blocking recommendations gate the scene video confirm on the server [server, M, compatible_today=False, deps=DC-1,DC-10]
- Design: 'Confirm frames & generate video' is enabled only when blocking recommendations are settled (and all frames are opened)
- Current: The scene view's busy flag counts only running or queued turns and pending questions (scene-generation.ts:275-284). The video POST rejects with WAITING_USER only on busy or paused (scene-generation.ts:448-449). Notes do not exist, and the 'viewed' proof lives only in browser memory (audit 1.1, apps/web/src/conversation-actions-model.ts:151).
- Gap: A gate held only in the client is lost when the tab reloads or closes, and the server would accept the paid press even with blocking notes open.
- Change: server: GET scenes/:sceneId adds openNotes and blockingNotes for the scene's shots, and a notesDigest inside the reviewed tokens. POST scenes/:sceneId generate {kind:'video'} rejects NOTES_UNSETTLED when a blocking note anchored to a selected shot is open. web: the SCENE n VIDEO panel reads these server fields. The 'opened frame' record belongs to the keyframes/review area.
- Risk: The Director could block video forever. Every blocking note always offers a 'Keep' choice, and the person can dismiss a note.
- Tests: server scene-generation.test.mjs: video refused with an open blocking note and allowed after 'accept'; a non-blocking note does not gate; a stale notesDigest is refused with SCENE_REVIEW_STALE.

## DC-10 Note resolution routes, staleness, and feeding decisions back to the Director [server, M, compatible_today=False, deps=DC-1,DC-5]
- Design: Resolved state on notes; choices 'Keep maroon', 'Regenerate 2.2', 'Edit narration'; the Director not raising settled points again
- Current: Nothing records the person's decision on a suggestion. The context overview includes messages, questions, holds, toolCalls and workflow (context-projection.ts:235-257) but no suggestions. Regenerating goes through POST scenes/:sceneId generate with regenerate and targetShotIds (scene-generation.ts:340-415, 652-680), and that request supersedes the Director today.
- Gap: There is no resolved state, a 'Keep' choice leaves no trace, and the next turn may raise the same note again.
- Change: server: POST /director/notes/:noteId/resolve {choiceIndex, expectedVersion, resultRef?}, an alongside request (DC-5). Behaviour by choice kind:
- 'accept' resolves the note.
- 'proposal' delegates to proposal accept (DC-2).
- 'regenerate_keyframe': the web first calls the scene-generation route with the person's priced press, then resolves the note with resultRef = the returned request.
- 'edit_field' resolves when the linked hand edit lands (the edit id is passed).
Notes become stale on their own when the anchored shot's revisionId or the seen keyframe sha changes. A context section 'notes' (plus counts in the overview) carries state, the chosen choice and the person's action, and the skills say not to re-raise settled notes. web: director-notes-model.ts (pure) maps each choice to a command and computes the callout letters for the shot cards.
- Risk: For a paid choice (Regenerate), the app must never fire the paid route from a note click without the visible price and the person's press. Keep the paid press in the existing scene route, so authority stays human.
- Tests: server: resolve is idempotent; a stale note cannot be resolved by 'accept'; the context notes section lists resolutions. web: director-notes-model maps each choice kind to the right command.

## DC-11 Tool contract 5.0.0 plumbing and V6 skill guidance [skills, L, compatible_today=False, deps=]
- Design: All new Director behaviours (notes, proposals, seeing keyframes, review turns)
- Current: The catalogs stop at 4.0.0 (packages/core/src/tools.ts:91-104). V5 guidance is bound to contract 4.0.0 (apps/server/src/application/director-capabilities.ts:20-27). 4.0.0 and the version lists are hard-coded at:
- local-director.ts:166, 297
- tool-invocations.ts:253, 264
- context-projection.ts:174, 181
- director-tools-upgrade.ts:12-16, 34-35, 73, 80, 89, 106
- director-input.ts:15, 44
- application-capabilities.ts:45-46
- audio-operation-context.ts:15
- film-planning-guidance.ts:7, 18
- app.ts:175-176
- toolchain-probe.ts:24, 32
Fresh turns are upgraded automatically to the 4.0.0/V5 lock (director-tools-upgrade.ts:80). skills/v5 has no guidance on notes or proposals. Its review stage says that without visual capability the Director must ask for human inspection (skills/v5/production/references/stages/review.md). The 3.0.0 and 4.0.0 descriptions still say the audio tools 'never generate', although V5 publishes (tools.ts:74-80 against tool-invocations.ts:183-197). current-contract.md tells the model to ignore its own tool descriptions.
- Gap: Nothing in the contract or the guidance describes the new tools, and the version checks would reject a 5.0.0 lock.
- Change: core: TOOL_CATALOGS['5.0.0'] = 4.0.0 plus record_notes and propose_change, with truthful audio descriptions; one exported SUPPORTED_TOOL_CONTRACTS constant replaces the scattered arrays. server: createDirectorSkillLock defaults to 5.0.0 with guidance 6; the upgrade target is extended so that fresh turns move 4.0.0/V5 to 5.0.0/V6; the reconciliation and context branches accept 5.0.0. skills/v6/production: a new references/notes.md covering:
- when to note, ask, propose or apply
- one change per proposal
- anchor to shot ids
- use the letters the tool returns
- never claim visual observations without attachedKeyframes
- paid choices are the person's presses
- do not re-raise resolved notes
Plus updated review.md, continuity-review.md and video.md, and a production manifest listing the new required tool ids.
- Risk: Old epochs must keep their catalogs, and receipts are checked against them (tool-invocations.ts:96-111, 136-138). Never mutate the 1.0.0-4.0.0 descriptors, or the digests change. Customised locks raise DIRECTOR_GUIDANCE_UNSUPPORTED (director-tools-upgrade.ts:79-82); keep that path.
- Tests: packages/director/test/tools.test.mjs freezes the 5.0.0 digest; director-tools-upgrade.test.mjs covers upgrading 4.0.0 to 5.0.0 on a fresh turn while an in-flight 4.0.0 epoch keeps its catalog; a skill lock verification test for the v6 manifest; context-projection.test.mjs lists the notes section for 5.0.0.

## DC-12 Director-started paid audio becomes a recommendation, not an action [server, M, compatible_today=False, deps=DC-1,DC-11]
- Design: Paid choices are the person's presses (white primary, price shown); amber is only the Director
- Current: With a V5 lock, prepare_narration_speech and prepare_recording_transcription call port.request() and publish the paid job directly (tool-invocations.ts:109, 183-201). In addition, finalizePreparedChange creates a speech or transcription grant for any new speech or transcription node in a Director plan (service.ts:334-335), so a prepare_change with plan source can also start paid audio. agent.md missed this second path.
- Gap: The Director can spend without any press from the person, which contradicts the design's recommendation pattern and the cost display.
- Change: core/server: with contract 5.0.0, the audio tools save the prepared audio proposal and a recommendation note with a choice {kind:'request_speech'|'request_transcription', proposalId}, and do not publish. The person's press calls the existing human review commit (commitNarrationSpeechReview, service.ts:443-491). In finalizePreparedChange, skip the grant creation at service.ts:335 when actor.kind === 'director' under 5.0.0, so ORIGIN_NOT_AUTHORIZED applies as it does for image and video.
- Risk: This is a deliberate behaviour change against V5 guidance that says 'no approval step'. Rewrite audio-proposals.md in V6. Projects still on 4.0.0 epochs keep the old behaviour until their next fresh turn.
- Tests: server audio-proposal-tools.test.mjs: under 5.0.0 a speech tool call creates a note and no job; the human press publishes it; a Director plan with a new speech node fails with ORIGIN_NOT_AUTHORIZED.

## DC-13 Scripted (fake) Director emits real notes and a proposal so demos show the design [server, M, compatible_today=False, deps=DC-1,DC-2,DC-8,DC-11]
- Design: Scripted mode demos showing notes (a)/(b), a recommendation with Now/After, and Keep/Regenerate choices
- Current: FakeWorkflowDirector handles only demo_command create, close_up and wide; every other message gets one fixed text (apps/server/src/application/fake-director.ts:38-58). /demo requires the two-shot boot fixture (app.ts:226-236). Fake keyframes are SVG placeholders (providers/src/fake.ts:103-104). The fake supervisor uses the same lock path as the native one (local-director.ts:56-57).
- Gap: With no Codex configured there are no notes, no banner and no choices to see or test, and the fake Director cannot honestly 'see' a picture.
- Change: server: a scripted review path. On a keyframe_review turn (DC-8) or a new /demo action 'review', the fake calls record_notes and propose_change through ToolInvocationService exactly like the real Director:
- note (a): a blocking recommendation on the last shot, proposing desiredFrames 6 s to 8 s, with choices proposal / accept ('Keep 6 s') / edit_field narration.
- note (b): an observation on the first shot, worded honestly ('Scripted demo note: a live Director would compare this frame with the brief') with choices accept / regenerate_keyframe.
Its message is labelled scripted. A 3-shot demo scene fixture, so the prototype's 2.1-2.3 can be reproduced, belongs to the demo/fixtures area.
- Risk: The fake must never phrase observations as if it saw the picture (skills and the product rule that it is 'never presented as AI output'). Deterministic call ids (demo-N) must stay unique per turn (fake-director.ts:33-36).
- Tests: server demo.test.mjs: after fake keyframes land, a review turn creates two notes and one held proposal; accepting the proposal changes the duration; the scripted text never claims to see the image. Browser: the fixture studio on port 5173 shows the banner and callouts.

## DC-14 @-pointing composer with scene and shot scope; scope never follows selection [web, M, compatible_today=True, deps=DC-6]
- Design: Composer with @ pointing, scene and shot scope; the user's @-scoped message shown in the thread
- Current: The server accepts project, scene or shot scope ids (service.ts:120-122) and a scene covers its shots (service.ts:208-211, continuation-model.ts:10-11). The web stores only shot ids, or [] for the whole film (composer-draft-cache.ts:7, 21-23; App.tsx:1286). Selecting a shot silently rewrites the draft's scope (App.tsx:948-953). Conversation entries carry no scope (service.ts:605).
- Gap: The server is ready. The web cannot point at a scene, the message bubble cannot show its @ target, and the current coupling between selection and scope contradicts the design.
- Change: web: a pure composer-scope-model.ts that parses @ tokens into chips ('Whole film', 'Scene 2', 'Shot 2.3'), using one shared labeller for scene.shot numbers (fixes audit 5, App.tsx:889); scopeIds may hold scene ids; chooseShot no longer writes scope. The Send button names the target. server, small: add scopeIds to each conversation entry (service.ts:605) so the bubble can show its chip.
- Risk: Drafts saved in localStorage with shot-only scope must still load (composer-draft-cache migration). A scene-scoped change-mode message holds the whole scene's media, so say so in the composer.
- Tests: web composer-scope-model tests: @ parsing, label consistency and the scene-id round trip; composer-draft-cache.test.mjs covers the legacy draft. server api.test.mjs: a scene-scoped message is accepted and its conversation entry carries scopeIds.

## DC-15 Scripted vs real Director modes in the thread and header [web, S, compatible_today=True, deps=]
- Design: Scripted vs real Director modes
- Current: GET /director returns mode fake or native (director-supervisor.ts:73-79, local-director.ts:80-97). The web shows disclosure paragraphs (App.tsx:1373-1399) and labels every assistant message 'OpenSlate' (App.tsx:1407-1409). The mode is locked after the first conversation for configure (local-director.ts:202, 228), yet changeSelection can switch it when idle (local-director.ts:145-193), so earlier messages may come from the other mode.
- Gap: Messages do not record which runtime wrote them, so a scripted reply looks like a Director reply after a mode switch.
- Change: server: conversation assistant entries add runtime:'scripted'|'live', taken from director_output.turnId to director_turn.runtimeId (service.ts:607-610). web: a header pill 'Scripted demo' or 'Director', a byline per message, and in scripted mode the composer offers the scripted actions instead of implying free conversation.
- Risk: Low. Only the presentation changes.
- Tests: server: a snapshot entry carries the runtime after a mode change; web test: the byline differs by runtime.

## DC-16 Honest turn progress and endings in the bottom-anchored thread [server, S, compatible_today=False, deps=DC-1,DC-2]
- Design: Director message area: working, finished, interrupted, failed states inside the thread
- Current: Text arrives as whole messages, not token streams (codex.ts:136-143). The run is capped at 180 s. A timed-out or interrupted turn ends with no message (director-supervisor.ts:217-218, 225-226). The status message is set only for 'unknown' (director-supervisor.ts:78), and readable text exists only for image and guidance errors (local-director.ts:82-95). The SSE stream sends tool.started and tool.finished with the tool name (tool-invocations.ts:150, 311).
- Gap: The thread cannot say what the Director is doing, or why a turn ended with nothing.
- Change: server: a terminal-reason map for RUNTIME_RUN_TIMEOUT, REQUEST_SUPERSEDED, OWNER_LOST and unknown, plus an 'effects' summary for each finished turn (notes created, proposals held, changes applied, from tool receipts). web: a pure turn-activity model that renders a step row from tool events ('Reading Scene 2', 'Writing notes') and an end row such as 'Stopped after 3 minutes; it left 1 note, nothing changed'.
- Risk: Do not reveal tool arguments. The rows are names and counts only.
- Tests: server: a timeout produces a turn with reason and effects; web: the activity model covers each terminal state.

## DC-17 Structured answers to Director questions, rendered like note choices [server, S, compatible_today=False, deps=DC-5]
- Design: Director choices as buttons in the conversation (consistency between questions and notes)
- Current: A question carries 1-3 items, each with up to 10 options (director-supervisor.ts:192-199, runtime/types.ts:31-36). The answer is one free-text string for the whole set (director-supervisor.ts:56-72, app.ts:200-204). Asking ends the turn.
- Gap: Option buttons cannot be bound to specific answers, and the same visual pattern (choice buttons) would behave differently for notes and for questions.
- Change: server: answerQuestion accepts {answers:[{questionId, optionLabel?|text?}]}, validates the labels against the stored options and passes a structured answer into the next turn's context. web: question cards reuse the note-choice component; free text remains available.
- Risk: Keep the free-text field for backward compatibility. With DC-5, question requests are no longer killed by hand edits.
- Tests: server: an unknown option label is rejected; the structured answer appears in the context. web: the question card model.

## DC-18 Web API surface and pure models for notes, recommendations and activity [web, L, compatible_today=False, deps=DC-1,DC-2,DC-3,DC-10,DC-16]
- Design: Director column (notes, banner, callouts) and SCENE n VIDEO panel reading server state
- Current: The web has no client methods or models for notes, proposals or activity. The snapshot types (apps/web/src/model.ts:98) cover conversation, questions and toolCalls only. Events stream through project-event-stream.ts, which accepts any well-formed kind (project-event-stream.ts:51-54).
- Gap: The new server records have no client shape, no models and no tests.
- Change: web:
- api.ts: getProposals, acceptProposal, rejectProposal, undoProposal and resolveNote, each with an idempotency key.
- model.ts: types for notes, proposals with previews, and activity.
- New pure modules: director-notes-model.ts (letters, callouts per shot, choice-to-command mapping, stale state), recommendation-model.ts (queue showing one banner at a time, blocking notes first, then by letter; Now / After bars; Undo window) and conversation-model.ts (thread entries, activity rows, runtime byline).
- Refetch on the SSE events director.note and proposal.changed.
- i18n: keys rather than English sentences, for the new strings only.
- Risk: The models must not recompute impact on the client; they render only what the server previews. Keep them free of React so node --test can run them.
- Tests: web unit tests for each model; browser test on the fixture studio (port 5173, never 3001): the banner shows Now 6 s / After 8 s, Accept updates the shot, Undo restores it, and the callouts' letters match the notes.

## Open questions
- Should the Director keep its ability to apply creative changes immediately when the person asked for a change in change mode, or should every Director edit become a held proposal (DC-2)? The design shows only proposals.
- When a recommendation is accepted, which media rule applies: the Director publish rule (bindings untouched, outdating derived by digest) or the hand-edit rule (storyboard.ts detaches bindings)? Today the two disagree, and the Now / After preview must match whichever is chosen.
- May the Director propose a change outside the scope of the message that started it (for example a note on 2.2 when the user pointed at 2.3)? This applies to read-only review turns too.
- Is the app-started keyframe review turn (DC-8) on by default? It costs model usage on every keyframe batch.
- Who decides that a note is 'blocking': the Director, the app by rule (for example any recommendation that changes duration or narration), or both? Can the person always dismiss a blocking note?
- Should Director-started speech and transcription become person-pressed recommendations under the new contract (DC-12)? That reverses the V5 'no approval step' guidance.
- Is a contact sheet acceptable for scenes with more than 4 shots? Or should an MCP 'view_keyframe' tool be investigated first, which needs confirmation that Codex 0.153.4 passes MCP image results to the model?
- Where does the price on a paid choice (for example 'Regenerate 2.2, about $0.04') come from? No server price estimate exists today (spending-display.ts has no amounts). This belongs to the cost area.
- Should the demo get a 3-shot 'Last ferry' fixture so the scripted Director can reproduce the prototype's 2.1-2.3 and its notes? Today /demo requires the 2-shot boot fixture (app.ts:231-232).
