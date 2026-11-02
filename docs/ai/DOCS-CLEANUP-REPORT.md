# D1 documentation refresh and cleanup report

Baseline: `codex/d1-docs` at `47205eb2`, including `c8461021`. Work stays in this worktree. No product code, browser contract, runtime skill package, dependency, database or media was edited. No commit was made.

## Done

- D1.1: rewrote the README around both film modes, current Director/media choices, actual workspace/turn/persistence/sandbox boundaries, pinned setup, fixture use, commands and documentation map.
- D1.2: deleted five unreferenced superseded briefs/cards after searching tracked text for both full path and filename. Kept linked designs/evidence and all film-quality/code-plan task records. No eligible obsolete/duplicate test was established, so no test was deleted.
- D1.3: refreshed status, all technical references, live setup/walkthrough and the Chinese owner test guide. Codex 0.162.1/default gpt-6.1-sol, optional Claude plan runtime, contract 0.3.0, keyframe decisions, choice retirement and progress are now described separately from storyboard execution. Trimmed repeated STATUS history in favor of links to the retained reports.
- Corrected historical source links and prototype navigation/font paths; added historical labels where old rollout facts would otherwise read as current instructions.

## Deleted files

No file had an inbound full-path or filename mention in the tracked text inventory at deletion time (excluding its own contents). The report's inventory below intentionally records their names after deletion. The scan excluded private `.env*`, `secrets/`, `.openslate/`, binary/non-text files and generated output. A final scan checks code/tests/scripts/remaining docs and runtime guidance again, excluding this deletion inventory. These are completed specs superseded by retained documentation; no unique verification evidence was removed.

| Deleted file | Reason and retained useful facts |
|---|---|
| `docs/ai/prototypes/last-ferry/P5-BRIEF.md` | Pre-build brief for the “not designed yet” views. The completed P5-DESIGN/validation and linked HTML studies retain the design, and current UI/API references describe delivered behavior |
| `docs/ai/uiux-plan/codex/cards/B1-requests.md` | Completed migration card superseded by B1-report, retained gap analysis and current API/workflow references: request source, keyed commands and human audio decisions |
| `docs/ai/uiux-plan/codex/cards/B2-overview.md` | Completed extraction/overview card superseded by B2-report and current API/UI references: generation overview, viewed frames, prices and slot state |
| `docs/ai/uiux-plan/codex/cards/B4-stop.md` | Completed Stop/release card superseded by B4-stop-report and execution/API references; uncertain liability and late-result rules remain documented/tested |
| `docs/ai/uiux-plan/codex/cards/B7-confirm.md` | Completed server-sequencing card superseded by B7-confirm-report and narration/API/workflow references; durable confirmation, measured fitting and restart behavior remain documented/tested |

## Updated and added documents

| File | Change |
|---|---|
| `README.md` | Current features, both planning paths, Codex/Claude, provider boundaries, architecture, stable data directory, pinned commands and doc map |
| `docs/README.md` | Updated getting-started anchor; owner tests, AI records and D1 report navigation |
| `docs/ai/README.md` (new) | Classifies current contracts/work, historical migration/prototypes and still-proposed research |
| `docs/ai/DOCS-CLEANUP-REPORT.md` (new) | This inventory, deletion evidence, verification and retained uncertainties |
| `docs/ai/code-plan/TEST-INSTRUCTIONS.md` | Chinese current-checkout guide; added tests 16/17 for Claude/Codex; removed personal paths, arbitrary process-kill/Wi-Fi interruption, obsolete fixed costs/counts and two-keyframe request; retained current upload/keyframe/card/progress/film/limit/retry/provider/viewer tests |
| `docs/implementation/STATUS.md` | Current source summary/contracts/limits; distinguishes historical counts/live samples; replaces repetitive dated changelog with retained report/evidence map |
| `docs/implementation/MANUAL-LIVE-PRODUCTION.md` | Exact side-by-side Codex install; optional Claude plan setup; current separate code/storyboard workflows; stable directory and scoped media acceptance |
| `docs/ai/code-plan/DESIGN.md` | Reconciles delivered runtime/API/choice/state with the retained initial decision/phase record; makes original $1 and workspace proposal historical |
| `docs/implementation/PROVIDER-CATALOG.md` | Built-in real profile defaults, music, separate graph/code locking and current Viggle/model capabilities |
| `docs/implementation/PROJECT-SETTINGS-AND-UPDATES.md` | Current Settings source paths, Codex/Claude selection, code-film limits/preferences and current guidance target |
| `docs/implementation/DIRECTOR-TOOLS-UPGRADE.md` | Latest release target and separate code catalog; labels old native evidence and corrects retired manual HTTP upgrade |
| `docs/implementation/MANUAL-AUDIO-TESTING.md` | Fake-first rehearsal, current automatic measured acceptance/fit and server sequencing; removes the retired browser session/accept instructions |
| `docs/implementation/SHOT-AUDIO.md` | Current Film naming, fitting generated/imported audio acceptance and free fit/Undo boundaries |
| `docs/implementation/LOCAL-SETUP.md` | Exact Node patch, Codex 0.162.1/model default, Claude option, Lyria/Seedance/fal configuration names |
| `docs/implementation/MEDIA-EXECUTION-LAUNCHER.md` | Credential-derived route defaults/explicit disable behavior, newer adapters, image pin and Director/media separation |
| `docs/design/README.md` | Two-mode architecture, Director/MCP/host execution flow, entity persistence, runtime trust and actual render/editor limits |
| `docs/design/IMPLEMENTATION-PLAN.md` | Delivered code-film/runtime features; narrows genuinely pending general-editor capabilities and current status link |
| `docs/design/STORYBOARD-STUDIO.md` | Explicit storyboard scope, with links to code-film behavior/owner tests |
| `docs/technical/README.md` | Two-mode invariants, isolated guest evaluation, current Directors and $4 code-film ceiling |
| `docs/technical/APPLICATION-API.md` | Real port integration, step inspection/retry, liability-floor ceiling and stale-choice refusal; exact quarantine-read boundary |
| `docs/technical/DATA-PERSISTENCE.md` | Code journal/choice/review entities and separate Claude authentication |
| `docs/technical/DIRECTOR-RUNTIME.md` | Replaced obsolete runtime/scaffolding prose with Codex 0.162.1/high effort/dynamic models, Claude process/init/prompt/login, actual 0.3.0 tools, holds/review/uploads and recovery |
| `docs/technical/EXECUTION-ENGINE.md` | Current ctx API, $4 default, choice liveness, installed adapters and keyframe/review/render boundaries |
| `docs/technical/NARRATION.md` | Separates code-film speech/music/render from storyboard measured acceptance/fit |
| `docs/technical/OPERATIONS-TESTING.md` | Toolchain/Director versions, Claude option, observed current demo reuse/preview/accounting and fixture versus billing distinction |
| `docs/technical/PLAN-COMPILER.md` | Graph AST compilation versus separately isolated code-program evaluation |
| `docs/technical/PRODUCTION-WORKFLOW.md` | Explicit storyboard scope and code-plan workflow link |
| `docs/technical/PROVIDERS-ARTIFACTS.md` | Image worker pin, dated live-evidence limits, current ceiling, Viggle settlement and music-duration reuse |
| `docs/technical/REVIEW-UI.md` | Cards at askedAt/retirement, Plan references/progress, code-film view set/Developer mode and Claude/model/limit controls |
| `docs/technical/SKILLS-TOOLS.md` | Current 0.3.0/handler@3/package 2.0.0, archived code catalogs, five tools, consent/choice/keyframe/replay behavior; historical v5 labeling |
| `docs/technical/TIMELINE-RENDERING.md` | Separates program row edits, captions/sounds/fades/mastering from pending general editor features |
| `docs/ai/UIUX-IMPLEMENTATION-PLAN.md` | Labels historical rollout/pending assertions; preserves original decisions |
| `docs/ai/ui-v8/DESIGN.md` | Labels original design checkpoint versus current implementation |
| `docs/ai/v8-plan/2026-10-28-v8-plan.md` | Labels dated proposal versus current status |
| `docs/design/OPENSLATE-LIGHT.md` | Labels retired design history without rewriting evidence |
| `docs/design/AUTHORITY-AND-WORKFLOW-REVIEW.md` | Labels historical browser/UI checkpoint |
| `docs/audit/DOCUMENTATION-RECONCILIATION.md` | Labels older audit; D1 is linked as current cleanup |
| `docs/ai/uiux-plan/codex/reports/review-backend.md` | Replaces machine-specific source targets with checkout-relative links; preserves original line labels as historical |
| `docs/ai/uiux-plan/codex/reports/review-final.md` | Same source-link repair and baseline note |
| `docs/ai/uiux-plan/codex/reports/review-web.md` | Repairs source-root-relative targets and line suffixes; preserves finding text |
| `docs/ai/prototypes/last-ferry/last-ferry.html` | Broken gallery link now opens the retained local start study |
| `docs/ai/prototypes/failure-display/studio.css` | Prototype font resolves to the existing repository font rather than a nonexistent local absolute path |

## Source checks and self-review

Checked commands/versions against `package.json`, `.nvmrc`, `scripts/test-media-toolchain.json`, launcher/dev proxy and actual package names. Checked runtime/model identities, dynamic model discovery, Claude version/login/flags/init, code-tool catalogs/handler/package, schema, view types, choice settlement, provider activation/credentials and render API against current source. No external verification was attempted: RULES forbids non-loopback network access; the docs describe implemented support rather than announcing external vendor availability.

Self-review covers changed prose, command safety, mode-specific authority, callers/inbound references, link/anchor effects, historical records and missing tests. It corrected an overbroad quarantine-read claim (only code step detail is allowlisted; view/source remain blocked), a leftover “unset is off” activation statement, stale $1 wording, a guidance-only music-duration convention, an old design claim that code mode replaces native epochs/holds, and invalid new anchors. The offline demo also exposed obsolete reuse-count/preview prose, now updated to the actual current example. Other retained limitations are explicit below.

## Tests and link checks

The baseline build/runner completed with **5,222 passed, zero failures, two skips (5,224 total)** in **714.831 s**. The final full gate has the same counts; documentation-only edits changed no tests. No tests added, rewritten, deleted or disabled. Existing removed-route tests still protect deliberate refusal and are not obsolete merely because an endpoint is retired. Optional native/codec skips have live subjects; they were not deleted. No browser scenario was changed.

- `pnpm setup:test-media`: existing FFmpeg/ffprobe 8.1.1 reused; no download.
- `pnpm check:toolchain`: passed with Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders.
- Before: `pnpm build` passed all five workspaces, then `node scripts/run-tests.mjs` (same runner as `pnpm test`). **5,222 passed, zero failures/cancelled/todo, two skips (5,224 total)**.
- After: `pnpm test` built all five workspaces and passed **5,222**, with **zero failures/cancelled/todo and two skips (5,224 total)** in **719.768 s**. Before/after totals and skip reasons are identical; no timing failure required an isolated file rerun.
- `pnpm -r typecheck`: **5/5 workspace targets passed**, zero errors. `pnpm typecheck`: shared-package build plus **5/5 typechecks passed**, zero errors.
- No test files were touched, so the touched-file test command had no files to select; full before/after runners exercised the existing suites.
- `pnpm demo:code`: passed, final `done`, versions 1 → 2 → 3 → 4, two answered choices, four reused edit steps, new video/render, one lookup recovery, **zero duplicate submissions**, fixture spend **$0.40 / $4.00**. Placeholder media/fake providers; not a real export-quality or provider acceptance test.
- Baseline skips: animated WebP (the installed decoder refuses animation with the expected format error) and the opt-in native Codex probe (not enabled). No skip was introduced by D1.
- Link audit: initial Markdown scan found 37 broken source targets. The expanded audit checks inline/reference Markdown links, HTML href/src/poster, CSS URLs and Markdown/HTML fragments under README/docs without external requests. The final expanded audit passes **742 local targets/fragments across 325 Markdown/HTML/CSS files**, with **zero broken paths or fragments**.
- `node scripts/browser-check.mjs` / `pnpm check:browser`: **not run**. RULES.md hard rule 3 prohibits any browser launch in this sandbox; the lead must run this check outside it. No browser pass count is claimed.

## Kept after review / open boundaries

- Kept `docs/ai/uiux-plan` gaps/reports, Last Ferry P5 design/validation, other prototypes and linked `docs/design`/`docs/audit` history: source comments, rules, runtime guidance or retained docs still reference them, or they contain unique dated evidence. Repeated STATUS prose was trimmed, not the underlying reports.
- Kept `docs/ai/skill-drafts`, `ui-v8`, `v8-plan`, film-kind, character, music/video and Director-gap research: linked design provenance and some still-pending work; age alone does not meet the deletion rule. Shipped `skills/` snapshots and their source references were untouched.
- All `docs/ai/film-quality` and `docs/ai/code-plan` cards/reports are retained. `docs/ai/ARCHITECTURE-OVERVIEW.md` was absent in this worktree and was not created/edited; no other engineer's untracked artifact was touched.
- Test subjects still exist, including deliberate 404/refusal contracts. No exact duplicate test file or permanent removed-feature skip was established, so counts should not change for documentation-only work.
- Readiness/model lists do not establish account/media access. Claude supports only code films and subscription login; Codex image authentication is separate. General detached guest promise rejection remains limited; no-shot code plans lack the declared-shot keyframe gate. Video/audio attachment persistence is narrower than picture persistence.
- Human sound/quality acceptance, every additional provider/account and longer film behavior remain separate. No live provider/native model call, external network access, production-state read/restart or port-3001 service was performed for D1.

## Contract changes and proposed commits

Contract changes: **none** to `packages/core/src/studio-api.ts` or any product code. No commits created. Proposed lead split below includes every file (M/A/D is in the inventories above).

### docs(studio): refresh features architecture and owner guides

- `README.md`
- `docs/README.md`
- `docs/ai/README.md`
- `docs/ai/code-plan/DESIGN.md`
- `docs/ai/code-plan/TEST-INSTRUCTIONS.md`
- `docs/design/IMPLEMENTATION-PLAN.md`
- `docs/design/README.md`
- `docs/design/STORYBOARD-STUDIO.md`
- `docs/implementation/DIRECTOR-TOOLS-UPGRADE.md`
- `docs/implementation/LOCAL-SETUP.md`
- `docs/implementation/MANUAL-AUDIO-TESTING.md`
- `docs/implementation/MANUAL-LIVE-PRODUCTION.md`
- `docs/implementation/MEDIA-EXECUTION-LAUNCHER.md`
- `docs/implementation/PROJECT-SETTINGS-AND-UPDATES.md`
- `docs/implementation/PROVIDER-CATALOG.md`
- `docs/implementation/SHOT-AUDIO.md`
- `docs/implementation/STATUS.md`
- `docs/technical/APPLICATION-API.md`
- `docs/technical/DATA-PERSISTENCE.md`
- `docs/technical/DIRECTOR-RUNTIME.md`
- `docs/technical/EXECUTION-ENGINE.md`
- `docs/technical/NARRATION.md`
- `docs/technical/OPERATIONS-TESTING.md`
- `docs/technical/PLAN-COMPILER.md`
- `docs/technical/PRODUCTION-WORKFLOW.md`
- `docs/technical/PROVIDERS-ARTIFACTS.md`
- `docs/technical/README.md`
- `docs/technical/REVIEW-UI.md`
- `docs/technical/SKILLS-TOOLS.md`
- `docs/technical/TIMELINE-RENDERING.md`

### docs(archive): retire superseded briefs and repair links

- `docs/ai/DOCS-CLEANUP-REPORT.md`
- `docs/ai/UIUX-IMPLEMENTATION-PLAN.md`
- `docs/ai/prototypes/failure-display/studio.css`
- `docs/ai/prototypes/last-ferry/P5-BRIEF.md`
- `docs/ai/prototypes/last-ferry/last-ferry.html`
- `docs/ai/ui-v8/DESIGN.md`
- `docs/ai/uiux-plan/codex/cards/B1-requests.md`
- `docs/ai/uiux-plan/codex/cards/B2-overview.md`
- `docs/ai/uiux-plan/codex/cards/B4-stop.md`
- `docs/ai/uiux-plan/codex/cards/B7-confirm.md`
- `docs/ai/uiux-plan/codex/reports/review-backend.md`
- `docs/ai/uiux-plan/codex/reports/review-final.md`
- `docs/ai/uiux-plan/codex/reports/review-web.md`
- `docs/ai/v8-plan/2026-10-28-v8-plan.md`
- `docs/audit/DOCUMENTATION-RECONCILIATION.md`
- `docs/design/AUTHORITY-AND-WORKFLOW-REVIEW.md`
- `docs/design/OPENSLATE-LIGHT.md`

