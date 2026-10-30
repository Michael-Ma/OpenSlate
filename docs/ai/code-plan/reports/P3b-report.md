# P3b report: code-plan web UI

- Worktree: `.claude/worktrees/claude-p3b-ui`, branch `claude/p3b-code-plan-ui` (from `e24bdfd`). Nothing committed, stashed or reset.
- Scope: `apps/web/**`, plus `docs/technical/REVIEW-UI.md`, `docs/implementation/STATUS.md` and this report. No server, `studio-api.ts` or `tools.ts` edits.

## Done

1. **Start flow.** The New film sheet has a "How the Director plans" choice: **Storyboard** (default, unchanged) or **Code plan (experimental)** / 代码计划（实验性）. Only the code choice adds `planMode: "code"` to `POST /api/projects`, so a storyboard request is byte-identical to before. With a code plan, "Bring a written plan" is turned off with a reason (plan-imports feed a storyboard), and the Director/empty steps get code-plan wording.
2. **API client and store.**
   - Routes: `api/code-plan.ts`.
   - Typed store methods: `readCodePlan`, `readCodePlanSource`, `answerCodePlanChoice`, `raiseCodePlanCeiling`, `submitCodePlanSource`. Writes go through the existing `#press`: a fresh Idempotency-Key per press, and a lost reply resends the same key and body. Press ids are `codeplan:choice:<id>`, `codeplan:ceiling` and `codeplan:source`.
   - Every method refuses before sending anything unless the open film's snapshot says `planMode === "code"`.
   - `CodePlanProvider` reads `GET /code-plan` once for the shell through `useResource`. It refetches when the cursor moves. Stored versions are read once each and cached.
   - Media goes through `codePlanArtifactContentPath`, the single helper to switch, via a `codePlanMedia` source and a `CodePlanMedia` scope over `useMedia`.
3. **Code-film screens.** Graph films are unchanged: same tabs, views and thread.
   - **Run strip** under the Director header shows:
     - the state chip;
     - the version;
     - spend as "Spent $x (+$y pending) of $z", with a meter;
     - "The Director is updating the plan…" while `held`;
     - at `paused_budget`, "Raise the limit to $n" (+$1), a white primary button;
     - on `state: "error"`, the pass's message as escaped monospace text, plus what happens next.
   - **Choice cards:**
     - Waiting choices are amber cards at the foot of the thread.
     - Answered choices sit among the messages by `answeredAt`, neutral, with the chosen option marked white and the others dimmed.
     - Media options are thumbnails; other options are chips.
     - One press sends the exact option value. A lost reply shows "Not confirmed. Press the same option again…".
   - **Plan:** declared scenes and shots, read-only, in the Plan view's row style. A shot's thumbnail is the chosen (else newest) image step made from its prompt.
   - **Keyframes:** image steps as cards with state, price, label and model, and the picture once made. "Chosen" is marked white. Unreached steps are dimmed under "Earlier steps".
   - **Film:** the newest succeeded render in the browser's video player (in the fixture, its still with a note), then the render and clip steps as rows.
   - **Code (new tab):** versions newest first, each with:
     - reused steps;
     - new steps with prices;
     - cancelled steps;
     - certain cost, and whether more depends on choices;
     - findings with their codes.

     Beside the versions is the selected version's program: monospace, both line-number columns, and a Changes view (LCS line diff, unchanged runs folded to three lines of context) or the Whole program.
   - **Top bar:** "Code plan · experimental" under the title, and scene and shot counts from the declarations.
4. **Fixtures.** `fixtures/routes/code-plan.ts`. `?fixture=last-ferry&codeplan=waiting|budget|error|done|empty` lists *Harbour lights* first, so it opens.
   - `waiting`: version 2 waits on three keyframe thumbnails. Version 1's frames are history.
   - `budget`: paused at $0.81 of $1.00.
   - `error`: version 3 threw. A message to the Director writes version 4.
   - `done`: the render is shown.
   - `empty`: no plan yet; the first message writes version 1.

   All presets except `empty` have at least two versions with a source diff. The run moves on simulated time (1.6 s per stage) and the Director holds paid work while it replies. A film created in Start as a code plan starts empty. The Last Ferry refuses these routes with `CODE_PLAN_MODE` (409).
5. **Tests.** 31 new tests in two files (see Tests). Browser check done (see Browser check).

## Files

Added:
- `apps/web/src/next/api/code-plan.ts`
- `apps/web/src/next/model/code-plan.ts`
- `apps/web/src/next/codeplan/CodePlanContext.tsx`, `RunStrip.tsx`, `ChoiceCards.tsx`, `CodePlanViews.tsx`, `CodeView.tsx`, `parts.tsx`, `codeplan.css`
- `apps/web/src/next/i18n/catalog/code-plan.ts`
- `apps/web/src/next/fixtures/routes/code-plan.ts`
- `apps/web/test/next/code-plan.test.mjs`, `apps/web/test/next/code-plan-components.test.mjs`
- `docs/ai/code-plan/reports/P3b-report.md`

Changed:
- `apps/web/src/next/api/client.ts`: `artifactUrl` takes a content path; adds `codePlanArtifactUrl`.
- `apps/web/src/next/boot.tsx`: the live session gets `codePlanMedia`.
- `apps/web/src/next/store/react.tsx`: `codePlanMedia`, the `CodePlanMedia` scope and `useMedia`.
- `apps/web/src/next/store/store.ts`: the five code-plan methods.
- `apps/web/src/next/model/types.ts`: `project.planMode?`, and `"code"` in `ViewName`.
- `apps/web/src/next/model/shell.ts`: `CODE_VIEWS`, `viewTabs(view, codePlan)`, `?view=code`, and `shownView` maps Code to Keyframes for a graph film.
- `apps/web/src/next/model/shell-states.ts`: carry accepts `code`.
- `apps/web/src/next/model/start-new.ts`: `Planning`, `createBody(..., planning)`, `stepFits`, `planningStep`.
- `apps/web/src/next/app/NextApp.tsx`: the provider and code-view routing.
- `apps/web/src/next/app/TopBar.tsx`: the Code tab, meta and counts.
- `apps/web/src/next/director/DirectorColumn.tsx`: the run strip and choices.
- `apps/web/src/next/director/Thread.tsx`: optional `extra`, `extraCount` and `timed` props. The defaults render as before.
- `apps/web/src/next/views/start/NewFilmSheet.tsx`: the planning choice.
- `apps/web/src/next/fixtures/routes/start.ts`: the preset film, `planMode` on create, the code-film Director reply, `bumpFilmCursor`.
- `apps/web/src/next/fixtures/routes/index.ts`: registers the code-plan routes.
- `apps/web/src/next/i18n/messages.ts`, `catalog/shell.ts` (`shell.tab.code`), `catalog/start.ts`, `catalog/errors.ts` (`CODE_PLAN_MODE`, `CODE_PLAN_REJECTED`, `CODE_PLAN_MISSING`, `CODE_PLAN_CHOICE_STALE`).
- `docs/technical/REVIEW-UI.md` (code-plan section), `docs/implementation/STATUS.md` (P3b entry).

## Tests

- `apps/web/test/next/code-plan.test.mjs`: **24 tests**, covering:
  - project switch and route helpers;
  - artifact and option parsing;
  - run strip (states, en/zh spend, raise body, error text, meter clamp);
  - choice cards (chosen by canonical value, media layout, falsy answers);
  - thread order, and time placement of answered choices;
  - press identities;
  - step rows (current/history, budget wait, chosen, failure code, free render);
  - latest render;
  - declarations (fallback fields, grouping, picture by prompt, chosen preferred);
  - version rows and diff wording in en/zh;
  - `previousVersion`;
  - line diff (first version, change, CRLF, the large-input fallback) and the fold;
  - create body and planning step;
  - Code tab and `shownView`.

  Store tests run against the fixture:
  - a graph film sends no code-plan request;
  - the waiting preset loads;
  - an answer goes out with an Idempotency-Key and the exact body, and the run advances on mocked timers;
  - a lost answer is resent with the same key, and a stale answer is refused;
  - budget → raise → done;
  - error → message → version 4;
  - Start creates a code film with `planMode: "code"` and a graph film without it.
- `apps/web/test/next/code-plan-components.test.mjs`: **7 tests**. `ChoiceCards.tsx` and `RunStrip.tsx` are compiled with `transformWithOxc` and rendered with real React (`renderToStaticMarkup`), plus shallow presses. They cover:
  - waiting and answered (zh) cards;
  - a chip press sending the exact value;
  - lost-reply and sending notes;
  - the write guard;
  - run strip held and pending;
  - raise button and press;
  - escaped error text;
  - the unreadable run with Read again.
- Results:
  - `pnpm build`: passed.
  - Touched tests (`node scripts/run-tests.mjs` on both files): **31/31**.
  - Full web suite (`node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`): **1,000/1,000**, 0 fail, cancelled, skipped or todo. The baseline before this card was 969.
  - `pnpm -r typecheck`: **5/5** passed.
  - `git diff --check`: passed.

## Browser check

- **Setup:** the in-browser fixture (`?fixture=last-ferry&codeplan=…`), served from the built `apps/web/dist` by `vite preview` on **127.0.0.1:5173**, in the desktop app's browser pane.
  - The Vite dev server was tried first. There, timed fixture transitions are slow or missing. DESIGN.md's limits already note this for dev pages, so the check used the built page.
  - Port 3001 was not touched. No API request left the page.
- **1440×900, English:** the waiting preset was walked through the whole run:
  - three thumbnails;
  - choosing marked the frame white and showed Running with pending spend;
  - the 1.2 choice appeared;
  - choosing it → paused at $0.81 of $1.00, with the 1.2 clip "Waiting for a higher limit";
  - Raise the limit to $2.00 → Done, $1.26 of $2.00;
  - Film showed the render still with its sample note;
  - Plan showed the chosen thumbnails;
  - Code showed versions and diff.

  Also checked: the New film sheet (planning choice, written plan off with its reason), and a film created as a code plan → message → version 1 → choice card.
- **1440×900, Chinese:** the error preset showed the pass error. The answered card sat between messages by time. A message showed "导演正在更新计划…", then version 4 and the 1.2 choice.
- **390×844, both languages:**
  - Keyframes, Plan, Film and Code had no page-wide horizontal scroll (scrollWidth 390). A sideways overflow in Code was found and fixed.
  - The Director drawer showed the run strip with the raise button and the answered cards.
- **Graph check:** The Last Ferry still shows four tabs, no `data-plan-mode` and no code-plan request.

## Contract gaps

- **No create-project input type** in `studio-api.ts`. `planMode?: "code"` is typed locally on `CreateBody` (`model/start-new.ts`). It reuses the `PlanMode` values.
- **Snapshot `planMode`:** the web reads `snapshot.project.planMode`. This works because the server's snapshot returns the raw `ProjectRecord`. The project snapshot is not typed in `studio-api.ts`. The web type `ProjectSnapshot` now has `planMode?`.
- **`ProjectListItem` has no `planMode`,** so Start's film list cannot tag code films.
- **Step media route:** implemented against `GET /api/projects/:id/code-plan/artifacts/:artifactId/content`. If P3a confirms the graph artifact route instead, change only `codePlanArtifactContentPath` in `api/code-plan.ts`.
- **Declarations are `unknown[]`.** The web reads `id|sceneId|key`, `scene|sceneId`, `label`, `purpose|title|description|action`, `framing`, `seconds|durationSeconds|duration`, `prompt|imagePrompt|image`, `motion|camera|videoPrompt`, `narration` (a string or `{text}`) and `keyframe|picture` (an artifact ref). P2a's `studio.d.ts` should pin one shape.
- **Steps are not linked to shots.** Plan matches image steps to shots by prompt label (≤200 characters), which is fragile. A `shotId`/declaration key on `CodePlanStepView`, or a keyframe ref on the shot, would fix it.
- **Refusal codes are not named** for:
  - answering a choice that was already answered or changed. The fixture uses `CODE_PLAN_CHOICE_STALE` (409) with a message;
  - a ceiling that is not higher. The fixture uses `VALIDATION_ERROR` (400).
- **No summary on `CodePlanVersionItem`.** P2a's `submit_plan` takes a `summary`; showing it in Code would help.

## Open issues

- **No real server.** Not verified against a server: P2a, P2b and P3a are not merged in this worktree. Everything was checked against the fixture.
- **Fixture wording:**
  - the existing tag under each scripted reply says "nothing in the film was changed";
  - the fixture's Director mode line is about keyframes.

  Both read oddly in a code film whose plan changes. Code mode might want its own wording.
- **Stop:** the top bar's graph **Stop** appears while the Director works in a code film (`showStop`). Whether `/controls` stops code-plan dispatch is unknown.
- **Lost replies:** code-plan presses are not in `PAID_PRESS`. A lost answer therefore toasts the generic network error, while the card itself says "Not confirmed. Press the same option again".
- **No source editing.** Code is read-only, as asked. `submitCodePlanSource` exists and is tested, but has no UI.
- **Assets:** the tab is kept for code films and shared as is.
- **"Reconnecting…" strip:** seen a few times in the pane right after viewport resizes on the code film, for about a second. It did not reproduce in sampled runs without resizing. Probably the pane's visibility flip closing the event stream, but worth a look.

