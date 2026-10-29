# Deep review: plan/generation flow, UI, skills (workflow wf_daea0785-e60)


## plan — Plan authoring and storyboard edits

### Map

WEB (apps/web/src/next)
- views/plan/PlanView.tsx `Workspace` builds the outline with model/plan.ts `planOutline(snapshot, overview)`. Its authority is `projectionBaseline` (model/plan-session.ts): snapshot and overview must agree on project, headVersion and revisionId.
- Editors (TextPanel, ScenePanel's InlineForm, ShotEditor) keep drafts with views/plan/useHeld.ts `heldDraft`, built on model/plan-conflict.ts (hold, shown, conflicts, keepMine, takeSaved, afterSave). Drafts live in the per-film `PlanSession`.
- Save path: saveText, saveTitle, saveDirection and saveShot call `sendStoryboard`, then views/plan/commands.ts `storyboardOutcome`, `settle`, `storyboard()`, then `store.command("plan:"+pressId, body incl. expectedHeadVersion)`, then store/store.ts `#press`. store/press-keys.ts keeps the key and body of a lost reply, so a resend uses the same Idempotency-Key.
- A shot save is model/plan-edit.ts `draftEdits`: narration mode none, then shotFields, then narration text, then narration mode. `runShot` sends them one after another, each with the head from the previous receipt (`receiptBaseline`).
- The impact line comes from `shotImpact` and `draftEffects`, priced by `unitPrices` (which uses inspector.ts `clipUnit`).
- Undo: last-change.ts `useLastChange` plus PlanView `undo()` sends {kind:"undo", commandId}. The toast Undo goes through store.undoToast, store.undo, store.edit.
- Imports: ImportSheet calls sendImport, confirmImport and discardImport against /plan-imports. The review is model/plan-import.ts `importReview(snapshot.project, pending.draft.project)`.

SERVER
- apps/server/src/storyboard.ts `editStoryboard`, in order:
  1. store.command replay check.
  2. Head fence and the IMPORT_PENDING gate.
  3. The edit is applied to a clone of the project.
  4. `beginRequest` with concurrency "alongside", editing, holdScopeIds [].
  5. Affected bindings are computed: timeline/render; treatment and scene use `intentChanged`; undo of brief/story takes everything; other edits use the `changed` shots minus exclusions; then a dependency closure.
  6. Affected bindings are detached (outputs {}, candidateId null, outdated).
  7. saveProject, project_revision, application/human-fields.ts `recordHumanFields`. The human.fields_changed events feed `assertNoHumanFieldConflict`, which fences Director patches.
  8. For undo, storyboard-history.ts `restoreMediaUndo`, `restoreCanonicalUndo` and `restoreNarrationWorkspaceUndo`, gated by `assertUndoUnused` and the latest-command plus same-head check.
  9. A storyboard_edit record is written.
- apps/server/src/plan-imports.ts:
  - POST creates a non-alongside editing request and a pending plan_import, then queues the Director. service.prepare only allows a creative patch (IMPORT_REVIEW_REQUIRED).
  - GET rebases with service.planImportDraft and application/creative-rebase.ts `rebaseCreativeDraft`.
  - Confirm runs service.confirmPlanImport: checks the latest non-alongside request, no running turn, and the latest prepared change plus its digest; rebases; `beginRequest` continuation; `recordPreparedChange`; `apply` / `publishPreparedChange`.
  - Discard supersedes the request, revokes its epochs and releases its holds.
- Whether media is current (overview / scene-row.ts) comes from packages/core/src/planning/index.ts `shotIntentDigest` plus a prompt-equality check.
- request-scopes.ts drives `supersede: intersecting`.
- expected-human-request.ts fences scene presses by the latest active editing request; storyboard edits count as one.
- packages/core/src/planning/scene-composition.ts and narration-rebase.ts compose generation plans. I read them but they were not the focus.


### plan-undo-outdates-paid-media [blocker → blocker] confirmed

**Undo of a brief/story edit or a cross-scene shot move outdates paid keyframes and clips that the forward edit kept**

- File: `apps/server/src/storyboard.ts:435`
- Scenario: Case 1: a film with every keyframe and Viggle clip made. The person edits the Story in Plan; the panel says "Nothing made goes out of date" and the forward edit does keep all outputs. They press Undo (header button or the toast). Every image and video binding in the film is detached: outputs cleared, candidateId null, outdated.fields ["undo"]. All keyframes and clips show as outdated. Case 2: moving shot 1.2 to scene 2 (MoveDialog says it "outdates nothing ... and it can be undone") and then pressing Undo outdates 1.2's keyframe and clip. Clips cannot be re-selected (only keyframe takes have a use route), undo-of-undo is refused (line 374), and engine.reuseLocal never reuses image or video. The person must pay Viggle again to get back clips they already had.
- Evidence: storyboard.ts:435-436: `(input.kind === "undo" && (next.brief !== before.brief || next.story !== before.story))` marks every binding affected. storyboard.ts:383-387: undo's `changed` holds any shot whose record differs, including a sceneId-only change from moveShot. Clause 4 (437-451) then detaches that shot's image and video, because effectiveInput.kind is "moveShot" and no exclusion applies. Lines 476-489 clear those bindings. Lines 500-501 call restoreMediaUndo with only `undoing.undo.bindings`, which are the bindings the forward edit touched (timeline/render only for treatment and moveShot), and storyboard-history.ts:58 skips those. The forward behaviour is pinned by storyboard.test.mjs:184 (treatment keeps outputs); no test undoes it. Reproduced with throwaway tests in the scratchpad: engine.outputs went 4→4 on a story edit, then 4→0 after its Undo; 4→4 on a cross-scene moveShot, then 4→2 after its Undo. Controls: undo of scene direction, sceneTitle, moveScene, addShot and a purpose edit all kept 4 outputs.
- Fix: For undo, decide affected image and video bindings the way the forward treatment and scene path does. Remove the blanket brief/story clause; timeline/render are already covered by clause 1. In clause 4, for undo, require `intentChanged(shotId, kind)`, a changed image or video prompt, or a removed shot, instead of raw `changed.has`. Add regression tests: undoing treatment:brief, treatment:story and a cross-scene moveShot leaves `engine.outputs` unchanged.
- Verifier: I traced it and reproduced it. Forward treatment edit: shotIntentDigest (packages/core/src/planning/index.ts:83-87) covers only purpose/action/framing/references (+motion/frames/cue for video), not brief/story, so clause 2 (storyboard.ts:432-434) leaves image/video alone. Only timeline/render are detached, and that is what the forward command's undo.bindings saves (line 476). Undo: clause 3 (storyboard.ts:435-436) `input.kind === "undo" && (next.brief !== before.brief || next.story !== before.story)` has no node-kind or shot filter, so every active binding is detached at 476-488 (outputs {}, candidateId null, outdated.fields ["undo"]). restoreMediaUndo (storyboard-history.ts:42-58) only walks the forward command's saved bindings (timeline/render) and skips non-image/video at line 58, so nothing comes back. Git history explains it: commit 2e65dfc3 (SB-12) replaced the forward `input.kind === "treatment"` blanket clause with the intentChanged check but left the undo twin in place. moveShot case: moveShot does not add to `changed`, so forward only detaches assembly. On undo, the digest diff at 383-387 puts a cross-scene-moved shot in `changed` (sceneId differs). Clause 4 then applies: effectiveInput is moveShot, so the narration exclusion is off, and shotFields is null, so both `!(undefined && …)` exclusions are true. Its image and video are detached. Nothing guards against this: assertUndoUnused passes when no paid submission happened in between. The UI offers Undo for both (PlanView.tsx:326-333 and 373-382 call finish→undoToast/setLast). Undo-of-undo is refused (line 374), and store.ts:341 gives no undo toast for an undo. Recovery: keyframes can be re-picked through /takes/:id/use (shot-takes.ts), but clips have no route back. engine.reuseLocal returns false for GENERATED kinds (engine.ts:811), and installPlan reuses outputs only for unchanged active bindings. Throwaway test in scratchpad (skeptic/undo.test.mjs): treatment:brief and treatment:story went 4→4→0 outputs, with every binding showing outdated 'undo'. Cross-scene moveShot went 4→4→2 (shot-0's image and video gone). Same-scene move, scene direction and sceneTitle undo kept all 4. One Undo press after a story edit takes every clip in the film out of use, and Viggle has to be paid again to get them back.


### plan-impact-clip-unpriced [major → major] confirmed

**Shot editor says a paid clip remake has "no price set" whenever the scene's clips are all made**

- File: `apps/web/src/next/model/plan-edit.ts:257`
- Scenario: A scene whose clips are all ready, with a priced Viggle profile. The person changes motion, length, action or a prompt of shot 1.1 in Plan. The impact line reads "Saving outdates 1.1's clip (no price set for remaking it)". The same happens for kf_clip_unpriced and kf_clip_codex_unpriced, and also when the scene has a pending generated voice line (mixed units make unitMicros "0"). This line is the only before-save statement of what remaking will cost, and it tells the person no price exists for a paid clip.
- Evidence: generation-overview.ts:179 always sends `confirmVideo: quote(lock, rows, "confirmVideo")`. generation-quotes.ts pushes units only for `!row.videoComplete`, so a fully made scene gets {units:0, unitMicros:"0", priceUnknown:false}; a mix of video and speech units also gives unitMicros "0". inspector.ts:120-124: `quoteUnit` returns a non-null object for that quote, so the `?? other scene` fallback never runs. plan-edit.ts:257 `Number(clip.unitMicros) > 0 ? ... : null` returns null, and shotImpact (plan-edit.ts:326-330) chooses the *_unpriced message. Reproduced in a scratchpad test with the last-ferry overview using the server's zero-unit confirmVideo shape: prices {clip:null}, impact "Saving outdates **1.1's clip** (no price set for remaking it)". The fixture (last-ferry.ts:107) omits confirmVideo when there are no targets, so plan-edit.test.mjs never sees this case. `voice` has the same problem through `quotes.voice` (it shows the unpriced voice message).
- Fix: Price a remake from a per-unit source. Options: have the server send a per-shot or per-profile regenerate quote (as regenerateKeyframe already does), or in unitPrices/clipUnit skip quotes with `units === 0` or mixed units and fall back to a quote whose units are all the video profile. Add a fixture or test whose scene has every clip ready.
- Verifier: Server: generation-overview.ts:179 always sends `confirmVideo: quote(lock, rows, "confirmVideo")`. In generation-quotes.ts, `quote` pushes a video unit only for `!row.videoComplete` (and speech only under the same condition). A fully made scene therefore gets units 0 and unitMicros "0" (`costs.length && …` is falsy), with priceUnknown false. A mix of video and speech costs also gives unitMicros "0". Web: inspector.ts:120-124 `quoteUnit` returns non-null for that quote, so the `?? any scene` fallback never runs. plan-edit.ts:257 then sets clip to null because `Number("0") > 0` is false. draftEffects needs `shot.video.state === "ready"`, so the impact line matters most when the clip is made, which is usually when the whole scene is made. shotImpact (plan-edit.ts:326-330) then picks clip_unpriced, kf_clip_unpriced or kf_clip_codex_unpriced. Reproduced in scratchpad (skeptic/price.test.mjs) with lastFerryOverview scene 1 (all 3 clips ready) and the server's zero-unit confirmVideo: prices went from clip 500000 to clip null, and the impact text read "Saving outdates **1.1's clip** (no price set for remaking it)." The fixture (last-ferry.ts:107) leaves out confirmVideo when there are no targets, so existing tests never see the server's real shape. The same clipUnit path also drives the Keyframes inspector's Regenerate clipNote (inspector.ts:149-151) and the takes impact (keyframes-takes.ts:46-49), so all three pre-action cost notes are wrong in this common case. I keep it at major, not blocker, because the actual paid press (scene confirm) recomputes confirmVideo with the outdated row and shows the right price. No money is spent without a price, but the person is told something false about cost at the moment they decide.


### plan-delete-shot-running-job [major → minor] confirmed

**deleteShot accepts a shot whose paid job is running or has no answer; deleteScene refuses the same case**

- File: `apps/server/src/storyboard.ts:221`
- Scenario: Shot 2.3's clip is being made (remote_pending) or its outcome is unknown (submission_unknown). Its ••• menu still offers Delete, and the dialog lists only media counts, length and the undo note. Deleting succeeds. The provider job finishes and is charged, but its output is never published (the binding is detached and the shot is gone). For an unknown-outcome job, the shot row and its no-answer pill and Release path disappear from Plan and Keyframes, so the job can no longer be resolved there. Deleting the whole scene in the same state is refused with ATTEMPTS_RUNNING.
- Evidence: storyboard.ts:141-150 (deleteScene) calls `assertNoRunningAttempts(s, projectId, new Set(shots.map(x => x.id)))`. storyboard.ts:221-225 (deleteShot) has no such check. ShotRow.tsx:121 enables delete-shot whenever there is no guard and nothing is busy. DeleteDialog.tsx shows no running-work fact. Reproduced: after `engine.runReady()` both attempts were remote_pending; deleteScene threw ATTEMPTS_RUNNING; deleteShot of shot-0 succeeded; after `reconcile` both attempts succeeded but only shot-1's output remained in `engine.outputs`. Per-shot slots in generation-overview are the only place unknown jobs are listed apart from restartCasualties.
- Fix: Call `assertNoRunningAttempts(s, projectId, new Set([row.id]))` in the deleteShot branch to match deleteScene. Optionally pass the shot's running or no-answer state into DeleteDialog so it explains why delete is off.
- Verifier: The code gap is real. deleteScene calls assertNoRunningAttempts (storyboard.ts:146), and deleteShot (221-225) does not. Plan's guard (PlanView.tsx:146) and ShotRow.tsx:121 do not look at per-shot running state. Reproduced (scratchpad skeptic/del.test.mjs): with both attempts remote_pending, deleteScene threw ATTEMPTS_RUNNING while deleteShot('shot-0') succeeded. The impact is smaller than claimed, though. After reconcile the attempt succeeded and its artifact was kept: projectAssets lists it as a non-current shot-0 take (asset-library), and Undo of the delete reconnected it through restoreMediaUndo's submitted-attempt branch (outputs went back to both shots). The provider charge happens whether or not the shot is deleted, so the delete causes no double charge or lost payment. What remains: (1) the behaviour is inconsistent with deleteScene. (2) For a submission_unknown job that does not resolve on its own (Viggle lookup can return unknown, viggle-h3-execution.ts:100-109), the per-shot no-answer pill and Release button disappear with the shot. Project archive is then refused with ATTEMPTS_RUNNING (project-library.ts:66 → 27-29), and nothing visible can be released until Undo, or until a server restart lists it in restartCasualties (generation-overview.ts:70 lists only attempts created before engine start). In the fake provider, lookup resolved it automatically. The proposed fix (call assertNoRunningAttempts with the shot's id) is right, but severity should be minor.


### plan-import-confirm-project-hold [minor → minor] confirmed

**Confirming an import leaves a project-wide hold that stops all queued generation until the person acts again**

- File: `apps/server/src/application/service.ts:572`
- Scenario: A film with queued work, for example clips in scene 3 waiting for capacity. The person imports a document that only changes the story and confirms it. The confirm request takes a hold on the whole project and keeps it after publishing. Every queued job in the film stays waiting (edit_pending) until the person sends a Director message, presses a non-regenerate scene action, or chooses "Let it go". A Regenerate press is alongside, does not supersede the hold, and its job also waits. Nothing continues the confirm request automatically; its own text says "No generation is authorized."
- Evidence: service.ts:572 `beginRequest(..., { editing: true, continuationRequestId: requestId })` is non-alongside and holds scopeIds [projectId] (service.ts:164). publishPreparedChange releases holds only `if ((prepared.compiled || alongside) && !retainHolds)` (service.ts:709), so this creative-only human publish keeps them. releaseFinishedRequestHolds returns early when the request has no director turns. engine.ts:902 blocks dispatch on any active project-scope hold. Reproduced: after an HTTP confirm, the active holds are [project, owner "Confirm the reviewed supplied-material plan"], and snapshot.pendingEditContinuations lists that request.
- Fix: Release the confirm request's holds after a successful confirmPlanImport, since it authorizes no generation. Alternatively make the confirm request alongside with holdScopeIds [], as storyboard edits are, while keeping the continuation lineage.
- Verifier: confirmPlanImport (service.ts:572) calls beginRequest with editing:true, without alongside and without scopeIds, so it holds [projectId] (service.ts:164). The continuation releases only the import request's holds. publishPreparedChange releases holds only `if ((prepared.compiled || alongside) && !retainHolds)` (line 709), and an import draft is never compiled. releaseFinishedRequestHolds returns early when the request has no director_turn (`!turns.length`), and the confirm request never gets one. Reproduced via HTTP (scratchpad skeptic/imp.test.mjs): after confirm, the only active hold is a project hold owned by 'Confirm the reviewed supplied-material p…'. releaseFinishedRequestHolds leaves it in place, and snapshot.pendingEditContinuations lists it. engine.held (engine.ts:890-905) blocks dispatch of every node under a project-scope hold. This differs from the other human publish paths, which are alongside and release at publish (storyboard edits, director-proposals.ts:156, director-notes.ts:133). The harm is limited. The project was already held by the import request for the whole pending-import period. The overview marks held slots as edit_pending ('Held by an edit'), and HeldEdits.tsx offers 'Let it go', which calls release-holds. A Director message or an intersecting scene press also ends it. Queued work is delayed and nothing is charged, and the person can see it and clear it with one press, though the UI calls it an unfinished Director edit. Minor.


## director — Director planning changes (prepare and apply)

### Map

Director tool transport: app.ts POST /internal/projects/:id/tools/:tool authenticates the bridge token (service.actorForBridge, service.ts:220), then calls ToolInvocationService.invoke (tool-invocations.ts:137). invoke checks the epoch's locked catalog (catalog():120), validates arguments with parseToolArguments (core/tools.ts:222) and writes one tool_invocation 'started' receipt per epoch+callId. A replay returns the saved result; a started or unresolved call returns TOOL_CALL_UNRESOLVED and is never resubmitted. It then dispatches the tool:
- read_context goes to service.readContext, then projectDirectorContext (context-projection.ts:149).
- prepare_change goes to service.prepare (service.ts:291). ORIGIN_NOT_AUTHORIZED with a source becomes awaiting_human_generation (tool-invocations.ts:228-235).
- apply_change goes to service.apply (service.ts:534).
- propose_change goes to proposeChange (director-proposals.ts:47).
- record_notes goes to recordNotes (director-notes.ts:38).
- control_execution goes to holdRequest.
- reconcileEpoch (tool-invocations.ts:295) runs after the epoch is fenced and recovers only from domain receipts.

Prepare/apply kernel (service.ts):
- prepare: assertActor(mutating) → parseChangeProposal (core/workflow/index.ts:101) → assertNoHumanFieldConflict (human-fields.ts:28) → same-digest replay → holdRequest → head check → applyCreativePatch → compilePlanIsolated (core/planning/index.ts:410, worker) → assessCompiledChange:321. That step uses diffPlans; turns in-scope ungranted reuse into replace; handles requestNewTakes; runs checkFootprint:250 and requiredStages/validateStageRequirements.
- finalizePreparedChange:351 re-checks authority and head, then binds unused grants whose authority is in continuedRequestAuthorities (pending-edit-continuation.ts:36). A Director has no such grants, so it gets ORIGIN_NOT_AUTHORIZED. recordPreparedChange:382 saves the Prepared record.
- apply runs store.command(principal:project:apply, preparedId) → publishPreparedChange:677. That fences on head, capability lock and stage versions, saves next, calls engine.installPlan (engine.ts:184, which creates candidates from grants) and releases holds.
- The same kernel is used by:
  - applyCompiledSceneGeneration:400 (the scene press)
  - publishHumanCreativePatch:593 (proposal accept/undo)
  - confirmPlanImport:555
  - the audio reviews

Authority:
- beginRequest:117 handles supersede/revoke, holds and continuation edges.
- openEpoch:207 and assertActor:233.
- DirectorSupervisor (director-supervisor.ts) runs: tick → run → openEpoch → createDirectorInput (director-input.ts) → DirectorContextService.capture (director-context.ts:48) → runtime → terminal. terminal calls releaseFinishedRequestHolds (service.ts:634) and reconcileEpoch. filmPlanningGuidance (film-planning-guidance.ts) and skills/v6 supply the policy text.

Proposals:
- proposeChange → validateHeldCreativePatch (service.ts:583) plus previewCreativePatch (core/proposal-preview.ts:14) → director_proposal record.
- view/directorProposals recompute the preview through rebaseProposal:28.
- proposalCommand:123 handles accept, reject and undo: beginRequest(alongside) → publishHumanCreativePatch → noteTransition → releaseFinishedRequestHolds.

Web:
- useDirectorNotes.run (keyframes/useDirectorNotes.ts) calls store.acceptProposal({previewDigest}), store.resolveNote, or runNoteRegeneration (note-command.ts:22).
- The view models are noteViews (notes.ts:141) and noteBanner (note-banner.ts:133).

Checked and fine:
- The Director cannot start paid media: grants exist only under human/app requests, and video also needs an exact human approval (engine.ts:955).
- Tool calls are idempotent per epoch+callId, and an unknown outcome is never resubmitted.
- A Prepared change is fenced by head version and its epoch.
- Proposal accept is fenced by the recomputed previewDigest.


### director-proposal-inflight-discard [major → major] confirmed

**Accepting a proposal while the shot's paid clip is rendering silently throws the charged clip away; the Now/After preview and the banner say nothing**

- File: `packages/core/src/proposal-preview.ts:28`
- Scenario: 1. Scene 1 is confirmed and the Viggle clip for shot 1.1 is in flight (attempt remote_pending).
2. A non-blocking Director note offers "Make 1.1 8 s" (propose_change desiredFrames).
3. The person presses it. The preview effects are only [keeps_keyframe], and the banner button is enabled.
4. Accept publishes the new duration.
5. When the provider finishes, the attempt succeeds and the reservation is charged.
6. The output is never bound, because checkIntent now fails. The shot shows no clip and is not pending, so Confirm is offered again: a second paid clip.

The same discard happens when the Director applies a desiredFrames/motion/videoPrompt change directly with prepare_change + apply_change; nothing checks for in-flight attempts.

Reproduced in /private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad/inflight.test.mjs. Output: preview effects [keeps_keyframe]; afterwards attempt succeeded, reservation charged, binding outputs {}.
- Evidence: - proposal-preview.ts:28: `const bindings = (bindingsByShot[shot.id] ?? []).filter(b => Object.keys(b.outputs).length)`. An in-flight video has no outputs, so has('video') is false: no clip effect and no warning.
- director-proposals.ts:123-176 (proposalCommand accept) and service.ts:593-623 (publishHumanCreativePatch) never look at engine.attempts.
- engine.ts:1231 `this.setReservation(current, "charged")`, then 1237-1251: the output is bound only `if` checkIntent(project, binding.node) passes. checkIntent (engine.ts:887) compares node.intentDigest to the new shotIntentDigest, which includes desiredFrames and motion (core/planning/index.ts:86).
- Web: note-banner.ts:113-117 enables a proposal choice whenever `proposal?.state === "held"`. The regenerate choice (118-121) is disabled while regenerationBlock reports isWorking(shot.video).
- Fix: In proposalCommand accept, and in the Director apply path for shots with a non-terminal attempt, either refuse with ATTEMPT_EXISTS or add a distinct preview effect such as 'running_clip_discarded' (include running bindings in bindings()). Mirror the regenerate busy check in choiceAction for proposal choices.
- Verifier: I traced the path end to end and re-ran the repro (dist was built at HEAD), with the same result. Effects come only from bound outputs (proposal-preview.ts:28 filters by Object.keys(b.outputs).length), so a running video adds nothing. Output: preview effects [keeps_keyframe]. proposalCommand accept (director-proposals.ts:123-176) goes to publishHumanCreativePatch (service.ts:593-623) with compiled=null. That path never looks at attempts and never detaches bindings, so the video binding keeps its candidate. At completion, engine.ts:1231 charges the reservation, then binds only if checkIntent passes (engine.ts:1241). checkIntent fails because shotIntentDigest includes desiredFrames and motion (planning/index.ts:84-86). Nothing makes this impossible: rebaseProposal checks only shot revision and digest, which starting a clip does not change. choiceAction (note-banner.ts:113-117) enables the button on state==='held' only. Only the regenerate choice is busy-gated. A comparable design intent exists: the inspector warns about a running keyframe ('will still be charged and come back out of date', inspector.ts:33). One correction to step 6: I extended the repro to read the generation overview. Afterwards the video slot is not 'none' but stuck at state 'queued' with waiting.code 'unknown'. Its 'previous' is the discarded clip, and the shot is back in videoTargets, so a new priced Confirm is needed. A stuck 'waiting' state is arguably worse than 'none'. Same gap in the hand-edit path: during a running clip, editImpact for a duration or motion edit says 'The keyframe stays. No clip exists yet, so nothing needs redoing.' (inspector.ts:30-37, keyframes catalog:116). The fix should cover both paths. Major: a paid clip is silently wasted behind a preview that says nothing about it, and the shot is then shown as waiting forever.


### director-proposal-changes-unseen [major → major] confirmed

**The person accepts a proposal without ever seeing its field changes; the button can describe only part of the change**

- File: `apps/web/src/next/model/notes.ts:58`
- Scenario: 1. The Director proposes {updateShots:[{id:'2.2', desiredFrames:240, narration:{mode:'generated', text:'<new words>', voice:'stock'}}]} and links it in a note whose model-written text says "A little longer?".
2. The banner shows the button "Make 2.2 8 s", the film-length line, effect chips ("Voice line will be remade") and the duration strip.
3. The new narration words (preview.changes) are never displayed.
4. Pressing the button sends the previewDigest that covers those changes, and the server saves the narration. That text is later voiced through paid TTS.

For a prompt-only or narration-only proposal the button just says "Apply the change", and the only description is the Director's own note text.

The server's rule that the person accepts the exact Now/After preview is therefore not met in the UI.
- Evidence: - notes.ts:58-63 choiceLabel: the proposal label is either `note.choice.make_seconds` for the first changed duration row, or `note.choice.apply`.
- note-banner.ts:150-163 builds the banner from sub (anchor, blocking, film length, effects) and the duration timeline only.
- NoteBanner.tsx renders view.title (note.text), sub and timeline.
- No web code reads `preview.changes`; a grep finds it only in fixtures and settings.
- The server binds changes into the digest: proposal-preview.ts:26 pushes before/after per field, and director-proposals.ts:129 requires `previewDigest === current.previewDigest`.
- Fix: Render preview.changes (field, before, after) in the banner for every proposal choice. Derive the button label from all changes, or fall back to a generic label plus the diff when the patch has more than one duration change or any non-duration change.
- Verifier: I verified this in the web code. choiceLabel (notes.ts:58-63) gives either make_seconds for the first row whose duration changed, or the generic 'apply' label. noteBanner (note-banner.ts:150-163) builds sub only from the anchor, the blocking flag, film length and deduplicated effect chips, plus the duration timeline. NoteBanner.tsx renders title (the model-written note.text), sub, timeline and buttons only. A git grep finds preview.changes only in settings.ts, where it refers to a different preview type. NoteCards and Thread/plan outlines reuse noteViews and do not render the changes either. The server meanwhile binds the full preview, changes included, into previewDigest (proposal-preview.ts:26, director-proposals.ts:129). The design says the preview is app-computed with no model-authored summaries (proposal-preview.ts:13), and the guidance says 'the person accepts the exact Now/After preview' (film-planning-guidance.ts:22, notes.md:7). So for narration, prompt or scene-purpose changes, the Director's free text is the only description the person sees. A narration-only change with no existing voice or cue shows no effect chip at all, just 'Apply the change'. Accepting costs nothing and can be undone (DC-4), which limits the harm. But it defeats the integrity guarantee the digest is meant to give, and accepted narration words feed later paid TTS. I keep major.


### director-orphan-proposal-holds [minor → minor] confirmed

**A held proposal the person declined (or never saw) keeps the finished Director request's execution holds indefinitely**

- File: `apps/server/src/application/service.ts:643`
- Scenario: 1. The person sends an ordinary chat message (editing, project scope), so beginRequest places a project hold.
2. The Director calls propose_change, records a note with choices [proposal, accept 'Keep it'], and the turn completes.
3. The person presses 'Keep it'. The note resolves, but the proposal stays 'held'. The web never calls rejectProposal, so the UI has no reject path at all.
4. releaseFinishedRequestHolds returns early because a held proposal exists, so the project hold stays active.
5. Already-queued keyframes or videos anywhere in the project wait as "edit_pending" (an "unfinished Director edit"), and the inspector disables Make for them. This lasts until the person finds 'let go' or types a new message.

The same happens when the Director proposes without linking the proposal in any note. Such a proposal is invisible in the web, because proposals are shown only through note choices.

Reproduced in /private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad/orphan.test.mjs. Output: 'active holds after Keep it [PROJECT]', proposal held.
- Evidence: - service.ts:643: `if (this.store.list<ProposalRecord>("director_proposal", projectId).some(proposal => proposal.requestId === requestId && rebaseProposal(project, proposal).state === "held")) return;`
- director-notes.ts:133-138: resolveNote for accept/reply/edit choices never touches the linked proposal.
- store.ts:514 rejectProposal is defined but has no caller.
- generation-overview.ts:125-129 reports `edit_pending` for any active hold covering the slot.
- Fix: When a note that links a proposal is resolved by another choice, reject that proposal in the same command. Do not let held proposals retain request holds; they are documented as 'No holds' (tools.ts:122). At minimum, show unlinked held proposals with a reject action.
- Verifier: I re-ran the repro: after 'Keep it' the note is resolved, the proposal is still held and the PROJECT hold stays active. resolveNote (director-notes.ts:88-139) never touches linked proposals. No server code moves a proposal out of 'held' except proposalCommand: the only writer of director_proposal is director-proposals.ts:172. The web's rejectProposal (store.ts:514) has no caller. releaseFinishedRequestHolds returns early while a proposal of that request is held (service.ts:643). An ordinary editing chat places holds on its scopeIds (service.ts:164, default project scope). engine.held blocks every node under a project-scope hold, and Confirm video is alongside with holdScopeIds [] (scene-confirmations.ts:110-111), so it does not supersede the old request. Its clips would therefore wait as edit_pending. Keeping holds while a proposal is live is documented as intended (B13 report), but nothing ends that state when the person declines through the note. Ways out do exist: HeldEdits shows 'Let it go' when work is blocked, a new typed message supersedes the request, and a non-alongside Make keyframes supersedes intersecting requests. Keyframe-review turns are editing:false and place no holds. Minor.


### director-skill-propose-schema-gap [minor → minor] confirmed

**The guidance requires propose_change for every change that outdates paid media, but propose_change cannot change shot purpose, action or framing**

- File: `skills/v6/production/references/notes.md:7`
- Scenario: 1. The user asks "make 2.2 a close-up" on a shot that has a keyframe and a paid clip.
2. framing, action and purpose are part of shotIntentDigest, so the change outdates both pieces of media.
3. V6 notes.md says such changes "must use propose_change" and "Do not use prepare/apply to bypass this boundary". plan-authoring SKILL.md and film-planning-guidance.ts:22 say the same.
4. proposalPatchSchema only allows desiredFrames, motion, imagePrompt, videoPrompt, narration and scene purpose.
5. The Director must either refuse the explicit request, apply it directly against its rules, or propose only the prompts and leave framing at 'Wide'. The last option leaves the shot card contradicting its own prompts.
- Evidence: - core/tools.ts:106-115: proposalPatchSchema.updateShots has properties id, desiredFrames, motion, imagePrompt, videoPrompt, narration, with additionalProperties false.
- core/planning/index.ts:84: `const common = { purpose: shot.purpose, action: shot.action, framing: shot.framing, references: shot.referenceArtifactIds }` feeds both the image and the video intent.
- engine.ts:887 treats an intent mismatch as stale media.
- notes.md:7, plan-authoring/SKILL.md:12 and film-planning-guidance.ts:22 mandate propose_change for paid-media-outdating changes.
- Fix: Add purpose, action and framing to proposalPatchSchema and previewCreativePatch, or narrow the guidance to the proposable fields and state explicitly how to handle framing/action edits the user asked for.
- Verifier: proposalPatchSchema (tools.ts:106-115) allows only id, desiredFrames, motion, imagePrompt, videoPrompt and narration, with additionalProperties false. The same holds for the ProposalPatch type in proposal-preview.ts:8. framing, action and purpose are part of shotIntentDigest for both image and video (planning/index.ts:84), so changing them outdates paid media. Three places say such changes must go through propose_change and must not be applied directly: notes.md:7, plan-authoring SKILL.md:12 and film-planning-guidance.ts:22. Other parts of the same package contradict this. continuity-review.md:9 says to record a typed edit or regeneration note for a close-up, but edit_field allows only narration, imagePrompt and motion (tools.ts:101), so framing still cannot be changed. plan-authoring example.md:48 says to update the shot intent and prepare a replacement source, which is the prepare/apply route that notes.md forbids. The server does not enforce the boundary, so a Director that applies directly succeeds while breaking its own guidance. A Director that follows notes.md either refuses or offers only prompt edits, leaving framing out of step with the prompts, which shot_plan.md explicitly forbids. The guidance really is self-contradictory. Minor (Director behaviour, no direct money or data loss).


### director-proposal-floor-unchecked [minor → minor] confirmed

**A duration proposal below accepted within-shot narration is held and offered to the person but can never be accepted**

- File: `apps/server/src/application/service.ts:583`
- Scenario: 1. Shot 1.1 has a within_shot accepted cue of 200 frames and desiredFrames 240.
2. The Director calls propose_change with desiredFrames 120.
3. The proposal is stored as 'held', and the banner offers "Make 1.1 4 s".
4. Every accept fails with SHOT_SHORTER_THAN_NARRATION, and the proposal stays held. Through the holds finding above, it also keeps the request's holds.

Reproduced in /private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad/floor.test.mjs. Output: state held, accept error SHOT_SHORTER_THAN_NARRATION, still held.
- Evidence: - service.ts:583-590: validateHeldCreativePatch runs assertNoHumanFieldConflict, checkFootprint and validateStageRequirements only.
- service.ts:684: publishPreparedChange calls `assertAcceptedNarrationDurationFloor(prepared.next)`, implemented in publication-validation.ts:5-12.
- Fix: Call assertAcceptedNarrationDurationFloor(next) in validateHeldCreativePatch, so propose_change refuses such a patch in the Director's own turn. Also apply it in view(), so a proposal that has become unpublishable is shown as stale.
- Verifier: I re-ran the repro: the proposal is held with afterSeconds 4, accept throws SHOT_SHORTER_THAN_NARRATION, and the proposal is still held. validateHeldCreativePatch (service.ts:583-590) checks human field conflicts, footprint and stage requirements only. assertAcceptedNarrationDurationFloor runs only in publishPreparedChange (service.ts:684) and storyboard.ts:491. view() computes held or stale from revisions alone, so the banner keeps the 'Make 1.1 4 s' choice enabled. The impact is limited. The web maps the error to a clear message ('The shot would be shorter than its narration. Make it longer or cut the line.', errors.ts:26), nothing is charged, and the person can Keep or Let go. Side effect: through the previous finding, the never-acceptable proposal also keeps the request's holds. Minor.


### director-note-cross-scene-regenerate [minor → minor] confirmed

**record_notes accepts a multi-scene shot anchor with a priced regenerate choice that the scene route always refuses**

- File: `apps/server/src/application/director-notes.ts:53`
- Scenario: 1. The Director, in a project-scope request, records a note with anchor {shotIds:['1.1','2.1']} and choice regenerate_keyframe for both shots. It is accepted.
2. The web shows the note in scene 1 with "Regenerate 1.1, 2.1 · <price for both>".
3. Pressing it calls makeKeyframes(scene-1, ['1.1','2.1'], true).
4. generateScene refuses with SCOPE_DENIED "Choose shots belonging to this scene" every time.

The priced action is shown with a price for both shots but can never run.

The acceptance of the note is reproduced in /private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad/floor.test.mjs (second test). The refusal is read from code.
- Evidence: - director-notes.ts:53 checks each shotId only against `!anchor.sceneId || s.sceneId === anchor.sceneId`, so there is no single-scene rule without a sceneId; line 64 only requires regenerate ids to be within the anchor.
- note-command.ts:29-30 calls `store.makeKeyframes(overview.shots[first]?.sceneId ?? "", action.shotIds, true)`.
- scene-generation.ts:280-287: `input.targetShotIds.every(id => captured.view.rows.some(row => row.shotId === id))` else SCOPE_DENIED.
- Fix: Require the shots of a regenerate_keyframe choice (or of the whole anchor) to share one scene in recordNotes, or split the press per scene in runNoteRegeneration and price it the same way.
- Verifier: I re-ran the second repro test, and record_notes accepts anchor shotIds from scene-0 and scene-1 in a project-scope request. director-notes.ts:53 only requires shots to match anchor.sceneId when one is given, and line 64 only checks that regenerate ids are inside the anchor. The web prices both shots (keyframeEstimate sums every shot, price.ts:31-46). runNoteRegeneration sends makeKeyframes(sceneOf(first), both ids, true) (note-command.ts:29-30), keyframesBody passes targetShotIds unchanged, and scene-generation.ts:280-287 refuses ids outside that scene's rows (rows filtered by sceneId at scene-generation.ts:111-112) with SCOPE_DENIED. The press always fails before any spend, with the message 'That shot is not in this scene.' (errors.ts:51), and the note can still be kept or answered. It is a priced button that can never work, but no money or data is lost, and it needs a project-scope request plus a cross-scene note. Minor (bordering on polish).


## keyframes — Keyframe generation (paid path 1)

### Map

Keyframe press, end to end (paths relative to the worktree):

WEB
- apps/web/src/next/keyframes/KeyframesView.tsx wires two buttons. The panel's "Make N keyframes" calls store.makeKeyframes(sceneId). The Inspector's Regenerate / Make again / Make keyframe, and a Director note's regenerate (model/note-command.ts runNoteRegeneration), call store.regenerateKeyframe(shotId), which is makeKeyframes(scene, [shot], true).
- model/keyframes.ts videoPanel() decides between unknown wait, making keyframes, waiting, video saved, held, making video, makeKeyframes() and confirm. The price comes from scene.quotes.makeKeyframes; for regenerate it comes from model/price.ts keyframeEstimate(), which sums the per-shot quotes.regenerateKeyframe.
- model/keyframes-press.ts keyframesPress() builds the pressId ("keyframes:<scene>" or "regenerate:<shots>") and a logical identity: targets plus each target's keyframeJob (base slot state, attemptId, failure time, artifact, takenOff, voice state).
- store/store.ts makeKeyframes() works out the expected estimate, then calls #press(). #press reuses the saved key and body when the logical identity matches (PressKeys, store/press-keys.ts). Otherwise it calls build(): GET /scenes/:id/generation, check head and revision against the overview, then model/commands.ts keyframesBody() plus expectedEstimateMicros. It POSTs with an Idempotency-Key. A 4xx response clears the saved key; a timeout or 5xx keeps it, and the UI shows "Not confirmed. Press again to check" (lostReplyHolds, Inspector lostRegen).

SERVER ROUTE (apps/server/src/scene-generation.ts generateScene)
1. Replay by key (store.commandReplay / store.command, persistence/store.ts:805-821).
2. sceneView() and scene-row.ts sceneRow() / generationTargets() produce the rows.
3. fresh(): head, revision, hold digest, control authority, the expected human request (application/expected-human-request.ts), the row digest, paused, busy, and pending or SUBMISSION_UNKNOWN rows.
4. The quote (generation-quotes.ts) is compared with expectedEstimateMicros (ESTIMATE_CHANGED); then assertNoDetachedJobs.
5. A voice-only branch hands work to enqueueVoice (scene-confirmations.ts enqueueKeyframes); otherwise composeScenePlanIsolated runs, then fresh() again.
6. Inside one transaction: fresh() again; holds are narrowed; beginRequest and authorize (one-use grants); for regenerate, the image binding is detached and service.applyCompiledSceneGeneration runs (installPlan mints candidates from the grants; video nodes are deferred); the previous take is restored as a display-only retainedTake; a scene_generation_action is recorded; voice lines are enqueued.

OVERVIEW
generation-overview.ts GenerationOverviewReader.read() builds MediaSlot via slot(). It covers the replacement or progress state, no_answer for submission_unknown, the per-shot and per-scene quotes, and keyframeTargets and videoTargets.

ENGINE (execution/engine.ts)
- runReady → admit(): candidate, no prior non-failed attempt, held(), intent, profile pin, capacity, externalAdmission.authorize (media-execution-runtime / durable-external-admission ConfiguredExternalAdmission), reservation.
- runReady → observeProvider (lease renewal) → provider.submit → handle(): evidence; completed → ingest → attach outputs plus outdateImageDependents when there was a retainedTake; failed or rejected → reservation charged or released; unknown → submission_unknown.
- reconcile → claim (submitting becomes submission_unknown) → lookup or poll.
- retry-eligibility automaticRetriesLeft; detachUnsent on Stop; releaseAttempt.

CODEX ADAPTER
- execution/codex-image-execution.ts submit(): assertCodexImageFirstDispatch (codex-image-authority.ts, which also runs assertCodexImageCurrentSelection: hold, pause, prompt) → prepareInputs → transport.prepare → mapping transaction → dispatch-marker transaction → transport.start → observe/saveResult (codex-image-receipts.ts / codex-image-lineage.ts) → recover().
- notDispatched() records a no-start proof, but only while the same fence still passes.
- packages/director/src/media/codex-image.ts CodexImageWorkerTransport: prepare holds one app-server, start runs one turn with a 180 s bound and interrupts on error, lookup reads the thread history.

TAKES AND UNDO
shot-takes.ts useShotTake (refuses the current take), keyframe-take-history.ts, storyboard-history.ts restoreMediaUndo (reattaches only exact verified outputs and never revives retry authority).

Scratch checks (scripts under the session scratchpad, kf/ folder): regen-fail.test.mjs, codex-fence.test.mjs, panel.mjs and press.mjs, run against the repo's built dist. The repository was not modified.


### keyframes-retained-take-blocks-video [major → major] confirmed

**A same-spec keyframe replacement that fails, is stopped or is released leaves the shot showing a frame that video can never use**

- File: `apps/server/src/scene-generation.ts:573`
- Scenario: Shot 1.1 has keyframe T1 and no clip yet. The person presses Regenerate. Then one of three things happens: (a) the replacement fails (Codex or provider failure, no retries left); (b) the person presses Stop while the replacement is still queued, for example behind another Codex keyframe, since capacity is 1; or (c) the person releases a no-answer replacement.

Afterwards the overview shows 1.1 as an ordinary ready frame T1. In case (b) nothing at all needs attention. The video panel offers 'Confirm frames & generate video' with its price. The person opens T1 and confirms: the server accepts (200), buys any missing voice lines, then stops at the video step with SCENE_REVIEW_STALE ('Published video inputs differ from the reviewed scene'). The UI says 'The scene changed after you confirmed… open the current frames, then confirm again', and every retry ends the same way. 'Use take' on T1 is refused with ALREADY_COMPLETE ('This keyframe is already current').

The only ways out are another paid Regenerate that succeeds, a prompt edit, or the non-obvious use-older-take-then-Undo. I reproduced this with the real engine: the failed-replacement case and the Stop-before-admission case both give POST /generate kind=video → 409 SCENE_REVIEW_STALE, and the confirm ends 'blocked'.
- Evidence: - scene-generation.ts:573-577 detaches the image binding to {candidateId:null, outputs:{}}. Lines 598-600 keep the old take only as `retainedTake`, which is display-only ('Never execution input', engine.ts:45).
- engine.ts:459 outputs() publishes `binding.retainedTake?.outputs ?? binding.outputs`, so sceneRow (scene-row.ts:42-46, 102) reports imageComplete=true with image=T1. The overview slot (generation-overview.ts:95-99, 137) reports state 'ready'.
- Execution and review resolve the frame from `binding!.outputs[source.port]` (engine.ts:862-863), which is empty, so they throw INPUT_PENDING. calculateReview marks the member not ready, and scene-generation.ts:620-647 throws SCENE_REVIEW_STALE.
- Nothing restores outputs when a replacement ends without output:
  - handle() failed path (engine.ts:1178-1186) leaves the binding as it is.
  - detachUnsent (engine.ts:391) writes `{...binding, candidateId:null, outdatedReason:'stopped'}` and keeps retainedTake.
  - releaseAttempt (engine.ts:416) also keeps retainedTake.
- shot-takes.ts:21 and :38 treat T1 as current and refuse to switch to it.
- Fix: When a replacement candidate ends without output, put the retained take back as the binding's real selection (outputs = retainedTake.outputs, candidateId = retainedTake.candidateId) and drop retainedTake. 'Ends without output' means: a terminal failure with no automatic retries left, Stop detaching a queued replacement, or a human release.

Do this in handle() (failed or rejected, retries exhausted), in detachUnsent and in releaseAttempt. Alternatively, have sceneRow/outputs() report imageComplete=false while the binding's own outputs are empty, so the UI never offers a confirm that cannot publish.
- Verifier: I reproduced all three cases with the real engine and the confirmation fixture (throwaway test at /private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad/kf/retained.test.mjs). Setup: one shot, narration none, keyframe T1 made and opened, no clip.

(a) Replacement fails with no retries left:
- The overview shows keyframe 'ready' with replacement 'failed'. The scene reads needs_attention, but blockers=[], so the panel enables Confirm.
- POST /confirm returns 200. The confirmation then ends 'blocked' with SCENE_REVIEW_STALE.
- Using take T1 returns 409 ALREADY_COMPLETE.
- The binding is {candidateId:C2, outputs:{}, retainedTake}.

(b) Regenerate, then Stop before admission:
- detachUnsent (engine.ts:391) keeps retainedTake. The binding becomes {candidateId:null, outputs:{}, outdatedReason:'stopped'}.
- After Continue the blockers are [] and the scene reads keyframes_back. Confirm gives the same blocked SCENE_REVIEW_STALE.

(c) Release of a no-answer replacement (engine.ts:416): the confirm is also blocked with SCENE_REVIEW_STALE.

Root cause:
- engine.outputs() (engine.ts:459) publishes retainedTake, so sceneRow.imageComplete is true (scene-row.ts:42-46, 102). imagePending is false once the candidate's last attempt failed (scene-row.ts:168), or once the candidate is null.
- The video node's frame source resolves binding.outputs[port] (engine.ts:862-863), which is empty. calculateReview marks the member not ready, so scene-generation.ts:620-647 throws.
- Nothing restores outputs on failure, stop or release. The existing test 'failed regeneration retains current frame and clip' (takes-undo.test.mjs) only covers an already-completed clip, so it never runs a new confirm.

Ways out: another regenerate that succeeds, a storyboard edit (storyboard.ts:478 strips retainedTake), or in case (c) the late result arriving as a new take.

This leaves the person in a loop: a 'scene changed' message on every confirm while the UI shows a ready, usable frame. No direct money is lost, though the confirm chain may buy voice lines first. Major.

FLOW MAP (keyframe paid path), for the lead:
- Web: KeyframesView/Inspector, then keyframesPress (keyframes-press.ts) and store.#press, which saves the Idempotency-Key and body (press-keys.ts). It sends POST /scenes/:id/generate with kind=image (targetShotIds and regenerate for a Regenerate).
- Server, scene-generation.ts generateScene:
  - commandReplay first; then sceneView/sceneRow capture.
  - fresh() checks the head/revision/hold/control digests, busy, paused and ATTEMPT_EXISTS.
  - generationTargets picks targets; quote() checks expectedEstimateMicros; assertNoDetachedJobs.
  - If only voice lines are missing, it takes the voice-only branch (enqueueVoice). Otherwise composeScenePlanIsolated, then store.transaction{command{ fresh; narrow holds; beginRequest+authorize (grant); for regenerate, detach the image binding (candidateId null, outputs {}); applyCompiledSceneGeneration → engine.installPlan (a new candidate per grant); retainedTake bookkeeping; scene_generation_action; enqueueVoice }}.
- Engine:
  - runReady takes bindings with empty outputs and calls admit, which checks candidate_stop, held, intent, retry and capacity (maxConcurrency, installation-wide), writes the attempt and reservation 'reserved', then calls provider.submit via observeProvider.
  - handle() maps the outcome: accepted → remote_pending; unknown → submission_unknown; failed → failed, reservation charged; rejected → failed, reservation released; completed → ingestOutputs, then succeeded and bindingWithOutputs (with outdateImageDependents when a retainedTake exists).
  - reconcile() claims each non-terminal attempt and runs lookup/poll.
- Codex adapter (codex-image-execution.ts submit):
  - Runs resolveCodexImageAdmission and assertCodexImageFirstDispatch (lease, pause, holds, selection), then prepareInputs and transport.prepare (spawns the app-server and creates the thread).
  - The mapping transaction re-checks the fence. The claim transaction inserts the dispatch marker, then calls transport.start.
  - observe() saves the result; recover() maps the saved result to an engine outcome.
- Read side:
  - generation-overview.ts slot()/progress() builds the MediaSlot, with a replacement when retainedTake is current, and the blockers.
  - Web videoPanel/makeKeyframes (keyframes.ts) and the inspector regenerateAction turn these into buttons, prices and notes.
- Take switching: shot-takes.ts useShotTake.


### keyframes-codex-known-failure-reported-unknown [major → major] confirmed

**A Codex image turn that definitely failed is reported as 'no answer' for good: it blocks the scene and asks for a double-charge acknowledgement**

- File: `apps/server/src/execution/codex-image-execution.ts:135`
- Scenario: A keyframe's Codex turn starts and then ends without an image:
- the plan's image usage limit is hit (failure.type usageLimitExceeded → USAGE_LIMIT);
- the image tool fails, for example a content refusal (IMAGE_FAILED);
- the turn runs past the worker's 180 s bound, and the worker itself sends turn/interrupt (TURN_FAILED on lookup);
- or the turn completes with no image item (the CODEX_IMAGE_COMPLETION_MISSING throw).

The outcome is known. Yet the attempt becomes submission_unknown and stays that way across reconciles. The card says 'No answer from the service'. The scene says 'The work may still arrive and be charged'. Make keyframes, Regenerate and Confirm are blocked for the scene (no_answer_in_scene). The person can only go on by releasing the attempt with acknowledgeDoubleCharge=true, although no second job can ever land.

I reproduced this with the real engine and a transport whose start returns {kind:'failed',code:'USAGE_LIMIT'}: after runReady and three reconciles the attempt is still phase submission_unknown, with result.observation = failed/USAGE_LIMIT. The existing test codex-image-execution.test.mjs:104-108 asserts the 'unknown' mapping.
- Evidence: - codex-image-execution.ts:135 `if(value?.kind==='failed')return unknown();`
- codex-image-execution.ts:146 returns unknown without a lookup once a failed result is saved.
- packages/director/src/media/codex-image.ts:233-236 maps the failures above to kind 'failed'; :237-239 throws for a completed turn without an image, which start (:334-336) and lookup (:360-361) turn into unknown; :280 and :336 apply the 180 s deadline and the interrupt.
- engine.ts:1178 maps unknown to phase 'submission_unknown'.
- generation-overview.ts:102 shows it as no_answer, and :159 adds a no_answer_in_scene blocker.
- Copy: i18n/catalog/keyframes.ts:27 and :64.
- engine.ts:408 releaseAttempt requires acknowledgeDoubleCharge.
- Fix: Report a terminal native failure (failed observation, or a completed or interrupted turn with no usable image) to the engine as a definite failure: phase failed, technical:false, retryAllowed:false, reservation 'charged' (usage was consumed). It must not be unknown.

This needs a failed outcome shape that does not require a vendor taskId for codex-image, or the turnId used as the task id with the taskId===null receipt invariant relaxed for that case. Keep 'unknown' only when there is no saved native evidence.
- Verifier: Reproduced with the real engine via codexImageFixture, with a transport whose start returns {kind:'failed', code:'USAGE_LIMIT'}. After runReady and three reconcile/runReady cycles:
- the attempt is still submission_unknown, with reservation 'reserved';
- codex_image_execution_result is failed:USAGE_LIMIT;
- there was 1 start and 0 lookups.
This comes from codex-image-execution.ts:135 (`value?.kind==='failed'` → unknown) and :146 (no lookup once a failed result is saved), mapped to submission_unknown at engine.ts:1178.

The mapping is deliberate: the comment at :134 and the test codex-image-execution.test.mjs:104-108 exist to avoid reading a consumed turn as a pre-start 'rejected' (which would release the reservation). The cost of that choice is still real:
- The UI shows 'No answer from the service… may still arrive and be charged' (keyframes.ts catalog :27, :64). That is false for a known terminal turn.
- The scene gets no_answer_in_scene (generation-overview.ts:159). Release requires acknowledgeDoubleCharge (engine.ts:408).
- The codex-image profile is forced to maxConcurrency=1 (codex-image-receipts.ts:43). A non-terminal submission_unknown attempt counts against capacity in admit() (`!released && !TERMINAL`). I confirmed that a second film's Codex keyframe is then refused with CAPACITY_EXCEEDED. So one usage-limit hit or content refusal stops every Codex keyframe in the installation until the person releases it by hand.

Other paths behave the same:
- Timeout: the worker interrupts at 180 s; a later lookup reads the turn as 'interrupted', saves failed TURN_FAILED, and the attempt stays unknown for good.
- A completed turn with no image throws CODEX_IMAGE_COMPLETION_MISSING. It stays unknown, and every reconcile spawns a fresh native lookup.

The fix needs a contract change for a failed outcome without a vendor taskId. The defect stands.


### keyframes-codex-prepare-fence-unknown [major → major] confirmed

**Stop, a prompt edit or a Director message while a Codex keyframe is being prepared leaves the keyframe 'no answer' for good, though nothing was started**

- File: `apps/server/src/execution/codex-image-execution.ts:123`
- Scenario: A Codex keyframe has been admitted and the worker is in native preparation. Preparation spawns the Codex app-server, then runs initialize, account/config/capability reads and thread/start, which takes seconds for every keyframe. During that window the person does one of these:
- presses Stop;
- edits that shot's picture prompt;
- sends any Director message (the messages route defaults to editing:true, so beginRequest puts a hold on the whole film or the scene).

When the mapping transaction re-checks the fence it throws. notDispatched() then re-runs the same fence, which fails again, so it records nothing and returns unknown. The attempt becomes submission_unknown. reconcile → recover() returns unknown for good, because there is no dispatch marker, even after the hold is released or the film continues.

The UI shows 'No answer… may still arrive and be charged', blocks the scene, and asks for a double-charge release. The dispatch marker is committed before turn/start (lines 63-68), so its absence proves no turn ran. I reproduced this with the real engine for pause, prompt edit and a Director message: 0 starts, 0 dispatch markers, attempt still submission_unknown after reconcile and runReady. The existing test codex-image-execution.test.mjs:75-84 asserts 'unknown'.

The same happens when the claim transaction fails (line 69), and after a crash or quit between admission and the marker (recover line 146 returns unknown when `!records.dispatch`).
- Evidence: - codex-image-execution.ts:53-61: the mapping transaction calls assertCodexImageFirstDispatch; its catch calls notDispatched.
- :120-127 notDispatched: `try{assertCodexImageFirstDispatch(...)}catch{return;}`, so the result is not saved when selection, pause or hold changed even though the lease is still owned.
- :69 claim failure → `return unknown()`.
- :146 `if(!allowNative||!records.mapping||!records.dispatch||...)return unknown();`
- codex-image-authority.ts:132-159 assertCodexImageCurrentSelection fails on pause, prompt change or any active hold on the project, scene or shot.
- application/service.ts:178 beginRequest sets holds for editing requests; app.ts:235 makes editing default to true.
- engine.ts:1178 maps unknown to submission_unknown; generation-overview.ts:102 shows it as no_answer.
- Fix: Separate 'lease lost' from 'selection, pause or hold changed'.
- While this worker still owns the unexpired submitting lease and no dispatch marker exists, record a not_dispatched result (for example LOCAL_CANCELLED or a new SELECTION_CHANGED code), even though the selection fence now fails. The engine then marks the attempt rejected, not charged.
- In recover(), when an attempt has no dispatch marker and is being reconciled by a new lease owner, record the same provable no-start, because the marker always precedes turn/start.
- Do the same for the claim-transaction failure at line 69.
- Verifier: Reproduced with the real engine (codexImageFixture). The transport's prepare() sets execution_control.paused=true, the way Stop does. After runReady, the attempt is submission_unknown with 0 starts, 0 dispatch markers and 0 results. After un-pausing, expiring the lease and running three reconcile/runReady cycles, it is still submission_unknown with reservation 'reserved'.

Code path:
- The mapping transaction (codex-image-execution.ts:53-54) re-runs assertCodexImageFirstDispatch, which includes assertCodexImageCurrentSelection: paused at codex-image-authority.ts:151, active holds at :158, prompt or selection at :134-140. It throws.
- notDispatched (:120-123) re-runs the same fence, swallows the failure and saves nothing. It then calls recover(…, allowNative=false), which returns unknown.
- Later, recover() returns unknown whenever there is no dispatch marker (:146).
- The claim-transaction failure (:69) also returns unknown directly.

The existing test codex-image-execution.test.mjs:75-84 asserts this 'unknown' for the pause, hold and shot modes, so the behaviour is intended to be conservative. That caution is only needed in the lease-lost mode. For pause, hold or prompt edit with the lease still owned, the missing marker proves no turn started: the marker is committed before transport.start. A new lease owner also fences out the old one, because the marker transaction checks the lease.

Triggers are ordinary actions: Stop (control → setPaused); a prompt edit; any Director message, since app.ts:235 defaults editing:true and beginRequest then sets holds (service.ts:178). The native preparation window lasts seconds.

Consequences are the same as the previous finding: a false 'may still arrive and be charged', a scene blocker, release only with a double-charge acknowledgement, and installation-wide Codex capacity occupied (maxConcurrency=1; verified CAPACITY_EXCEEDED for another film). Major.


### keyframes-voice-only-make-keyframes-label [minor → minor] confirmed

**Missing voice lines show as 'Make N keyframes' at a per-keyframe price, in place of Confirm**

- File: `apps/web/src/next/model/keyframes.ts:471`
- Scenario: A scene's keyframes are all ready and opened, but some shots have generated narration whose voice line is not ready (for example, the narration text was edited after the keyframes were made). keyframeTargets still contains those shots, so the panel shows 'Make 2 keyframes · about $0.03 (2 keyframes at about $0.02)' with the note 'Make keyframes to see the shots', and it hides Confirm.

Pressing it makes no keyframe. The server takes its voice-only branch and buys 2 voice lines; the '2 keyframes at…' breakdown is really 2 speech units. I confirmed this with videoPanel() on such an overview: action make_keyframes, label panel.make_keyframes {count:2}, priceEach panel.each.keyframes {count:2}.
- Evidence: - scene-row.ts:185 generationTargets(image) includes rows with `narration.mode==='generated' && !ready` even when imageComplete.
- generation-overview.ts:178 builds keyframeTargets from it.
- generation-quotes.ts:25-29: makeKeyframes adds only speech units for such rows.
- keyframes.ts:471-472: makeKeyframes is chosen before the confirm branch; :512 counts the label from keyframeTargets.length; :386 builds the breakdown with `panel.each.keyframes`.
- scene-generation.ts:407-417: the voice-only branch.
- Fix: Have the panel count only the shots that need a keyframe (keyframe not ready) for the label and the 'each' line. When only voice lines are missing, use a voice-line label and price (scene.quotes.voice), or let Confirm proceed, since the confirm chain already makes missing voice lines.
- Verifier: Server side, verified with the confirmation fixture: shots generated + none, keyframes and voice lines made. Then a storyboard edit {kind:'narration', field:'text'} on shot-0. The overview then has keyframeTargets ['shot-0'] while its keyframe is 'ready', and quotes.makeKeyframes is {micros:'100', units:1}: the speech unit only (generation-quotes.ts:25-29; scene-row.ts:185 includes generated, not-ready narration even when imageComplete). Narration does not affect the image intent (shotIntentDigest, planning/index.ts:84-86), so the keyframe really is current.

Web side, run with videoPanel on the last-ferry fixture with all frames opened and two voice-only targets:
- action make_keyframes, label 'Make 2 keyframes';
- price 'about $0.03', with the breakdown '2 keyframes at about $0.02';
- note 'The prompts are written. Make keyframes to see the shots.'
The makeKeyframes branch (keyframes.ts:471) comes before the confirm branch, so Confirm is hidden.

Pressing it reaches the server's voice-only branch (scene-generation.ts:407-417) and buys speech. The total price is correct, but it is described as keyframes, and the note is false. No double charge, and after the voice lines are made Confirm comes back. Minor.


### keyframes-regenerate-identity-ignores-replacement [minor → minor] confirmed

**The regenerate press identity ignores the replacement take, so after a lost reply the next Regenerate only replays the old request**

- File: `apps/web/src/next/model/keyframes-press.ts:19`
- Scenario: The person presses Regenerate on a ready keyframe. The server applies it, but the reply is lost (timeout or 5xx), so key K1 stays saved. The replacement then runs and fails.

The slot is 'ready' with replacement 'failed'. keyframeJob() reads only the base slot (state ready, same artifact, no attemptId or failure), so the logical identity equals the one saved with K1. The Inspector keeps showing 'Not confirmed. Press again to check; it will not charge twice' (lostRegen) next to the failed take.

Pressing Regenerate resends K1. The server replays the old receipt, no new take is made and no message explains why; only a third press starts the new take. This contradicts the module's own contract that once the film shows the job (made, failed…) pressing again is a new request. I checked keyframesPress(): the identity is equal for a ready slot before regeneration, with the replacement running, and with it failed.
- Evidence: - keyframes-press.ts:19-31 keyframeJob reads slot.state, slot.attemptId, slot.failure and slot.artifact, never slot.replacement.
- generation-overview.ts:95-98 progress() puts attemptId and failure only under `replacement` for a ready slot.
- store.ts:224-225 resends the saved body when the logical identity matches.
- KeyframesView.tsx:249 and Inspector.tsx:112-113 show error.PAID_UNCONFIRMED while that holds.
- Fix: Include the replacement in keyframeJob: replacement state, attemptId and failure.at. A running or failed replacement then proves the request landed, which clears the lost-reply notice and makes the next press a new request.
- Verifier: keyframeJob (keyframes-press.ts:19-31) reads state, attemptId, failure.at, artifactId, takenOff and voice. For a ready slot that has a replacement, progress() (generation-overview.ts:95-98) puts attemptId and failure only under `replacement`, and base carries takenOff only when the candidate is null. So the logical identity is the same for:
- the ready slot before Regenerate;
- the replacement queued or running;
- the replacement failed.

PressKeys.begin and store.#press (store.ts:226) resend the saved body and key whenever the logical JSON matches. The key is settled only on a 2xx or 4xx answer (store.ts:63, :234). After a lost reply (timeout or 5xx) on an applied Regenerate whose replacement then fails, the inspector's regenerateAction is enabled ('ready' case, inspector.ts:167). lostRegen (Inspector.tsx:112) therefore shows 'Not confirmed. Press again to check; it will not charge twice' next to the failed take.

The next press replays K1: generateScene returns commandReplay before any checks (scene-generation.ts:267-268). No new take is made, and only a further press starts one. This contradicts the module's own contract (keyframes-press.ts:8-11). It never causes an extra charge, and it needs a lost reply first, so the impact is a wasted press and a misleading note. Minor.


## video — Frame confirmation and video generation (paid path 2)

### Map

Web: model/keyframes.ts videoPanel() builds the Confirm panel from the GenerationOverview: blockers, quotes.confirmVideo, the confirmation, and confirmationStop(). Pressing calls store.confirmVideo (store/store.ts:307), which uses confirmPress (keyframes-press.ts:43) and confirmBody (model/commands.ts:71) and POSTs /scenes/:id/confirm with confirmationDigest, reviewedFrames and expectedEstimateMicros. Opened frames come from the frame-views POST (generation-overview.ts:54).

Server confirm: SceneConfirmationRunner.confirm (scene-confirmations.ts:90) runs under store.command for idempotency. It rebuilds sceneView/sceneGenerationView (scene-generation.ts:44,164) and requires a matching confirmationDigest. Every video target must be current, have no pending work, and have an exact frame with a frame_view receipt. It checks the estimate with quote() (generation-quotes.ts) and refuses while a voice job for these shots is in flight. It then calls beginRequest(alongside), authorizes the video grants (service.ts:276) and sets a scene hold. Finally it saves a scene_confirmation row holding sceneIntentDigest, guardDigest (scene-confirmation-state.ts:4) and framePins.

Runner: the index.ts tick runs every 500 ms: engine.reconcile, then engine.runReady, then runner.advance. advanceOne (scene-confirmations.ts:147) first checks command replay, then fresh() (state, pause, actor, sceneIntentDigest, frames read through the display rows). Each shot then goes through: session → speech (NarrationSpeechService.request) → attach (waits for the speech attempt) → accept (recomputes the guard). The video step saves videoInput once, then calls generateScene(..., {actor}) (scene-generation.ts:260). That re-runs the freshness checks (head, revision, hold digest, rows), awaits composeScenePlanIsolated (a worker), then in one transaction releases the scene holds, publishes applyCompiledSceneGeneration (service.ts:400) using the confirm's grants, and calls reviewSnapshot + approve.

Admission: engine.admit (engine.ts:909) checks candidate_stop and the confirmation (sceneConfirmationIdForCandidate in retry-eligibility.ts, then the guard and confirmationFramesCurrent). It then checks held(), intent, timing, the review gate and approval. Retries are allowed only by automaticRetriesLeft, which is 0 for confirmation-owned candidates. Last come capacity and the reservation at unitCostMicros.

Viggle (viggle-h3-execution.ts): submit checks first dispatch and current selection, including pause and holds (viggle-h3-authority.ts:176-222). It writes the mapping, then the dispatch marker, then POSTs, then saves the submit record. lookup and poll go through replay() and never resubmit. A completed poll records a protected_locator receipt and downloads through ProtectedVideoDownloader (video-download.ts: allowlisted HTTPS hosts, public IPv4 pinned). The bytes go to outputStore.spool and recoverCompletion, then to engine.handle → ingestOutputs → binding.

Reconcile (engine.ts:527): all non-terminal attempts run in parallel, released ones included. It claims lease-expired attempts (submitting becomes submission_unknown), runs recoverCompletion, then poll or lookup, then handle(). An unknown outcome becomes submission_unknown, shown as no_answer. releaseAttempt (engine.ts:405) only flags the attempt and detaches its binding.

Stop: service.control (service.ts:818) supersedes active requests. detachUnsent (engine.ts:364) writes candidate_stop, fails unsent preparing work, detaches bindings that have nothing in flight, and cancels running or blocked confirmations and their holds. Then it pauses. Continue unpauses.


### video-01 [blocker → blocker] confirmed

**Output-store writer limit makes reconcile mark accepted paid jobs 'no answer' and stop polling them**

- File: `apps/server/src/execution/engine.ts:565`
- Scenario: Reproduced with a throwaway test. Three accepted remote jobs are reconciled in one cycle: the first two hold the output store's two writer slots, the third's recoverCompletion throws OUTPUT_STORE_BUSY, and reconcile files that as an unknown outcome. The job goes remote_pending -> submission_unknown and stays there every cycle. A second test released two older attempts as unknown: released jobs stay non-terminal and keep reconciling forever, so they hold both slots and a newer accepted job was never polled in 5 cycles. Triggers in real use: one Viggle POST lost after its marker (a permanent unknown) plus two clips in flight, or a Viggle profile with maxConcurrency >= 3. The accepted clip shows 'No answer from the service', blocks the scene ('no_answer_in_scene'), and the Inspector offers 'give up' with a double-charge acknowledgement. Meanwhile the clip is never polled, so its vendor output can expire. The same conversion happens in Viggle poll's spool catch (viggle-h3-execution.ts:154). In speech submit (openai-speech-execution.ts:114) a busy spool drops the returned bytes after the vendor has charged; the attempt stays unknown for good and blocks a running confirmation at its attach step (scene-confirmations.ts:197).
- Evidence: output-store.ts:15 sets concurrentWriters: 2. output-store.ts:278-280 recoverCompletion runs invariant(active < OUTPUT_STORE_LIMITS.concurrentWriters, "OUTPUT_STORE_BUSY", ...) synchronously on entry. engine.ts:530-532 builds pending as every non-terminal attempt, released ones included, and runs them all through Promise.allSettled. engine.ts:565-569 wraps recoverCompletion as try { ... } catch { await this.handle(attempt, { type: "unknown", diagnostic: "Owned output recovery requires attention" }); ... }. engine.ts:1178 maps unknown to phase "submission_unknown". generation-overview.ts:102 turns submission_unknown into "no_answer". Test output: after reconcile ['remote_pending','remote_pending','submission_unknown']; with two released older jobs, 'NEW:submission_unknown', polls of newer accepted job 0.
- Fix: Treat OUTPUT_STORE_BUSY (and other local-capacity errors) from recoverCompletion as 'skip this attempt this cycle': restore its lease and leave phase and evidence unchanged. Do not send it to handle() as unknown. Do the same in the Viggle poll and speech submit spool paths. Better still, queue writers or serialize recovery rather than failing on the third. For speech, keep the returned bytes (for example, spool before releasing the in-memory buffer, or wait for a slot) so a busy store cannot destroy a paid result. Also consider leaving released attempts that have no task id out of per-cycle output recovery.
- Verifier: I traced it and reproduced it. Engine.reconcile (engine.ts:530-532) builds `pending` from every non-terminal attempt in every project, including released ones (no `released` filter, and claim() at :1143 doesn't skip them either). It then starts all of them inside one Promise.allSettled. For a non-local, non-preparing attempt, nothing awaits before withLease → recoverCompletion. recoverCompletion (output-store.ts:278-280) checks `active < concurrentWriters (2)` and increments the counter synchronously, then holds that slot across `await this.readJson(...)`. So the first two claimable spool-role attempts in rowid order always take both slots, and the third always rejects with OUTPUT_STORE_BUSY. The bare `catch` at engine.ts:567-568 turns that into handle(unknown) → submission_unknown (:1178), shown as no_answer (generation-overview.ts:102) with a no_answer_in_scene blocker (:159). The provider is never polled for that attempt. Throwaway test (fake provider, 3 accepted jobs, image maxConcurrency 3): every cycle gave ['remote_pending','remote_pending','submission_unknown'], and the third task's poll count stayed at 0.

How it happens with default settings (Viggle maxConcurrency 1): Codex image failures after dispatch are permanent `unknown` (codex-image-execution.ts:135, covered by a test). A Viggle POST lost after its marker is also permanent unknown (replay at :262). The person has to give up (release) such attempts to free capacity, but released attempts stay non-terminal and are reconciled forever. So once two of them come earlier in the reconcile order (same project, older rowid), every later accepted Viggle clip is starved permanently. It is shown as 'no answer' and offered the give-up / double-charge flow, while its vendor URL can expire. That is lost paid work plus a strong push to pay again.

The Viggle poll-spool catch (:154) is a weaker path that heals on the next poll. The speech sub-claim (openai-speech-execution.ts:110-114 drops in-memory bytes on a busy spool, so the outcome stays unknown for good) is real in code, but it needs three concurrent writers during runReady. Only with non-default concurrency is that likely.

Flow map, for the lead: confirm (scene-confirmations.ts:90) → advance/advanceOne (:122/:147): speech → attach → accept → generateScene(video) (scene-generation.ts:260) → applyCompiledSceneGeneration + approve → Engine.runReady → admit (engine.ts:909: confirmation guard, capacity, reservation) → provider.submit (Viggle submit: mapping → dispatch marker → POST) → handle → remote_pending → Engine.reconcile → recoverCompletion → provider.poll (viggle poll → recordReceipt → spool download → recoverCompletion) → handle(completed) → ingestOutputs (spool-video-ingester → resolveOutput) → artifact + binding outputs → overview (generation-overview.ts) / scene-row.ts.


### video-02 [major → major] confirmed

**After a confirm finishes, a harmless scene edit strands its queued clips as 'Queued · next' forever**

- File: `apps/server/src/execution/engine.ts:920`
- Scenario: Reproduced. A scene with three shots and no voice is confirmed and the confirmation reaches 'done'. Two clips are admitted and the third waits for capacity. The person renames the scene (sceneTitle) or edits another shot's image prompt. From then on, every admission of the third clip is refused with SCENE_REVIEW_STALE because the confirmation's guardDigest covers the scene record and every shot in the scene. That code is not a wait code, so the old CAPACITY_EXCEEDED node_wait stays. The overview shows the slot as 'Queued · next' with ahead 0, the scene state stays making_video with no blockers, and the panel says 'Making video… Keep working; nothing else is blocked.' Pressing Confirm again is refused ('Finish the current frames before confirming') because the stranded candidate still counts as videoPending. Only a film-wide Stop then Continue detaches it. The paid clip the person confirmed is silently never made, and the status claims it is about to run.
- Evidence: engine.ts:918-921: if (confirmation) invariant(["running","done"].includes(confirmation.state) && confirmation.guardDigest === sceneConfirmationGuard(project, ...) && confirmationFramesCurrent(...), "SCENE_REVIEW_STALE", ...). scene-confirmation-state.ts:5 hashes { scene: project.scenes.find(...) (title/revisionId), lock, shots: all shots of the scene }. storyboard.ts:136-140 makes a sceneTitle edit change row.title and row.revisionId. storyboard.ts:427ff leaves that edit with no affected bindings, so the candidate stays bound. engine.ts:99 and 511-513 make recordNodeWait return without writing for non-WAIT_CODES, so the stale capacity wait survives. generation-overview.ts:124-135 reports a bound candidate as queued with the stored wait. scene-row.ts:169-173 sets videoPending = reviewedVideo && candidatePending, and scene-confirmations.ts:102 refuses a new confirm on that. Test output: shot-2 {state:'queued', waiting:{code:'capacity', ahead:0}}, scene making_video, blockers [], re-confirm 409 SCENE_REVIEW_STALE.
- Fix: When admission refuses a candidate because its confirmation went stale, surface it terminally. For example, detach the binding (candidateId null, outdatedReason 'confirmation_stale') or write a visible wait code that generationTargets and the panel treat as needing a fresh confirm. Clear any stale node_wait when admission fails for a non-wait reason. Also narrow the guard to what actually conditions each clip (that shot's fields and pin, not the scene title or sibling shots) so harmless edits don't fence paid work that was already confirmed.
- Verifier: Reproduced with a throwaway test against confirmationFixture: 3 shots, no voice, fake video maxConcurrency 2, the first two clips held pending. Confirm returned 200 and the confirmation reached 'done'. runReady refused the third clip with CAPACITY_EXCEEDED, which wrote a node_wait. Then I made a sceneTitle edit (storyboard.ts:136-140 changes scene.title and scene.revisionId; the `affected` filter at :427ff selects nothing for sceneTitle, so the candidate stays bound) and completed the first two jobs.

After that, every runReady refused the third clip with SCENE_REVIEW_STALE. The cause is admit (engine.ts:918-921): grant.authorityId is the confirmation id (service.ts:287 + retry-eligibility.ts), and the check compares guardDigest against sceneConfirmationGuard, which hashes the whole scene record and all of its shots (scene-confirmation-state.ts:5). recordNodeWait skips codes that are not WAIT_CODES (:99, :513), so the stale capacity wait stays.

Observed: shot-2 {state:'queued', waiting:{code:'capacity', ahead:0}}, scene 'making_video', blockers [], video attempts only the two that succeeded. A re-confirm returned 409 SCENE_REVIEW_STALE 'Finish the current frames before confirming' (videoPending, from scene-row.ts:169-173). A per-shot keyframe regeneration is also refused (generateScene fresh() → ATTEMPT_EXISTS on videoPending). Editing another shot's prompt in the scene does the same thing.

No money is spent: the stranded clip was never admitted, so nothing was reserved. But a confirmed clip is silently never made, the status says it is next in the queue, and the way out (film-wide Stop/Continue) is undiscoverable. Major.


### video-03 [major → major] confirmed

**A keyframe whose regeneration failed passes Confirm, then the confirmation hangs forever or stops on every press**

- File: `apps/server/src/scene-confirmations.ts:102`
- Scenario: Reproduced. A shot's keyframe regeneration fails, as Codex image jobs sometimes do. The card keeps the old take as 'ready' with 'replacement failed'. The panel shows Confirm enabled, priced, with no blockers, and the server accepts the press (200). The confirmation pins that shot's frame to the image binding's outputs, which are empty because the old take lives in retainedTake. So every speech and video admission for the confirmation is refused with SCENE_REVIEW_STALE. The runner's fresh() reads the display rows, which include retainedTake, so it keeps passing. If the scene needs a voice line, the confirmation stays 'running' at the attach step indefinitely: nothing is admitted and nothing is bought, while the UI says 'Saving the voice line for 1.1; the clips follow.', blocks Confirm and Make keyframes with confirmation_running, and only Stop gets out. With no voice line, the video step fails at once with SCENE_REVIEW_STALE ('The scene changed after you confirmed…'), which is false, and every new press does the same. The scene can't get its clips until that keyframe is regenerated successfully, and the UI never says so. The same hang happens if a per-shot regeneration is pressed in the Inspector while a confirmation is running and that regeneration fails: the server does not fence it, and inspector.ts:148-176 enables it.
- Evidence: engine.ts:459 makes outputs() expose binding.retainedTake?.outputs ?? binding.outputs, so sceneRow (scene-row.ts:42-46) shows the retained frame. scene-row.ts:166-168 leaves imagePending false once the replacement attempt has failed. scene-confirmations.ts:102-106 then accepts the frame, and :114 pins nodeId: r.frameNodeId. scene-confirmation-state.ts:18-20 requires Object.values(binding.outputs).some(a => a.artifactId === pin.artifactId ...), which fails because outputs is {}. engine.ts:918-921 refuses admission. scene-confirmations.ts:194-198 at the attach step does attempt = attempts.at(-1); ... if (attempt?.phase !== "succeeded") return; and waits silently. Test output: confirmation running ["attach"], speech calls 0, runReady blocked SCENE_REVIEW_STALE. The no-voice run gave confirmation blocked {code:SCENE_REVIEW_STALE}.
- Fix: Make confirm, fresh() and admission agree on one frame identity. Either refuse confirm (with a specific reason) while a shot's frame is only a retained take whose replacement failed or is pending, or make confirmationFramesCurrent and the video composition accept the retained take. Have fresh() reuse confirmationFramesCurrent so a pin mismatch blocks the confirmation instead of hanging. Fence per-shot keyframe regeneration in a scene whose video confirmation is running, on the server (generateScene image path) and in the Inspector.
- Verifier: Reproduced with confirmationFixture. Shot-0's keyframe was regenerated with the fake provider set to technical_failure; the replacement attempts ended failed. The binding then had a candidate, outputs {} and a retainedTake. outputs() (engine.ts:459) shows the retained take, so the overview showed the keyframe 'ready' (same artifact) with replacement.state 'failed'. There were no blockers and a confirmationDigest was present.

Confirm returned 200, with a frame pin to the image node (scene-confirmations.ts:114). confirmationFramesCurrent then requires binding.outputs to contain the pin (scene-confirmation-state.ts:18-20), which fails because outputs is {}. So admit refuses with SCENE_REVIEW_STALE.

With a voice line, the confirmation stayed 'running' at ['attach'] with speech calls 0 and runReady blocked SCENE_REVIEW_STALE. The attach step returns silently when there is no attempt (:194-198). fresh() passes because view rows include the retained take. The overview kept the confirmation_running blocker. Without voice, the confirmation was blocked at once with SCENE_REVIEW_STALE and 0 video attempts, because the reviewSnapshot member is not ready since its output source is empty (scene-generation.ts:612-647).

With Codex keyframes, a failure after dispatch is `unknown`, which blocks Confirm through blockedCode until the person releases it. releaseAttempt (engine.ts:416) keeps retainedTake and clears candidateId, which leads to the same state. Failures before dispatch (not_dispatched → rejected → failed) go straight there.

The Inspector-path claim holds too. The confirm request message has editing:true (beginRequest default), so generateScene's hold-ownership check (scene-generation.ts:491-497) lets a per-shot regeneration through during a running confirmation. That releases the scene hold and detaches the pinned image.

Nothing is bought. But the person gets either a confirmation that hangs forever or a false 'scene changed' message, with no hint that the keyframe has to be regenerated successfully first. Major.


### video-04 [minor → minor] confirmed

**A finished Viggle clip whose download is refused or fails is shown as 'No answer', and the cause is lost**

- File: `apps/server/src/execution/viggle-h3-execution.ts:154`
- Scenario: Viggle reports completed with a video_url, but the host is not in OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS (for example the vendor moved to a new CDN domain), or the download fails. The download error, such as OUTPUT_DOWNLOAD_LOCATOR, is caught and replaced by unknown("H3 completed; owned video storage needs recovery"). The engine marks the attempt submission_unknown, and the card says 'No answer from the service' with the give-up / double-charge flow. With a host mismatch this repeats on every poll, so a paid, finished clip is reported as an unanswered submission. The real cause (the download host) appears nowhere the person can see, and giving up then confirming again pays twice and fails the same way.
- Evidence: viggle-h3-execution.ts:149-154 calls the downloader inside try { await this.#outputs.spool(..., this.#download.source(receipt), ...); ... } catch { result = unknown("H3 completed; owned video storage needs recovery", taskId); }. video-download.ts:77-79 throws OUTPUT_DOWNLOAD_LOCATOR for hosts outside the allowlist. engine.ts:1178 maps unknown to submission_unknown, and generation-overview.ts:102 maps that to state 'no_answer'.
- Fix: Keep a completed-but-not-stored task distinct from an unknown submission. Leave it remote_pending/ingesting and record an attempt_ingestion_issue (or similar) with the sanitized download code, so the UI says the clip is done but couldn't be downloaded (check download hosts) and does not offer give-up/double-charge.
- Verifier: In code: ProtectedVideoDownloader.source throws OUTPUT_DOWNLOAD_LOCATOR for a host outside the allowlist (video-download.ts:77-79). download() throws OUTPUT_DOWNLOAD_EXPIRED / OUTPUT_DOWNLOAD_ADDRESS. All of these are swallowed by the bare catch at viggle-h3-execution.ts:149-154 into unknown('H3 completed; owned video storage needs recovery', taskId). The sanitized code is not recorded anywhere (no attempt_ingestion_issue; recordIngestionIssue only runs on the engine's ingest path).

One correction to the scenario: the state does not sit at 'no answer'. On the next reconcile, poll → replay returns `accepted` during the poll cooldown (:124/:128, up to 15s), so handle moves the attempt back to remote_pending ('running'). After each failed re-download it flips to submission_unknown for one cycle. So the person mostly sees 'Making video' forever, with short 'no answer' windows in which give-up is offered.

Transient download errors heal (an existing test covers re-poll after a 400). A host mismatch or an expired locator never does, and the cause is invisible. It is a real false-state and lost-cause defect. It depends on config or vendor behaviour and no money moves automatically, so minor.


### video-05 [minor → minor] confirmed

**Runner's video step is fenced by film-wide headVersion, so any edit elsewhere blocks the confirmation with a false 'scene changed'**

- File: `apps/server/src/scene-confirmations.ts:157`
- Scenario: Reproduced by running a sync storyboard edit at the point where generateScene awaits its composition worker. The runner builds videoInput from the current head (headVersion, revisionId, hold digest), saves it once, then calls generateScene. generateScene awaits composeScenePlanIsolated in a worker and re-checks now.headVersion === input.headVersion inside its transaction. headVersion is project-wide, so if the person renames or edits another scene in that window (the panel says 'Keep working; nothing else is blocked'), the confirmation becomes blocked with SCENE_REVIEW_STALE. That happens after its voice lines were bought, and the person is told 'The scene changed after you confirmed: its frames or plan are not the ones you opened.', which is false. Because videoInput is saved, a crash after it is written also replays the stale head after restart. Another scene's confirmation accepting narration earlier in the same advance() pass then blocks this one too.
- Evidence: scene-confirmations.ts:156-161: if (!row.videoInput) { row.videoInput = { headVersion: view.headVersion, revisionId: view.revisionId, ... }; this.save(row); } then await generateScene(...). scene-generation.ts:296-304 checks now.headVersion === input.headVersion && now.revisionId === input.revisionId ..., and :444-470 does await composeScenePlanIsolated(...); fresh(); store.transaction(... fresh() ...). The runner's own fence is sceneIntentDigest plus frames (scene-confirmations.ts:144), so film-wide head equality protects nothing here. Test output: confirmation blocked {code:SCENE_REVIEW_STALE}, video attempts 0, after an unrelated sceneTitle edit to another scene.
- Fix: For the durable runner, rely on the confirmation's scene-scoped fences (sceneIntentDigest, frame pins, guard). Recompute head/revision/hold tokens inside generateScene's transaction when called with options.actor, or retry the video step once with refreshed tokens when only out-of-scene state moved. Do not persist head tokens across restarts.
- Verifier: Reproduced. With a second scene added, I confirmed scene-0 (no voice), started runner.advance(), and while generateScene was awaiting composeScenePlanIsolated I sent a sceneTitle edit to the other scene (200). The confirmation ended blocked {code:'SCENE_REVIEW_STALE'} with 0 video attempts.

Cause: videoInput pins the film-wide headVersion and revisionId (scene-confirmations.ts:156-160), and generateScene's fresh() requires an exact match after the await (scene-generation.ts:296-304, :466, :470). The runner's own scene-scoped fence (sceneIntentDigest + frames, :144) would have accepted the edit.

One sub-claim is wrong. 'Another scene's confirmation accepting narration earlier in the same advance() pass' cannot block this one, because videoInput is built inside this row's own advanceOne after the earlier rows' steps finished. That only happens if videoInput survived a crash. The restart replay of a stale head is real but needs a head change between the save and the restart.

Impact: a false 'scene changed' blocker and a lost press. No money is lost: voice lines already accepted count as ready, so a re-confirm does not buy them again. The window is the worker compose time, and edits by the person or the Director to other scenes are encouraged during it. Minor.


## narration — Narration within the flow

### Map

How narration moves through the flow (server is apps/server/src, web is apps/web/src/next):

1. Editing intent. storyboard.ts editStoryboard (kind "narration": mode, text, voice). A real change sets narrationPending, deletes narrationFit, and on "none" clears cueId. It detaches the timeline and render bindings. Shortening a shot is fenced by publication-validation.ts assertAcceptedNarrationDurationFloor.

2. Read model, chained:
   - scene-narration-view.ts sceneNarrationView works out each shot's mode, text and voice (via default-voice.ts), the speech profile, recordingCurrent (the attached take must match the latest narration_speech_proposal for its segment revision), the cue range and the confirmation error.
   - scene-generation.ts sceneGenerationView adds sceneIntentDigest (every shot in the scene, plus the lock) and confirmationDigest.
   - generation-overview.ts shotNarration sets state, measured or estimated seconds, fits and fit, and builds the quotes from generation-quotes.ts quote (voice, makeKeyframes, confirmVideo). Only the latest *video* confirmation is projected.
   - Web: model/narration.ts (voiceUnit, lineNotes, takeView), model/plan-edit.ts unitPrices, model/checks.ts plus keyframes/CheckBanner.tsx and KeyframesView.tsx (the fit actions call store.narrationFit).

3. Keyframes press. generateScene(image) quotes speech for generated lines that are not ready and not recordingCurrent. It calls enqueueVoice, which is scene-confirmations.ts enqueueKeyframes and writes a "keyframes" row with steps speech or accept in shot order. If no image is needed, there is a voice-only branch (scene-generation.ts:407-417).

4. Confirm press. SceneConfirmationRunner.confirm checks the quote and runs assertNoVoiceInFlight, sets a scene hold, and writes a "video" row. advance/advanceOne then does:
   - fresh() first, which checks sceneIntentDigest and the frames; any error blocks the row for good.
   - A shot session via narration-scope.ts createShotNarrationSession.
   - speech: shot-audio-routes.ts saveWriting, then narration-speech-service.ts request → prepareRequest → prepare (composeSpeechPlanIsolated on the *active* plan) → publish → ProductionService.commitNarrationSpeechReview. The engine's admit re-checks the confirmation guard.
   - attach: narration/service.ts attachGeneratedAudio. This is the only place a generated take becomes a narration_audio row.
   - accept: shot-audio-routes.ts accept → recordHumanCue, place, accept, acceptAudio → canonical.ts prepare/apply (within_shot cue, narrationFit, plan rebase).
   - Then generateScene(video).

5. Recording. shot-recording-routes.ts runs intent and session → importAudio → saveWriting(uploaded) → bindAudio → accept if it fits; otherwise it stays attached for a fit. It is free and undoable through MediaUndo.

6. Fit. narration-fit.ts fitNarration: narrationFitFrames picks the length; extend uses editStoryboard on desiredFrames; then a new session, workspace.accept (a cut sets endSample to min(samples, frames×1600)), then sets narrationFit and records an undo.

7. Playback and export. shot-audio-routes.ts /narration/playback and media/storyboard-capture.ts use audio-placement.ts projectAudioPlacements (a cut gets a fade).

8. Web panel. keyframes/NarrationPanel.tsx offers a line (runNarrationEdits applies text, then voice, then mode), a recording (recording-words save and rollback, plus narration-recording upload with key replay), or none.

Throwaway reproductions are in /tmp/narr-review: orphan, stale, stale2, recover, order, voicequote and fitflow test files, plus fit.mjs. Each test runs with node scripts/run-tests.mjs <file>.


### narration-speech-plan-stale [major → major] confirmed

**After a motion or duration edit, every voice line fails with PLAN_COMPOSITION_STALE, so the scene can never be confirmed**

- File: `apps/server/src/narration/narration-speech-service.ts:98`
- Scenario: Scene 1 has shots 1.1 and 1.2, and their keyframes are made. The person sets 1.1 to "A line" with words, so it needs a voice line. They then change 1.2's camera motion or its duration. Motion does not touch the picture, so the frames stay current. They open the frames and press Confirm (priced: 1 voice line plus clips). The run blocks at 1.1's speech step with PLAN_COMPOSITION_STALE before any spend. Pressing Confirm again blocks the same way, every time. The voice-only "Make keyframes" press (priced: 1 voice line) also blocks, and that block is invisible because keyframe runs are not in the overview. The UI only says "Check the scene, then confirm again." The only way out is to regenerate an unrelated keyframe, which recomposes the plan. Reproduced with confirmationFixture: /tmp/narr-review/stale.test.mjs (edit 1.2's motion), stale2.test.mjs (edit 1.2's duration, or 1.1's own motion, then confirm twice: blocked both times, 0 speech calls), recover.test.mjs (regenerating keyframe 1.2 unblocks it).
- Evidence: narration-speech-service.ts:81,98: prepare composes the speech operation onto the saved active plan, with `project: captured.before` as the current project.
packages/core/src/planning/speech-composition.ts:159 and :162: compose() recompiles the saved plan source against the current project, and samePlan(base, verified/baseline) throws PLAN_COMPOSITION_STALE when any saved node compiles differently.
storyboard.ts:201 and :215: shot edits change desiredFrames and videoPrompt (via motion) but only detach bindings; the plan is never recomposed.
scene-generation.ts:407-417: the voice-only keyframes branch enqueues speech without composing the scene plan.
scene-confirmations.ts:190 throws from request, and :133 turns that into a permanent 'blocked'.
web model/keyframes.ts STOP_CODES has no entry for this code.
- Fix: Before the speech step, compose speech onto a plan rebased to the current project: run the scene composition (composeScenePlanIsolated / prepareNarrationPlanRebase) first, or have speech composition verify only the nodes it depends on rather than the whole saved plan. The voice-only keyframes press should do the same. If a stale plan can still occur, give it its own blocker message with a working next step.
- Verifier: I traced the scenario and reproduced it. Flow map: a Confirm press goes through SceneConfirmationRunner.confirm (scene-confirmations.ts:90), which writes a 'video' row. A Make keyframes press goes through generateScene and then enqueueVoice/enqueueKeyframes (scene-generation.ts:407-417, scene-confirmations.ts:64), which writes a 'keyframes' row. advance() calls advanceOne for each row. It checks fresh() (sceneIntentDigest plus assertActor) and then runs one step per tick. The 'speech' step calls workspace.saveWriting and then NarrationSpeechService.request. That calls prepareRequest and prepare, which composes speech onto the saved active plan with the current project (narration-speech-service.ts:81,98), and then publish, which calls commitNarrationSpeechReview. The 'attach' step waits for the attempt to succeed and calls narration.attachGeneratedAudio. The 'accept' step calls workspace.accept, which goes through the canonical commit and prepareNarrationPlanRebase. The video step calls generateScene, which runs composeScenePlanIsolated.

Why it fails: compose() in speech-composition.ts:158-162 recompiles the saved plan source against the current project and calls samePlan(). Plan nodes carry shotRevisionId (planning/index.ts:200), and every 'shot' or 'shotFields' storyboard edit sets row.revisionId = newId() (storyboard.ts ~212). Motion, desiredFrames and videoPrompt edits detach only video, timeline and render bindings, and they never recompose the plan. So the saved image nodes no longer match, and compose throws PLAN_COMPOSITION_STALE. I found nothing that recomposes the plan after such an edit: the storyboard request is only a message, and the Director is not enqueued.

Reproduction: I ran /tmp/narr-review/stale.test.mjs and stale2.test.mjs against the current dist, which is newer than src. A motion or desiredFrames edit (on 1.2, or on 1.1 itself) leads to confirm 200 and then 'blocked PLAN_COMPOSITION_STALE' with 0 speech calls, the same on every press. The voice-only keyframes press is also blocked, with overview confirmation null. Without the edit, the same flow completes.

The only things that rebase the plan are: a scene composition (regenerating a keyframe, as recover.test.mjs shows), or an accept on some other shot through canonical.ts:164. That second path is why the extend_shot fit in fitflow.test.mjs does not hit this. The web STOP_CODES has no entry for this code, so the person gets only the generic 'other' next step. No money is spent, but the scene cannot be confirmed after a common edit, and nothing points to the way out. Major stands.


### narration-orphaned-paid-voice [major → major] confirmed

**A scene edit while a voice job is out loses the paid voice line, and the next press buys the same line again**

- File: `apps/server/src/scene-confirmations.ts:153`
- Scenario: The person presses Make keyframes for a scene where 1.1 has a line to voice (priced: 1 voice line). While 1.1's voice job is at the provider, they edit anything in the same scene, for example the words of the silent shot 1.2 or any direction field. On the next runner tick, fresh() fails with SCENE_REVIEW_STALE and the run is blocked at its 'attach' step for good. The provider finishes and the job is charged (the attempt succeeds), but the take is never attached:
- It never becomes a narration_audio row, so Assets does not show it.
- recordingCurrent stays false, so 1.1 reads "not voiced yet" (text_only).
- The panel quotes the voice line again, and the next press buys an identical second line.
Reproduced in /tmp/narr-review/orphan.test.mjs: after the edit there is 1 succeeded speech attempt, 0 narration_audio rows, and a makeKeyframes quote of 1 voice unit. After the second press there are 2 speech calls and 2 grants for the same unchanged text and voice.
- Evidence: scene-confirmations.ts:153: `const view = this.fresh(row)` runs before every step, including attach.
:144: fresh compares sceneIntentDigest, which covers every shot in the scene (scene-generation.ts:172-176), not just the stepped shot.
:130-133: any error marks the row blocked. There is no resume: confirm and enqueueKeyframes always write new rows (:71, :113), and only the blocked row holds speechResult (:191).
:193-207: attach is the only path to attachGeneratedAudio, and narration/service.ts:208 is the only insert of narration_audio for a generated take.
scene-narration-view.ts:105-139: recordingCurrent requires row.audio.
generation-quotes.ts:27-29 quotes speech again.
assertNoVoiceInFlight (:74-83) ignores succeeded attempts.
The existing test 'an edit between paid speech publication and dispatch…' only covers an edit before dispatch.
- Fix: Choose one or both:
- Scope the freshness check of the attach and accept steps to the stepped shot's own narration intent and voice, so an unrelated edit in the scene cannot strand a paid take.
- When building steps, look for a succeeded, unattached take whose proposal matches the current segment revision, text, voice and profile. Start that shot at 'attach' instead of 'speech', and leave it out of the quote.
Also consider listing unattached paid takes in Assets.
- Verifier: I confirmed this and found it is broader than reported. advanceOne runs fresh(row) before every step (scene-confirmations.ts:153). fresh() compares sceneIntentDigest, which covers every shot's fields and narration in the scene (scene-generation.ts:172-176), and it also calls production.assertActor(row.actor, mutating). Any throw marks the row 'blocked' at :133.

There is no resume. enqueueKeyframes and confirm always create a new row (:71, :113) with fresh stepKeys, so request() is not replayed. Steps start at 'speech' unless recordingCurrent is true, and recordingCurrent requires an attached row.audio (scene-narration-view.ts:105-139). attachGeneratedAudio has exactly one caller: the runner's attach step (grep shows only scene-confirmations.ts:206). assertNoVoiceInFlight skips succeeded attempts (:77).

I re-ran /tmp/narr-review/orphan.test.mjs. After an edit to silent shot 1.2 while 1.1's voice job was at the provider, the row is blocked SCENE_REVIEW_STALE at 'attach'. There is 1 succeeded speech attempt and 0 narration_audio rows, shot-0 reads text_only, and makeKeyframes quotes 1 voice unit. The second press makes 2 speech calls, giving 2 succeeded attempts and 2 speech grants for the same text and voice.

I also wrote /tmp/narr-skeptic/orphan-chat.test.mjs, which sends an ordinary Director chat message (no concurrency, as the web sends at store.ts:466) while the voice job is out. beginRequest supersedes all active editing requests (service.ts ~158), so fresh() fails with ACTOR_DENIED at 'attach'. The paid take is stranded the same way: 1 succeeded attempt, 0 narration_audio rows. So an edit is not needed; talking to the Director while a voice line is being made is enough.

The existing test 'an edit between paid speech publication and dispatch…' only covers the fence before dispatch. Fencing after spend loses paid work, and the next press buys the line again. Major stands, although each voice line is cheap.


### narration-keyframes-run-invisible [minor → minor] confirmed

**Voice-line runs started by Make keyframes are not in the overview: a priced press can silently make nothing, again and again**

- File: `apps/server/src/generation-overview.ts:169`
- Scenario: Scene 2 has shot 2.1 with a 7.4 s voice line on a 6 s shot, and shot 2.2 with an unvoiced line. The first keyframes run voices and attaches 2.1, then blocks at 2.1's accept (NARRATION_CUE_OUT_OF_RANGE) before reaching 2.2's speech step. The panel still offers Make keyframes priced at 1 voice line (for 2.2). Pressing it returns 200, but the new run again starts with 2.1:accept and blocks, so 2.2 is never voiced. overview.scenes[].confirmation is null, so no step or reason is shown, and the press can be repeated indefinitely. Reproduced in /tmp/narr-review/order.test.mjs: both runs blocked at shot-0:accept, 1 speech call, shot-1 still text_only. Keyframe runs blocked by SCENE_REVIEW_STALE or PLAN_COMPOSITION_STALE are hidden the same way. While such a run is running, recording uploads and fits are refused with CONFIRMATION_RUNNING, with no run visible to explain why.
- Evidence: generation-overview.ts:169-170 projects only `r.kind === "video"` rows and adds the confirmation_running blocker only for those.
scene-confirmations.ts:72 builds steps in shot order.
:153 processes only the first unfinished step, and :133 blocks the whole row on that step's error, so later shots' speech never runs.
narration-fit.ts:38 and shot-recording-routes.ts:60 refuse on any running row of any kind.
Web model/keyframes.ts confirmationStep and confirmationStop read only scene.confirmation, and makeKeyframes (keyframes.ts:505) stays enabled with a voice price.
- Fix: Project the latest keyframes-kind run (state, current shot and step, blocker) in the overview next to the video run, and add confirmation_running for it. Either skip or defer a shot whose accept is out of range so the other shots' voice lines still run, or refuse the press up front with the reason ("Settle 2.1 first") instead of returning 200.
- Verifier: generation-overview.ts:169 projects only `r.kind === "video"` rows into scene.confirmation, and adds confirmation_running only for those. On the web, confirmationStep and confirmationStop (keyframes.ts:85,127) and voiceStepOf read only scene.confirmation. makeKeyframes (keyframes.ts:505) gates on direction_required, stopped, director_working, no_answer_in_scene, narration_making and confirmation_running. It does not gate on narration_too_long, so it stays enabled with the voice price.

enqueueKeyframes builds steps in shot order (:72): shot-0 goes to 'accept' because recordingCurrent is true, and shot-1 goes to 'speech'. advanceOne processes only the first unfinished step, and a throw blocks the whole row.

I re-ran /tmp/narr-review/order.test.mjs. The quote is 1 voice unit (100 micros), overview confirmation is null, and the second press returns 200 and is again blocked at shot-0:accept NARRATION_CUE_OUT_OF_RANGE. There is still 1 speech call, and shot-1 stays text_only. The stale.test voice-only press is also blocked with overview confirmation null.

What keeps this minor: no money is spent, because the block happens before speech. The person does see the narration_too_long check for 2.1, and settling it with a fit lets the next press voice 2.2 (fitflow.test.mjs shows this). During an in-flight speech attempt, shot.narration.state shows 'making', which partly explains a CONFIRMATION_RUNNING refusal. Still, a priced press that does nothing, with no visible reason, is a real defect.


### narration-voice-price-missing [minor → minor] confirmed

**Remaking a voiced line is shown as "no price is set" whenever no other line still needs a voice**

- File: `apps/web/src/next/model/narration.ts:98`
- Scenario: Every narrated shot in the film is voiced, which is the normal state once keyframes are done. The person changes the words or voice of voiced line 1.1 in the Keyframes narration panel. The panel says "The voice line will be made again …; no price is set for it." In Plan, the same edit gives "The voice line needs making again" with no price. In fact the speech profile has a price (100 micros in the fixture), and the next keyframes or confirm press charges it. Verified in /tmp/narr-review/voicequote.test.mjs: once 1.1 is voiced, the scene's voice quote is {micros:"0", units:0, unitMicros:"0"}.
- Evidence: generation-quotes.ts:27-34: the 'voice' quote counts only rows that still need a voice. With no units, unitMicros is "0" (`costs.length && …`).
generation-overview.ts:179 publishes it as quotes.voice.
narration.ts:98-102: voiceUnit returns null when unitMicros is not > 0, and every scene's quote is 0 in this state. That null drives narr.voice.impact.remake_unpriced (:108-111) and narr.line.impact.remake_unpriced (:172-174).
plan-edit.ts:248 and :258 read only scene.quotes.voice, which feeds plan.impact.voice_unpriced (:330).
- Fix: Publish the speech profile's per-line price independently of pending units, either as a scene or overview field such as voiceUnitMicros or as a 'voice' quote with one notional unit. Use it in voiceUnit and unitPrices, and keep 'unpriced' only for a profile that really has no price.
- Verifier: quote(…, 'voice') in generation-quotes.ts:27-34 adds a unit only for rows that are generated, not ready and not recordingCurrent. With no such rows, costs.length is 0, so unitMicros is "0". I re-ran /tmp/narr-review/voicequote.test.mjs: before voicing the quote is {micros:100, units:1, unitMicros:100}, and after it is {micros:0, units:0, unitMicros:0}.

On the web, voiceUnit (narration.ts:98-102) returns null when unitMicros is not > 0, falling back to other scenes, which are all 0 once everything is voiced. unitPrices (plan-edit.ts:248-258) never falls back at all, because scene.quotes.voice is always defined. As a result:
- narr.line.impact.remake_unpriced says 'no price is set for it', which is false because the speech profile has unitCostMicros 100.
- plan.impact.voice_unpriced shows no price.
- narr.voice.impact.remake_unpriced only omits the price; it does not claim there is none.

The paid presses themselves (makeKeyframes and confirmVideo quotes) still include the speech unit, so the price-before-paid-action rule holds. What is wrong is the edit-time impact line. Minor.


### narration-fit-contract-drift [minor → minor] confirmed

**The too-long-line banner follows the fixture's fit rules, not the server's: wrong "Make N s" length, and fit offered for unvoiced lines the server always refuses**

- File: `apps/web/src/next/model/checks.ts:50`
- Scenario: (a) A measured 5.8 s voice line on a 5 s shot. The banner offers "Make 2.1 7 s", the After strip shows 7 s, and the toast says "2.1 is now 7 s and keeps its whole line". The server sets the shot to 180 frames (6 s): narrationFitFrames(150, 278400, …) = 180, checked in /tmp/narr-review/fit.mjs. Any measured length whose fractional part is above 0.7 comes out one second off (4.8→6 vs 5, 6.9→8 vs 7).
(b) A line that is only estimated (text_only, not voiced yet) and longer than the shot gets the same banner with Make and Keep. Both always fail with NARRATION_RECORDING_REQUIRED, while Confirm stays disabled by the narration_too_long blocker.
- Evidence: checks.ts:50 sets `fitSeconds = ceil(lineSeconds + 0.3)`.
checks.ts:39-41 includes estimated lines.
checks.ts:215-221 offers extend and keep with no estimated check.
KeyframesView.tsx:140-143 builds the toast from actions.extend.seconds.
The server's narration-fit.ts:15 uses `Math.ceil(max(cur/30, samples/48000, min/30))*30`, with no pad, bounded by the locked profile.
narration-fit.ts:40 requires an attached take for the current text (server test 'fit rejects missing voice…' expects NARRATION_RECORDING_REQUIRED).
The web fixture (fixture-commands.ts:727-733) implements the padded rule and accepts estimated lengths, so the web tests agree with behaviour the real server does not have.
- Fix: Compute the extend target with the server's rule, or have the overview supply the server-computed fit frames for the locked video profile. Offer Make and Keep only when the line is measured; for an estimated line, offer to make the voice line or edit the words. Align the fixture with the server.
- Verifier: (a) checks.ts:50 uses fitSeconds = ceil(lineSeconds + 0.3). The server's narrationFitFrames (narration-fit.ts:15) uses ceil(max(cur/30, samples/48000, min/30))*30. The NarrationFitInput body has only fit and expectedHeadVersion, so the web cannot ask for its own length. Running /tmp/narr-review/fit.mjs against dist gives: 5.8 s → web 7 s vs server 6 s, 6.9 → 8 vs 7, 4.8 → 6 vs 5. The button label (check.narration.extend) and the toast (KeyframesView.tsx:140-143, toast.fit_extended with actions.extend.seconds) state the wrong length. One mitigation: once the overview refreshes, the settled banner title reads the server's durationFrames (CheckBanner.tsx:62), so that part corrects itself.

(b) narrationChecks also builds checks for estimated lines (measuredSeconds undefined), and CheckBanner renders Make and Keep for them without checking `estimated`. The server's fit requires segment.audio, intentCurrent and the same text (narration-fit.ts:40), so for a text_only line it always throws NARRATION_RECORDING_REQUIRED. The web fixture (fixture-commands.ts:727-733) implements the padded rule and accepts estimates, so the web tests agree with behaviour the real server does not have.

The person is not stuck: Make keyframes is not gated by narration_too_long and will voice the line, after which fit works. The person is shown a wrong length, and offered buttons that always fail. Minor.


## film — Film timeline and export

### Map

I reviewed the export path from the server out to the web, plus the free Film edits.

SERVER EXPORT
- Routes (apps/server/src/media/routes.ts):
  - POST /exports calls commandActor and then MediaApplicationService.prepareExport. On success it calls launch(job, "run"), which defers into media.run.
  - POST /exports/:id/cancel calls media.cancel.
  - POST /exports/:id/recover awaits media.recover.
  - GET /exports calls media.exportView. GET /media calls workspaceSnapshot and adds canRecover per job.
  - onClose aborts every launched task.
- prepareExport (apps/server/src/media/application.ts:102):
  - Inside store.command it checks expectedHeadVersion and runs captureStoryboard. It throws EXPORT_BLOCKED unless readiness.ready, then assertUnpaused.
  - freezeExport imports fixture clips and fixture audio through fixtureSource and LocalMediaService.importFixture, then calls LocalMediaService.freezeManifest.
  - It re-captures and inserts a media_render job in the "prepared" state.
- run (application.ts:172): authorize, matches and assertUnpaused, then state "running" plus a heartbeat. Then LocalMediaService.render, which is exclusive and runs one FFmpeg filter graph with the demo drawbox glyphs and audio lanes plus amix. Then installManagedVideo, then finish.
- finish: publishes or keeps the result as historical, plus media_preview.
- recover: only reads completion receipts from findCompletions, then finish, or marks the job "interrupted".
- exportRecord / exportView: map job state to rendering, done, failed or cancelled, and outdatedBy from changedFilm(target.film, current film).
- captureStoryboard (apps/server/src/media/storyboard-capture.ts) is the single readiness rule.
  - Shot order comes from storyboardAudioCuts (scenes array, then project.shots order).
  - Per-shot clip currency: binding, node, shotRevisionId, intent, args.durationFrames >= desiredFrames, measured source frames >= desiredFrames.
  - Voice: shotVideoTiming plus the canonical segment, through projectAudioPlacements (shot-relative) or the stored absolute placement.
  - Music: soundtrackPlacement.
  - Demo vs mixed media: decided from mediaFlavors.
  - Builds the RenderManifestInput (clips are trimmed from frame 0 to desiredFrames) and the film fingerprint.
- Film edits (apps/server/src/storyboard.ts editStoryboard):
  - Length is kind shot with desiredFrames. It changes revisionId and video intent and detaches the shot's video binding.
  - moveShot and soundtrack are global: they detach only timeline/render bindings and set no holds.

WEB
- FilmView (apps/web/src/next/views/film/FilmView.tsx):
  - Builds filmTimeline from the overview (apps/web/src/next/model/film.ts).
  - runEdit sends storyboard commands through store.command with displayedHead.
  - Music gain goes through GainSession and submitGain (film-gain.ts).
  - Export start, cancel and recover are presses on /exports.
  - Narration and music preview: useLiveAudio over GET /narration/playback.
- ExportPanel shows panelState, readinessRows from the overview, and whyNotReady from the server blockers (film-export.ts).
- Player and Timeline run on FilmClock; Tools holds the length, move and music tools.


### film-length-inflight-clip [major → minor] confirmed

**Film length stepper gives no warning that a paid clip being made will be charged and come back out of date**

- File: `apps/web/src/next/views/film/Tools.tsx:33`
- Scenario: A Viggle clip for shot 2.1 is running (overview video.state 'running', so FilmShot.picture is 'keyframe'). The person selects 2.1 in the Film timeline and presses + to make it 6 s. The tool row shows no note. The toast says only '2.1 is 6 s. The film is N s.' The server detaches the video binding (candidateId null). When the in-flight attempt finishes it is marked charged but never bound, so the person pays for a clip that will not be used and must pay again. The same happens when a ready clip has a paid replacement in flight: the note says only 'a new length outdates its clip'.
- Evidence: - Tools.tsx:33-36 builds notes only from voiceFloor and `shot.picture === "clip"`. Nothing covers shot.video running, queued-to-run or no_answer, or a video.replacement in flight.
- FilmView.tsx:169-175: changeLength's toast uses `selectedShot.picture === "clip"` only.
- film.ts:119-123: pictureOf is 'keyframe' while a clip is being made.
- Server side, storyboard.ts:437-447: a desiredFrames edit affects the shot's video binding (only image nodes are excluded). storyboard.ts:476-488 then writes `candidateId: null, outputs: {}`.
- engine.ts:1230-1238: the finished attempt is marked charged (`setReservation(current, "charged")`) but bound only if `binding.candidateId === current.candidateId`.
- The Plan view warns about exactly this: plan-edit.ts:305 sets `running: ... clipLike && inFlight(shot.video)`, and :324 shows 'plan.impact.running'. The Film view does not.
- Fix: In ShotTools and the length toast, when making(shot.video), video.state is no_answer, or a video.replacement is in flight, say what the Plan view says ('Work for {shot} is still running; what it makes will be out of date'). Better, require a confirm, so a free length change never silently strands paid work. The Keyframes inspector's editImpact (inspector.ts:33) has the same gap for desiredFrames when a video is in flight.
- Verifier: I traced it end to end. In Tools.tsx:33-36 the notes come only from voiceFloor and `shot.picture === "clip"`, and the stepper is disabled only by `!writable`. FilmView.tsx:174 builds the toast from `selectedShot.picture === "clip"`. In film.ts:119-122, pictureOf is 'keyframe' while video.state is 'running'. On the server, a `kind:"shot", field:"desiredFrames"` edit puts the shot in `changed`. In storyboard.ts the image node is excluded (the shotFields ⊆ motion/desiredFrames/videoPrompt rule), but the video binding is not, so it is rewritten with `candidateId: null, outputs: {}`. Nothing refuses the edit while an attempt runs: assertNoRunningAttempts is only used for deleteScene. In engine.ts the finished attempt calls `setReservation(current, "charged")` but binds only when `binding.candidateId === current.candidateId`. generation-overview.ts keeps the detached attempt showing 'running' (`active` from history), then shows 'outdated' with previous = the new clip. So the person pays for a clip that comes back out of date and has no warning in the Film view. The Plan view does warn (plan-edit.ts:305 `running`, plan.impact.running). The Keyframes inspector's editImpact (inspector.ts) checks only `isWorking(shot.keyframe)` for running work, not the video. I lowered the severity to minor: the money was committed, with its price shown, when the clip was pressed; the edit adds no new charge; the cost is a few cents per clip; and the toast offers Undo. The real defect is the missing disclosure, not an unpriced charge.


### film-render-timeout [major → major] confirmed

**A whole-film export runs as one single-threaded FFmpeg job under the fixed 120 s per-tool timeout, so long films with real footage fail**

- File: `apps/server/src/media/local-media.ts:13`
- Scenario: A person exports a 5-6 minute film of real Viggle clips (the panel promises up to 6:00, 'renders here, free'). The whole render is one FFmpeg run with libx264 veryfast and -threads 1 everywhere. On this Mac, a single-threaded run of the same filter chain encoded 720p with mild grain at about 82 fps. At that rate 10800 frames take about 131 s, past the 120 s limit. The run is killed with MEDIA_TIMEOUT, the export fails ('FFmpeg took longer than its time limit'), and every retry fails the same way. Nothing in the app can raise the limit, and slower machines fail on shorter films.
- Evidence: - local-media.ts:13: `DEFAULTS = {..., timeoutMs: 120000}`.
- local-media.ts:368-431: render builds one ffmpeg command with `-filter_complex_threads 1`, `-threads 1` per input, and `-c:v libx264 -threads 1 -preset veryfast` for all totalFrames.
- local-media.ts:510-521: run() always passes `timeoutMs = this.limits.timeoutMs`.
- media-execution-runtime.ts:109-110 constructs LocalMediaService without `limits`, so production uses the default.
- The only six-minute check, apps/server/test/media-six-minute.mjs, renders flat-colour lavfi sources (trivially cheap) and is not part of the suite.
- My benchmark (scratchpad, same filter chain and flags, 600 frames): 1280x720 testsrc2 with noise=alls=4 took 7.28 s (about 82 fps); a 1080p source scaled down took 3.70 s (about 162 fps). That extrapolates to 67-131 s for 10800 frames on an Apple Silicon machine.
- Fix: Give the export render a timeout scaled to manifest.totalFrames (for example a base plus a per-frame allowance, bounded by the 600 s maximum the limits already allow), or let the encoder use more threads. Add a realistic-content acceptance check.
- Verifier: The code path is deterministic. In local-media.ts:13, `timeoutMs: 120000`. media-execution-runtime.ts:109 builds LocalMediaService without `limits`. render() makes one ffmpeg call over all `-frames:v totalFrames` with `-filter_complex_threads 1`, `-threads 1` per input and `libx264 -threads 1 -preset veryfast -crf 20`, and run() always uses `this.limits.timeoutMs`. The export is 1280x720 (storyboard-capture.ts:131), and the maximum is 10800 frames. media-six-minute.mjs uses 160x90 flat-colour sources and is not picked up by run-tests (it only runs *.test.mjs). I measured on this machine (M1 Max): encoding 1800 frames of detailed 720p content (mandelbrot) through the encoder alone used 19.5 s of CPU with user≈real, near full use of one core. That is about 92 fps, or about 117 s of single-threaded encoding for a 6-minute film, before decode, filtering, startup and binary hashing. The full filter chain under the current machine load ran at 79-85 fps, about 127-137 s for 10800 frames. Clean 1080p content scaled down ran at about 160 fps, about 67 s. So a 5-6 minute film with detailed real footage has almost no margin even on fast Apple Silicon. It fails reliably on slower or busier machines, retries fail the same way, and nothing in the app can raise the limit. Severity stays major because export is the core deliverable and the panel promises up to 6:00, but it depends on hardware and content.


### film-absolute-narration-reorder [major → minor] confirmed

**Narration with absolute placement stays at its old time when shots are reordered or lengthened, while the Film view shows it moving with its shot and export stays ready**

- File: `apps/server/src/media/storyboard-capture.ts:90`
- Scenario: The project's canonical narration was committed without shot-relative placement (segments have no placementMode: every full-script commit, as in the classic or older studio). In the Film view the person moves shot 1.2 earlier (or lengthens 1.1). The narration lane and the subtitle (lineOf/lineAt) place the line at 1.2's new start. Export readiness stays ready, and the export (and the live preview audio) still play 1.2's voice at its old absolute sample, now under another shot. Shortening an earlier shot can also push the voice past the film end; freezeManifest then refuses with MEDIA_AUDIO_OUTSIDE_TIMELINE after the panel said Ready.
- Evidence: - storyboard-capture.ts:90-91: `if (accepted.placementMode === "shot" || !placedAbsoluteCues.has(cue.id)) audio.push(...projectAudioPlacements(accepted, [cuts[index]!]))`.
- audio-placement.ts:16: `if (segment.placementMode !== 'shot') return [segment.audioPlacement];`, the stored atSample, ignoring the cut.
- Readiness checks only shotVideoTiming and segment identity, not that atSample matches cuts[index].startFrame.
- shot-audio-routes.ts:636 (GET /narration/playback) uses the same projection.
- film.ts:175-190: lineOf draws the line at the shot's current start.
- Probe (copy of storyboard-export.test fixture with absoluteSharedCue, one cue on shot 1): after `editStoryboard moveShot` puts shot 1 at index 0, readiness ready=true, blockers=[], and the narration placement is still atSample 48000. That is the old frame 30, now shot 0's start.
- Fix: In captureStoryboard (and the playback route), treat an absolute placement as current only when its atSample equals the start of the cut its cue maps to. Otherwise report voice_unsettled for that shot (or re-anchor it to the cut, as shot-relative placements are). The Film view would then show the voice as needing settling, not placed.
- Verifier: I reproduced it with a throwaway probe against the built dist. It used a legacy canonical segment with no placementMode, exact timing, the cue on shot index 1 and atSample 48000. After `editStoryboard moveShot` puts that shot first, captureStoryboard reports ready=true, blockers=[], and the voice is still at atSample 48000, now under the other shot. The cause is audio-placement.ts:16 `if (segment.placementMode !== 'shot') return [segment.audioPlacement]`. Readiness (shotVideoTiming) checks only the cue's duration against desiredFrames, never the placement against cuts[index].startFrame. The playback route (shot-audio-routes.ts:615+) uses the same projection, and film.ts lineOf draws the line at the shot's current start, so the Film view and the export disagree. I lowered it to minor because current code never creates absolute placements: the only canonical commit path is shot-audio accept (shot-audio-routes.ts:382-389), which always passes segmentIds and shotRelativeSegmentIds, and canonical.ts:63 keeps earlier shot-relative ids. Only projects committed by the removed classic full-script flow (before 842b28c) are affected. storyboard-export.test.mjs:257 deliberately keeps legacy absolute narration absolute, but nothing flags the resulting misalignment.


### film-shutdown-marks-cancelled [minor → polish] confirmed

**Quitting or restarting OpenSlate during an export records it as cancelled by the person, and Check again is never offered**

- File: `apps/server/src/media/application.ts:206`
- Scenario: An export is rendering and the person quits or restarts OpenSlate normally. The media routes' onClose aborts the task. run() catches MEDIA_CANCELLED with abort.signal.aborted=true and writes state 'cancelled', cancelRequested=true. After restart exportRecord says 'cancelled', so the panel shows 'Export cancelled. Nothing was saved.' even though no one pressed Cancel. The interrupted state (whose copy says 'OpenSlate restarted while this export was rendering. Check again looks for the finished file') is reached only after a crash. A render whose receipt was written just before the abort can also never be checked for from the panel.
- Evidence: - routes.ts:60-63: `scope.addHook("onClose", ... owned.forEach(task => task.abort.abort())`. shutdown.ts:34 runs app.close() as 'HTTP connections and local render cleanup'.
- application.ts:206-207: `state: abort.signal.aborted ? "cancelled" : "failed", ... cancelRequested: current.cancelRequested || abort.signal.aborted`.
- application.ts:155: exportRecord maps cancelRequested or 'cancelled' to state 'cancelled'.
- film-export.ts:189: `if (current.state === "cancelled") return { kind: "idle", failed: null, cancelled: true }`. 'interrupted' is only reachable from a 'rendering' record with canRecover (lines 178-181).
- Fix: Tell a shutdown abort apart from a human cancel. Use a separate AbortController or reason for onClose, and leave the job 'running' with its lease or mark it 'interrupted' (cancelRequested false), so after restart the panel offers Check again.
- Verifier: The code path is as the reviewer describes. routes.ts:60-63 aborts every task in onClose, and shutdown.ts:35 runs app.close() before the resources close, so run()'s catch at application.ts:206-207 writes `state: "cancelled"` and `cancelRequested: true` while the store is still open. exportRecord then maps it to 'cancelled', and panelState returns `cancelled: true` ('Export cancelled. Nothing was saved.'). However, media-http.test.mjs:129-142 explicitly asserts that server close leaves the job in state 'cancelled', so the job-level outcome is intended. Offering 'Check again' would also not help: the abort kills FFmpeg, so no completion receipt exists, except in a very narrow window after installJson('completions'). Even then finish() would mark the job historical because cancelRequested is set. 'Export again' is free and correct. What remains is wording, and cancelRequested being set by a non-human abort. No data or money is lost, so the severity is polish.


### film-mixed-demo-false-reason [minor → minor] confirmed

**Adding your own music or recording to the demo film blocks export, and the reason says the clips are mixed when they are not**

- File: `apps/server/src/media/storyboard-capture.ts:121`
- Scenario: In the shipped demo film (all clips are demo fixtures) the person picks music they imported (or records their own voice line). captureStoryboard counts the soundtrack and cue audio in mediaFlavors and adds mixed_demo_media to every shot. The panel then shows every row as ✓ clip / ✓ voice. It says 'Demo clips and made clips can't share one export', but every clip is a demo clip, and nothing points to the music or recording that actually blocks the export. The DEMO mark also disappears from the player.
- Evidence: - storyboard-capture.ts:87 `if (record) mediaFlavors.push(record.fixture)` for cue audio, and :112 `mediaFlavors.push(... fixture === true)` for the soundtrack.
- storyboard-capture.ts:121-122 adds `mixed_demo_media` for every shot when flavors differ. The existing test (storyboard-export.test.mjs:160-162, the mixedAudio case) confirms this blocks all shots.
- film-export.ts:153 maps it to 'film.why.mixed_demo', whose text in i18n/catalog/film.ts:65 is "Demo clips and made clips can't share one export".
- Fix: Report which medium is mixed (for example a distinct code or a `kind: music|voice|clip` on the blocker). Name the music or the shot's recording in the reason, and offer Change music / No music from the panel.
- Verifier: storyboard-capture.ts:87 pushes the cue audio's fixture flag and :112 pushes the soundtrack's into mediaFlavors. :121-122 then adds mixed_demo_media to every shot when the flavors differ, and :120 makes demo=false. The shipped demo (demo.ts) sets no soundtrack, so choosing any imported music, or recording your own voice line on a demo shot, introduces a non-fixture flavor. The block itself is intended: storyboard-export.test.mjs:160-162 covers the mixedAudio case. The reason shown is wrong, though. film-export.ts whyNotReady maps the code to film.why.mixed_demo, "Demo clips and made clips can't share one export", while every clip is a demo clip. Because demo=false, clipCell shows '✓ clip' and the Player drops the DEMO mark. Nothing names the music or recording that actually blocks the export. The person is blocked with a false reason, but no money or data is at risk.


### film-export-media-busy [minor → minor] confirmed

**An export that starts while another local media job holds the shared FFmpeg worker fails at once and is reported as 'FFmpeg could not finish rendering'**

- File: `apps/server/src/media/application.ts:197`
- Scenario: The export render and all clip, voice and upload normalization share one LocalMediaService that allows one operation at a time. If a Viggle clip or TTS line for any film is being normalized when an export starts, render() throws MEDIA_BUSY. run() has already set the job to 'running' and now records it as failed with MEDIA_BUSY. The panel shows 'The last export stopped. FFmpeg could not finish rendering the film.' (MEDIA_BUSY has no catalog entry), and nothing waits or retries. A second export pressed while the first renders (a second tab) fails the same way and becomes the panel's 'current' record, which hides the still-running first export and its Cancel. The demo path fails the same way earlier, in importFixture during freeze.
- Evidence: - local-media.ts:501-505: `exclusive` does `invariant(!this.busy, "MEDIA_BUSY", ...)`. render (line 360), importFixture (275) and importMedia (211) all take it.
- application.ts:179-180 sets state 'running' before the render. :197 calls `this.media.render`, and :206 records 'failed' with errorCode MEDIA_BUSY.
- film-export.ts:194-197: renderFailureReason falls back to 'error.MEDIA_RENDER_FAILED' because no 'error.MEDIA_BUSY' entry exists in i18n/catalog/errors.ts (lines 60-75).
- Contrast engine.ts:1195-1207, where generation ingestion treats MEDIA_BUSY as 'deferred' and retries.
- application.ts:166-168: exportView takes `records[0]` (the newest job) as current.
- Fix: Wait for the worker (queue) before moving a prepared export to running, or leave it prepared with a retryable code and retry it. Add catalog words for MEDIA_BUSY ('another media job is running; this export will start when it finishes'). In exportView, prefer an export that is still rendering as 'current' over a newer failed one.
- Verifier: index.ts:86 hands the single LocalMediaService instance to MediaApplicationService. The same instance serves the spool video and audio ingestors, transcription, LocalMediaExecutor and narration (media-execution-runtime.ts:194-199, index.ts:73). exclusive() (local-media.ts:501-505) throws MEDIA_BUSY right away instead of waiting. run() has already set the job to 'running' (application.ts:179-180), so the catch at :206 records 'failed' with errorCode MEDIA_BUSY. errors.ts has no error.MEDIA_BUSY, so renderFailureReason falls back to 'FFmpeg could not finish rendering the film.' Generation ingestion, by contrast, defers on MEDIA_BUSY (engine.ts:1195-1207). Realistic triggers include a replacement clip or a TTS line finishing normalization (this project or another) just as Export is pressed; readiness stays ready while a replacement is in flight. The panel does say 'You can export again', and a later retry works, so this is a misleading failure with no money or data impact. The second-tab part is real but narrower. prepareExport has no guard against an export that is already running, freezeManifest is not exclusive, so the second job fails with MEDIA_BUSY, and exportView takes records[0], the newest, as current, hiding the running export's Cancel. That needs a stale second tab, since the rendering panel shows no Export button.


## ui — Remaining UI code written by the visual-review fix agents

### Map

Keyframes view (apps/web/src/next/keyframes/KeyframesView.tsx) composes the segment's components:
- SceneHeader.tsx: scene pills from keyframesView(). A ResizeObserver keeps the selected pill in view (revealScroll). Pills are disabled while editHold(draft) holds the edit.
- Preview.tsx: takes an OpenIntent, armed by KeyframesView.openShot or by its selectedId effect. Its "Opened" effect calls store.openFrame(shotId), which posts the current artifact, once the picture has decoded (Picture onDecoded -> loaded), is on screen (useOnScreen) and is not covered by a player. It also runs:
  - the motion preview through requestAnimationFrame, then ended -> KeyframesView.ended -> advance(playback);
  - Clip for scene clip playback (useArtifactUrl; onEnded/onError, or a failed source, advance it);
  - ClipPlayer for the Video side;
  - Previous/Next and the arrow keys, which call onStep = openShot.
- ShotCards.tsx: cards from keyframesView. Director note chips come from useDirectorNotes.calloutsFor -> noteCallout; the paid regenerate link calls notes.chooseOnCard -> runNoteRegeneration. Chip words are fitted by useChipFit.ts + model/chip-fit.ts.
- BannerFrame.tsx: renders NoteBanner/CheckBanner. Its Now/After strip is measured and fitted with fitStrip.

Inspector -> NarrationPanel.tsx (key = shotId) has three choices:
- A line (LinePart): lineNotes, voiceImpact and lineFromRecordingImpact from model/narration.ts give the impact and price text. Save has two paths:
  - a text-only change goes to onSaveDraft -> KeyframesView.saveDraft -> store.saveEdit, then notes.editSaved and the check-settle;
  - anything else goes through run -> runNarrationEdits (model/narration-edits.ts: store.saveEdit / store.edit), then close().
- None: runNarrationEdits.
- My recording (RecordingPart): checkRecording/inspectFile, then add():
  1. saveRecordingWords
  2. beginRecordingWrite
  3. recordingRequest with import keys
  4. uploader.send (liveUploader or the fixture)
  5. acknowledgeRecording, then a toast with Undo.
  On failure: afterRecordingFailure (fresh/settle/keep), then notAdded -> rollbackRecordingWords.
- TakePlayer plays the current take from useNarrationAudio (a SHA-256-verified blob URL).

Film view (views/film/FilmView.tsx):
- filmTimeline() in model/film.ts feeds Timeline.tsx: blocks and lines, useFittedForms, useLineSeparators, useElementWidth with tickLabels, and a playhead drawn by useClockPaint.
- ExportPanel.tsx uses panelState(view, media, now), readinessRows/blockersFirst and whyNotReady from model/film-export.ts, plus useRowsBelow from layout-hooks.ts. Its presses go to FilmView startExport/cancelExport/recoverExport through store.command.
- The free edits are lengthEdit/moveEdit/music* in model/film.ts, sent by FilmView.runEdit.

Start: views/start/NewFilmSheet.tsx uses modelPlan, modelSummaryText, createBody and creationSteps from model/start-new.ts, then runCreation (model/start-commands.ts): create, Codex director setup, then plan import. A failed later step shows madePlan and retries that step only.

Director column:
- director/Composer.tsx: composerView, the @ picker and store.sendMessage.
- director/Markdown.tsx: React-only rendering of model/markdown.ts blocks; links pass through safeHref (http/https/mailto only).

Pure helpers:
- model/shell.ts: tabs, connect screen, toast placement.
- model/assets.ts: assetLibrary, readAllAssets, SlotQueue.
- views/plan/useShrinkWrap.ts: used by Plan note chips.


### ui-1 [major → major] confirmed

**A narration edit opened from a Director note (or a check) is never settled when Save sends more than the line text**

- File: `apps/web/src/next/keyframes/NarrationPanel.tsx:247`
- Scenario: A Director note asks for a line on shot 2.1, which has no line yet: its stored mode is undecided, none or absent. The person presses the note's narration Edit choice, which goes through openNoteEditor and sets pendingEdit. They type the line and press Save. modeEdit('line', mode) is not null, so edits = [text, mode->generated] and the panel takes the runNarrationEdits path. The panel closes with the toast "2.1 has a line to voice now", but the note is never resolved: it stays open and still leads the banner. close() -> onEdit(null) -> editDraft(null) -> notes.editChanged(null) also clears pendingEdit. Pressing the note's Edit choice again opens the panel with the saved line, and Save is disabled because nothing changed. The note can then only be closed with a different choice, which records the wrong one. The same happens when the person changes the voice together with the line on a note- or check-opened edit; for a check, the settled banner with Undo never appears.
- Evidence: NarrationPanel.tsx:246-256: `// The line alone goes through the view ... if (edits.length === 1 && textChanged) { onSaveDraft({ ...draft, value: text }); return; } ... if (await run(edits)) close();`. Lines 189-190: run -> runNarrationEdits(store, draft, edits). In model/narration-edits.ts:13-37 that function only dispatches a toast. KeyframesView.tsx:163-169: saveDraft is the only place that calls `notes.editSaved(next.shotId, next.field, commandId)` and sets the check's settled state. KeyframesView.tsx:189-192: editDraft(null) calls notes.editChanged(null). useDirectorNotes.ts:160-163: `if (waiting && (!draft || ...)) pendingEdit.current = null`. model/note-command.ts:55-56 opens the narration editor for note edits.
- Fix: Have runNarrationEdits return the command id of the text edit (or of the last command). Add an onSaved(commandId) callback to NarrationPanel; KeyframesView should run notes.editSaved(shotId, 'narration', id) and the check-settle logic in it. Call it after run() succeeds and before close(). Alternatively, send the whole composite save through the view's saveDraft.
- Verifier: Traced end to end. A note's edit choice goes useDirectorNotes.run (case 'edit') -> openNoteEditor (note-command.ts:39-57), which calls store.setEdit directly and sets pendingEdit (useDirectorNotes.ts:101-102). Inspector passes KeyframesView.editDraft straight through as NarrationPanel.onEdit (Inspector.tsx:171, KeyframesView.tsx:332). In NarrationPanel.onSave (NarrationPanel.tsx:235-257), only the case `edits.length === 1 && textChanged` goes through onSaveDraft -> KeyframesView.saveDraft, which is the only narration caller of notes.editSaved and of the check's setSettled (KeyframesView.tsx:163-179). The composite path runs run() -> runNarrationEdits (narration-edits.ts:14-37). That function only dispatches the last toast and returns true, then close() -> onEdit(null) -> editDraft(null) -> notes.editChanged(null), which clears pendingEdit (useDirectorNotes.ts:160-163) and narrationFromCheck (KeyframesView.tsx:191). editSaved is never called. Two things trigger the composite path. (a) The stored mode is not 'generated': modeEdit('line', mode) returns 'generated' for undecided, none or absent (narration.ts:45-48), and the server default is mode 'undecided' (storyboard.ts:258-262, scene-narration-view.ts:37). (b) The person changes the voice together with the line. The note stays 'open' afterwards. A narration edit only changes the shot's revisionId when shotIntentDigest('video') changes, and that digest does not include the narration text or mode (planning/index.ts:83-87), so directorNotes() does not mark the note stale and sceneOpenNotes keeps it leading the banner. On reopen, text, voice and mode all match the saved values, so canSave is false (NarrationPanel.tsx:338-343). If the note is blocking, confirm is refused with RECOMMENDATION_OPEN (scene-confirmations.ts:93) until the person picks another choice such as accept/keep, which records the wrong resolution. The server would have accepted the text command id as resultRef: the edit_field check only needs the narration field to differ before and after that command (director-notes.ts:125-131). So the suggested fix (return the text edit's commandId and call editSaved and the check-settle logic) is sound. No test covers a note- or check-opened composite save. One small correction: with two or more edits the toast is narr.toast.line_more or voice_more, not narr.toast.line. Flow map: openNoteEditor/editNarration -> store.setEdit -> NarrationPanel (LinePart) -> onSave -> [one text edit: onSaveDraft -> saveDraft -> store.saveEdit -> notes.editSaved -> store.resolveNote(noteId, choice, commandId) -> settle | setSettled for a check] or [composite: runNarrationEdits -> store.saveEdit(toast null) / store.edit per step -> toast -> close -> editDraft(null) -> editChanged(null) clears pendingEdit].


### ui-2 [minor → polish] refuted

**Changing only the narration mode of a voiced line says 'The voice line will be made again' with no price**

- File: `apps/web/src/next/model/narration.ts:172`
- Scenario: Shot 2.3 is set to 'My recording', but its take is still a voice line (origin 'voice', so recordingInUse is false and impactLeave is null). The person picks 'A line' and leaves the words and voice unchanged. The impact line reads "Nothing visual changes. The voice line will be made again." with no price, even though the voice-line unit price is known. Changing a single word in the same panel says "... made again, about $0.01 ...". Saving sends the mode edit, and the server sets narrationPending (storyboard.ts:293) on any narration change, so a remake follows. The same panel announces one paid remake with its price and an equivalent one without. Reproduced with a throwaway test: lineNotes(shot 2.3, modeChanged, leave null, unitMicros 10000) -> ['Nothing visual changes. The voice line will be made again.'].
- Evidence: model/narration.ts:169-175: `const words = !textChanged ? (draft.voiceChanged ? null : msg(voiced ? "inspector.outdates.voice" : "inspector.outdates.nothing_visual")) ... : unitMicros !== null ? msg("narr.line.impact.remake", { price }) : msg("narr.line.impact.remake_unpriced")`. The catalog's keyframes.ts:117 gives "inspector.outdates.voice" as "Nothing visual changes. The voice line will be made again." (no price). NarrationPanel.tsx:341-346 (modeChanged = modeEdit('line', narrationMode) !== null) feeds this branch. Server storyboard.ts:282-293: `if (writingChanged) row.narrationPending = draft.mode !== "none"`.
- Fix: In the !textChanged && !voiceChanged && voiced branch, use the priced message (narr.line.impact.remake / remake_unpriced, priced from unitMicros), as the text-change branch does. If a mode-only switch does not actually remake the line, the message should say that instead.
- Verifier: The lineNotes branch is quoted correctly: when the text and voice are unchanged, the mode changed and the line is voiced, it returns the unpriced 'inspector.outdates.voice' (narration.ts:169-175). But the claimed money problem, a paid remake announced without its price, does not hold. narrationPending (storyboard.ts:293) does not by itself buy a voice line. Paid speech is bought only when `mode === 'generated' && !ready && !recordingCurrent`, both in the quote (generation-quotes.ts:27-29) and in the confirmation and keyframe steps, which otherwise choose 'accept' (free) (scene-confirmations.ts:72, 115-116). In this scenario the take is still the verified voice line. Switching back to 'generated' with the same words and voice gives the same narration digest the voice line was made for, so writingCurrent holds and the same voice resolves (scene-narration-view.ts:58-71, default-voice.ts). recordingCurrent then stays true when the script text, voice, profile revision and latest speech proposal match (scene-narration-view.ts:105-139), and the existing voice line is re-accepted for free. If it is remade (for example, the profile revision changed), that cost is in the scene's keyframes or confirm quote, which is the paid press and shows its price. Adding a price here, as the finding suggests, would announce a charge that normally does not happen. The real but cosmetic problem is the opposite one: 'The voice line will be made again' usually overstates a mode-only switch. That is polish, not a hole in price display.


### ui-3 [minor → minor] confirmed

**Keyboard focus is lost when the recording's Choose button moves into or out of the refusal box**

- File: `apps/web/src/next/keyframes/NarrationPanel.tsx:630`
- Scenario: A keyboard or screen-reader user focuses 'Choose a file…' and presses Enter. In the file dialog they pick a file the panel refuses: not audio, too large, or found to be over 6 minutes once its length is read. When the dialog closes, the browser returns focus to that button. onChange -> choose() then sets a refusal, so the button unmounts and an identical 'Choose another…' button mounts inside the refusal box. Focus drops to <body>, and the next Tab starts from the top of the page instead of in the inspector. The same happens the other way: an acceptable file picked from 'Choose another…' removes the refusal box with the focused button in it.
- Evidence: NarrationPanel.tsx:614-618 defines chooseButton(className). Line 630 renders `{refusal ? null : chooseButton("pill narr-choose")}`, and line 646 renders `{chooseButton("pill sm narr-choose")}` inside the role=alert refusal block at 639-649. These are two different tree positions, so React creates a new element whenever `refusal` flips (lines 475 and 484-495).
- Fix: Keep one Choose button in a stable place in the tree and move only the refusal text, or after the swap move focus into the new button (or onto the refusal) with a ref and an effect that runs when `refusal` changes.
- Verifier: chooseButton(className) is rendered at NarrationPanel.tsx:630 (`{refusal ? null : chooseButton('pill narr-choose')}`) as a sibling under the fragment, and at :646 inside .narr-foot > .narr-refusal > .narr-refusal-body. These are different parents, so React unmounts one DOM button and mounts another whenever `refusal` flips. `refusal` comes from check, inspected or phase (line 475). choose() sets check synchronously on the input's change event, and the length check arrives later through inspectFile (lines 484-495). input.click() from the button does not move focus, so when the file dialog closes the focused element is still the Choose button, and it is removed on the next render. focusField is false after the first render (opening.current is cleared in an effect, lines 153-155), so the new button does not autofocus either. No ref or effect moves focus into the refusal box. role=alert announces the text, but focus falls to <body>. The reverse also happens: an acceptable file picked from 'Choose another…' clears the refusal while reading (inspected is null), which moves the button back out. The browser script scripts/browser/next-narration.mjs checks only the refusal text and style, not focus. This is a keyboard and screen-reader focus loss, with no effect on data or money.


### ui-4 [minor → minor] confirmed

**Scene clip playback stalls on a shot whose clip stopped being ready**

- File: `apps/web/src/next/keyframes/Preview.tsx:194`
- Scenario: In the live studio the person presses Play scene; every clip is ready, so playback.kind is 'clip'. While it plays, a later shot's clip becomes outdated or starts running, for example after Undo of an edit from a toast or another window's change. When playback reaches that shot, Preview renders no <Clip> because shot.video.state is no longer 'ready', so neither onEnded nor the failed-source effect fires. Playback stays on that shot indefinitely: the play button shows pause, the scrubber sits at 0, VideoPanel still says the scene is playing, and keyframeVisible stays false, so the frame's 'Opened' is not recorded. The person has to press stop.
- Evidence: Preview.tsx:194: `{playing === "clip" && shot.video.state === "ready" && shot.video.artifact ? <Clip shot={shot} onEnded={onEnded} .../> : null}`. Only Clip advances playback (line 300: `useEffect(() => { if (source.status === "failed") ended.current(); }, [source.status])`, plus onEnded/onError at 315-316). Line 95: `keyframeVisible = !player && playing !== "clip"`. KeyframesView.tsx:221 decides on clips only when playback starts, and model/motion.ts advance() never re-checks.
- Fix: In Preview, when playing === 'clip' and the shot has no ready clip artifact, call onEnded once (in an effect keyed on shot id and clip availability) so playback moves on. Or fall back to the motion preview for that shot.
- Verifier: playScene checks that clips are ready only at start (KeyframesView.tsx:211-222). Nothing later stops the playback when the overview changes: the only reset is the scene-change effect at :118, plus openShot, regenerate and confirm. Preview mounts <Clip> only when `playing === 'clip' && shot.video.state === 'ready' && shot.video.artifact` (Preview.tsx:194). The motion effect returns early unless playing === 'motion' (:124). The only ways to advance are Clip's onEnded/onError and its failed-source effect (:300, :315-316). An edit outdates a clip: the video state becomes 'outdated' (studio-api.ts:36,47), so a later shot that became outdated or running, or the current shot edited mid-play from the inspector, renders no Clip and nothing calls onEnded. The playback object stays set: the button shows the stop icon, VideoPanel gets playing=true (KeyframesView.tsx:357), and keyframeVisible is false (Preview.tsx:95), so 'Opened' is not recorded for that frame while it sits there. The person can recover by pressing stop or Play scene, which toggles it off. It needs an edit, Undo or another window's change during a short playback, and loses no data or money, so minor is the right severity.


## skills-current — Director skills in use (v6, v5, plan-authoring, production)

### Map

How the skills load and lock. apps/server/src/application/director-input.ts createDirectorInput runs on every Director turn and picks the lock in this order: (1) the lock already pinned to the epoch (director_epoch_lock); (2) DirectorToolSettings.currentForFreshTurn (director-tools-upgrade.ts), native turns only, which re-verifies the newest saved lock against freshly shipped bytes and moves any verified older lock up to contract 5.0.0 with guidance v6; (3) a new default lock, which is bootstrapped. createDirectorSkillLock (director-capabilities.ts) maps 5.0.0 to skills/v6, 4.0.0 to skills/v5 (or v4), 2.0.0 and 3.0.0 to v2 and v3, and 1.0.0 to the root skills/. It then calls loadSkillCatalog and createSkillLock in packages/director/src/skills/index.ts, which validates the manifest, frontmatter and declared links, writes a read-only content-addressed snapshot, and pins the 9 STAGES prompts. verifySkillLock re-checks the lock digest, bindings and snapshot hashes. DirectorContextService.capture/readSkill (director-context.ts) activates the lock and reads every declared file through hash-checked reads. The model context then gets four things: filmPlanning (film-planning-guidance.ts: the notes schema, examples and procedure, which is mutable host guidance), every skill reference file, the toolContract, and the instructions. On native runs, codex.ts requires the enabled skills to equal exactly the pinned SKILL.md paths.

How the tools run. ToolInvocationService.invoke (tool-invocations.ts) validates arguments with parseToolArguments (packages/core/src/tools.ts). Only record_notes gets field-level error messages. Then:
- propose_change goes to director-proposals.ts proposeChange. The patch can only carry desiredFrames, motion, imagePrompt, videoPrompt and narration on shots, plus purpose on scenes. A person accepts it through proposalCommand, which calls publishHumanCreativePatch. A proposal goes stale when a shot revision changes.
- record_notes goes to director-notes.ts recordNotes. It checks that the anchor is in scope, that a linked proposal stays inside the anchor, that a blocking note has a keep choice, and that seenKeyframe matches request_keyframe_projection.
- prepare_change goes to service.prepare. That holds the request, applies the creative patch, compiles any source and binds grants. When no grant exists it fails with ORIGIN_NOT_AUTHORIZED, which tool-invocations turns into an awaiting_human_generation result with nothing saved.
- apply_change goes to publishPreparedChange.

Real generation. The scene press in scene-generation.ts issues grants to its own app request and publishes through applyCompiledSceneGeneration. scene-row.ts decides whether media is current: imageCurrent and videoCurrent compare each node's intentDigest with shotIntentDigest (packages/core/src/planning/index.ts), which covers purpose, action, framing and references, plus motion, frames and cue for video.


### skills-current-1 [major → major] confirmed

**A shot's purpose, action or framing cannot be proposed, but changing them outdates its paid keyframe and clip; the V6 skills steer the Director to apply them directly**

- File: `packages/core/src/tools.ts:106`
- Scenario: Shot 3 has a generated keyframe and a Viggle clip. The person asks to make shot 3 a close-up, or to shorten the shot descriptions; the host guidance itself says shot purpose holds the long descriptions. V6 notes.md says that changes which outdate paid media must go through propose_change. The patch shape it gives, and the schema, have no purpose, action or framing field. The V6 example.md says to handle a close-up revision by updating the saved shot intent directly. So the Director treats framing or purpose as harmless text and calls prepare_change and apply_change with updateShots {framing:'Close-up', reauthorPrompts:true}. The server accepts this with no media check. The shot gets a new revision and the image and video intent digests change. The paid keyframe and clip become outdated without any Now/After preview, and the person has to pay again to regenerate. If the Director proposed the prompt change first and then applied framing directly, its own held proposal goes stale (SHOT_CHANGED), so the person cannot accept it either. The other path, proposing only imagePrompt, leaves the shot labelled Wide with a close-up prompt.
- Evidence: tools.ts:106-113: proposalPatchSchema.updateShots allows only id, desiredFrames, motion, imagePrompt, videoPrompt and narration, with additionalProperties false. planning/index.ts:84: `const common = { purpose: shot.purpose, action: shot.action, framing: shot.framing, references: ... }` feeds both the image and the video intent digest. A throwaway script confirmed that changing framing changes both digests. scene-row.ts:39 (imageCurrent) and the videoCurrent check both need node.intentDigest === shotIntentDigest(shot, ...). service.ts:291-317 plus finalizePreparedChange: a creative-only Director preparation checks no media impact; the only guards are scope and human-field. skills/v6/production/references/notes.md:7 says 'Apply directly only pure text changes that do not outdate paid media ... must use propose_change with {patch:{updateShots:[{id, desiredFrames?, motion?, imagePrompt?, videoPrompt?, narration?}]...'. skills/v6/plan-authoring/references/example.md:48 says 'For a close-up revision, update the saved shot intent and deliberately reauthor/reconfirm prompts, then prepare a replacement source'. film-planning-guidance.ts:21 says 'Put longer visual descriptions in shot purpose, action...'. director-proposals.ts:30 makes a proposal stale when the shot revision changes. Card B9 confirms the field set was chosen on purpose and that this gap was not noticed.
- Fix: Make the boundary enforceable. In the 5.0.0 Director prepare/apply path, refuse creative updates that change shotIntentDigest inputs (purpose, action, framing, references), the prompts, desiredFrames or narration on a shot with current or retained paid outputs. Return a typed code such as PROPOSAL_REQUIRED that names the fields. In the successor catalog, add purpose, action and framing to the propose_change patch. Until then, the mutable guidance should state that shot purpose, action and framing are picture inputs, and that on shots with media they must be proposed or left for the person to edit in Plan, where the UI shows the impact.
- Verifier: I traced this through the code and could not refute it. (1) packages/core/src/tools.ts:106-116: proposalPatchSchema.updateShots allows only id, desiredFrames, motion, imagePrompt, videoPrompt and narration, with additionalProperties false. A script against the built core showed that propose_change with {framing:'Close-up'} fails with VALIDATION_ERROR, while prepare_change with updateShots {framing, reauthorPrompts:true} parses. (2) packages/core/src/planning/index.ts:84: shotIntentDigest's `common` includes purpose, action, framing and references, for both image and video. apps/server/src/scene-row.ts:39-41 (imageCurrent) and the video recipe/videoCurrent checks require node.intentDigest === shotIntentDigest(shot, ...). So a purpose, action or framing edit makes the keyframe and the clip non-current. (3) Nothing on the server stops a Director from applying this directly. service.ts prepare (291-317), assessCompiledChange, finalizePreparedChange (impact is [] when there is no source, so no grant check) and apply (534-544) only check scope (checkFootprint), human-field conflicts (human-fields.ts:28) and stage requirements (workflow/index.ts:196, which needs only a brief and a scene). There is no media-impact check, and nothing in the code base raises PROPOSAL_REQUIRED. (4) workflow/index.ts:165 gives the shot a new revisionId for any non-narration-only change, and director-proposals.ts:30-34 marks a held proposal stale (SHOT_CHANGED) when the revision changes. So the 'propose prompts, then apply framing' path makes the Director's own proposal stale, as claimed. (5) The guidance pushes toward direct apply. example.md:48 says to update the saved shot intent for a close-up. notes.md:7 gives a propose_change shape without framing, purpose or action. film-planning-guidance.ts:21 calls purpose and action the home for longer descriptions and tells the Director to shorten fields the person asks to revise. Nothing tells the Director that these fields are picture inputs, so 'shorten the shot descriptions' looks like pure text. The binding outputs are kept, so the media is outdated rather than deleted. But there is no undo for a direct Director apply, and restoring currency needs the exact old text, so in practice the person must regenerate (Viggle is paid) before export (storyboard-capture clip_outdated). The B9 card confirms the field set was chosen on purpose, and the D1 rule (paid-media changes are proposed) is enforced only by guidance. That gap is real.


### skills-current-2 [major → minor] confirmed

**The current V6 skills still tell the Director to write image and video plan declarations and requestNewTakes, which the app now always refuses**

- File: `skills/v6/production/references/stages/storyboard.md:5`
- Scenario: The person asks 'plan scene 1 and get the storyboard keyframes ready' or 'give me another take of shot 2'. The storyboard and video stages, the shot_plan stage, the contract and the plan-authoring grammar all say to save the shots, read their IDs, and then author source with p.image, p.humanReview and p.video, or use requestNewTakes. In the current app, generation grants are only issued to the scene press's own app request, so the Director's request never holds one. Every such prepare_change fails with ORIGIN_NOT_AUTHORIZED and comes back as awaiting_human_generation. The grammar says intent edits and replacement source 'can be prepared together'. If the Director follows that, the creative edit in the same call is rolled back too ('This call saved no writing'), so it must notice and save again. This is the generation-preparation failure seen in the real runs. The host procedure only overrides it for save-only requests.
- Evidence: stages/storyboard.md:5 says 'Use the plan-authoring grammar to declare image work and exact review membership'. stages/video.md:3 says 'Translate settled shot motion into a supported video declaration', and video.md:7 says 'use the current video node ID in requestNewTakes'. stages/shot_plan.md:5 says 'read their saved IDs before writing executable source'. current-contract.md:28 says 'apply the creative draft, read its saved IDs, then author the plan', and current-contract.md:32 covers requestNewTakes. production/SKILL.md:32 says 'Use plan-authoring when producing executable declarations'. plan-authoring/references/grammar.md:11 says 'Existing-shot intent edits and replacement source can be prepared together', and example.md:48 says 'prepare a replacement source'. service.ts:375 raises ORIGIN_NOT_AUTHORIZED ('Human generation authorization is required'). tool-invocations.ts:228-233 turns that into awaiting_human_generation with nothing saved. scene-generation.ts:548 authorizes grants only for the scene request's own actor. film-planning-guidance.ts:20 limits the override to 'a save-only request'. docs/ai/uiux-plan/codex/reports/B23-live2-findings.md:49 lists the needed V6 successor as still pending.
- Fix: Publish the successor package proposed in B23. It should drop the image and video declaration and requestNewTakes guidance from the storyboard, video and shot_plan stages, current-contract, grammar and example, and should say that scene actions build all keyframe and video work. Until it ships, widen the mutable guidance from 'save-only request' to every request: never author p.image, p.humanReview or p.video, and never request new takes; only timeline and render source is allowed. Also never combine creative edits with source in one prepare_change.
- Verifier: The cited skill text is all present: storyboard.md:5, video.md:3 and :7 (requestNewTakes), shot_plan.md:5, current-contract.md:28 and :32, production SKILL.md:32, grammar.md:11 ('Existing-shot intent edits and replacement source can be prepared together') and example.md:48. It contradicts the app. Grants are created only by the scene press's own request (scene-generation.ts:534-554 authorizes only when no actor is supplied), by scene confirmation (scene-confirmations.ts:112, for its own request) and by demo routes. continuedRequestAuthorities only follows request_continuation edges. So a Director request never holds an image or video grant, and service.ts:375 raises ORIGIN_NOT_AUTHORIZED for any p.image, p.video or requestNewTakes node. I lowered the severity from major. tool-invocations.ts:228-237 turns that refusal into awaiting_human_generation, which explicitly says nothing was saved, gives no prepared ID, and tells the Director to save writing without source and to use the scene actions. No money, grant or integrity effect is possible. Prepare never saves anything on its own, so the 'rolled back' wording is loose: the combined call simply prepares nothing. The host guidance also describes the scene actions (film-planning-guidance.ts:10, :31). The remaining cost is wasted turn time and recovery steps for requests that are not save-only. B23-live2-findings.md:49 already lists the successor skill as pending.


### skills-current-3 [minor → polish] confirmed

**The scene_plan stage tells the Director to pack planning intent into scene purpose, which the studio displays as the scene title**

- File: `skills/v6/production/references/stages/scene_plan.md:5`
- Scenario: While planning scenes, the Director follows scene_plan.md: 'Include concise planning intent in the purpose when useful', because there are no ordering, timing or narration-range fields. It writes createScenes purpose as something like 'Dawn harbor; covers narration lines 1-3, ~20 s, opens from black and cuts to the ferry ramp'. The scene schema has no title field, so that sentence becomes the scene header and pill text in Plan, Keyframes and Assets. This contradicts the host rule that purpose is a short name of about 6 words and that scene-level explanation belongs in story. The skill text is the more specific of the two instructions, and this is the long-scene-name failure seen in the real runs.
- Evidence: scene_plan.md:5 says 'Include concise planning intent in the purpose when useful'. The same text is in skills/v5 and the root skills/production. film-planning-guidance.ts:21 says 'use createScenes/updateScenes.purpose as that short name ... scene-level explanation in story'. apps/web/src/next/model/assets.ts:263 has `title: scene.title || scene.purpose`, and plan-import.ts:108 has `scene.title?.trim() || scene.purpose`. B23-live2-findings.md:41-49 confirms the cause and that the skill successor is pending.
- Fix: In the successor package, rewrite scene_plan.md: purpose is the short scene name (at most about 6 words), and coverage, timing and narration range go into story, or into a dedicated title/description split once the schema adds one.
- Verifier: The contradiction is real. scene_plan.md:5 says 'Include concise planning intent in the purpose when useful', right after noting that there are no ordering, timing or narration-range fields. film-planning-guidance.ts:21 says purpose is a short name of about 6 words and that scene-level explanation belongs in story. However, the reviewer missed a mitigation. The scene title every view shows comes from generation-overview.ts:21-24 sceneTitle(), which uses the human title when set and otherwise only the first sentence of purpose. assets.ts:263 and plan.ts:281 read that overview title, not the raw purpose. Plan also shows the full purpose separately as the scene 'direction' (plan.ts:282). So a long header appears only when the planning intent is written as one run-on sentence. The impact is display only, the host guidance states the rule explicitly, and B23 already tracks the successor. Severity lowered to polish.


### skills-current-4 [minor → polish] confirmed

**The V6 narration guidance sends the person through separate script, audio and timing acceptance steps that the app has replaced with scene confirmation**

- File: `skills/v6/production/references/narration.md:13`
- Scenario: After a narration proposal is accepted, the Director follows narration.md: 'Tell the user which sections need exact review. The human uses narration controls to upload/attach recordings, set trims/placement, accept script/audio/timing and review/apply the canonical change.' It then tells the person to accept the script, audio and timing for each section. The Last Ferry UI has no such per-section acceptance or trim controls. The app's own instructions say that one scene confirmation saves the exact script, recording and timing, and that the Director must not direct the person through per-shot acceptance. The person is told about steps that do not exist, and the shipped current guidance contradicts the runtime instructions.
- Evidence: skills/v6/production/references/narration.md:13 says '...accept script/audio/timing and review/apply the canonical change'. director-input.ts:48 says 'The studio scene confirmation saves exact narration recording and timing without another narration review. Do not direct the human through per-shot acceptance.' audio-operation-context.ts:80 says 'One studio scene confirmation ... saves exact script, recording and measured within-shot timing acceptance; do not ask for a separate narration review.' film-planning-guidance.ts:10 says 'Scene confirmation saves exact script, recording and timing together; no separate narration review is required.' A search of apps/web/src/next found no script, audio or timing acceptance controls.
- Fix: In the successor narration.md, replace that paragraph with the scene-confirmation flow: the person reviews keyframes, motion and narration and confirms the scene once; listening and recording edits are optional.
- Verifier: The stale text exists. skills/v6/production/references/narration.md:13 tells the person to use narration controls to 'accept script/audio/timing and review/apply the canonical change'. NarrationPanel.tsx and model/narration-*.ts have no script, audio or timing acceptance or trim controls; narration-recording.ts:15 attaches a recording and accepts it automatically when it fits. But V6 locks run with audioRequests=true (director-input.ts:31). The system instructions sent with every turn (director-input.ts:48) say that locked skill instructions are 'historical compatibility text' and that current application policy takes precedence. They also say outright: 'Do not direct the human through per-shot acceptance.' film-planning-guidance.ts:10 and :31 repeat that no separate narration review is needed. The contradiction is explicitly overridden by a higher-priority instruction, so the Director is unlikely to follow it. Lowered to polish.


### skills-current-5 [minor → minor] confirmed

**propose_change and prepare_change schema errors carry no field path, while the V6 skills point the Director at the fields that trigger them**

- File: `packages/core/src/tools.ts:232`
- Scenario: The V6 rules require propose_change for narration changes. grammar.md, in the same package, says shot narration updates use 'reauthorPrompts: true', and current-contract.md lists purpose, action and framing as updateShots fields. So the Director sends propose_change {patch:{updateShots:[{id, narration:{...}, reauthorPrompts:true}]}} or includes framing. The bridge validates locally and returns only 'Tool arguments do not match the registered schema', with no field path, which a throwaway script reproduced. The Director cannot tell which field to drop. It either retries blindly or falls back to prepare_change and applies the change directly, which is the bypass described in skills-current-1. record_notes got detailed path messages after the anchor.shotId failure in the real runs, but the other 5.0.0 tools did not.
- Evidence: tools.ts:228-232: only record_notes calls recordNotesValidationMessage; every other tool hits `invariant(valid, "VALIDATION_ERROR", "Tool arguments do not match the registered schema")`. bridge.ts:57-59 validates every tool except record_notes locally with parseToolArguments before any HTTP call. skills/v6/plan-authoring/references/grammar.md:50 says 'Use `reauthorPrompts: true` for updates', and current-contract.md:26 lists 'purpose/action/framing/motion/duration/prompts ... and reauthorPrompts: true'. proposalPatchSchema (tools.ts:106-116) rejects both. A script run gave 'VALIDATION_ERROR | Tool arguments do not match the registered schema' for propose_change with framing and with reauthorPrompts.
- Fix: Reuse the safe path-and-constraint renderer from recordNotesValidationMessage for propose_change and prepare_change. List the allowed fields at the failing path, and never echo the supplied values. In the successor skills, state that propose_change takes no reauthorPrompts (the server adds it) and only the six shot fields.
- Verifier: The defect is confirmed, but the trigger is weaker than reported. tools.ts:228-233 builds a path-level message only for record_notes. Every other tool, including propose_change and prepare_change, gets the bare 'Tool arguments do not match the registered schema'. bridge.ts calls parseToolArguments locally for every tool except 5.0.0 record_notes. My script reproduced the pathless message for propose_change with framing and with reauthorPrompts, and for prepare_change with an unknown shot field. Two parts of the claim are overstated. notes.md:7 gives the exact propose_change shape without reauthorPrompts. grammar.md:50 and current-contract.md:26 describe the prepare_change creative patch, not propose_change. The MCP tools/list (stdio.ts:77-80) also exposes the full inputSchema with additionalProperties false, so the model can see which fields are allowed. The risk is real, because pathless refusals caused real failures for record_notes and could push the Director toward the direct-apply bypass in finding 1. But it is a lost-information problem in the error, not a direct integrity hole, so it stays minor.


## skills-legacy — Older Director skills (v2, v3, v4) and version handling

### Map

How a project's Director guidance and tool contract are chosen, upgraded and enforced:

1. Catalogs: packages/core/src/tools.ts builds TOOL_CATALOGS 1.0.0 to 5.0.0.
   - 1.0.0 uses the frozen V1–V3 grammar in legacy-change-schema.ts.
   - 2.0.0 drops narrationScript/narrationSource, and adds revise_narration_draft plus the `narration` context section.
   - 3.0.0 adds `audio_operations`, prepare_recording_transcription and prepare_narration_speech.
   - 4.0.0 clones the live workflow changeProposalSchema minus the global narration fields, which gives compact shot `narration`.
   - 5.0.0 adds `notes`, record_notes and propose_change.
   - parseToolArguments checks the catalog's own schema, then the current parseChangeProposal. Catalog digests are pinned in packages/director/test/tools.test.mjs:326.

2. Locks:
   - apps/server/src/application/director-capabilities.ts: directorSkillEnvironment sets four bindings (runtime, recipe, stage-check, handler = toolHandlerId + catalog digest). createDirectorSkillLock picks the guidance folder: 5.0.0→skills/v6, 4.0.0→v5 by default (v4 when asked), N→vN, 1.0.0→skills/.
   - packages/director/src/skills/index.ts: loadSkillCatalog/publish writes read-only snapshots keyed by packageDigest. createSkillLock builds the lock. verifySkillLock checks the lock digest, compatibility, the current bindings and snapshot integrity.

3. Per turn: director-supervisor.run → service.openEpoch (a new epoch every turn; native threads are never resumed) → createDirectorInput (director-input.ts).
   - No epoch binding yet → take the latest project lock.
   - Native only: DirectorToolSettings.currentForFreshTurn (director-tools-upgrade.ts:41-100) rebuilds the shipped lock for the saved version and guidance from the repository files. It requires exact equality, then installs a 5.0.0/V6 successor, or returns the saved lock if it is already 5.0.0/V6.
   - No lock at all → bootstrap a new one.
   - DirectorContextService.capture (director-context.ts) writes director_epoch_lock, then all declared references are read.
   - filmPlanningGuidance and the instruction tail in director-input.ts vary by version and by audioRequests (guidance major ≥5).
   - Native start (local-director.ts:388-431): verifies every historical codex lock and disables its skill paths.

4. Tool calls: ToolInvocationService.catalog (tool-invocations.ts:120) maps epoch binding → lock → catalog; an unbound epoch gets 1.0.0. invoke validates against that catalog.
   - Audio tools use prepareRequest (guidance ≥5) or the old prepare (V3/V4). Both go through pendingAudioReceipt, which creates a director_audio_request suggestion.
   - reconcileEpoch recovers receipts by version.
   - context-projection.ts, audio-operation-context.ts and application-capabilities.ts gate the notes and audio_operations sections and the capability text by version.
   - The bridge (packages/director/src/tools/bridge.ts) re-validates arguments locally against the locked version.

5. Reachability:
   - Native: every fresh native turn is upgraded before its epoch is bound, so V2–V4 guidance can no longer reach a live native model.
   - Fake mode: it is used only by fake-mode projects. The fake supervisor never upgrades, and its scripted runtime ignores skill text.
   - Historical locks: V2–V4 also exist to verify historical locks.
   - Their outdated text is therefore not live, for example:
     - V3/V4 audio-proposals point the person to "review in Story & narration" with "finite spending approval", but no route or UI consumes a Director proposal today.
     - The V2/V3 plan-authoring grammar's read_context list omits `narration`/`audio_operations`.
   - Do not edit this text (see the second finding).

6. Checked and found consistent:
   - Each version's skill text against its own catalog (fields, required keys, the reauthorPrompts rule, the mode=none cue clearing, the audio tool inputs and byte limits).
   - Catalog digests 1.0.0 to 4.0.0 have not changed since they shipped.
   - Old proposals cannot be applied by a later request.
   - Older epochs cannot reach notes or propose_change (NOT_FOUND / CAPABILITY_MISMATCH).

Repro scripts are in /private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad: v6-edit-bricks.mjs, v6-3b3edf7.mjs, v4-edit.mjs and startnative-history.mjs.


### skills-legacy-1 [major → major] confirmed

**Changing the current 5.0.0 catalog or skills/v6 in place permanently blocks the Director on every native project that already has a 5.0.0 lock**

- File: `apps/server/src/application/director-tools-upgrade.ts:74`
- Scenario: 1. A native project runs one conversation after 3b3edf7. It saves a 5.0.0/V6 lock with handler digest 78fdd6f6… and the 3b3edf7 V6 package bytes.
2. Commit 55460dc changed the 5.0.0 catalog in place (the pinned digest became e696fa19…) and edited 10 skills/v6 files without a version bump.
3. Every new message on that project now fails before dispatch with DIRECTOR_GUIDANCE_UNSUPPORTED. The person is told the guidance was "customized or unavailable" and to "Restore the matching application files". That is false and they cannot act on it.
4. There is no recovery path:
   - currentForFreshTurn returns or rejects a 5.0.0/V6 lock but never replaces it.
   - upgrade() has no target above 5.0.0, and its route is retired.
   - Switching the Director to fake and back to native installs a valid lock, but startNative still re-verifies the old 5.0.0 lock row against today's catalog and throws SKILL_COMPATIBILITY_MISMATCH. That throw happens after `attempted = true`, so the turn is saved as state "unknown" with dispatched:true even though no model started.
5. tools.ts:105 says 5.0.0 is "unreleased", which invites more in-place edits. The other review segments of this workflow are likely to propose V6 text changes, and applying them would block every existing native project.
Reproduced:
- v6-3b3edf7.mjs (real 3b3edf7 V6 bytes → DIRECTOR_GUIDANCE_UNSUPPORTED; old handler digest → cause SKILL_COMPATIBILITY_MISMATCH).
- startnative-history.mjs (valid latest lock plus the historical row → {state:"unknown", errorCode:"SKILL_COMPATIBILITY_MISMATCH", dispatched:true, runtimeStarted:0}).
- Evidence: - director-tools-upgrade.ts:74-85
  ```
  const shipped = createDirectorSkillLock(configuration, saved.lock.compatibility.toolContract, guidanceVersion);
  verifySkillLock(saved.lock, shipped.environment);
  invariant(... canonical(content(saved.lock)) === canonical(content(shipped.lock)), ..., "Customized Director guidance");
  successor = saved.lock.compatibility.toolContract === "5.0.0" && guidanceVersion === "6" ? saved.lock : ...
  ```
  The catch rethrows DIRECTOR_GUIDANCE_UNSUPPORTED with "Restore the matching application files".
- director-tools-upgrade.ts:17 and :121: upgradeTargets["5.0.0"] is empty.
- packages/core/src/tools.ts:105, `// B9: 5.0.0 is unreleased`; :117-122 v5Descriptors.
- `git log -G` on packages/director/test/tools.test.mjs: the 5.0.0 pin changed from 78fdd6f6… (3b3edf7) to e696fa19… (55460dc).
- skills/v6/production/openslate.skill.json is still version 6.0.0 after the 55460dc edits.
- local-director.ts:398-403: `for (const row of ...director_skill_lock...) { ... const environment = directorSkillEnvironment(configuration, row.lock.compatibility.toolContract); for (const skill of verifySkillLock(row.lock, environment)) ... }` is uncaught for every historical codex lock.
- director-supervisor.ts run(): `attempted = true` before `this.runtime.start`, and the catch saves `attempted ? "unknown" : ...`.
- Fix: 1. Freeze 5.0.0 and V6 now. Ship any later change as a new contract or guidance version (6.0.0/v7) that currentForFreshTurn upgrades to.
2. Alternatively, keep a pinned list of released identities for the current contract (5.0.0 handler digests and V6 package digests). Accept a saved lock that matches any listed identity and whose snapshots verify, then install a fresh current successor instead of requiring the saved lock to equal today's files.
3. In startNative, verify historical locks only for snapshot integrity, which is all that path disabling needs, or limit the check to the epoch's bound lock. Run that check before `attempted` is set so a refusal is saved as failed, not unknown.
4. Replace the "customized … restore files" message with an accurate one for this case.
- Verifier: I traced the code and reran the scenarios. The finding holds, with two scope corrections.

Flow:
1. LocalDirector prepare() builds the input through createDirectorInput (director-input.ts:23-27).
2. For a native turn with no epoch binding, that calls DirectorToolSettings.currentForFreshTurn (director-tools-upgrade.ts:41-100).
3. currentForFreshTurn rebuilds the shipped lock from today's repository files through createDirectorSkillLock (director-capabilities.ts:20-27). It runs verifySkillLock, which compares the bindings including the handler catalog digest (packages/director/src/skills/index.ts:329-342). It then requires the saved lock content to equal the rebuilt lock content (:80). This applies even when the saved lock is already 5.0.0/V6, and the catch replaces any error with the 'customized … Restore the matching application files' message (:83).
4. upgradeTargets['5.0.0'] is empty (:17), so nothing can replace a 5.0.0 lock.

Facts checked:
- 3b3edf7 and 55460dc are both on this branch, three hours apart, and neither is on main.
- 55460dc changed the pinned 5.0.0 handler digest in tools.test.mjs from 78fdd6f6… to e696fa19… and edited 11 skills/v6 files while openslate.skill.json stayed at 6.0.0.
- The /tmp old3b copy matches the 3b3edf7 bytes exactly.

Reruns:
- v6-3b3edf7.mjs: the old V6 bytes throw DIRECTOR_GUIDANCE_UNSUPPORTED; with the old handler digest the cause is SKILL_COMPATIBILITY_MISMATCH.
- startnative-history.mjs: {state:'unknown', errorCode:'SKILL_COMPATIBILITY_MISMATCH', dispatched:true, runtimeStarted:0}.
- My own scratchpad/skeptic-legacy/toggle.mjs drives the real changeSelection fake→native path (local-director.ts:242-262, which installs a replacement built from current files without checking the old lock):
  - V6 text-only edit: the turn first fails, then completes after the toggle. This case can be recovered, but only through a toggle nobody is told about.
  - 5.0.0 catalog edit: after the toggle the turn ends as unknown/SKILL_COMPATIBILITY_MISMATCH/dispatched:true with 0 runtime starts, on every message. This case is permanent.

Why the catalog case is unknown rather than failed: startNative (local-director.ts:398-403) re-verifies every historical codex-app-server lock row with full binding equality, and nothing catches the error. It runs inside runtime.start, which director-supervisor.ts calls only after `attempted = true` (:203). The catch at :257 therefore records 'unknown', and the status message says the turn 'ended without a confirmed result' (:94), although nothing was dispatched. That is false state. The 'customized' message is also false for an in-place app update.

Corrections to the finding:
- Already-realized damage is tiny. Only native projects that saved a lock in the 3-hour window on an unmerged branch are affected, and 5.0.0 is not on main.
- 'Permanent' is accurate only for catalog changes. V6 text edits are recoverable through the toggle.

I keep major because the code treats any saved 5.0.0 lock as immutable while tools.ts:105 labels 5.0.0 'unreleased'. The only thing standing between today and a permanent native Director outage on every project created on this branch since Oct 15 is a maintainer editing in place, which has already happened once and which this review workflow is likely to prompt.


### skills-legacy-2 [minor → minor] confirmed

**Historical skill packages are not digest-pinned, and any edit to them blocks the automatic upgrade for every project on that version**

- File: `apps/server/src/application/director-tools-upgrade.ts:76`
- Scenario: 1. A maintainer corrects V2–V4 text that this review shows is wrong for today's app. Examples: skills/v4/production/references/audio-proposals.md "Tell the human which exact work is ready for review in Story & narration … finite spending approval", or the V2/V3 plan-authoring grammar's read_context list, which omits `narration`/`audio_operations`.
2. The next native message on any project whose latest lock is V4 fails with DIRECTOR_GUIDANCE_UNSUPPORTED instead of upgrading to 5.0.0/V6.
3. The cause: currentForFreshTurn rebuilds the predecessor from the edited repository files and requires them to match the saved lock byte for byte, even though the saved snapshot is still intact on disk.
4. No test catches this. Only the tool catalogs are pinned; skill package digests are not, and the skills test compiles only the V1 example.
5. Because V2–V4 text can no longer reach a native model (every fresh turn is upgraded before binding), its outdated instructions are harmless as they stand. Editing them is the harmful step.
Reproduced in v4-edit.mjs: a one-line wording change to v4 audio-proposals.md → THROWN DIRECTOR_GUIDANCE_UNSUPPORTED.
- Evidence: - director-tools-upgrade.ts:75-80 rebuilds `createDirectorSkillLock(configuration, saved.lock.compatibility.toolContract, guidanceVersion)` from repository files and compares `canonical(content(saved.lock)) === canonical(content(shipped.lock))`. Lock content includes each skill's packageDigest and each stage prompt's sha256 (packages/director/src/skills/index.ts createSkillLock).
- director-capabilities.ts:23: `const root = version === "1.0.0" ? join(options.repositoryRoot, "skills") : join(options.repositoryRoot, `skills/v${guidanceVersion}`)`.
- No packageDigest pins in packages/director/test or apps/server/test; tools.test.mjs:326-338 pins only catalogs.
- skills/README.md: "Historical V1–V5 package bytes remain available for verifying existing immutable locks" is a stated requirement with nothing enforcing it.
- Fix: 1. Add a test pinning the packageDigest of every shipped historical package: skills/production, skills/plan-authoring and skills/v2 to v5, plus V6 once it is frozen.
2. Note in skills/README.md that historical text must never be edited, and that V2–V4 guidance is unreachable for native turns.
3. Better: verify a predecessor against that pinned list of shipped package digests plus its on-disk snapshot integrity, rather than rebuilding it from current repository bytes.
4. Leave the outdated V2–V4 instructions unchanged.
- Verifier: Mechanism confirmed, with a control run.

How it fails: currentForFreshTurn rebuilds the predecessor from current repository files and requires its content to equal the saved lock. Saved lock content includes each packageDigest and prompt sha256, and the package root is chosen by guidance version (director-capabilities.ts:23), so editing skills/v{2..5} breaks the comparison.

Reruns:
- v4-edit.mjs throws DIRECTOR_GUIDANCE_UNSUPPORTED (cause DIRECTOR_GUIDANCE_UNSUPPORTED).
- My control, the same script with both edits removed (scratchpad/skeptic-legacy/v4-control.mjs), prints 'OK upgraded to 5.0.0'. The text edit alone causes the block. In that script the effective edit is skills/v4/production/references/audio-proposals.md; the v3 grammar edit does not affect a V4 lock.

No guard exists:
- No test pins skill package digests. The only 64-hex pins are the tool catalogs in tools.test.mjs:326-338.
- director-guidance-maintenance and director-tools-upgrade tests build both the saved and the shipped locks from the current files, so they would still pass after an edit.
- No script or CI step checks skills/v*.

Why minor, not higher:
- Nothing fails as the files stand. The outdated V2–V4 text cannot reach a native model, because fresh turns upgrade to 5.0.0/V6 and in-flight epochs read their saved snapshots, not repository files.
- If someone did edit, the block can be undone through the same undocumented fake→native toggle. changeSelection installs a lock for the saved lock's own tool contract with that contract's default guidance from current files (for 4.0.0 that means V5). The next turn then upgrades it.

Value of the finding: it is a missing guard rail, plus a warning not to act on other segments' V2–V4 text findings.
