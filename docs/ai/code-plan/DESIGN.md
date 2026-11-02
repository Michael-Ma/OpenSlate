# Code-plan Director (experiment)

- Original decision: 2026-10-29. Reconciled with merged source on November 2.
- Status: replay, Director/port/HTTP/UI and real-provider integration are implemented. The original phase/decision records below are retained; replacement of the storyboard planning layer remains an owner decision.
- Cards: [`cards/`](cards/).

Current source adds confirmed declared-shot keyframes, dependency-based choice retirement, shared references/progress, music, contact-sheet review and render edits on contract **0.3.0**. The code-film default is now **$4**, with a saved new-film preference/per-film override. Codex **0.162.1** defaults to **gpt-6.1-sol**; optional Claude Code directs code films on the user’s Claude subscription. See [runtime](../../technical/DIRECTOR-RUNTIME.md), [execution](../../technical/EXECUTION-ENGINE.md#code-plans-experimental) and [owner tests](TEST-INSTRUCTIONS.md) for exact behavior and evidence.

## Decisions (owner, 2026-10-29)

This is the initial decision record. CP-3's original $1 was superseded by the current configurable $4 default; CP-1 does not bypass host validation, current choices, Stop, holds or liability checks. CP-5/P5 is a future decision, not a claim that application authority or the graph path has been removed.

| # | Decision |
|---|---|
| CP-1 | The Director writes the film's plan as an ordinary TypeScript program, with loops, conditions, functions and concurrency. There is no restricted DSL and no approval gate. The Director may change anything. |
| CP-2 | The program runs in an isolated environment that can reach only the `ctx` API: no files, no environment, no network, no process access. |
| CP-3 | Each film has a spend ceiling of **$1**. Reaching it pauses new paid work until the owner raises it. It is a circuit breaker, not an approval step. |
| CP-4 | The new mode runs beside the current flow behind a project-level switch. The current planning layer stays untouched until P5 decides. |
| CP-5 | Legacy-compatibility removal is redone on this branch, limited to the layers this design keeps: persistence, provider/execution, audio. The planning layer's compatibility code goes with that layer in P5. |

## The idea

After user input the Director may submit a complete plan program or just reply. The source is stored as a version in SQLite, not edited by a native filesystem tool. The studio runs it. The program stops wherever it asks the user to choose, and continues from the answer. When the user says something new, the Director decides whether the code must change; either way, execution then continues until the next change is needed.

Making this reliable rests on one mechanism: **replay the program from the top every time, and look every effect up in a content-addressed step journal.**

## Execution model

### Program contract

```ts
export default async function film(ctx: Studio): Promise<void>
```

Every effect goes through `ctx`:

| Call | Effect |
|---|---|
| `ctx.shot(decl)` / `ctx.scene(decl)` | Declares storyboard rows. Free; the Plan panel is projected from the latest pass's declarations. |
| `ctx.image(input)` | Shared reference image generation; configured estimate (Codex subscription images count $0). |
| `ctx.keyframe(shot, input)` | One declared-shot picture followed by a priced human video-input choice; waits until confirmed. |
| `ctx.video(input)` | Clip generation using a supported reference/first-frame/first-last/text mode; new declared-shot video needs its confirmed keyframe input. |
| `ctx.speech(input)` | Voice line. Paid. |
| `ctx.music(input)` | Lyria background music, measured and journaled; length is approximate. |
| `ctx.render(timeline)` | Local FFmpeg assembly with row trims, speed/holds/zoom, audio/fades/sounds and captions. Free. |
| `ctx.review(id, {clips, note})` | Bounded Director inspection through free read_clip_frames, without sound; run state reviewing. |
| `ctx.choose(id, { question, options })` | Asks the user. Returns the chosen option. |
| `ctx.log(text)` | A line in the run log. |

A provider failure returns `{ ok: false, error }` so the program can branch on it. A programming error throws and puts the run in `error`.

### Step identity

A media step's key is `digest(kind, normalized input)`, where the input includes the model, every parameter and the digests of input artifacts. An optional `variant` separates deliberate duplicates (three keyframe candidates from one prompt). The key never depends on where the call sits in the code, so reordering, wrapping in functions or inserting new steps does not invalidate finished work.

A choice's identity derives from `(id, digest(options))`. An answered choice stays answered while its id and options are unchanged. New options (for example, new frames) ask again. Latest completed-pass reachability marks unreached rows stale; failed/incomplete passes do not retire the previous cards. Stale rows remain in their reply as history, and new answers are refused.

### One pass

1. Load the current plan version into a fresh sandbox, with a saved clock and seeded random sequence reproduced on every pass.
2. Run `film(ctx)`. Each `ctx` call looks up its key in the journal:
   - **succeeded / failed:** resolve at once with the recorded result. No cost.
   - **in flight:** stay pending.
   - **absent:** check the ceiling, persist the submission intent, dispatch to the provider, stay pending.
   - **choice without an answer:** publish the choice to the UI and stay pending.
3. The pass can finish (`done`, or `done_with_failures` for reached failed media), throw (`error`), wait on effects/choices (`waiting`), pause at the ceiling (`paused_budget`) or wait for Director inspection (`reviewing`). Before any submitted version the view is `empty`.

Calls reach the host when made, rather than only when awaited, so `Promise.all` can expose independent work in one pass. Actual dispatch still checks capacity, holds, Stop and liability; not every reached call starts at once.

### What starts a pass

A step reaching a terminal state, a choice answered, a new plan version, server start, or the ceiling raised. Passes are single-flight per project and bounded by the sandbox limits; replay does not itself invoke the Director, although admitted media effects may use model providers.

### Recovery

Each media step keeps the existing attempt invariants: persist the intent before dispatch; after a restart, an intent without a receipt is `unknown` and is reconciled through the provider's lookup, never resubmitted. Results go through the existing output spool and ingesters before a step is `succeeded`.

### Code edits

A new plan version replays from the top against the same journal. Steps whose inputs did not change are reused. Steps the new code no longer reaches are left in the journal (and the project library); unsent ones are cancelled. Example: changing shot 1.2's camera motion re-runs only 1.2's clip and the final render.

## Director loop

1. A user message arrives → new paid submissions pause (in-flight work continues).
2. The Director reads the current code, the run state (done / in flight / waiting choices / error) and the message.
3. It calls `submit_plan` with the complete source and current base version, or only replies. Native filesystem/shell access is disabled; there is no plan-file workspace edit.
4. `submit_plan`: bounded source/syntax validation and sandbox **dry run** (a pass with dispatch disabled) → a diff posted in the thread: steps reused, new steps, the cost that is certain now, and that later cost depends on the user's choices → the new version takes effect and submissions resume.
5. If a pass throws, the error and run state go back to the Director for a fix, at most two automatic attempts; then it asks the user.

## Guardrails

- **Sandbox (CP-2).** QuickJS/WASM runs in a disposable Node worker. The guest has no files, environment, network or processes; bounded JSON host calls, CPU interruption and heap/stack limits constrain each pass. The host requires Node 24.
- **Ceiling (CP-3).** Before each dispatch: charged plus possibly-charged plus in-flight known prices, plus this step's price, must stay within the saved ceiling (new default $4). Otherwise the step stays absent and the run becomes `paused_budget`. Codex image generation uses the ChatGPT plan and has no per-call price; it counts as $0 and is capped by the step limit.
- **Limits.** Per pass: a CPU-time limit and a memory cap. Per project across versions: a maximum number of admitted media attempts (default 200, including retries), so a loop is stopped even when its steps are free.

## Data (new entity kinds, no DDL)

| Kind | Fields |
|---|---|
| `code_plan_version` | projectId, version, source, sha256, author (`director` \| `user`), createdAt |
| `code_plan_run` | projectId, planVersion, state (`running` \| `waiting` \| `reviewing` \| `error` \| `paused_budget` \| `done` \| `done_with_failures`), lastPassAt, error |
| `code_plan_step` | projectId, key, kind, normalized input, state, attempt reference, result artifact refs, price, timestamps |
| `code_plan_choice` | projectId, choiceId, optionsDigest, question, options, answer, answeredAt, askedAt, stale |

The project gets `planMode: "graph" | "code"`; new projects choose it, existing ones stay `graph`.

## Current shared and separate boundaries

- **Kept:** provider adapters; attempt, receipt, spool and ingestion with unknown-outcome recovery; timeline and FFmpeg rendering; audio processing; SQLite store, SSE, the Codex runtime; the Last Ferry shell.
- **Separate in code mode:** the program/journal replaces graph declarations/compositions, graph candidate/grant admission and scene-confirmation/prepare/apply/notes tools for that film. Code mode has its own keyframe choices, attempts and ceiling. Native epochs, application authorization, request-owned holds and unknown-outcome protections remain. P5 has not removed the storyboard planning layer.

## Original phases (historical plan)

| Phase | Scope | Done when |
|---|---|---|
| P1 | Replay runtime, step journal, sandbox, `ctx` image/video/choose/render/shot, ceiling and limits, fake providers only, no UI | Card P1's tests pass |
| P2 | Director: per-film workspace with `plan.ts` and `studio.d.ts`, `submit_plan`, dry-run diff, pause on input, auto-repair; scripted Director for tests | Offline: one message → plan → choose a frame → one edit → only affected steps re-run |
| P3 | UI: choice cards in the thread, run progress, code view with version diffs, Plan/Keyframes/Film projected from the run | Browser checks on the 5173 fixture studio |
| P4 | One real film: Codex image + Viggle, two shots, spend ≤ $1 | Compared with LIVE-4b: keyframes 35–48 s, review 25 s |
| P5 | Decide: keep and delete the old planning layer, or drop the code mode | Owner decision |

The phase table is the original plan, including its then-$1 experiment scope and proposed workspace shape. Current implemented boundaries supersede those details; both graph and code paths remain. Cards/reports retain the actual verification. Assigned card work uses its own worktree and the lead owns commits/merges under RULES.md.

## Open questions

- Resolved: latest declarations/steps/choices project into Plan, Assets and Film; code films have no separate Keyframes tab.
- Direct edits in the UI become Director input in code mode; whether small field edits may patch the code directly.
- Resolved: normalized effective input and owned artifact content form the step key; significant prompt whitespace is preserved. Profile defaults/definition digest remain pinned.
