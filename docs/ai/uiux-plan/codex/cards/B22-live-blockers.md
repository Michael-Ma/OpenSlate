# Card B22: fix what the first real run found

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it (you are back in the sandbox: no git, no Chrome or browser checks; you may edit browser scenarios, the lead runs them). This card may edit `apps/server`, `packages/*` and `apps/web` logic and catalogs; the lead owns visual design, so keep markup and CSS changes to what a fix needs. Do not edit `docs/implementation/STATUS.md`; report in `docs/ai/uiux-plan/codex/reports/B22-live-blockers.md`.

Your LIVE-1 report and its evidence are in `docs/ai/live-test-20261016/` (REPORT.md, screenshots, `server-redacted.log`, the JSON diagnostics). The retained test data directory `$HOME/openslate-live-test-20261016` may be READ for diagnosis (project database, Director run records, logs). Never read `.env*`, `secrets/`, `~/.codex` auth files or tokens, and never copy prompts or private text from it into the repository beyond short redacted excerpts.

## 1. Blocker: keyframes stay `SCENE_REVIEW_STALE` after a Plan edit and Undo

Your source reading: `apps/server/src/scene-generation.ts` (~177) leaves `concurrency: "alongside"` requests out of the current request identity it returns, `apps/web/src/next/model/commands.ts` (~33) echoes it, and `apps/server/src/application/expected-human-request.ts` (~11) compares against the latest active editing request including alongside ones; Plan edit/Undo creates alongside requests (`apps/server/src/storyboard.ts` ~397). Confirm with a failing server test that reproduces the live sequence (Director-saved plan, human Plan edit, Undo, fresh read, generate keyframes for the scene and for one shot), then make the fences agree. A genuinely newer human request must still refuse a stale press; the money rules stay (no blind resubmission, idempotent replay). Also add a browser scenario on the live fixture studio (fake providers) for the same sequence: Plan edit, Undo, Keyframes, Make keyframes, no 409.

## 2. Major: a failed first-film setup loses its sheet

Creating the first film with "Talk to the Director" when the Director setup fails (`409 DIRECTOR_SETUP_REQUIRED`) leaves "Loading the film…" with "No film open" until a reload (`04-create-stuck.png`). Your reading: `model/start-commands.ts` (~161) calls `onMade` right after creation, `views/start/StartView.tsx` (~100) updates the list without selecting the film, `model/shell.ts` (~37) stops forcing Start, `app/NextApp.tsx` (~221) unmounts the sheet. Fix it so the created film is selected and the sheet stays in its failed phase (the setup error, Open the film, Try again) until the person acts. Unit tests; extend the Start browser scenario for this path.

## 3. Major: the Director's default Codex is the wrong version, and the error does not say so

The default program was the ChatGPT app's bundled `codex` (`0.162.0-alpha…`), while OpenSlate pins `0.153.4`; Save failed with a generic `DIRECTOR_SETUP_REQUIRED`. Prefer, in order: the configured Codex binary the studio already uses for the image worker (`OPENSLATE_CODEX_BINARY` or equivalent configuration), the pinned install under `~/.local/share/openslate-codex`, then other discovered binaries whose version matches. When the chosen program has the wrong version, the error and the Settings Director panel name the expected and the found version and the path, and say where the supported install lives (en and zh, errors only in `errors.ts`). Tests.

## 4. Major: the first planning turn ran 180 s and saved nothing

Investigate with the retained data (Director run records, model calls, tool calls, any Codex session logs the studio stored under its data directory, never auth files): what was the Director doing for 180 seconds? Then fix the cause: for example a tool loop, a slow or blocked tool, waiting for something that never came, or a plan too large for one turn. If the right fix is a longer limit, make it a deliberate, configured value with a reason; a person must also see progress during a long turn and, on timeout, what was saved and what to do next. Report what you found with redacted evidence.

## 5. Minor: subscription-billed models say "no price set"

Keyframe buttons read "Make keyframe · no price set" and "Make 2 keyframes · no price set" with Codex images, although the New film sheet says Codex images use the Codex plan (`28-final-blocker.png`). Where a model is billed by the person's subscription rather than per call, the price wording says so, for example "uses your Codex plan" / "使用你的 Codex 订阅", in the inspector, the scene panel, note links and the banner, instead of "no price set". Find how the catalog or quote expresses subscription billing (add a minimal field to `packages/core/src/studio-api.ts` only if nothing expresses it; list it under Contract changes). "No price set" stays for a per-call model without a configured price.

## Checks

`pnpm build`, touched tests, `node scripts/run-tests.mjs apps/web/test/*.test.mjs apps/web/test/next/*.test.mjs`, the full `pnpm test`, `pnpm -r typecheck`, `node --check` on changed scenario files. Report with the RULES headings, per item: cause, fix, tests.
