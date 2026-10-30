# Code-plan Director (experiment)

- Date: 2026-10-29. Branch: `feature/last-ferry-ui`.
- Status: direction approved by the owner; P1 is next.
- Cards: [`cards/`](cards/).

## Decisions (owner, 2026-10-29)

| # | Decision |
|---|---|
| CP-1 | The Director writes the film's plan as an ordinary TypeScript program, with loops, conditions, functions and concurrency. There is no restricted DSL and no approval gate. The Director may change anything. |
| CP-2 | The program runs in an isolated environment that can reach only the `ctx` API: no files, no environment, no network, no process access. |
| CP-3 | Each film has a spend ceiling of **$1**. Reaching it pauses new paid work until the owner raises it. It is a circuit breaker, not an approval step. |
| CP-4 | The new mode runs beside the current flow behind a project-level switch. The current planning layer stays untouched until P5 decides. |
| CP-5 | Legacy-compatibility removal is redone on this branch, limited to the layers this design keeps: persistence, provider/execution, audio. The planning layer's compatibility code goes with that layer in P5. |

## The idea

After every user input the Director creates or edits `plan.ts`. The studio runs it. The program stops wherever it asks the user to choose, and continues from the answer. When the user says something new, the Director decides whether the code must change; either way, execution then continues until the next change is needed.

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
| `ctx.image(input)` | Keyframe or image generation. Paid. |
| `ctx.video(input)` | Clip generation from a first frame. Paid. |
| `ctx.speech(input)` | Voice line. Paid. |
| `ctx.render(timeline)` | Local FFmpeg assembly. Free. |
| `ctx.choose(id, { question, options })` | Asks the user. Returns the chosen option. |
| `ctx.log(text)` | A line in the run log. |

A provider failure returns `{ ok: false, error }` so the program can branch on it. A programming error throws and puts the run in `error`.

### Step identity

A media step's key is `digest(kind, normalized input)`, where the input includes the model, every parameter and the digests of input artifacts. An optional `variant` separates deliberate duplicates (three keyframe candidates from one prompt). The key never depends on where the call sits in the code, so reordering, wrapping in functions or inserting new steps does not invalidate finished work.

A choice's key is `(id, digest(options))`. An answered choice stays answered while its id and options are unchanged. New options (for example, new frames) ask again.

### One pass

1. Load the current plan version into a fresh sandbox, with `Date` and `Math.random` frozen per run.
2. Run `film(ctx)`. Each `ctx` call looks up its key in the journal:
   - **succeeded / failed:** resolve at once with the recorded result. No cost.
   - **in flight:** stay pending.
   - **absent:** check the ceiling, persist the submission intent, dispatch to the provider, stay pending.
   - **choice without an answer:** publish the choice to the UI and stay pending.
3. The pass ends when the program returns (`done`), throws (`error`), or every live promise is pending (`waiting`).

Calls submit when they are made, not when they are awaited, so the steps inside one `Promise.all` all start in the same pass.

### What starts a pass

A step reaching a terminal state, a choice answered, a new plan version, server start, or the ceiling raised. Passes are single-flight per project and cost milliseconds; they never call a model.

### Recovery

Each media step keeps the existing attempt invariants: persist the intent before dispatch; after a restart, an intent without a receipt is `unknown` and is reconciled through the provider's lookup, never resubmitted. Results go through the existing output spool and ingesters before a step is `succeeded`.

### Code edits

A new plan version replays from the top against the same journal. Steps whose inputs did not change are reused. Steps the new code no longer reaches are left in the journal (and the project library); unsent ones are cancelled. Example: changing shot 1.2's camera motion re-runs only 1.2's clip and the final render.

## Director loop

1. A user message arrives → new paid submissions pause (in-flight work continues).
2. The Director reads the current code, the run state (done / in flight / waiting choices / error) and the message.
3. It edits `plan.ts` in the film's own workspace directory and calls `submit_plan`, or it only replies.
4. `submit_plan`: typecheck against `studio.d.ts` → **dry run** (a pass with dispatch disabled) → a diff posted in the thread: steps reused, new steps, the cost that is certain now, and that later cost depends on the user's choices → the new version takes effect and submissions resume.
5. If a pass throws, the error and run state go back to the Director for a fix, at most two automatic attempts; then it asks the user.

## Guardrails

- **Sandbox (CP-2).** Candidates: QuickJS compiled to WASM, or a child Node process under the permission model. P1 picks one by these criteria: no access to files, environment, network or processes; async host calls; interrupting an infinite loop; a memory cap; Node 24.
- **Ceiling (CP-3).** Before each dispatch: charged plus possibly-charged plus in-flight known prices, plus this step's price, must stay ≤ $1.00. Otherwise the step stays absent and the run becomes `paused_budget`. Codex image generation uses the ChatGPT plan and has no per-call price; it counts as $0 and is capped by the step limit.
- **Limits.** Per pass: a CPU-time limit and a memory cap. Per run: a maximum number of media steps (default 200), so a loop is stopped even when its steps are free.

## Data (new entity kinds, no DDL)

| Kind | Fields |
|---|---|
| `code_plan_version` | projectId, version, source, sha256, author (`director` \| `user`), createdAt |
| `code_plan_run` | projectId, planVersion, state (`running` \| `waiting` \| `error` \| `paused_budget` \| `done`), lastPassAt, error |
| `code_plan_step` | projectId, key, kind, normalized input, state, attempt reference, result artifact refs, price, timestamps |
| `code_plan_choice` | projectId, choiceId, optionsDigest, question, options, answer, answeredAt |

The project gets `planMode: "graph" | "code"`; new projects choose it, existing ones stay `graph`.

## What is kept and what is replaced

- **Kept:** provider adapters; attempt, receipt, spool and ingestion with unknown-outcome recovery; timeline and FFmpeg rendering; audio processing; SQLite store, SSE, the Codex runtime; the Last Ferry shell.
- **Replaced in code mode (deleted in P5 if the experiment succeeds):** the restricted plan compiler and compositions, plan-authoring skills, scene confirmations and the two review steps, the prepare/apply/notes/remake tool contracts, the hold/epoch/grant authority layer.

## Phases

| Phase | Scope | Done when |
|---|---|---|
| P1 | Replay runtime, step journal, sandbox, `ctx` image/video/choose/render/shot, ceiling and limits, fake providers only, no UI | Card P1's tests pass |
| P2 | Director: per-film workspace with `plan.ts` and `studio.d.ts`, `submit_plan`, dry-run diff, pause on input, auto-repair; scripted Director for tests | Offline: one message → plan → choose a frame → one edit → only affected steps re-run |
| P3 | UI: choice cards in the thread, run progress, code view with version diffs, Plan/Keyframes/Film projected from the run | Browser checks on the 5173 fixture studio |
| P4 | One real film: Codex image + Viggle, two shots, spend ≤ $1 | Compared with LIVE-4b: keyframes 35–48 s, review 25 s |
| P5 | Decide: keep and delete the old planning layer, or drop the code mode | Owner decision |

Backend work goes to Codex by card, each in its own worktree branched from `feature/last-ferry-ui`; the lead reviews, commits and merges. The lead builds the UI.

## Open questions

- How an arbitrary program's output maps onto Plan / Keyframes / Film (P3).
- Direct edits in the UI become Director input in code mode; whether small field edits may patch the code directly.
- Normalization rules for step inputs (whitespace in prompts, parameter defaults).
