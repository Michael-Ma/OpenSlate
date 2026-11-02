> Evidence appendix for ../UIUX-IMPLEMENTATION-PLAN.md, produced by a code-grounded gap analysis on 2026-10-14 against commit 2c4b6e3. Item ids (DC, GR, SB, WA, LG) are referenced from the plan.

# Web app architecture and cleanup (apps/web)

**Conclusion: build the new UI as a separate `src/next/` tree behind a reload-based switch. Do not grow `App.tsx` further.** The switch is `?ui=next`, remembered in localStorage. It works on today's server with no changes:
- the server falls back to `index.html` for extension-less paths (`apps/server/src/web-assets.ts:83-88`);
- a reload keeps the session (`StudioApi.connect()` with no code calls `GET /api/session`, `api.ts:21-30`).

The current UI moves unchanged to `src/legacy/`. Its 28 CSS files are loaded from a dynamically imported `legacy/entry.tsx`, so their `#root` rules and the 796 KB Radix Themes stylesheet never reach the new tree.

**What to keep, unchanged, in `src/shared/`:**
- `StudioApi`: idempotency keys, CSRF kept in memory, media verified by hash.
- The SSE parser and `ProjectSubscription`.
- `reference-model.ts`.
- The idea behind `PendingCommandRegistry`: one request identity per press.

**The new tree is built like the prototype and `film.js`.** It has one injected `ProjectStore` with a pure reducer, an adapter that turns today's snapshot into a normalized `Film`, and pure selectors for each design region. Selectors return codes and message ids, not English, and they decide each control's availability. This replaces the 47 `useState`, the global `disabled` flag and the always-visible Stop.

**i18n moves to typed message ids.** There is one catalog per language with ICU-style plurals, and errors are mapped by server code. Today about 780 `t("en","中文")` calls and about 500 sentence lookups use 1,874 lines of English→Chinese maps. This approach has already broken one action in Chinese (`DirectorPlan.tsx:53`).

**CSS becomes one token file** taken from DESIGN.md's colour roles, plus CSS modules. Inter stays self-hosted, because the server's CSP (`font-src 'self'`) blocks the prototype's Google Fonts.

**Layout bug, root cause from reading the code (to be confirmed by the browser test):** a Radix Select inside a `<form>` adds a hidden, absolutely positioned native select. It overflows the `overflow:hidden` `.workspace-grid`. The inline `AppDialog` then calls `scrollIntoView` (`ui.tsx:258`), which scrolls that grid.

**Delete now:** 3,728 lines that nothing imports. That is 7 files, not just the 2 the audit named, plus 3 CSS files.
**Delete later:**
- the scene saga, once the server owns the chain;
- `local-draft-cache` (keep only the composer draft);
- `DirectorPlan` and the legacy panels;
- Radix Themes, once each view has parity.

**Corrections to the inputs:**
- there are 28 CSS files, not 30;
- the draft cache has 39 read/write/clear calls (about 65 references in total), not 59 call sites;
- the dead code is about 3,700 lines, not about 1,850.

**Testing:** node `--test` for every pure module, including a golden fixture of The Last Ferry. Browser checks use a pinned `playwright-core` with system Chrome against a disposable fixture studio, never port 3001. Note that the dev proxy points at the live port 3001 today.

## WA-1 Two entry trees behind one boot: legacy (classic) and next [web, M, compatible_today=True, deps=]
- Design: Ship the Keyframes design incrementally while the current UI stays usable
- Current: main.tsx:8-36 imports all 28 CSS files (4,656 lines) globally before App; 25 of them are imported a second time by components; many rules are scoped `#root ...` (frame-shell.css:42-111, conversation-workspace.css:1-33, workspace-light.css:5-136) so anything mounted under #root inherits them. App.tsx is one 2,519-line Studio component with 47 useState. View lives in ?view= (WorkspaceNavigation.tsx:11-16). Server SPA fallback already serves index.html for extension-less HTML paths (apps/server/src/web-assets.ts:83-88) and a reload re-pairs without a launch code via GET /api/session (api.ts:21-30).
- Gap: New components mounted inside the current tree inherit legacy global CSS, the Radix Theme wrapper (Appearance.tsx:12) and App's global lock; there is no isolation boundary.
- Change: web: main.tsx becomes boot only: initializeLocale/initializeAppearance, then src/ui-mode.ts resolves 'next'|'classic' (?ui= beats localStorage 'openslate.ui', default classic, try/catch), then `import('./legacy/entry.tsx')` or `import('./next/entry.tsx')`. Commit 1 is a pure `git mv` of every current component, model and CSS into src/legacy/ (no edits). Commit 2 moves the CSS imports from main.tsx into legacy/entry.tsx (Vite's per-chunk CSS splitting keeps them out of next). Framework-free modules move to src/shared/: api.ts, event-stream.ts, project-subscription.ts, studio-launch.ts, model.ts (types + command builders), reference-model.ts, pending-command.ts, locale-model.ts, appearance-model.ts. next top bar gets a 'Classic view' link; classic header gets 'Try the new view'; next's Plan/Assets/Film tabs deep-link to ?ui=classic&view=plan|assets|cut until designed.
- Risk: Large move diff: keep it a no-edit commit so blame and bisect survive. Switching modes is a full reload; the classic composer draft is not visible in next (migrate text once in ui-mode on first switch). CSS from a dynamic chunk loads after JS: set color-scheme/background in index.html to avoid a flash.
- Tests: unit: test/next/ui-mode.test.mjs (query vs storage precedence, invalid values, storage that throws). Build check: after `vite build`, assert the next chunk's CSS contains no `.rt-` or `#root ` selectors. Browser: load both modes against the fixture studio, zero console errors, reload keeps session.

## WA-2 Shared session module and a next Connect screen [web, S, compatible_today=True, deps=WA-1]
- Design: Entry to the studio for both UIs (launch code, reconnect, session expiry, disconnect)
- Current: connect/disconnect/onSessionExpired live inside App.tsx:2471-2519; the Connect UI is Radix-based in components.tsx:198ff; the hashchange reconnect listener is App.tsx:2495-2503. ApiError's constructor converts the code to an English sentence (api.ts:7 via model.ts:430-527) and discards the server's `message` (api.ts:90).
- Gap: next cannot reuse a React component from legacy without its CSS; error objects carry English instead of a code-first shape.
- Change: web: src/shared/session.ts exports connectStudio(location, history), disconnectStudio(api), and wires onSessionExpired; ApiError gains `status` and `detail` (server message) while keeping `message` for legacy until it is deleted. next/app/ConnectScreen.tsx (no Radix) with language switch available before a film opens.
- Risk: Single-use launch code: StrictMode double effects must exchange it once (components.tsx:203-207 guards with a ref; keep that guard in the shared module, not the component).
- Tests: unit: session.test.mjs with fake fetch (code exchanged once, invalid csrf rejected, expiry callback); existing api.test.mjs keeps passing. Browser: open fixture URL in next mode, reload, disconnect.

## WA-3 Keep the transport layer (StudioApi, SSE parser, ProjectSubscription) as is [web, S, compatible_today=True, deps=WA-1]
- Design: Live 'Saved locally' pill, per-shot progress, Director 'Working…'
- Current: api.ts: idempotency-key header (line 88), CSRF in memory (10-19), 15 s default timeout (85), abort registry, hash-verified media (104-117). event-stream.ts: bounded SSE decoder. project-subscription.ts: 150 ms coalesced invalidation (40-46), backoff + 30 s polling fallback (82-96), visibility/focus handling, cursor validation (47-63). Events are hints; payload names are ignored. Tests exist (api.test.mjs, event-stream.test.mjs).
- Gap: none for the Keyframes view. Director status is not pushed on SSE (backend.md, app.ts:301) so 'Working…' still relies on invalidation + GET P/director.
- Change: web: move unchanged to src/shared/. Optional later: pass event names (attempt.state_changed, tool.started) to the store so it refetches only the selected scene's generation view.
- Risk: None if moved verbatim; do not rewrite.
- Tests: existing tests move with the files; add one store-level test that an invalidation triggers exactly one coalesced load.

## WA-4 Single injected ProjectStore with a pure reducer [web, L, compatible_today=True, deps=WA-1,WA-3]
- Design: One source for scene pills, banner, preview, inspector, cards, video panel and Director column (prototype `state` + `render`, film.js select/actions)
- Current: State is scattered: 47 useState in Studio (App.tsx:288-480); useProject (140-216) refetches snapshot + director per invalidation and review only when head/plan/cursor changes (178-187); providers fetched separately (521-538); per-scene generation views fetched inside ConversationActions.tsx:205 and FrameDecision.tsx:46; recovery status lives in RecoveryPanel.tsx:67 and is pushed up via onState; a reset effect clears ~15 pieces of state on project change (495-513).
- Gap: Separate fetches and local state are why the same status shows in five or six places and disagrees (audit finding 6).
- Change: web: next/state/store.ts (ProjectStore {getState, subscribe, dispatch}) constructed with {api, subscribe: projectSubscription, storage, now, uuid}; next/state/reducer.ts pure (State, Event) => State; next/state/load.ts: per invalidation GET P, P/director, P/review (only on signature change, as today), P/providers (on project change), /api/installation/recovery, and P/scenes/:id/generation for the selected scene; next/state/use-store.ts = useSyncExternalStore + selector with shallow equality. State shape: {session, projects, projectId, data{snapshot, director, review, providers, recovery, sceneViews}, ui{view, sceneId, shotBySceneId, directorOpen, edit, toast}, composer, commands, exposures, connection}. Dev/test builds expose window.__openslate = {getState, actions} (the prototype's window.LastFerry hook).
- Risk: Out-of-order responses and project switches: keep one AbortController per load and the projectId guard that App.tsx:156-204 has; never merge a response into a different project.
- Tests: unit: reducer table tests; load.test.mjs with a fake api (abort on project switch, stale response dropped, review fetched only on signature change, scene view refetched on scene switch).

## WA-5 Snapshot adapter and pure, code-returning selectors [web, L, compatible_today=True, deps=WA-4]
- Design: Scene pills with per-scene status, '2.3' shot labels, Opened/Not opened, Takes, durations, film length in the top bar, '1 of 3 frames opened'
- Current: project-results-model.ts derives media state but emits English labels ('Outcome unconfirmed', 'Keyframe needs attention' at lines 58-64; narration labels 70-77) that are then translated by sentence lookup. conversation-actions-model.ts mixes state with reason strings. Shot labels disagree: global index 'Shot {number}' (App.tsx:889-896) vs 'Shot {scene}.{shot}' (App.tsx:1311-1319).
- Gap: Selectors that return English sentences cannot drive two languages or be compared in tests; there is no single label function.
- Change: web: next/model/film.ts adapter toFilm(snapshot, review, sceneViews, providers) → Film {scenes[], shots[] with label 'n.m', durationSeconds, keyframe {state: none|making|ready|stale|failed|unknown, artifact, takes}, video {...}, narration {text, recordedSeconds, fits}}. It reuses project-results-model's nodeState/attemptState logic but returns enums. Selectors in next/model/select/: top-bar.ts, scenes.ts, keyframes.ts (current shot, preview, inspector rows), shot-cards.ts, video-panel.ts (opened count, blocking reasons, price), director.ts, composer.ts. Mirror film.js `select.*` naming. When the backend ships a board projection, add a second adapter; selectors stay the same.
- Risk: Divergence from the classic UI's status while both exist: run both selectors against the same fixtures during migration.
- Tests: golden fixture test/next/fixtures/last-ferry.json (snapshot + review + scene view for 3 scenes, 8 shots) asserting prototype facts: 48 s film, 'Scene 2 · 3 shots · keyframes back, no video yet', 1 of 3 opened, Confirm disabled with 'open 2.2 and 2.3' reason; label numbering after a shot move.

## WA-6 Per-control availability replaces the global disabled flag and the idle Stop [web, M, compatible_today=True, deps=WA-5]
- Design: Only the affected control waits and says why; Confirm enabled only when every frame is opened and blocking notes are settled
- Current: `disabled = mutationsDisabled || protectedTool || sceneMutationBlocked` (App.tsx:873-883) gates nearly every control; protectedTool is any busy inline card (380-392); recoveryReadOnly starts true (294) until RecoveryPanel polls; canStopWork returns true whenever any plan node lacks an output (model.ts:259-261), so Stop shows while idle (stop-availability.test.mjs pins this behaviour).
- Gap: One flag freezes the whole app while anything is in flight; the design needs a reason per control.
- Change: web: next/model/select/availability.ts with canSend, canOpenFrame, canEditShot(id), canRegenerate(id), canConfirmVideo(sceneId), canStop, each returning {enabled, reason?: MessageId} from session, connection, recovery (fetched in boot; 'unknown' disables only mutation controls), director status, paused, per-scene busy, and unresolved commands on that target. canStop = director running/waiting or an attempt in preparing|submitting|remote_pending|ingesting; drop the plan-node clause. Rewrite stop-availability.test.mjs for next.
- Risk: Being too permissive could send a write the server rejects: the server still fences everything (409s), so the worst case is a clear error, not a double spend. Stop sets a film-wide pause with no Continue in today's UI (digest); a Continue control needs the resume command (backend/product).
- Tests: table-driven unit tests per control; browser: during a running Director turn the inspector edit stays enabled where the server allows it.

## WA-7 One request-identity registry for every write, especially paid presses [web, M, compatible_today=True, deps=WA-4]
- Design: Confirm frames & generate video · about $1.50; Regenerate keyframe · about $0.04; safe retry after a lost response
- Current: pending-command.ts freezes body + key per area registry (lines 22-28, pendingCommandsFor). App.tsx keeps separate maps for messages (405-420, persisted through the local draft cache), actions (421, memory only) and stops (427), and repeats the uncertain-vs-definitive rule four times (591-596, 734-743, 784-795, 837-843: NETWORK_ERROR / INTERNAL_ERROR / REQUEST_FAILED keep the key). The UI has about ten wordings for 'not confirmed' (capabilities.md).
- Gap: A reload loses action keys, so a second press mints a new idempotency key and can charge twice (digest: request identity for paid presses).
- Change: web: next/state/commands.ts: one registry keyed by intent {projectId, kind, target}; the key is minted at press; isUncertain(error) keeps the command 'unconfirmed' and the same control becomes 'Check again', which re-sends the identical key; definitive errors clear it. Paid kinds are persisted to sessionStorage (namespaced by api.cacheNamespace) so a reload re-sends the same key. One message id command.unconfirmed.
- Risk: Money: losing a key means a possible double charge. Keep persistence write-before-POST like scene-command.ts does, and never auto-resend on load (STATUS.md:24: reload alone must produce no POST).
- Tests: unit: classify, retry same key, settle, reload restore, no POST on restore. Browser: fixture studio with a withheld response, reload, 'Check again' resolves through the original key (STATUS.md:28 already did this once for classic).

## WA-8 Video confirmation behind an interface; keep the browser saga only until the server owns the chain [web, M, compatible_today=True, deps=WA-7,WA-9]
- Design: SCENE n VIDEO panel, Confirm frames & generate video
- Current: The browser runs the chain: scene-command.ts:9-47 (Web Locks, localStorage checkpoints via scene-continuation-cache.ts, 271 lines) and scene-confirmation-model.ts (597 lines: per-shot narration initialize/generate/accept, then scene generate, lines 255-552). Closing the tab mid-run strands paid speech (audit 4). STATUS.md:53 records a generated-audio acceptance compatibility defect on this path.
- Gap: The design's single button must be a single server command to be safe; today it is a multi-request saga in the tab.
- Change: web: next/state/actions/confirm-video.ts depends on an injected SceneVideoStarter. Implementation A wraps the existing startSceneCommand, moved verbatim to src/shared/scene-saga/. Implementation B posts one server command once the backend ships the server-run chain. Then delete scene-confirmation-model.ts, scene-continuation-cache.ts, scene-command.ts and the 'conversation-scenes' registry (~950 lines) with scene-confirmation.test.mjs and scene-command-cache.test.mjs.
- Risk: Until B ships, next inherits the tab-close risk. Show 'Keep this tab open while the voice lines are made' only while A runs, and keep Stop reachable.
- Tests: unit: confirm-video with a fake starter (enabled rules, one call per press, same key on retry). Browser: fixture scene confirm end to end; after B, a test that closing the tab mid-run still finishes server-side.

## WA-9 Opened state that survives reload and unrelated edits [web, S, compatible_today=True, deps=WA-5]
- Design: Shot cards Opened / Not opened; 'n of 3 frames opened'; green segments
- Current: Exposures live in App state (App.tsx:393-395), are set by FrameWorkspace onFrameExposure (1026-1048), pruned on every snapshot (1049-1071) and cleared on project switch (499). The key includes projectRevisionId (conversation-actions-model.ts:68-77), so any edit anywhere resets all frames. framesReady requires them (conversation-actions-model.ts:151-159). A reload resets them; the Confirm modal shows no frames (audit 1).
- Gap: Opened must be visible, durable and tied to the exact picture bytes, not to the project revision.
- Change: web: next/state/exposures.ts keyed by (projectId, shotId, artifactId, sha256), marked when the preview <img> fires onLoad for that exact artifact (keeps today's 'displayed' semantics), persisted to sessionStorage per project, pruned when the shot's current artifact changes. The server still fences stale reviews (SCENE_REVIEW_STALE, scene-generation.ts:431-446). Server-side persistence of opened frames is a backend option (WA open question).
- Risk: Dropping revisionId from the key could let a frame count as opened after its prompt changed but before a new picture exists. Prevent this with the adapter's keyframe.state 'stale', which makes the frame 'Not opened'.
- Tests: unit: key, prune on artifact change, survives an unrelated text edit, restored from storage. Browser: open 2 frames, reload, count stays 2 of 3.

## WA-10 Director notes and the recommendation banner need structured data [cross-cutting, M, compatible_today=False, deps=WA-5,WA-7]
- Design: DIRECTOR RECOMMENDS banner (one note at a time, Now/After timeline, choices, Undo), lettered notes (a)/(b) anchored to shots, card callouts
- Current: The snapshot has conversation messages (model.ts:36-42, 89-97) and questions with options (model.ts:43-55); the nearest UI is the 'Saved / Next' card, DirectorPlan.tsx + director-plan-model.ts (438 lines, ~20 states). No recommendation entity, anchor or choice→command mapping exists.
- Gap: The banner cannot be built from free-text Director messages; Undo would need server undo semantics that do not null media (digest: undo nulls media bindings).
- Change: web: next/model/select/recommendations.ts reads `snapshot.recommendations ?? []` (shape agreed with backend: id, letter, shotIds, title, before/after, choices[{id, labelId|text, command, cost}]); views/keyframes/RecommendationBanner.tsx and views/director/NoteCard.tsx render nothing when empty; choices go through WA-7 commands; toast Undo only when the server returns an undo token. Delete DirectorPlan.tsx, director-plan-model.ts and director-plan.css with classic.
- Risk: Building the UI before the schema exists invites throwaway work: build behind the empty-array default and test with fixtures only.
- Tests: selector tests with fixture recommendations (order b then a, resolved view, quiet line); browser after backend lands.

## WA-11 Composer with one explicit @ target; selection never changes scope [web, M, compatible_today=True, deps=WA-4,WA-13]
- Design: Composer with @ chips, '@ 2.1' in the inspector, the user bubble with its @Scene 2 chip
- Current: One draft holds five targets: text, scopeIds, references, replyQuestionId, continuationRequestId (composer-draft-cache.ts:5-12). Six stale/conflict chips sit above it (App.tsx:1993-2102). chooseShot silently sets scopeIds (App.tsx:948-953). There is also a scope dropdown (1272-1325).
- Gap: The design has one targeting mechanism (chips); reply-to-question and continue-saved-edit have no place in it.
- Change: web: next/views/director/Composer.tsx + AtPicker.tsx (listbox, as in the prototype), reusing reference-model.ts (mentionAt, consumeMention, projectReferences, makeReferencedMessage). The target is the chip list only. Replying to a question is a visible mode entered from the question card. Continuation leaves the composer. next/state/composer-draft.ts stores {text, chipKeys} per project in localStorage (try/catch), with no revisions, TTL or quotas.
- Risk: 'Resume this edit' is the only user path that releases edit holds (digest; service.ts:132-142). Removing continuation needs a backend replacement or a plain 'Release' control.
- Tests: unit: chips → scopeIds, selecting a shot leaves the target unchanged, draft restore. Browser: type @, pick 2.2, send; the bubble shows the chip.

## WA-12 No synthetic user messages in the thread [cross-cutting, S, compatible_today=False, deps=WA-5]
- Design: Thread with 'You · 10:42' and 'Director · 10:44' bylines; presses are not messages
- Current: The client posts button text as user messages: 'Continue this earlier edit…' (App.tsx:1489), a pre-filled 'Continue this shot using its saved narration…' (App.tsx:1790), and image discussion (App.tsx:1841-1853). The server writes '(Re)generate keyframes/video for … this reviewed scene.' as a user message (apps/server/src/scene-generation.ts:655).
- Gap: next can stop the client-side ones, but server-written ones cannot be told apart reliably: messages carry only id/text/state/requestId/editing/scopeIds (model.ts:89-97).
- Change: web: next never posts a press as a message. Until the server tags origin (e.g. kind:'action'), the thread selector hides user messages whose requestId matches a scene command request and renders them as small event lines. Backend: add the origin flag.
- Risk: The Director's context still needs these presses (digest); hide them only in the view, never drop them.
- Tests: selector test with a fixture containing the server-written message; browser: after Confirm, no 'You' bubble appears.

## WA-13 i18n by message id with ICU-style plurals [web, M, compatible_today=True, deps=WA-1]
- Design: English and Simplified Chinese for every string in the design ('1 of 3 frames opened', 'about $1.50', 'Make 2.3 8 s')
- Current: Inline two-argument t('en','中文') appears about 780 times. Sentence lookups ui(text, map) appear about 500 times (rg counts: 782 and 499). They are backed by 1,874 lines of English→Chinese maps: media-ui-copy.ts 803, settings-ui-translations.ts 438, workbench-copy.ts 304, shell-ui-messages.ts 166, locale-ui-messages.ts 93, locale-errors.ts 70. translateUiText maps Chinese back to English in en mode (locale-model.ts:69-78). Plurals are chosen by English string (App.tsx:2141-2146). DirectorPlan.tsx:53 compares plan.action to t('scenes','场景'), so that action does nothing in Chinese.
- Gap: Sentence-keyed lookup breaks when copy changes, cannot express Chinese measure words, and leaks English from models.
- Change: web: next/i18n/messages/en.ts (`as const`) and zh-CN.ts (`satisfies Record<keyof typeof en, string>`); next/i18n/format.ts (~100 lines: {name}, {n, plural, =0{} one{} other{}} with #, {x, select, …}, Intl.PluralRules/NumberFormat; helpers for seconds '8 s'/'8 秒' and 'about $1.50' from micros); next/i18n/use-messages.ts → m(id, values). Keep the locale-model.ts preference functions and the LocaleProvider. User and Director text is never translated. Legacy keeps t/ui until deleted; do not migrate it.
- Risk: Missing zh strings at launch: the satisfies check makes them a type error, so a view cannot ship half-translated.
- Tests: unit: key parity, placeholder parity per key, every plural has `other`, formatter cases in both locales, a source scan that every m('…') id exists and no bare English literals appear as JSX text under next/views.

## WA-14 Errors mapped from server codes to messages [web, S, compatible_today=True, deps=WA-13,WA-2]
- Design: Plain reasons under disabled buttons and in toasts, in both languages
- Current: ApiError(code) → errorMessage(code) gives English for 48 codes, otherwise a generic sentence (model.ts:430-527). ui() then looks up Chinese by sentence (locale-errors.ts). errorText returns error.message (components.tsx:21). Client validations throw English sentences (model.ts has 12 throws; App.tsx:633-645). Cache warnings are matched by substring (App.tsx:1077-1078). The server returns {error:{code,message}} with 409 for every domain rejection, using about 273 distinct invariant codes across apps/server/src and packages/core.
- Gap: About 225 server codes fall through to one generic sentence; translation depends on exact English text.
- Change: web: next/i18n/errors.ts: describeError(e) → {id, values, detail?}. Codes map to about 8 situations (changed underneath, busy, needs your input, not configured, outcome unknown, failed, offline, session expired). Specific ids cover codes the Keyframes view hits (SCENE_REVIEW_STALE, REVISION_CONFLICT, EXECUTION_PAUSED, SUBMISSION_UNKNOWN, AUTH_REQUIRED, NETWORK_ERROR). An AppError(code, values) class replaces English throws in next. The server's English message appears only as a secondary detail.
- Risk: Category mapping can hide a specific fix: keep the code in a details line so support stays possible.
- Tests: unit: a scan test that every code literal in invariant(..., 'CODE', ...) under apps/server/src resolves to a message id (specific or category); en/zh render for each id.

## WA-15 One CSS token system matching DESIGN.md colour roles [web, M, compatible_today=True, deps=WA-1]
- Design: Neutral dark greys, amber only for the Director, white for chosen/primary, green for opened; Inter; 14 px body
- Current: There are 28 CSS files (not 30), 4,656 lines, in layered generations: style.css (old green sidebar palette and a .sidebar that no longer renders, line 5), precision.css, storyboard.css (minified light hex), workspace-light.css, frame-shell.css, and frame-theme.css (remaps about 40 Radix variables, lines 10-60). There are 146 distinct custom properties, 17 !important rules and #root-prefixed specificity. Inter is self-hosted (frame-theme.css:3-9, public/fonts/InterVariable.woff2).
- Gap: Old palettes and specificity layers fight any new look. The prototype loads Inter from Google Fonts, which the production CSP blocks (font-src 'self', apps/server/src/web-assets.ts:11).
- Change: web: next/styles/tokens.css holds exactly the DESIGN.md roles (--bar, --ground, --surface, --surface-stripe, --raised, --raised-2, --chip, --track, --hairline, --sunken, --text/-2, --muted, --amber, --amber-ink, --amber-line, --amber-surface, --green/-surface/-line, --select, --select-ink) plus type scale, radii and spacing. next/styles/base.css has a reset, @font-face from /fonts, a 2 px --select focus ring, prefers-reduced-motion and color-scheme: dark. Components use *.module.css. A node test enforces: no hex/rgb outside tokens.css, no !important, no #root, no .rt-.
- Risk: Day/Night is a promised feature (STATUS.md:10); the design is dark only. Name tokens by role so a light mapping can be added later without touching components.
- Tests: unit: css-rules.test.mjs over src/next/**/*.css. Browser: sampled pixel colours of the Opened pill, banner eyebrow and primary button match the tokens.

## WA-16 Do not use Radix Themes in the new tree [web, M, compatible_today=True, deps=WA-15]
- Design: Segmented tab pills, outline pills, chips, composer, dialog for Confirm/Settings
- Current: @radix-ui/themes 3.3.0: styles.css is 796 KB raw, and the built CSS is 828 KB (apps/web/dist/assets/index-*.css). It is used in 7 files (App.tsx:10, ui.tsx:17-24, components.tsx:14, Appearance.tsx:12, ImportMedia.tsx:4, WorkspaceNavigation.tsx:2, main.tsx:24) and is overridden by frame-theme.css. Radix Select's hidden input causes the layout bug (WA-17).
- Gap: The design's components are custom pills; using Themes means fighting its tokens, as frame-theme.css does today.
- Change: web: next uses native <dialog> with showModal (focus trap, Esc, inert), an in-house SegmentedTabs (role=tablist) and Listbox (@ picker, following the prototype's ARIA), and native <select> where a choice list is needed. Only if positioning demands it, add @radix-ui/react-popover pinned exactly at 1.1.23 (already in the lockfile through Themes). Remove @radix-ui/themes from package.json when classic is deleted.
- Risk: Accessibility regressions in hand-rolled widgets: keep them few (3) and cover them with keyboard browser tests.
- Tests: browser: keyboard-only pass over tabs, @ picker (arrows, Enter, Esc), dialog focus return; the next bundle's CSS is under 60 KB.

## WA-17 Fix the first audit's layout bug and make it impossible in next [web, S, compatible_today=True, deps=]
- Design: Top bar and tabs never scroll away
- Current: Mechanism from the code (to be confirmed by the browser test): DirectorSettings renders UiSelect inside a <form> (DirectorSettings.tsx:400, 433, 461), so Radix Select adds SelectBubbleInput, a native select with VISUALLY_HIDDEN_STYLES position:absolute (react-select dist/index.mjs:89, 1084-1124). The scroller .conversation-stream is not positioned, while .conversation-panel is position:relative (precision.css:20). The hidden select's containing block is therefore outside the scroller, at its static position far down the stream, and it overflows .workspace-grid. That grid is overflow:hidden (precision.css:19) but still programmatically scrollable, and the inline AppDialog calls content.scrollIntoView({block:'start'}) (ui.tsx:258), which scrolls it. The audit blamed only the hidden select; the scrollIntoView call is the trigger.
- Gap: Classic users hit it today; the same pattern would recur in any nested scroller.
- Change: web (classic hotfix, one commit): `#root .conversation-stream{position:relative}`; `#root .workspace-grid, #root .studio-shell{overflow:clip}`; replace the inline dialog's scrollIntoView with scrolling the .conversation-stream element itself. next rule: app shells use overflow:clip; every scroll region is position:relative with overscroll-behavior:contain; never call element.scrollIntoView across regions (scroll the region with scrollTo).
- Risk: overflow:clip disables programmatic scrolling of the shell, which is the intent; verify that sticky headers inside regions still work.
- Tests: browser: at 1440×900 open Model settings and each inline tool; assert .workspace-grid.scrollTop === 0 and the tab bar's bounding box is unchanged. Write this test first (reproduce, then fix).

## WA-18 Shared, refcounted artifact cache for verified images [web, S, compatible_today=True, deps=WA-4]
- Design: The same keyframe in the large preview and in its shot card; fast scene switching
- Current: useArtifact downloads and SHA-256-hashes the whole file per mounted component and revokes the blob URL on unmount (components.tsx:324-381; api.ts:98-117, 32 MiB image limit). Nothing is shared, so two views of one frame mean two downloads, and switching scenes re-downloads.
- Gap: The design shows each frame at least twice at once and switches scenes often.
- Change: web: next/state/artifact-cache.ts, a refcounted map keyed by sha256+kind → Promise<blobURL>, with a small LRU for released entries. Deps {fetchVerified: api.artifact, createURL, revokeURL} are injected. ui/ArtifactImage.tsx uses it and reports onLoad for WA-9. Backend option: immutable caching by sha256 (digest).
- Risk: Memory growth from blob URLs: cap the LRU (e.g. 24 images) and revoke on project switch.
- Tests: unit with fakes: one fetch for two subscribers, revoke after last release + eviction, a failed fetch is not cached, abort is respected.

## WA-19 Delete dead code now (phase 0) [web, S, compatible_today=True, deps=]
- Design: Audit finding 12 (dead code)
- Current: Unreachable from main.tsx (import-graph scan): NarrationPanel.tsx 1,856, NarrationSpeechPanel.tsx 403, OwnedTranscriptionPanel.tsx 501, TranscriptReviewPanel.tsx 657, owned-transcription-model.ts, transcript-review-model.ts, spending-model.ts: 3,728 lines (the audit named only NarrationPanel and spending-model). Their CSS (narration.css, owned-transcription.css, transcript-review.css) styles no live component, yet main.tsx imports it. Tests: spending-model.test.mjs, owned-transcription-model.test.mjs, transcript-review-model.test.mjs; codex-usage-model.test.mjs also imports spending-model. Lightbox onApprove is never passed (components.tsx:387-452 vs App.tsx:2459-2465). The demo('create') branch is never called (App.tsx:859-871). Server allowance/budget/spending routes are still registered (apps/server/src/app.ts:31, 114-116; server area).
- Gap: none
- Change: web: one commit deletes the 7 files, 3 CSS files and their main.tsx imports, the 3 tests, the spending part of codex-usage-model.test.mjs, the unused media-ui-copy entries, the Lightbox approve branch and the demo 'create' option. Add test/reachability.test.mjs (the import-graph scan) to fail on any unreachable src module. Keep narration-model.ts: ShotAudioPanel and the scene saga still use it.
- Risk: Low; the reachability test proves nothing live imports them. Server route removal is for the server area.
- Tests: pnpm check passes; the reachability test is green; vite build is smaller.

## WA-20 Retire the local draft cache beyond the composer [web, M, compatible_today=True, deps=WA-4,WA-11]
- Design: Inspector 'Edit prompt' / 'Edit motion & duration' with Save / Cancel; 'Saved locally' pill
- Current: local-draft-cache.ts is 265 lines with revisions, cross-tab conflict detection, quotas and TTLs. It has 39 read/write/clear calls (about 65 references counting imports and notices, not the 59 call sites the audit claimed) in 8 components: App, DirectorSettings, InlineField, PersonalVoicePanel, PlanImport, ProviderSettings, ShotAudioPanel, Timeline. It raises 9 warning texts (App.tsx:125-135) shown through useSyncExternalStore (290-293) and also persists the selected project/frame and pending messages (296-299, 405-420).
- Gap: The design has explicit Save/Cancel, so field drafts don't need cross-tab recovery.
- Change: web: in next, inspector edits hold their text in component state until Save, which sends POST P/storyboard with expectedHeadVersion (as App.tsx:1875-1883 does). On REVISION_CONFLICT, a pure next/model/conflict.ts keeps the typed text and offers 'Use saved'. next/state/prefs.ts persists only the selected project/scene/shot (plain localStorage, try/catch); WA-11 persists the composer. Delete local-draft-cache.ts, composer-draft-cache.ts and InlineField.tsx with classic.
- Risk: A user who closes the tab mid-edit loses the unsaved text: accepted trade-off (product), or keep a single sessionStorage slot for the open edit.
- Tests: unit: conflict.ts (keep mine / use saved); browser: an edit with a concurrent change shows the conflict and keeps the text.

## WA-21 Shell layout: 52 px top bar, 392 px Director column, narrow drawer [web, M, compatible_today=True, deps=WA-1,WA-15]
- Design: Top bar with Plan / Keyframes / Assets / Film and Saved locally; Director column; below 900 px a sticky top bar and a Director drawer
- Current: Header plus a resizable split (WorkspaceSplit.tsx: 260-640 px, default 380, persisted; workspace-layout-model.ts:1-46). The phone switch uses JS matchMedia at 760 px (App.tsx:396-404) and a Radix SegmentedControl (1183-1196). Six unlabeled icon buttons (1224-1271). Export opens a card in chat (1158-1169). New project is hidden among the conversation tools (1255-1260).
- Gap: Breakpoint, column width and tool placement all differ from the design.
- Change: web: next/app/Shell.tsx + Shell.module.css: a CSS grid (52 px bar / 392 px column / workspace); narrow layout in CSS only; store ui.directorOpen drives the drawer (Esc closes, focus returns, opening a shot from a note closes it). A labelled top-bar menu holds New film / Settings / Export / Language / Disconnect; until those are designed, the items open the classic UI. If resizing is kept, reuse workspace-layout-model.ts with DEFAULT 392.
- Risk: Losing the user's saved column width: read the old key openslate.director-width.v1 if resizing is kept.
- Tests: browser: region boxes at 1440×900 match DESIGN.md's measured result (bar 0-52, column 0-392, no page scroll); at 390×844 scrollWidth is 390 in every state; drawer Esc and focus return.

## WA-22 Keyframes view components built on selectors and actions [web, L, compatible_today=True, deps=WA-5,WA-6,WA-7,WA-8,WA-9,WA-13,WA-16,WA-18,WA-21]
- Design: Scene header + pills, keyframe preview with motion preview and scrubber, shot inspector, three shot cards with callouts, SCENE n VIDEO panel with price
- Current: FrameWorkspace.tsx is 1,421 lines (SelectedStage 222-575, ShotInspector 619-832, FrameShelf 833-996, PlanView 997-1220), driven by about 20 App callbacks (App.tsx:2270-2305). Keyframe requests go through the FrameDecision proposal card (App.tsx:1008-1025, 1723-1741). The scene decision is a modal that re-renders ConversationActions (App.tsx:2411-2458). There is no price at decisions; estimates exist per provider (provider-model.ts:5, 43-44).
- Gap: The design has no proposal card or modal; Regenerate and Confirm are single presses showing a price. Motion is free text, so the prototype's per-motion animation has no structured source. Prompt edits detach paid media (digest), which must show as 'Keyframe out of date'.
- Change: web: next/views/keyframes/: KeyframesView.tsx, SceneHeader.tsx, KeyframePreview.tsx (CSS transform preview chosen by keyword from the motion text, static otherwise and under reduced motion), ShotInspector.tsx (inline Save/Cancel → storyboard command; Regenerate → POST P/scenes/:id/generate with targetShotIds + regenerate, as FrameDecision does today), ShotCards.tsx, SceneVideoPanel.tsx (price = clips × video profile estimatedCost.unitMicros, labelled 'about'). Components hold no business logic: props come from selectors, callbacks go to actions.
- Risk: Money: a one-press Regenerate replaces today's proposal step, so the label must state count and price, and WA-7 must protect the key. The flat per-attempt estimate ignores clip length.
- Tests: browser on the fixture studio, porting the prototype's VALIDATION.md checks that today's backend supports: open frames → count, Confirm enable rule and reason, edit prompt → out of date + price, regenerate → Not opened, Takes 2; reduced motion keeps the picture still.

## WA-23 Test strategy: node --test for pure modules, pinned browser checks on a disposable studio [cross-cutting, M, compatible_today=True, deps=WA-1]
- Design: Every step has tests; pnpm check stays the gate
- Current: 47 web test files import src/*.ts through Node 24 type stripping (package.json test script; scripts/run-tests.mjs:17 globs only apps/web/test/*.test.mjs). TSX cannot be imported, so components are untested. There is no browser tooling in the repo; the prototype checks used an npx Playwright from the user's cache (scratchpad/proto/lf-check.js:1). tsconfig lacks erasableSyntaxOnly. There is no eslint or prettier config despite CLAUDE.md. The fixture studio hard-codes port 5173 (scripts/storyboard-review.mjs:60), which collides with vite's strictPort 5173, and ffmpeg at /opt/homebrew.
- Gap: No way to prove layout, focus or real-browser behaviour inside the gate.
- Change: web/scripts: add "erasableSyntaxOnly": true to apps/web/tsconfig.json; put next tests in apps/web/test/next/*.test.mjs and add that glob to run-tests.mjs. Add root devDependency playwright-core at an exact version (no caret), launched with channel:'chrome' so no browser download is needed. scripts/browser-check.mjs builds web, starts the fixture studio with a --port flag (free port, never 3001) and the pinned test ffmpeg, opens the printed #connect URL at once, runs the scenarios, then stops it. Expose it as `pnpm check:browser`, outside `pnpm check` because it needs Chrome.
- Risk: Flaky timing in browser checks: drive through window.__openslate state and data-act attributes rather than sleeps.
- Tests: the harness itself: one smoke scenario (connect, Keyframes renders, zero console errors) run in CI-like local mode.

## WA-24 Dev proxy must not point at the live instance [web, S, compatible_today=True, deps=]
- Design: Safe development of the new UI
- Current: vite.config.ts proxies /api to http://127.0.0.1:3001, which is the user's live server with real projects and paid providers (memory note: port 3001 is the live instance).
- Gap: Running `pnpm dev` while building next would read and write real data and could start paid jobs.
- Change: web: proxy target = process.env.OPENSLATE_API_ORIGIN ?? 'http://127.0.0.1:3101'; document starting the fixture studio on 3101 (WA-23's --port). Any connection to 3001 must be an explicit opt-in.
- Risk: Developers used to 3001 get a connection error until they start the fixture studio; say so in the README.
- Tests: unit: a vite config test that the default target is not :3001.

## WA-25 Rollout sequence and deletion gates [cross-cutting, L, compatible_today=True, deps=WA-1,WA-22,WA-8,WA-10]
- Design: Keep the current UI usable while next reaches parity view by view
- Current: Classic covers Plan, Keyframes, Assets, Film, settings, import, export, recovery and the demo (capabilities.md inventory). Only Keyframes is designed in the new system (inputs.md).
- Gap: Without explicit gates, both UIs would live indefinitely.
- Change: Phases, each a set of small commits gated by pnpm check (and check:browser from P3 on):
- P0: WA-19 dead code, WA-17 hotfix, WA-24 proxy.
- P1: WA-1/2/3 extraction and switch.
- P2: WA-4, 5, 6, 13, 14, 15 store, adapter, selectors, i18n, tokens (no UI).
- P3: read-only Keyframes in next (WA-21, 22 display, WA-18, WA-9).
- P4: writes (WA-7, WA-22 edits/regenerate, WA-8 confirm via saga).
- P5: Director column (WA-11, 12; WA-10 when backend lands).
- P6: next becomes the default for Keyframes, with classic one click away.
- P7: Plan / Assets / Film / settings / export / new film / recovery as they are designed.
- P8: delete legacy/, Radix Themes, local-draft-cache, the saga (after the backend chain), DirectorPlan, ConversationActions, FrameDecision, GenerationGuide, SceneActivity and the sentence-keyed copy modules.
Before P8, each capabilities.md must_keep item must be checked off.
- Risk: Recovery (RecoveryPanel) and the demo have no design; they must stay reachable through classic until P7.
- Tests: a parity checklist file in docs/ai/ with one browser scenario per must_keep item, run before each deletion commit.

## Open questions
- The design is dark only, but STATUS.md:10 promises Day/Night. Do we keep a light theme in the new UI (token roles allow it later) or drop it?
- Should the Director column stay resizable (reusing the saved width) or be fixed at 392 px as designed?
- Should 'Opened' be recorded on the server, so it survives devices and tab loss and the server can require it, or is sessionStorage keyed by exact picture bytes enough?
- Browser tests: may we add playwright-core at an exact version as a root devDependency and require a system Chrome for a separate `pnpm check:browser`? Or do you prefer a zero-dependency Chrome DevTools Protocol script?
- If a hand-rolled popover proves insufficient, is pinning @radix-ui/react-popover 1.1.23 (already in the lockfile) acceptable?
- Motion is free text, so the prototype's per-motion preview (push-in, pan, tilt…) can only be guessed from keywords. Is that acceptable, or should shots get a structured motion type (backend)?
- Who writes the Chinese copy, and what are the glossary terms (Director, keyframe, Opened, Takes, Saved locally)?
- Is 'about $1.50' as clips × flat per-attempt estimate acceptable, given that the estimate ignores clip length and is labelled not vendor-verified?
- Removing 'continue saved edit' from the composer leaves no user path that releases edit holds. Should the backend release holds on its own, or should the UI keep a plain 'Release' control?
- When does next become the default (after Keyframes parity, or only after Director column parity), and how long does the classic link stay?
