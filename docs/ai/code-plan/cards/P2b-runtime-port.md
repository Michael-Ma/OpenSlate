# P2b · Code-plan runtime: the port, dry runs, holds and events

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Then read:

- `docs/ai/code-plan/DESIGN.md`;
- the P1 report, `docs/ai/code-plan/reports/P1-report.md`, especially "Lead review";
- `apps/server/src/code-plan/port.ts` and the "Code-plan projects" section at the end of `packages/core/src/studio-api.ts`. Both are lead-owned contracts: build exactly these shapes and do not edit either file. If one is wrong, say so under Open issues.

This card runs in parallel with P2a (Director) and P3a (routes). Both call `CodePlanPort`; you implement it. Line numbers below are as of `078107d`.

## Change

1. **Implement `CodePlanPort`** on top of `CodePlanRuntime` (`apps/server/src/code-plan/index.ts`). Either the class implements it, or `createCodePlanPort(runtime)` lives in a new `apps/server/src/code-plan/port-impl.ts`.
   - **`view`:** builds `CodePlanView`.
     - `spentMicros` is charged plus possibly charged; `reservedMicros` is dispatched and not yet known.
     - `reached` comes from the latest pass.
     - `label` is the input's `prompt`, else `motion`, else empty, cut to 200 characters.
     - Versions are newest first, at most 50, each with its stored diff.
     - Choices list unanswered first.
     - `held` is true while any hold is open.
     - `state` is `empty` before the first version.
   - **`source`:** returns one version's source and metadata.
   - **`submit`:**
     - dry-runs first;
     - refuses with `CODE_PLAN_REJECTED` and `details.diff` when findings include `SOURCE_SYNTAX` or `RUNTIME_ERROR`;
     - stores the diff on the version record;
     - keeps an `invocationId → version` record (a new entity kind), so a retried call returns the same `{ version, diff }`;
     - uses `basedOnVersion` as the expected version (`null` = no plan yet).
   - **`answer`, `raiseCeiling`:** wrap the existing methods and return the view.
   - **`hold` / `release`:**
     - persisted entity kind `code_plan_hold`, idempotent per `holdId`;
     - while any hold is open, no new step with a price above zero is dispatched; the step stays `absent` and dispatches after release;
     - free steps and in-flight work continue;
     - release wakes the run.
   - **`failure`:** the current version's latest pass error, or `null`.
2. **Dry run.** A pass over the given source with dispatch disabled.
   - The same `call` path classifies each media call:
     - reused: already in the journal with a result or in flight;
     - new: absent, recorded with its price;
     - cancelled: unsent steps the source no longer reaches.
   - It writes nothing at all.
   - `certainMicros` is the sum of the new steps' prices reached before the pass stops. `dependsOnPending` is true when the pass ended `waiting`.
   - **Findings:**
     - `SOURCE_SYNTAX`: type stripping or module evaluation failed.
     - `RUNTIME_ERROR`: a pass error, with the message as `detail`.
     - `UNAWAITED_CALL`: a `ctx` call whose promise had no `then`/`await` attached by the end of the pass. Track this in the sandbox bootstrap.
     - `STEP_LIMIT`: the new steps would exceed the limit.
     - `CEILING`: `certainMicros` exceeds the remaining ceiling.
3. **Events.** Append `code_plan.changed` with payload `{ planVersion, state }` through `store.appendEvent` in these cases:
   - after `submit`, `answer`, `raiseCeiling`, `hold` and `release`;
   - after a pass, only when the view's digest changed.

   Never emit on a pass that changed nothing: the web refetches on every event.
4. **Carry-overs from the P1 review.**
   - **Sandbox dependency:** replace `@tootallnate/quickjs-emscripten@0.23.0` with the upstream `quickjs-emscripten`.
     - Pin an exact version published at least two weeks ago.
     - The sandbox has network access for `pnpm add`; use it only for this install.
     - Keep every P1 sandbox test green.
     - If the upstream build exposes a promise rejection tracker, report detached rejections as a pass `error`. Otherwise keep `UNAWAITED_CALL` as the warning and say so.
   - **Step limit:** count only dispatched steps (those with an attempt), per project, limit 200. Absent, budget-blocked and cancelled steps no longer count.
   - **`ctx.speech`:** implement it on the fake provider like image and video: kind `speech`, input `{ text, voice, model }`, a priced model entry and a fixture artifact.
5. **Docs.** Update the "Code plans" section of `docs/technical/EXECUTION-ENGINE.md` and add a `docs/implementation/STATUS.md` entry.

## Files you own

- `apps/server/src/code-plan/**`, except `port.ts`.
- `apps/server/package.json` and `pnpm-lock.yaml`, for the dependency swap only.
- New tests under `apps/server/test/code-plan-*.test.mjs`.

Do not edit `app.ts`, `index.ts`, the Director or `apps/web/**`. P2a and P3a wire the port; the lead merges.

## Tests (minimum)

- **Port:**
  - `view` on an empty code project is `state: "empty"`;
  - `submit` → `view` lists the version with its diff;
  - a second `submit` with a stale `basedOnVersion` is `REVISION_CONFLICT`;
  - a repeated `invocationId` returns the same version and creates nothing.
- **Dry run:**
  - writes nothing (compare a store snapshot before and after);
  - a one-shot motion edit reports exactly one new video and one new render, the rest reused;
  - syntax and runtime errors are findings, and `submit` refuses them with `CODE_PLAN_REJECTED`;
  - an unawaited `ctx.image` is `UNAWAITED_CALL`;
  - a plan over the remaining ceiling reports `CEILING`.
- **Hold:**
  - a held run dispatches no priced step but finishes in-flight work and free renders;
  - release dispatches the held step once;
  - holds survive a restart.
- **Events:**
  - one `code_plan.changed` per state change;
  - none for an idle tick;
  - the store cursor advances.
- **Carry-overs:**
  - all P1 sandbox tests pass on upstream QuickJS;
  - 200 dispatched steps are allowed even after many cancelled steps, and the 201st dispatched step is refused;
  - `ctx.speech` succeeds on the fake provider and is reused on replay.

## Out of scope

- The Director and its tools (P2a).
- Routes and project creation (P3a).
- The web (lead).
- Real providers (P4a).
