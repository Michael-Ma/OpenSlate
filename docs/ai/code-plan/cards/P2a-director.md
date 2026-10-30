# P2a · Code-plan Director: read_film, submit_plan, holds and repair turns

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. Then read:

- `docs/ai/code-plan/DESIGN.md`, especially "Director loop";
- `apps/server/src/code-plan/port.ts` and the "Code-plan projects" section at the end of `packages/core/src/studio-api.ts`. Both are lead-owned contracts: code against them, do not edit them. If one is wrong, say so under Open issues.

This card runs in parallel with P2b (which implements `CodePlanPort`) and P3a (routes). Use a fake `CodePlanPort` in your tests. Line numbers are as of `078107d`.

## Goal

In a project with `planMode: "code"`, a Director turn sees only two tools and its own instructions:

- `read_film` returns the current `CodePlanView`, plus the current version's source when one exists.
- `submit_plan({ source, basedOnVersion, summary })` calls `CodePlanPort.submit` with author `director`, the tool call's identity as `invocationId`, and returns `{ version, diff }`, or the refusal code and diff.

The Director writes the whole program in the tool argument. Do **not** give the native runtime a writable workspace or a shell: the workspace stays read-only (`packages/director/src/runtime/setup.ts:102`).

Graph projects must behave exactly as before, byte for byte in their locks, catalogs, instructions and tests.

## Change

1. **Code tool catalog** in `packages/core/src/tools.ts`.
   - Add `read_film` and `submit_plan` descriptors and their argument schemas: `source` ≤ 256 KiB; `basedOnVersion` integer or null; `summary` ≤ 500 characters.
   - Register a separate catalog version for code mode, with its own `toolHandlerId`. It must be distinct from every graph contract and satisfy the skill manifest's `x.y.z` check.
   - **Do not** add it to `SUPPORTED_TOOL_CONTRACTS` (`tools.ts:18`). Otherwise `toolContractAtLeast` turns on graph-only branches in `director-input.ts`, `context-projection.ts` and `tool-invocations.ts`. Widen the `ToolContractVersion` type where needed instead (`runtime/types.ts:17`, `tools/bridge.ts:12,27`, `tools/stdio.ts:10`).
   - Make sure `toolContractAtLeast(code, anything)` stays false. Add a test for it.
2. **Instructions package** `skills/code-plan/` (version `1.0.0`). The release automation ignores it, because only `skills/v<N>…` directories are released.
   - `SKILL.md` teaches:
     - the program contract `export default async function film(ctx)`;
     - every `ctx` method with its inputs and results;
     - await every `ctx` call;
     - use `variant` for deliberate duplicates;
     - keep choice ids stable;
     - leave prompts byte-identical when not changing them, because every byte change is a new paid step;
     - read the diff `submit_plan` returns before replying;
     - never put secrets or file paths in code.
   - `references/studio.d.ts` is the `ctx` API as TypeScript declarations, matching P1's `ctx` (`shot`, `scene`, `image`, `video`, `speech`, `render`, `choose`, `log`).
   - `references/example-plan.ts` is a two-shot plan with three keyframe variants per shot, a choice per shot, a video fallback branch and a final render.
   - Load it like a schema-1 lock (`createDirectorSkillLock`, `director-capabilities.ts:20-28`), with its own environment and the code catalog's handler binding. Pin its package digest in code, the way `SHIPPED_DIRECTOR_GUIDANCE` does.
3. **Lock selection** for code projects.
   - Branch at `director-input.ts:31-45` and `local-director.ts:274-280`.
   - Skip the shipped-release upgrade `DirectorToolSettings.currentForFreshTurn` (`director-tools-upgrade.ts:54-112`), which would throw `DIRECTOR_GUIDANCE_UNSUPPORTED` on a non-shipped lock.
   - The code-mode context is the `read_film` projection and short code-mode developer instructions, not the graph `projectDirectorContext`.
4. **Handlers** in `tool-invocations.ts`, in the `switch` at :270-369, with receipt and replay behaviour like the other tools.
   - Reconcile recovery (:397-504) must settle a `submit_plan` whose response was lost by re-calling `submit` with the same `invocationId`.
   - `ToolInvocationService` is also built without options in `fake-director.ts:41` and `director-supervisor.ts:144/264/273`. Code-mode handlers must find the port from where it is wired, not only from constructor options.
5. **Wiring.**
   - Add `codePlans?: CodePlanPort` to `AppOptions` (`app.ts:56-75`) and pass it into the `ToolInvocationService` options (`app.ts:398-405`). P3a adds the same `AppOptions` field; keep the exact name.
   - Pass it to `LocalDirectorController` (`local-director.ts:46-61`).
   - In `index.ts`, pass the runtime: P2b makes it a `CodePlanPort`. Until then a cast is fine; the lead fixes it at merge.
6. **Pause on input.** When a human message is queued for a code project (`app.ts:241-273` → `director.enqueue`), call `codePlans.hold(projectId, requestId)`. Release it when that request's turn reaches any terminal state, including Stop, failure and timeout, and on reconcile after a restart.
7. **Repair turns.**
   - When `codePlans.failure(projectId)` reports an error for a Director-authored version, queue a repair turn. Use the same path the automatic keyframe review uses to queue a non-human turn.
   - Its input carries the error and the version.
   - At most two automatic repairs per version; then post a plain message asking the person.
8. **Reasoning effort.** Effort is hard-coded `low` (`codex.ts:216/292`, `setup.ts:106/194/270`).
   - If code mode can use `medium` without changing graph mode's profile, setup check or locks, do that.
   - Otherwise keep `low` and explain under Open issues what it would take.
9. **Fake Director.** In fake mode, a code project's fake Director answers a message by submitting `references/example-plan.ts`, so the offline demo and tests exercise the loop.
10. **Docs.** Update `docs/technical/DIRECTOR-RUNTIME.md` and `docs/technical/SKILLS-TOOLS.md` (code mode), and add a `docs/implementation/STATUS.md` entry.

## Files you own

- `packages/core/src/tools.ts`.
- `packages/director/**`.
- `skills/code-plan/**` (new).
- In `apps/server/src/application/`: `local-director.ts`, `director-input.ts`, `director-supervisor.ts`, `director-tools-upgrade.ts`, `director-capabilities.ts`, `tool-invocations.ts`, `fake-director.ts`.
- New `apps/server/src/code-plan/director.ts` for the code-mode input and the `read_film` projection.
- In `app.ts`: only the `AppOptions` field, the tool-route pass-through and the hold on message queueing.
- In `index.ts`: only the wiring.
- Tests.

Do not edit `apps/server/src/code-plan/` runtime files (P2b), the new routes (P3a) or `apps/web/**`.

## Tests (minimum)

- **Isolation:**
  - a code project's turn gets exactly `read_film` and `submit_plan` and the code-plan instructions;
  - a graph project's lock, catalog digest and instructions are unchanged;
  - `toolContractAtLeast(code, "1.0.0")` is false.
- **submit_plan:**
  - success returns version and diff;
  - a refusal returns `CODE_PLAN_REJECTED` with the diff;
  - a stale `basedOnVersion` is `REVISION_CONFLICT`;
  - a replayed tool call returns the same result;
  - a lost response is reconciled with the same `invocationId` and creates no second version.
- **Hold:**
  - a queued human message opens a hold;
  - turn completion, Stop, failure and restart reconcile each release it exactly once.
- **Repair:**
  - a pass error on a Director version queues one repair turn;
  - a third failure posts the ask-the-person message instead.
- **Fake mode:** a message in a fake-Director code project produces version 1 from the example plan.

## Out of scope

- The runtime and port implementation (P2b).
- HTTP routes and project creation (P3a).
- The web (lead).
- Real providers (P4a).
