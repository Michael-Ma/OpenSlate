# Authority and workflow review — October 9, 2026

This is dated evidence for the earlier UI. The current next-only studio uses a durable server scene-confirmation command rather than the browser-owned sequence/checkpoints described here. See [current studio](STORYBOARD-STUDIO.md), [application routes](../technical/APPLICATION-API.md) and [status](../implementation/STATUS.md). The original results and development-session approval account below retain their historical scope.

## Outcome

Generation confirmation leaves its decision surface immediately. Workspace progress, errors, same-request recovery and Stop remain accessible. The previously blocked compact-shot narration compatibility fix was explicitly approved and is implemented. The full offline gate now passes 2,480 tests, with zero failures and one optional skip; all builds/typechecks pass.

Local recovery now preserves drafts and interrupted client scene work across reload. Backend jobs/output remain canonical. No live-provider calls, production data changes or production restart were used for validation.

## Two independent systems called “approval”

**Codex development execution review** is part of this coding session. The session uses a workspace-write sandbox and automatic review for eligible permission escalations. In the development session, this checkout was outside the configured writable roots, so repository-writing commands needed sandbox escalation. A separate reviewer assesses the exact proposed action and available task context; it can approve or deny that action and can make mistakes. This is neither OpenSlate's generation UI nor the project's code-review/test gate. It does not imply API credentials need another approval in the app.

Official documentation: [Codex Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review) and [Sandboxing](https://learn.chatgpt.com/docs/sandboxing). Those documents describe the product; the configured roots and reviewer mode above come from this actual session.

**OpenSlate application authority** records what an authenticated local user asked the application to do. Most of it is internal state integrity, not a screen or a confirmation the user should have to repeat.

| Layer | What it owns | What the user should see |
|---|---|---|
| Local browser session | Pairing/cookie/CSRF establish the local user at the API boundary | Connect to this local workspace |
| Human editing request | Saved user direction plus project/scene/shot scope | Normal chat or direct editing; no extra writing approval |
| Director epoch | Model proposals act under the current request; newer edits and Stop fence old proposals | A helpful Director, with Stop and clear current status |
| Application validators | Check declared changes, current revision, scope, immutable input identity and actual audio timing | Specific correction only when inputs really changed or cannot be used |
| Keyframe decision | Creates the requested scene/shot keyframes | One clear Generate keyframes action |
| Scene confirmation | Binds current returned keyframes, actual motion/duration/model recipe and narration | One Confirm & generate action; no separate narration listening/approval step |
| Execution candidate and attempt | Distinguish an authorized media version from a concrete provider submission; persist submission intent and reconcile uncertain outcomes | Progress, errors and Check existing request; no blind duplicate generation |
| Provider setup | Supplies configured models/accounts/keys and actual service availability | Choose the model; show actionable provider failures. No API-key approval or usage allowance prompt |

The Director proposes data; OpenSlate validates and applies it. Merely writing “approved” in model output does not manufacture authority. Conversely, backend records named acceptance, review, epoch or grant should not become extra user chores. The single scene confirmation can save the required narration records internally.

Source pointers: `apps/server/src/application/service.ts` (requests/epochs/scope), `scene-generation.ts` (scene decision), `execution/engine.ts` (submission/reconciliation), `narration/shot-audio-routes.ts` and `narration/generated-audio.ts` (exact narration evidence).

## The approved compatibility fix

File: `apps/server/src/narration/generated-audio.ts`, canonical generated-recording acceptance validation.

The previous predicate required the human request's scope list to include the **project ID**. However, the existing compact shot API deliberately creates a human request scoped to one **shot ID**. A genuine save for Shot 1.1 therefore failed with `GENERATED_NARRATION_CONFLICT` even after its recording and timing have been validated.

Implemented predicate, with all surrounding recording/timing/provenance checks retained:

```text
allow existing project-scoped evidence
OR
allow exact pinned-shot evidence only when all hold:
  within-shot placement
  authenticated local-user principal
  exactly one scoped shot
  immutable narrationAuthorScope proves that same shot
  narrationScopeTarget pins the same narration section
```

Example: a genuine Shot 1.1 request can save Shot 1.1's pinned narration section. It cannot borrow that request to save Shot 1.2, another section, another project, or different unverified audio. The patch creates no roles, provider calls, new scene permission or automatic retry. It uses helpers already integrated in `narration/narration-scope.ts`.

The exact change is in `apps/server/src/narration/generated-audio.ts`. Regression tests in `apps/server/test/generated-narration-http.test.mjs` cover the genuine compact endpoint, another shot/section/project/principal, multi-scope evidence, and historical backup/restore.

An earlier automatic execution review denied this edit over possible scope expansion. The user explicitly approved the exact bounded compatibility change on October 9. It has now been applied, reviewed and tested; no additional approval remains pending. That development-time review does not add a product approval screen.

## Interaction contract

1. Review keyframes, motion and narration once.
2. Click Confirm & generate. The application captures the exact command, closes the decision UI immediately and moves focus to the main workspace. It does not wait for an HTTP response or media completion.
3. Workspace activity reports requesting, narration generation/import/save, video request, or an actionable failure. “Request submitted” never means “media finished.”
4. Browse results, change views, inspect media, type a future draft, change appearance/language, or switch projects. A project's progress and draft stay with that project.
5. Stop and same-request recovery remain available. An unresolved command keeps its frozen original identity. Stop permits new direction; the backend fences old work. Already submitted provider jobs may still finish.
6. Only conflicting writes to the same project are temporarily held. Merely closing a dialog does not revoke a generation request.

## Local recovery design

The browser caches unsaved work under a public installation/restore namespace returned by the authenticated session API, plus the project and stable field/entity identity. Another data root or restore generation cannot adopt its cache. Origin isolation is supplied by browser storage. No cookie, CSRF value, API credential, file/blob, preview URL or voice consent is cached.

- Composer text, scopes, references, question target and saved-edit continuation are one atomic record with one expiry and revision. Missing/deleted targets remain visible and block Send until explicitly resolved. A stale tab cannot overwrite a newer record. A separate pending message retains its original frozen request/body/key.
- Director/media selections, project/shot text, imported brief text/name, narration editing, personal-voice text, Timeline duration, music volume and start retain local values and original bases. Fresh settings previews are still required. A restored selection never automatically applies. Successful responses cannot clear a newer local edit.
- Scene recovery keeps the parent command and all frozen step commands/results in one atomic document. Each new POST is checkpointed first. A per-project Web Lock covers latest-state import, dispatch and final cache cleanup. Reload only exposes an idle recovery action; explicit continuation revalidates the live project and reconciles the exact request before advancing.
- If a new step cannot be checkpointed and an older valid checkpoint exists, preserve that record and pause before the unsaved POST. Storage failure never closes navigation or claims durable recovery. With no usable storage from the beginning, local editing can continue in memory with a warning.
- Draft records expire after 30 days; scene hints expire after seven days. Draft storage is bounded to 128 records and roughly one million JSON characters per installation, with a 128 Ki-character per-record ceiling. A scene record is bounded to roughly two million JSON characters, up to 400 reviewed shots and 64 unfinished shots. Expired/invalid hints cannot authorize work. Backend jobs and saved project data are not removed when local hints expire.

This is browser-local recovery, not cross-device synchronization or a replacement for project backups. Clearing browser site data removes the cache. Unsent binary uploads need reselection after reload. Restoring a server backup changes the namespace; saved backend data remains, while older local recovery does not silently attach to the restored installation.

## Workflow audit

Evidence labels: **browser** means the actual built React UI in an isolated two-project synthetic fixture; **tests** means automated behavior tests; **source** means code-path review. No live provider calls or production-data mutations occurred.

| User workflow | Finding and change | Validation / remaining boundary |
|---|---|---|
| Confirm scene or create keyframes | Dialog used to remain until the entire operation completed. Now closes on synchronous command ownership, including fast errors. | Browser held-response scene; final fast-error and keyframe dismissal checks recorded separately; registry tests cover unmount and exact retries |
| Track background work | Progress used to belong to the unmounted dialog. Shared project/request progress now appears in workspace activity. | Browser held request, injected failure, exact retry, other-project isolation; tests reject stale progress callbacks |
| Navigate and draft | Scene work disabled project switch; modal prevented access to otherwise editable draft. Switch is now available; draft/reference editing stays local. | Browser preserves draft and selected shot across project switches, Day/Night and locale changes; question/IME regression tests |
| Stop or change direction | Stop must be reachable outside confirmation. Conflicting same-project writes remain fenced until resolution or explicit Stop. | Browser Stop after dispatch; server authority/retry tests. Submitted jobs may finish after Stop |
| Recover uncertain response | Retained command must not be silently replaced or auto-submitted on remount. Check existing request reuses the exact key/body. | Browser 503 then explicit successful retry; registry tests. Reload restores manual continuation; server attempts persist |
| Inspect keyframe/video | Failed preview had no direct repair action. Added Retry preview for the same immutable artifact, one localized error, and invalidation of stale viewing proof. | Browser failed image then successful retry; request log shows zero generation POSTs for the retry; media fencing tests |
| Settings lookup | Read-only model listing incorrectly locked dismissal. Now only a save is considered busy. | Source/type checks; held read dismissal browser scenario. Existing model-listing logic remains cancellable |
| Voice settings uncertainty | An unresolved saved command permanently locked Close. Now Close works after the request settles; reopening retains exact recovery. | Dedicated lost-response/remount test. No real voice registration performed |
| Timeline edit | Caller swallowed the save Promise; mobile failure appeared only in hidden chat. Real success/failure now reaches Timeline and alerts appear in the visible pane. | Browser injected revision conflict; unchanged shot order and visible mobile error. No false saved state |
| Export | Active render status and cancellation were hidden inside a collapsed disclosure. Active render section now opens automatically. | Source/type review and existing render tests; no live final export acceptance claim |
| Director guidance | Current context still requested separate narration review. V5 guidance now explains one scene confirmation, retaining evidence checks. | 58 targeted context/audio tests; frozen historical skill bytes unchanged |
| Scope and stale inputs | Keyframe decision discarded the actual reason for disabling generation. Now displays the real eligibility message. | Existing scope/changed-input tests and source review |
| Keyboard/focus | Closing/cancelling decisions returns to visible workspace; exact retry and dismiss actions retain useful focus. Question reply Enter remains enabled independently of reference picking. | Browser focus inspection and keyboard dismissal; targeted composer tests |
| Startup/reconnect/imports | Existing connection retry, saved import request recovery, and read-only recovery modes remain. | Source plus existing tests; no new real-installation acceptance claim |

## Remaining friction and limits

- Local draft/scene recovery is implemented. Browser site-data deletion, expiry and unavailable storage remain limits; backend jobs and outputs remain durable. The browser does not execute unsent stages while the page is closed.
- Settings may briefly protect an actual save while its HTTP request is outstanding. A settled uncertain voice response no longer traps the dialog; its exact retry remains.
- Unknown provider outcomes, stale input/revision, recovery quarantine and conflicting edits are real integrity restrictions. They should offer a precise explanation and resolution rather than another generic approval screen.
- The approved narrow generated-shot validator fix passes the genuine endpoint and negative provenance cases. Broader real-provider film quality acceptance remains separate from offline correctness.

## Verification record

- Full pinned offline gate: **2,480 passed, zero failed, one optional skip** (2,481 total); builds and all package typechecks passed. Frontend: **295 passed**.
- Astra designed and independently reviewed the recovery boundaries; GPT-6 Sol agents implemented the fixes. Astra independently ran 37 targeted tests, all passing, with no remaining material findings.
- Browser fixtures verified nonmodal dispatch and errors, reload preserving composer text/context and selection, settings/brief/failed editor drafts, failed music volume/start, stable exact-request recovery after an accepted-but-lost video response, and installation partitioning. Reload alone issued no generation POST. These tests used fake providers and locally normalized synthetic audio, not user media or real paid generation.
- Scene tests cover every accepted-but-lost operation, changed scope/head/request/writing, corrupt nested cache values, expiry, quota, cross-tab contention and locked settlement. The final cache validators reject unusable hints before runner hydration.
- No production database, job or returned response was modified; no production server restart occurred. The offline restart/edit/export demo passed with zero duplicate accepts and the untouched shot preserved. Hosted CI is checked on the published commit.
