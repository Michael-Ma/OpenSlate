# Studio and review UI

`apps/web/src/main.tsx` boots [the next studio](../../apps/web/src/next/boot.tsx) directly. It is the only web UI; `?ui=next` is unnecessary and the classic tree is retired. The browser reads saved projections and submits authenticated commands. It does not own production state or run the scene-confirmation sequence.

## Workspace

The shell has a 52 px header, a 392 px Director column and **Plan / Keyframes / Assets / Film** views, plus Start and Settings. Narrow screens use a Director drawer. The dark palette, local Inter, shared controls and per-view styles come from [studio.css](../../apps/web/src/next/ui/studio.css) and the [Last Ferry design](../ai/prototypes/last-ferry/DESIGN.md). The current tree does not use Radix Themes or the earlier Day/Night workbench.

- **Plan:** brief/story, scene/shot hierarchy, import review and revision-checked edits with Undo.
- **Keyframes:** selected preview, motion explanation, editable shot fields, scene/shot state, current-frame viewing evidence, earlier takes, narration-fit choices and video confirmation.
- **Director:** explicit @ scope, saved timestamps/runtime, structured question answers, anchored lettered notes and held proposals with Now/After effects. Selecting a preview does not change the composer target. Application-derived checks are separate from Director recommendations.
- **Assets:** owned images, clips, audio and exports, filtered by role/scene/shot, with imports and bounded media loading.
- **Film:** one clock for picture/narration/music, storyboard order/timing, music edits and a single readiness/history/download export surface.
- **Start/Settings:** film creation/rename/archive, sample path, provider choices, Director setup/review, stock/personal voices, computer status and language.

## Projection and command boundaries

The injected [store](../../apps/web/src/next/store/store.ts), pure [reducer](../../apps/web/src/next/store/reducer.ts), snapshot adapter and selectors normalize server state. [studio-api.ts](../../packages/core/src/studio-api.ts) defines the browser-facing generation, notes, proposals, takes, export, asset and installation shapes. Browser code imports `@openslate/core/public`.

`GET /generation` supplies scene/shot states, blockers, exact targets and estimates. A frame view is recorded only after the actual current image decodes and is shown; hidden prefetch and an old take cannot qualify. That record proves viewing, not generation authority. `POST /scenes/:sceneId/confirm` binds the exact returned frames and freshness digest; the server runner settles narration and starts video with persisted step identities. No browser-local saga is needed. See [application routes](APPLICATION-API.md).

Every write retains its original command identity across an uncertain response. Stop, Continue and release of an unknown attempt are distinct commands; Continue does not revive unsent detached work. Direct edits and proposal decisions can run alongside the Director while protecting later human field edits. Regeneration retains the selected paid output until replacement succeeds. A free earlier-take selection verifies ownership and bytes and invalidates the dependent clip as needed.

## Browser state and safety

Authenticated SSE invalidates projections, with bounded refresh/reconnect behavior. Per-control selectors and write guards explain offline, expired-session, Stop and restore-quarantine restrictions. Quarantine permits inspection without mutation. Disconnect ends the session and can carry unsent words and place into a new session; it does not resubmit work.

The composer stores bounded text/scope/reference context. Pending commands keep exact request identities; restoring a draft alone never POSTs. Credentials and unsent binary uploads are not draft state. Artifact loading checks project/content identity, cancels superseded reads and revokes unused object URLs. One artifact must not flash under another artifact's label. Media caches and view cleanup bound retained files.

## Language and checks

English and Simplified Chinese use message IDs, plural-aware formatting and mapped server error codes. A language switch preserves selected objects and unsent work. Creative text, transcripts, provider names and Director replies keep their original language.

Node tests cover reducers, adapters, selectors, request replay, state transitions and media guards. `pnpm check:browser` covers rendered desktop/phone behavior against disposable fixtures; it is separate from `pnpm test`. `?fixture=last-ferry` uses a browser fixture transport; `pnpm studio:fixture --film last-ferry` uses the fake-only server seed. Neither is a real-provider test. Actual results and outstanding browser replay belong in [status](../implementation/STATUS.md), not in design claims.

## Code-plan films (experiment)

A film created with **Code plan (experimental)** in the New film sheet sends `planMode: "code"` (storyboard stays the default and its request is unchanged). The shell treats a film as a code-plan film only when its snapshot says `project.planMode === "code"`; graph films never read or write a code-plan route and look exactly as before. See [the design](../ai/code-plan/DESIGN.md).

- **One read:** `CodePlanProvider` (`apps/web/src/next/codeplan/CodePlanContext.tsx`) reads `GET /code-plan` through `useResource`, so every `code_plan.changed` event that moves the film's cursor reads it again. Stored versions are immutable and read once each (`GET /code-plan/versions/:version`).
- **Writes:** `answerCodePlanChoice`, `raiseCodePlanCeiling` and `submitCodePlanSource` on the store use the ordinary press path: one Idempotency-Key per press, a lost reply resends the same key and body. Routes live in `apps/web/src/next/api/code-plan.ts`; step media uses `codePlanArtifactContentPath` and the existing project-owned artifact content route.
- **Director column:** a run strip under the header (state chip, version, spend `spent (+reserved pending) of ceiling`, "the Director is updating the plan" while `held`, the pass's error in plain text, and **Raise the limit to $n** at `paused_budget`). Choices the plan asked are amber cards: placed with the reply where `askedAt` occurred, keeping that position after answering; the run strip jumps to the first waiting card. Stale cards collapse in place and cannot be answered. Media options are thumbnails, other options chips.
- **Views:** Plan shows declared scenes/shots, shared References and per-shot keyframe/video making, queued or held state; code films have no separate Keyframes tab. Assets distinguishes shared references from shot keyframes and excludes video posters from image counts. Film plays the newest succeeded render and lists clips, music and renders; **Code**, visible only with Developer mode enabled, lists versions newest first with their dry run (reused, new steps with prices, cancelled, certain cost, findings) beside a read-only program with line numbers and a line diff against the previous version.
- **Fixture:** `?fixture=last-ferry&codeplan=waiting|budget|error|done|empty` opens *Harbour lights*, a code-plan film, first; choosing, raising the limit and a message to the Director move its run on simulated time. Nothing is generated or charged.

Model, store, fixture and component tests: `apps/web/test/next/code-plan.test.mjs`, `code-plan-components.test.mjs`.

Code-film Settings → Models → Director offers actual Codex model choices (0.162.1, default gpt-6.1-sol), Claude Code Opus 5.5/Sonnet 5.5 on the user's Claude subscription, and the demo Director. Storyboard films cannot choose Claude. New-film default spending is $4 unless this browser has a preference; this film's ceiling is durable and cannot fall below existing liabilities. Thumbnail clicks inspect; the priced keyframe option confirms the video input. These choices use the same ordinary command replay path. [Owner tests](../ai/code-plan/TEST-INSTRUCTIONS.md).
