# P1 · Replay runtime for code plans (fake providers, no UI)

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Then read `docs/ai/code-plan/DESIGN.md`. Its decisions CP-1 to CP-5 are final, and this card implements its "Execution model", "Guardrails" and "Data" sections.

## Problem

In code mode the Director writes the film's plan as an ordinary TypeScript program. P1 builds the runtime that executes such a program durably:

- choices that wait for days;
- restarts mid-run;
- code edits that must not pay again for unchanged work;
- unknown provider outcomes that must never be resubmitted blindly.

No Director, no routes and no UI yet.

## Change

1. **Sandbox spike, then pick one.**
   - Compare QuickJS compiled to WASM (for example `quickjs-emscripten`) with a child Node 24 process under the permission model.
   - Criteria:
     - no access to files, environment variables, network, processes, `require`/`import`;
     - async host calls into `ctx`;
     - a CPU-time interrupt that stops an infinite loop;
     - a memory cap;
     - `Date` and `Math.random` frozen per run.
   - Plan source is TypeScript: strip types with `stripTypeScriptTypes` from `node:module` (present on Node 24.15) rather than adding a compiler.
   - Report the choice and why. A new dependency is allowed only for the sandbox; name it and its version under Open issues.
2. **New module `apps/server/src/code-plan/`.**
   - **`ctx` API:** `shot`, `scene`, `image`, `video`, `render`, `choose`, `log`, as in DESIGN.md. `speech` may be stubbed with a clear `NOT_IMPLEMENTED` until P2.
   - **Step keys:** media step keys are `digest(kind, normalized input)`. Normalize: sorted keys, defaults filled, input artifacts by sha256, optional `variant`. Keys never depend on call position.
   - **Choice keys:** `(id, digest(options))`.
   - **Results:** provider failure resolves `{ ok: false, error }`; a thrown error ends the pass in `error` with message and stack, capped in size.
   - **Journal:** entity kinds `code_plan_version`, `code_plan_run`, `code_plan_step`, `code_plan_choice` through `store.put/get/list`. No DDL.
   - **Passes:**
     - a pass replays from the top and ends `done`, `error` or `waiting` (every live promise pending);
     - calls dispatch when made, so the steps in one `Promise.all` start in the same pass;
     - single-flight per project.
   - **Wake triggers:** step terminal, choice answered, new plan version, server start, ceiling raised. Expose `tick()` for the existing 500 ms loop in `apps/server/src/index.ts`. It must do nothing for projects not in code mode.
   - **Dispatch:**
     - reuse the provider layer, `ExecutionProvider.submit/poll/lookup` in `packages/providers/src/execution.ts`, with the fake provider;
     - reuse the output store and ingesters (`apps/server/src/execution/output-store.ts`, `ingestion-router.ts`, `spool-*-ingester.ts`);
     - do **not** go through the graph `Engine`'s node / candidate / grant admission.
   - **Dispatch invariants:**
     - persist the submission intent before `submit`;
     - after a restart, an intent without a receipt becomes `unknown` and is reconciled by `lookup`, never resubmitted;
     - a step is `succeeded` only after ingestion.
   - **Code edits:** a new plan version replays against the same journal. Steps the new code no longer reaches are kept; unsent ones are cancelled.
3. **Guardrails.**
   - **Ceiling:** $1.00 per project, as integer micros. Before each dispatch, charged plus possibly-charged plus in-flight known prices plus this step's price must stay ≤ the ceiling. Otherwise the step is not dispatched and the run becomes `paused_budget`. Raising the ceiling is a store write plus a wake.
   - **Unpriced steps:** a step with no per-call price counts as $0.
   - **Step limit:** at most 200 media steps per run, by default.
   - **Per-pass limits:** CPU time and memory, configurable for tests.
4. **Project switch.** `planMode: "graph" | "code"` on the project; absent means `graph`. The current flow must be byte-for-byte unaffected for `graph` projects.
5. **Docs.** Add a short "Code plans (experimental)" section to `docs/technical/EXECUTION-ENGINE.md` and an entry in `docs/implementation/STATUS.md`.

## Tests (minimum)

- **Replay:**
  - re-running a finished plan makes zero provider calls;
  - the same plan and journal always produce the same pass result;
  - `Date.now()` and `Math.random()` are stable across passes of one run.
- **Parallel:** a `Promise.all` of three `ctx.image` calls dispatches three steps in one pass.
- **Choice:**
  - an unanswered choice ends the pass `waiting`;
  - answering it wakes the run and continues;
  - changing the options re-asks;
  - changing only the question text does not.
- **Code edit:** change one shot's motion in a two-shot plan; only that shot's video (and the render) dispatch, and the other steps are reused.
- **Restart:**
  - a step with intent but no receipt becomes `unknown` and is resolved by `lookup` with zero new `submit` calls;
  - a restart while waiting on a choice resumes correctly.
- **Failure:**
  - a fake provider failure resolves `{ ok: false }` and the plan's fallback branch dispatches a different model;
  - a thrown error ends `error` with the message.
- **Sandbox:**
  - the plan cannot reach `process`, `require`, `import()`, `fetch` or the file system;
  - an infinite loop is interrupted within the CPU limit;
  - a memory blow-up is stopped.
- **Ceiling:**
  - priced steps stop at $1.00 with `paused_budget`;
  - raising the ceiling resumes;
  - the 201st free step is refused.
- **Isolation of modes:** a `graph` project's existing tests pass unchanged.

## Out of scope

- The Director, Codex workspace, `submit_plan` and dry-run diffs (P2).
- Routes, SSE events and the web (P3).
- Real providers (P4).
- Changing or deleting the current planning layer (P5).
