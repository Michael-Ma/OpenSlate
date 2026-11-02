> Evidence appendix for ../UIUX-IMPLEMENTATION-PLAN.md, produced by a code-grounded gap analysis on 2026-10-14 against commit 2c4b6e3. Item ids (DC, GR, SB, WA, LG) are referenced from the plan.

# Ledger of earlier findings (first UI audit, w1 research accidental_complexity/open_questions, w3 digest blockers and majors)

**What this ledger covers.** Every distinct issue from the 16-point first UI audit, the w1 research lists (`accidental_complexity` and `open_questions`) and the w3 digest's 19 blockers and roughly 50 majors. I checked each one against the code on `main` (2c4b6e3), then sorted it into one of 25 items: web-only, needs backend/core work, needs a product decision, or out of scope.

**Main conclusions**
- **Adopting the design fixes about a third of the list by itself, all on the web side:**
  - tool cards inside the chat, plus the scroll bug they cause
  - composer targeting
  - the same status shown in several places
  - internal vocabulary in the copy
  - the global disabled flag
  - a confirm modal that hides the frames it asks about
- **The design's own controls run into backend behaviour that has not changed since the digest:**
  - Every hand edit (`Make 2.3 8 s`, `Edit narration`, `Edit prompt`) opens an editing request. That request cancels any running Director turn and places holds (`service.ts:125-133`).
  - The toast's `Undo` throws away the shot's keyframe binding even after a duration edit. The `undo` kind is missing from the media exclusions in `storyboard.ts:440-463`.
  - `Regenerate 2.2` detaches the current picture before the new one exists (`scene-generation.ts:673-690`).
  - The single `Confirm frames & generate video` press is still a chain run in the browser (`scene-confirmation-model.ts`).
  - The DIRECTOR RECOMMENDS notes have nothing behind them. There is no recommendation record (`packages/core/src/tools.ts:7-9`), and `inspect_artifact` returns metadata only (`service.ts:682-689`), so a note like "coat came out maroon" cannot be produced by the Director today.
- **Corrections to earlier inputs:**
  - The "fake user messages" are mostly written by the server (`scene-generation.ts:652-656`, `app.ts:288,296`, `storyboard.ts:393-397`), not by the buttons.
  - The plan card has 13 states, not about 20.
  - There are 28 CSS files, not 30. Vite loads each one once despite the double imports.
  - The allowance/spending server code is 482 lines over 5 files, not about 630.
- **Still unresolved:**
  - Stop: a film-wide pause, and the web never sends `resume`.
  - Jobs with no answer: no way to give up on them.
  - The Director can start paid speech on its own (`tool-invocations.ts:192-201`).
  - Status projection: one GET per scene, wait reasons thrown away (`index.ts:86`).
  - Cost estimates are flat per job.
  - Export depends on a render plan written by the Director, and demo media is refused at export.
  - Setup, session and demo states.
- **Out of scope or pre-work:** dead code (`NarrationPanel` family, about 3,400 lines), the oversized draft cache, and the size of `App.tsx` are clean-up to do before or alongside the rework. They are not caused by the design.
- **Not designed yet:** Plan, Assets and Film, Stop, failure handling, recovery, settings and the phone layout. These go to the owner as product decisions, not as hidden scope.

## LG-1 Scene video confirmation hides the frames and keeps 'viewed' proof in memory [web, M, compatible_today=True, deps=LG-9]
- Design: Audit #1; capabilities oq 'does the server require proof of display'. Design: shot cards with Opened / Not opened, the SCENE n VIDEO panel counting opened frames, Confirm frames & generate video enabled only when every frame is opened
- Current: Proof is React state, App.tsx:393 (useState exposedFrames), and its key includes revisionId (conversation-actions-model.ts:151-164), so a reload or any project revision change resets it. The server checks only frame identities (artifactId + sha256), not that they were displayed: scene-generation.ts:516-531 ('Approve the exact displayed keyframes'). The confirm modal comes from FrameDecision.tsx / ConversationActions.tsx inside the chat column (App.tsx:1598-1612)
- Gap: None on the server: the design's Opened gate is a client rule over identities the server already accepts. Web gap: the proof is lost on reload and on unrelated edits, and there is no frame-first surface
- Change: web: new keyframes-view model (pure) that derives Opened per (shotId, artifactId, sha256) with no revisionId, persisted per browser through one small storage adapter (injected). The SCENE VIDEO panel builds reviewedFrames from the current scene view. Delete the modal path in FrameDecision.tsx and ConversationActions.tsx once the panel ships
- Risk: Weakens a deliberate safety: Opened could carry over to a frame the user never saw on this device. Contain it by keying on artifact sha256 and clearing an entry when the sha changes. The server still rejects stale identities (SCENE_REVIEW_STALE)
- Tests: Unit: opened-model derivation (sha change clears it, unrelated revision keeps it, reviewedFrames payload equals the scene view rows). Browser: open 3 cards, reload, button state is kept; regenerate one frame and it goes back to Not opened

## LG-2 Tools as cards in a 380 px chat column, icon-only toolbar, Export opening in chat, Radix select scroll bug, phone space [web, L, compatible_today=True, deps=LG-9,LG-10]
- Design: Audit #2, #3, #11; capabilities 'tools rendered as inline cards', 'four entry points to the same scene decision'. Design: top-bar tabs Plan / Keyframes / Assets / Film, a 392 px Director column holding only the thread and composer, the workspace on the right
- Current: Cards are rendered conditionally inside the conversation: ConversationActions, ProjectSettings, ImportMedia, ProjectEditor, PlanImport, export MediaPanel and GenerationGuide at App.tsx:1598-1973. The header Export calls setExportOpen and switches the phone view to 'director' (App.tsx:1155-1166). Six IconButtons at App.tsx:1224-1270, including New project (folder) and Disconnect. Scroll bug: .workspace-grid is overflow:hidden (precision.css:19) and the stream holds the Radix Select from ui.tsx:151. This is a runtime bug reported by the first audit and not re-run here, because only the 5173 fixture may be used. The 26% phone figure is also an audit measurement and was not re-measured
- Gap: Web only for Keyframes. Plan, Assets, Film, New film, settings and export have no design in the chosen system, so the cards cannot all be re-homed yet
- Change: web: replace the App.tsx shell with a TopBar (tabs, film meta, Saved pill), a DirectorColumn (thread and composer only) and per-tab workspaces. Move each card's content into its tab or a dialog: settings and New film into dialogs, Export into the Film tab. Until Plan, Assets and Film are designed, mount the existing components inside those tabs unchanged (an interim adapter) so that no capability is lost
- Risk: Capability loss while moving (import, brief import, editor, settings). Contain it with a capability checklist test that lists every action reachable today (capabilities.md inventory) and asserts an entry point for each after the move
- Tests: Browser on the 5173 fixture: open settings and the tabs stay visible (regression for the scroll bug); every inventory action is reachable at 1440 and 390 px; no tool renders inside .director-thread

## LG-3 Composer targeting: five states, selection silently changes scope, inconsistent shot labels [web, M, compatible_today=True, deps=LG-9,LG-13]
- Design: Audit #5; capabilities 'selecting a shot changes scope'; agent oq 'scene-level scope'; digest composer/target majors. Design: composer with @ chips; @Scene 2 in the user bubble; @ 2.1 in the inspector; opening a frame does not change the target
- Current: chooseShot writes scopeIds:[id] and clears continuationRequestId (App.tsx:948-952). Stale-target checks for reply, continuation, scope and references are at App.tsx:906-913. The label is 'Shot {number}' with a film-wide index (App.tsx:886-890) while the shelf uses 'Shot {scene}.{shot}' (App.tsx:1312). The server accepts scene ids as scope (packages/core/src/workflow/index.ts:190-192)
- Gap: None on the backend. Scene scope is supported, and the web's 'continue saved edits' state can go because ordinary sends already auto-continue covered pending edits (coveredPendingEdits, App.tsx:926-936)
- Change: web: a pure composer-target model. Targets = the @ chips (shot or scene ids) plus an optional question reply. Selection never writes scope. One label function `sceneShotLabel(project, id)` -> '2.1' is used everywhere. Remove the scope dropdown and the continue-edit chip
- Risk: Dropping continuationRequestId could leave holds unreleased if auto-continue does not cover a case. Keep coveredPendingEdits and add a test that a scoped send releases prior holds
- Tests: Unit: target model (selection does not change targets; @Scene produces a scene id; label function). Integration (server test harness): a message scoped to a scene id releases that scene's holds

## LG-4 The same status in five or six places; Saved / Next card with 13 states and a broken Chinese action [web, M, compatible_today=True, deps=LG-21]
- Design: Audit #6; capabilities 'progress spread over six surfaces', 'next-step card has 13 states'; digest majors on the Next line and status roll-ups. Design: status lives on scene pills, shot cards, the inspector pill and the SCENE VIDEO panel
- Current: The DirectorPlanView state union has 13 values (director-plan-model.ts:15-27). The inputs' '~20 states' is wrong; capabilities.md's 13 is right. Bug: `plan.action === t("scenes","场景")` at DirectorPlan.tsx:53 never matches 'scenes' in Chinese. Other surfaces: GenerationGuide, SceneActivity, the header connection dot, the workspace banner
- Gap: Web only for Keyframes. Per-scene status on every pill needs one GET per scene today (LG-21)
- Change: web: delete DirectorPlan, director-plan-model and GenerationGuide from the main path. Add one pure `shotStatus` / `sceneStatus` derivation from the snapshot plus the scene views, used by pills, cards, the inspector and the panel. Fix DirectorPlan.tsx:53 in the interim commit if the card survives one release
- Risk: Losing a state the card surfaced (question pending, stopped, unknown outcome). Map all 13 states to a home in the new UI before deleting
- Tests: Unit: a table-driven sceneStatus test over fixture snapshots covering the 13 old states; the Chinese action dispatch test (regression)

## LG-5 Internal vocabulary, raw error codes and naming drift in user copy [web, M, compatible_today=True, deps=LG-11]
- Design: Audit #8; backend accidental 'about sixty 409 codes'; agent accidental 'raw RUNTIME_*/DIRECTOR_* codes'; product naming drift; digest vocabulary majors; backend oq 'who owns failure reasons'. Design copy: Opened, Takes, Director recommends, video saved
- Current: 'Job outcome unconfirmed' (conversation-actions-model.ts:272, FrameDecision.tsx:356), 'A timeline plan is needed before rendering.' (MediaPanel.tsx:295), 'matching production plan' (director-plan-model.ts:304), a canned 'update only the affected production plan' message (App.tsx:1790). Errors are translated by matching English sentences (locale-errors.ts:2-50). Image and video attempts expose failure ids only
- Gap: Copy is web-only. Readable reasons for image and video failures need either a web catalogue keyed by error or failure code (preferred) or server work
- Change: web: a vocabulary module (Film, Scene, Shot, Keyframe, Clip, Narration, Take, Opened) and a code -> message catalogue keyed by DomainError.code and attempt.failure.id, so no English sentence is matched. server (optional, S): make sure every 409 carries a stable code (most already do)
- Risk: Unmapped codes fall back to raw text. Add a fallback 'Something went wrong (CODE)' and a test that lists every code thrown in apps/server/src against the catalogue
- Tests: Unit: catalogue coverage test (grep invariant codes vs catalogue keys); copy lint forbidding 'plan', 'hold', 'request', 'continuation' in the en strings

## LG-6 Application-authored 'user' messages in the conversation [server, S, compatible_today=False, deps=]
- Design: Audit #9; agent accidental 'synthetic user messages'. Design: the thread shows only the person's own messages and the Director's
- Current: Correction to the audit: most are written by the server through beginRequest, which inserts a message and emits message.recorded (service.ts:126-160). Examples: scene-generation.ts:652-656 ('Generate video for this reviewed scene.'), app.ts:288 ('Review the displayed keyframes'), app.ts:296 (Stop), storyboard.ts:393-397 ('Storyboard edit: ...'), plan-imports.ts:22, narration/narration-scope.ts:101, personal-voice-routes.ts:25,36, audio-library-routes.ts:60. Only storyboard tags source:'storyboard' (storyboard.ts:409-412). The client also sends canned text (App.tsx:1790)
- Gap: The web cannot reliably tell these apart from real user text, because only storyboard edits are tagged
- Change: server: add `source` ('user' | 'storyboard' | 'scene_generation' | 'control' | 'review' | 'import' | 'audio' | 'voice') to RequestRecord for every beginRequest caller and project it in the snapshot messages. web: render non-user sources as quiet activity rows or hide them; drop the canned App.tsx:1790 text. Keep the records, because the Director reads them as context
- Risk: Snapshot shape change. Make the field additive and optional, and default missing values to 'user' for old rows. A migration is not needed
- Tests: Server unit: each route stamps its source. Web unit: thread filter. Browser: confirm a scene and no user bubble appears

## LG-7 One global disabled flag; recovery read-only on every load [web, M, compatible_today=True, deps=LG-13,LG-12]
- Design: Audit #10; capabilities 'UI starts read-only on every load'. Design: no global freeze; the video button carries its own reason ('Open 2 more frames...')
- Current: recoveryReadOnly starts true (App.tsx:294). mutationsDisabled = recoveryReadOnly || busy || creating || pendingAction || pendingMessage || stops (App.tsx:873-879), plus protectedTool and sceneMutationBlocked (App.tsx:882-883), passed to every card
- Gap: Web only, but removing the lock exposes LG-13: board edits during a Director turn would then abort it silently
- Change: web: replace the boolean with a pure `actionAvailability(snapshot, director, recovery, pending)` returning {enabled, reason} per action. Recovery shows a 'Checking...' state only until the status read returns, then gates writes only if quarantined
- Risk: Unguarded double presses. Contain this with per-action pending state and idempotency keys (LG-12)
- Tests: Unit: a table of availability with reasons. Browser: the composer stays usable while a keyframe job runs; the video button shows its reason

## LG-8 Dead code and the retired spending layer [cross-cutting, S, compatible_today=True, deps=]
- Design: Audit #12; capabilities and audio accidental 'unmounted advanced panels', 'Lightbox Approve', 'demo create'; backend accidental 'legacy routes P/review, P/approvals, P/generation-permission, P/spending'
- Current: NarrationPanel.tsx (1,856 lines) is imported by nothing. NarrationSpeechPanel (403), OwnedTranscriptionPanel (501) and TranscriptReviewPanel (657) are imported only by it (about 3,417 lines in total). spending-model.ts is imported only by apps/web/test/spending-model.test.mjs. components.tsx:387-452 onApprove is never passed. demo('create') is never called (App.tsx:859; calls only at 2076, 2082). Allowance routes are still mounted (index.ts:73, app.ts:114-116): allowance-routes 72 + allowance-projection 121 + external-allowances 81 + spending-display 122 + project-budget 86 = 482 lines (the inputs' '~630' overstates this); the web never calls /spending
- Gap: Out of scope for the design, but it is clean-up that cuts what the rework has to carry
- Change: web: delete the 4 dead panels, their CSS (narration.css, owned-transcription.css, transcript-review.css if unused) and spending-model plus its test, onApprove, and demo 'create'. server: unmount allowance routes behind a decision (see open questions); keep the ExternalAllowanceService store schema for old data
- Risk: Hidden reuse (TranscriptViewer). Run a tsc/knip-style unused-export check before deleting. Server route removal changes the API, so keep it to a separate commit
- Tests: pnpm check passes; a grep test asserts no import of the deleted modules; the server route list snapshot is updated

## LG-9 App.tsx god component, oversized settings and audio UI, over-built local draft cache [web, L, compatible_today=True, deps=LG-8]
- Design: Audit #13, #14; capabilities accidental 'local draft cache warnings'; product accidental 'protected saves, browser checkpoint caches, cross-tab locks'
- Current: App.tsx is 2,519 lines with 47 useState. Settings files total 2,871 lines (DirectorSettings 630, ProviderSettings 1,036 plus models and translations). Audio panels total about 5,100 lines including the dead ones. local-draft-cache.ts has 59 call sites in 8 files (App 18, Timeline 9, InlineField 7, five others with 5 each) and exactly 9 distinct warnings (local-draft-cache.ts:59-199)
- Gap: Not a design incompatibility, but the rework cannot be done in small reversible steps inside a 2,519-line component
- Change: web pre-work: extract state into pure reducers and hooks (project selection, composer, keyframes view, activity) with injected api. Reduce the draft cache to the composer text and inline field drafts with one warning ('Could not keep your draft on this device'); remove cross-tab conflict detection
- Risk: Regression in draft recovery that STATUS.md lists as verified. Keep the composer-draft tests and drop only the conflict and quota branches
- Tests: The existing apps/web/test suite stays green on each extraction commit; new reducer unit tests

## LG-10 CSS layered generations and the theme system [web, M, compatible_today=True, deps=LG-2]
- Design: Audit #16. Design colour system: neutral dark greys, amber only for the Director, white for the chosen option, green for Opened, Inter, single dark look with color-scheme: dark
- Current: 28 CSS files (not 30), 4,656 lines. main.tsx:8-36 imports 28 sheets, and about 20 are imported again by their component (for example frame-shell.css, director-plan.css). Vite deduplicates, so the real problem is cascade order and ownership, not double weight. Competing .workspace-grid rules: style.css:6, precision.css:19,129, storyboard.css:2-4, frame-shell.css:42,349. Day/Night is a shipped feature (STATUS.md, Oct 7)
- Gap: The prototype is dark only, while the product ships Day/Night. A token set for light is a product decision
- Change: web: one tokens.css with the design's roles on :root (and a light mapping if kept), plus component-scoped CSS modules or one file per new component. Delete the old layered sheets when the old shell is removed
- Risk: Visual regressions on surfaces not yet redesigned. Keep the old sheets scoped under a .legacy-surface class until Plan, Assets and Film are rebuilt
- Tests: Browser screenshot comparisons at 1440x900 and 390 px against the prototype's measured boxes (DESIGN.md 'Measured result'); a contrast check on token pairs

## LG-11 i18n keyed by English sentences [web, M, compatible_today=True, deps=]
- Design: Audit #15; digest major 'Chinese is one word in Settings'. Design introduces new copy (Opened, DIRECTOR RECOMMENDS, Make 2.3 8 s, about $1.50)
- Current: About 788 inline t(en, zh) calls (639 single-line plus 149 multi-line) and 499 ui( calls. Errors are translated by matching English sentences (locale-errors.ts). Plural forms are built by string concatenation (DirectorPlan.tsx:78-79 'suffix: ... "s"')
- Gap: Web only, but every new string adds to the debt unless a keyed catalogue comes first
- Change: web: a message-id catalogue (en, zh) with ICU-style plurals for new components only; old strings migrate as their components are replaced. Errors are keyed by code (LG-5)
- Risk: Two systems coexist during migration. Add a lint rule that forbids t("...") in new files
- Tests: Unit: every catalogue id has en and zh; plural tests for 1, 2 and 0. Browser: the Keyframes view in zh at 390 px with no overflow

## LG-12 Scene confirmation is a browser-run saga; request identity for paid presses [server, L, compatible_today=False, deps=LG-13,LG-19]
- Design: Audit #4; backend and audio oq 'one durable server command'; digest blockers 'closing the tab after Make strands paid voice' and 'double-click or lost reply = second charge'. Design: one press 'Confirm frames & generate video · about $1.50'
- Current: scene-confirmation-model.ts (597 lines) runs per shot: speech generate, poll, attach, accept with sample range, then scene video (step keys at scene-confirmation-model.ts:209-244, 329-477, 544-556). Checkpoints in localStorage (scene-continuation-cache.ts:169), Web Locks (scene-command.ts:22-24). The server requires narration settled before video (TIMING_REQUIRED, scene-generation.ts:508-515) and replays by idempotency key (scene-generation.ts:400-403)
- Gap: The design's single press is one server command only when no narration needs generating or accepting. Otherwise closing the tab strands paid speech. Without the saga, a paid press still needs a persisted key until the reply settles
- Change: server: POST /scenes/:sceneId/confirm that takes reviewedFrames plus per-shot narration choices (keep or trim range), runs speech, accept and video as a durable job record resumed by the engine loop, and is idempotent by key. web: the press sends one command with a key persisted until settled (a minimal pending-command); delete scene-confirmation-model and scene-continuation-cache after cut-over
- Risk: Money: a server-side chain must not re-buy speech after a restart. Reuse the existing narration request ids as step keys and test restart mid-chain. Keep the old client path behind a flag for one release
- Tests: Server integration with fake providers: restart after speech, before accept, and after accept, each with exactly 1 speech and 1 video attempt. Web: a double click sends one key. Browser: close the tab after the press, reopen, the scene shows making video

## LG-13 Every hand edit supersedes the active request, revokes the Director's turn and places holds that block dispatch and export [server, XL, compatible_today=False, deps=]
- Design: Digest blockers ('a hand edit lands while the Director is working', 'reorder/music/add shot hold the whole film') and majors (question becomes stale, queueing); backend and agent accidental 'holds and pending edit continuations'; agent oq 'queue instead of interrupt'; backend oq WAITING_USER. Design: Make 2.3 8 s, Edit narration, Edit prompt and Edit motion & duration are all hand edits made while the Director thread is live
- Current: beginRequest with editing marks prior editing requests superseded, revokes every epoch and sets holds on scope (service.ts:125-133). Each storyboard edit is such a request (storyboard.ts:393-405). A held scope blocks dispatch (execution/engine.ts:755-768, EXECUTION_HELD) and export (media/application.ts:222 MEDIA_HELD). An open question is projected canAnswer:false once its request is superseded (service.ts:622). Scene generation refuses while a turn runs or a question is pending (scene-generation.ts:275-284, 446-450 WAITING_USER)
- Gap: In the design, resolving note (b) with 'Make 2.3 8 s' while the Director is replying would abort the turn and kill any open question, and leaves a hold on 2.3 until a scene make or continuation covers it
- Change: Pick by decision. (a) web-only: while the Director is working or asking, edit controls show 'Wait for the Director or Stop', and answering a note goes through the question path. (b) server/core: non-revoking 'direct edit' requests that do not supersede the Director's request or set holds when the scope is disjoint from the turn's scope, plus a hold-release on edit completion when no Director continuation is needed
- Risk: Integrity: holds exist so the Director does not plan over stale state. (b) needs an epoch-scope check on apply_change (refuse if the turn's base headVersion changed inside its scope). Ship (a) first
- Tests: Server integration: edit during a running fake turn under (a) is refused in the UI; under (b) the turn still applies when disjoint and is refused when overlapping. Engine test: holds released after the edit and queued jobs dispatch

## LG-14 Text edits detach paid media: Brief/Story detach everything, scene purpose detaches the scene, shot title outdates picture and clip, timeline/render detached on every edit; prompt scaffolding [server, M, compatible_today=True, deps=]
- Design: Digest blocker 'Brief/Story/scene/title edits detach paid media'; backend accidental 'prompt scaffolding written into editable fields'. Design: Edit prompt marks the keyframe out of date; 'Editing a shot in a scene that already has video clears that scene's saved video'
- Current: The treatment edit sets global and every binding is affected (storyboard.ts:106-114, 443-444). A scene purpose edit marks all its shots changed (storyboard.ts:114-121). Shot purpose, action and framing rewrite both prompts with the 'OpenSlate current direction:' header (storyboard.ts:36-61, 187-190). Timeline and render bindings are always detached (storyboard.ts:442). Detach = candidateId null, outputs {} (storyboard.ts:485-490)
- Gap: The Keyframes design's per-shot edits match server behaviour (desiredFrames and motion keep the image, storyboard.ts:456-462). Plan-tab editing of Brief, Story and scene would silently discard paid media
- Change: core/server: limit detach to shots whose image or video intent digest changed (drop `input.kind === "treatment"` from the affected rule and recompute per shot); store human prompt text separately from the generated scaffold. web: before saving any edit, show what it will outdate, computed by a pure function over the snapshot
- Risk: Changing the intent digest semantics could make old media look current. Version the digest and treat pre-change bindings conservatively
- Tests: Server table-driven tests: each edit kind lists the expected detached node kinds; Brief edit detaches nothing

## LG-15 Undo is single-step, only for the latest hand edit, and detaches media even when the edit had kept it [server, M, compatible_today=False, deps=LG-14]
- Design: Digest majors on undo; agent oq 'creative edits: preview or undo'. Design: toast with Undo after 'Make 2.3 8 s' and after resolving a note
- Current: Undo works only while headVersion is unchanged ('Only the latest unchanged edit can be undone', storyboard.ts:339-357). The undo kind is not in the media exclusions (storyboard.ts:440-463), so undoing a desiredFrames or motion edit detaches the shot's image binding too. Director changes have no storyboard_edit record
- Gap: The prototype's Undo after 'Make 2.3 8 s' would discard 2.3's keyframe on today's server
- Change: server: apply the same field-specific exclusions for undo by diffing saved.before vs current per field, and keep or restore the previous candidateId binding when the restored intent digest equals the binding's. web: offer Undo only for edits whose undo is media-safe, otherwise label it 'Undo (keyframe will need remaking)'
- Risk: Restoring bindings must not resurrect media from a superseded plan. Require planId equality and a digest match
- Tests: Server: undo of a desiredFrames edit keeps the image binding; undo after another edit is refused. Browser: the Undo toast keeps the keyframe

## LG-16 Takes: re-roll detaches the current picture first, no take adoption, multiple alternatives block the scene, clips cannot be re-rolled, video whole-scene only [server, L, compatible_today=False, deps=LG-14]
- Design: Backend oq 'takes', 'per-shot video'; product oq 'compare and adopt'; digest blockers and majors on 'arrives not in use' and Use this take. Design: Regenerate 2.2 produces take 2 and the inspector shows 'Takes 2'
- Current: Regenerate nulls the current image binding inside the command (scene-generation.ts:671-690). Several active alternatives fail the scene read with SCENE_SELECTION_REQUIRED (scene-generation.ts:119). Video requires the whole scene with no targetShotIds or regenerate (scene-generation.ts:404-409)
- Gap: The design's Keyframes flow works for a scene with no video yet. A 'Takes' row implies choosing a take, which has no route. Regenerating a frame in a scene with video loses the clip
- Change: server: POST /shots/:shotId/takes/:candidateId/use (rebind with intent check). web: Takes row read-only until then. product: decide whether a re-roll keeps the old take in use until chosen
- Risk: Adoption of a take whose intent differs from current text: refuse, or rewrite the text. Needs a decision
- Tests: Server: adopt an earlier take; regenerate failure leaves the previous take adoptable. Browser: Takes 2 switching

## LG-17 Stop: visible while idle, film-wide pause, no Continue control, provider jobs not cancelled [cross-cutting, M, compatible_today=True, deps=LG-13]
- Design: Audit #7; digest blockers 'no Stopped state and no way to continue', 'Stop the Director and make now blocks itself'; backend oq provider cancellation; capabilities oq per-scene Stop. Design: Stop is not designed
- Current: canStopWork returns true when any plan node lacks an output (model.ts:242-263). control('stop') supersedes active requests, revokes epochs and pauses (service.ts:654-667). The web never sends action 'resume'. The only way out is the next message wrapped by continueStoppedWork with resumeFromStopId (model.ts:221-240, reference-model.ts:193), which also releases the user's holds (service.ts:146-158). Plain 'resume' unpauses without releasing holds
- Gap: The Stop affordance and the paused state need design. A Continue button calling 'resume' would leave holds in place
- Change: web: fix canStopWork to running turns plus live attempts only; add a Paused state with 'Continue' that sends a project-scoped resumeFromStopId request. server (optional): make 'resume' release the stopping principal's holds
- Risk: Held jobs dispatch after Continue without a new confirmation. Copy must say so
- Tests: Unit: canStopWork table. Server: resume then dispatch. Browser: Stop, Continue, make keyframes

## LG-18 No-answer jobs: no give-up route, block the shot and the whole scene command, occupy provider capacity [server, M, compatible_today=False, deps=LG-16]
- Design: Backend oq 'unknown outcome has no human resolution'; capabilities oq; digest majors 'clip gets no answer', 'give up then late result', 'server restarts mid-batch'. Design: failures and unknown outcomes are not designed
- Current: submission_unknown makes blockedCode SUBMISSION_UNKNOWN (scene-generation.ts:270-272), and any such row fails the scene command with ATTEMPT_EXISTS (scene-generation.ts:452-466, 491-503). No abandon or give-up command exists anywhere in apps/server/src or packages/core/src
- Gap: A stuck job blocks 'Confirm frames & generate video' indefinitely
- Change: server: POST /attempts/:id/abandon (human, keyed) that marks it abandoned-not-polled or keeps polling but releases the slot, as decided. web: shot card state 'No answer yet' with the abandon action and a double-charge warning
- Risk: Money: a double charge is possible. The decision on keeping polling decides whether a late result is kept
- Tests: Engine tests with a fake provider that never answers: abandon frees the scene; the late result is recorded as a take

## LG-19 The Director can start paid speech and transcription by itself [cross-cutting, M, compatible_today=False, deps=]
- Design: Agent oq; digest majors 'Only a person spends'. Design: the only paid presses are Confirm & generate video and Regenerate keyframe, each with a price
- Current: With audioRequests selected (V5), prepare_narration_speech calls port.request, which publishes a paid job (application/tool-invocations.ts:192-201; same for transcription at 180-189)
- Gap: The video panel's price is not the whole spend: a Director reply can buy speech with no press
- Change: server/skills: under the new UI, run the V5 audio tools in proposal mode (port.prepare) and have the person's confirm run the request; or keep it, show those charges as Director activity, and state it in the copy
- Risk: Changes V5 behaviour; the skill lock and digests must be bumped
- Tests: Director fake-runtime test: a speech tool call creates no attempt without a human press

## LG-20 DIRECTOR RECOMMENDS: no recommendation record, the Director cannot see pictures, question options are plain text, prose questions, impact counts empty for creative changes [cross-cutting, XL, compatible_today=False, deps=LG-13]
- Design: Agent oqs (vision, structured answers, preview or undo of agent edits, prose questions); capabilities 'question options shown as plain text'; digest blockers 'cost-keyed gate' and 'asking the Director to fix something visible only in the picture'. Design: lettered notes (a)(b) anchored to shots with typed actions and a Now/After timeline
- Current: The tool catalogue is read_context, prepare_change, apply_change, control_execution, inspect_artifact plus the narration/audio tools (packages/core/src/tools.ts:7-9). inspect_artifact returns metadata only (service.ts:682-689). Questions carry options (apps/web/src/model.ts:43-52) but are answered by one free-text reply. prepare_change impact is [] when there is no compiled plan (service.ts:286)
- Gap: Note (a) 'Coat came out maroon' needs vision. Note (b) 'Narration 7.4 s, shot 6 s' can be computed by the app from accepted audio. The anchored, actionable note has no data model
- Change: Phase 1 web: app-derived checks (narration longer than shot, frame not opened, model duration limit) rendered in the banner format. Phase 2 core/director/skills: a 'recommend' tool producing {shotIds, title, choices:[{label, action}]} records projected in the snapshot. Vision only after the provider question is answered
- Risk: Without vision the banner shows only app-computed facts; it must not promise a visual critique
- Tests: Unit: derived recommendation model. Director fake runtime: a recommend tool call yields a snapshot record

## LG-21 Status and liveness projection: one GET per scene, wait reasons discarded, stale vs never generated, Director status not in SSE [server, M, compatible_today=True, deps=]
- Design: Backend oqs (waiting reasons, roll-up endpoint, stale take, liveness, failure explanation); digest majors 'status per shot', 'Activity'. Design: scene pills with status for every scene, cards with Opened/making video, Director 'Working...'
- Current: Status is read per scene from GET /scenes/:sceneId/generation (scene-generation.ts:324), and each read builds the full snapshot. runReady's blocked list is discarded (index.ts:86). The event stream is registered without directorStatus (app.ts:300-301) although project-event-stream.ts:26-27 supports it. Tool start and finish events exist (tool-invocations.ts:150, 311)
- Gap: Pills for 3 scenes means 3 GETs on every invalidation. There is no wait reason and no live Director activity
- Change: server: GET /generation-overview returning per-scene and per-shot status with the last wait reason (persist runReady blocked per node) and previous take ids; pass directorStatus into registerProjectEventStream
- Risk: Performance on the single thread. Cache the overview per cursor
- Tests: Server: the overview matches the per-scene views; an SSE test for the director status line

## LG-22 Cost display: flat per-job estimates, video ignores duration, Codex images zero with unknown quota, spending layer retired [web, S, compatible_today=True, deps=]
- Design: Backend oq cost; product oq 'cost visibility'; capabilities oq; digest money majors. Design: 'about $1.50', '3 clips at about $0.50', 'Regenerate keyframe · about $0.04'
- Current: /api/providers gives estimatedCost {unitMicros, basis host_configured|fixture, actualVendorPriceVerified:false} per profile (provider-catalog.ts:207-208); unitCostMicros is flat per job (provider-catalog.ts:31-35). Codex image usage sets quotaEstimateAvailable:false (provider-catalog.ts:205). There is no estimate in the scene view
- Gap: The design's prices can be computed on the web as count × unit, but they are wrong for duration-priced video and silent for zero or unknown prices
- Change: web: a pure priceLine(profile, count) with 'about', and 'price not set' when the cost is 0 or unknown; never sum unknowns as $0. server (later): a duration-aware estimate field
- Risk: Misleading money copy. Label it an estimate set on this computer
- Tests: Unit: priceLine table (0, unknown, fixture, 3 clips)

## LG-23 Narration fit and voice: overlong lines, undecided narration blocks video, model duration limits, personal voice and transcription unreachable [web, M, compatible_today=True, deps=LG-12,LG-20]
- Design: Audio oqs (automatic remedy, default voice, personal voice, transcription, microphone, separate libraries, legacy placements); digest majors 'voice line too long', 'Length learned after paying', 'Personal voice absent'. Design note (b): Make 2.3 8 s / Keep 6 s (cut) / Edit narration with estimate
- Current: Placement requires audio ≤ shot length (narration/audio-placement.ts:18-19). Trimming exists through a sample range (shot-audio-model.ts:8-24). Video refuses an unsettled narration (scene-generation.ts:508-515). A shot longer than the video profile's maxFrames sets PROFILE_INCOMPATIBLE and blocks the scene (scene-generation.ts:160-170; packages/core/src/planning/scene-composition.ts:158-185)
- Gap: 'Make 2.3 8 s' fails at video time if the model's maxFrames is under 240. 'Keep 6 s' must become an accept-with-range before video (LG-12). The other audio surfaces are not designed
- Change: web: note (b) actions check profile.maxFrames before offering a length; Keep = trimmed accept; Edit narration = script edit plus regenerate. product: decide on the other audio surfaces
- Risk: Paid speech is re-bought on every edit; show its price
- Tests: Unit: offering lengths against minFrames and maxFrames. Server: trimmed accept then video

## LG-24 Film, export and playback: Director-authored render plan, two export mechanisms, demo media refused, music duplicated, no Range or caching on media [server, L, compatible_today=True, deps=LG-21]
- Design: Audit #2 (Export card), audio oqs (export dependency, canonical mechanism, holds from music tweaks, aspect), product oq format, backend oq media delivery, digest majors on export and Grid/hover. Design: a Film tab (undesigned), a keyframe preview with a scrubber, ▶ Play Scene 1
- Current: A render needs a renderNodeId (media/application.ts:75). The UI says 'A timeline plan is needed before rendering.' (MediaPanel.tsx:295). Fixture media is refused (media/timeline-capture.ts:157-161). Artifact content is read synchronously, hashed per request, sent no-store, with no Range (app.ts:269-284)
- Gap: Play Scene and the large preview refetch whole files. Export is not designed
- Change: server: Range plus ETag on artifact content and a poster endpoint. Export assembled from storyboard order after the Film design
- Risk: Range handling must keep the sha check; hash once at ingest
- Tests: Server: Range 206 response, 304 on ETag. Browser: scrub a clip

## LG-25 Start, setup, sessions, demo and project management are undesigned and partly backend-limited [cross-cutting, L, compatible_today=True, deps=LG-2]
- Design: Digest newcomer blockers (demo export, empty film locks the demo Director), majors (setup screen, restart logs out, model change mid-film, brief import review, multi-film state, phone reach); product oqs (persona, format, delete or reorder scenes, rename films); backend oq sessions. Design: only the Keyframes view
- Current: The Director is locked after the first conversation (application/local-director.ts:228,237). Sessions live in memory, 12 h, with a 60 s launch code (studio-sessions.ts:9-24). Project routes are GET and POST only (app.ts:118,147,158). Storyboard kinds have no scene delete or reorder (storyboard.ts:536-547)
- Gap: Out of scope for this rework's first phase; the decisions are needed before those screens
- Change: product decisions first; then server routes for rename, delete, scene delete and reorder, and a signed-out or reconnect screen in the web
- Risk: Leaving the old surfaces reachable during the transition
- Tests: Browser: restart the fixture server and the tab shows reconnect

## Open questions
- Opened proof: keep requiring every frame to be opened before paying for video? If yes, is a per-browser record keyed by frame content enough, or must it be recorded on the server?
- Plan, Assets, Film, the start / new-film flow, settings, export, Stop, failures, unknown outcomes, recovery and the full phone layout have no design. Should the first release keep today's components inside the new tabs as an interim, or wait for those designs?
- Theme: the prototype is dark only, but Day/Night shipped on Oct 7. Keep a light theme mapped to the new colour roles, or drop it?
- Hand edits while the Director is working: refuse them with a reason (web only, ship now), or invest in edits that do not interrupt the Director (server/core, XL)?
- Should the scene confirmation chain (speech, accept, video) become one durable server command before the redesign ships, given that closing the tab today strands paid speech?
- May the Director keep starting paid speech and transcription by itself (V5), or must every paid job come from a person's press?
- DIRECTOR RECOMMENDS: phase 1 shows only app-computed facts (narration too long, frames not opened, model length limits). Is a Director-authored recommendation record (new tool) wanted, and is visual critique such as the coat colour in scope, given the Director cannot see pictures today?
- Takes: should regenerating a keyframe keep the current one in use until the person picks, and should an earlier take be adoptable?
- Undo: only for media-safe hand edits (single step), or a multi-step history that also restores media?
- Stop: keep it film-wide with a Continue button, or make it per scene or per job? What should the copy promise about jobs already sent?
- No-answer jobs: add 'give up and allow a new try', accepting a possible double charge? When a late result arrives, is it kept as a take?
- Cost: how to show a price of zero or unknown (Codex images)? Should video estimates depend on duration? Unmount the retired allowance and budget routes, or bring back a light spend view?
- Brief, Story and scene purpose edits currently discard all dependent paid media. Is that intended, or should only shots whose intent changed be outdated?
- Export: assemble the film from storyboard order in the app, or keep the render plan written by the Director? Should the demo film be exportable?
- Chinese terms for the new vocabulary (Opened, Takes, Director recommends, video saved): who writes them, and must the same words be used everywhere?
