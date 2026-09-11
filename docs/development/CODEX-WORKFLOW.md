# Building OpenSlate with Codex and GPT-6

**Research checked:** September 10, 2026
**Recommendation:** use native Codex with concise repository guidance, versioned implementation tasks, meaningful tests and independent review. Superpowers is optional; do not make the full workflow a prerequisite or a production dependency.

This document concerns the agents developing OpenSlate. The embedded video director has a separate restricted runtime and two production skills. No development plugin or skill was installed by this research, and no new `AGENTS.md` is activated by this document.

## 1. Findings from current primary sources

The current GPT-6 page names the model **GPT-6 Astra**. Its specific guidance calls out sensitivity to skill/instruction files, clarification behavior, explicit delegation instructions and calibrated testing. Audit conflicting instructions, state when routine work should proceed, request useful parallelism explicitly, and bound verification to the change. This is behavioral guidance, not evidence that any workflow package improves success or speed. [GPT-6 guidance](https://developers.openai.com/api/docs/guides/latest-model)

Codex's general workflow guidance recommends a clear goal, relevant context, constraints and completion criteria, plus planning for difficult tasks and concise repository instructions. Its `AGENTS.md` documentation explains hierarchical discovery, so local guidance must be reviewed together with inherited instructions. [Codex best practices](https://learn.chatgpt.com/guides/best-practices), [AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)

Current local Codex delegation is requested explicitly or through applicable project/skill instructions. Parallel agents consume additional work/tokens; the documentation highlights read-heavy delegation and caution with concurrent edits. Assign disjoint ownership and require concise results. [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

These sources were opened directly. The broader recommendations below are our application of them to OpenSlate, not a vendor benchmark or a claim that one universal workflow is best.

## 2. What Superpowers adds

I interpret “superpower” as Jesse Vincent/obra's **Superpowers** project. It packages a software-development methodology into composable skills: design, implementation planning, test-first development, debugging and review. It sits above a coding agent rather than replacing OpenSlate's scheduler, runtime adapter or application framework. [Superpowers project](https://github.com/obra/superpowers)

The current skill source is more nuanced than older summaries: brainstorming has spike, bounded and architectural paths, but retains an explicit approval gate for every path. The bootstrap aggressively checks for applicable skills. Its TDD skill requires a failing test before production implementation and asks for exceptions for listed categories. User instructions have precedence in its own bootstrap, so the workflow can be adapted; default behavior still matters. [Brainstorming source](https://raw.githubusercontent.com/obra/superpowers/main/skills/brainstorming/SKILL.md), [Bootstrap source](https://raw.githubusercontent.com/obra/superpowers/main/skills/using-superpowers/SKILL.md), [TDD source](https://raw.githubusercontent.com/obra/superpowers/main/skills/test-driven-development/SKILL.md)

| Choice | Benefits for OpenSlate | Tradeoffs |
|---|---|---|
| Native Codex + small repo rules | Direct fit to our accepted design, autonomy and component tests; less instruction overlap | We must maintain task quality and verification discipline ourselves |
| Full Superpowers workflow | Ready-made structure for design, test-first implementation, debugging and review | More workflow activation and approval boundaries; potential overlap with existing project rules |
| Selectively use or adapt a few practices | Can address a repeated weakness without changing the whole workflow | Must inspect dependencies/activation and version changes; selective reuse is not the full framework |

For this project, the architecture and product decisions are already developed. Requiring a new generic design approval for each authorized small implementation step would add friction. Its testing/debugging discipline is useful, particularly around paid-job recovery, but we can express that directly through acceptance tests and focused instructions.

There is no controlled GPT-6/OpenSlate comparison in this research proving Superpowers faster, more correct or unnecessary in every setting. The recommendation is a fit assessment. If repeated planning or verification failures appear, trial a pinned workflow on comparable tasks and measure results before adopting it broadly. Do not install a global skill bundle merely to start implementation.

## 3. Recommended repository setup

Add a short root `AGENTS.md` during the first implementation slice, after checking inherited guidance. It should point to the [technical index](../technical/README.md) and [development plan](../design/IMPLEMENTATION-PLAN.md), name the actual Node/pnpm commands, state module ownership, and list the small set of production invariants. It should not paste every design document into the prompt.

Suggested content categories, not yet installed instructions:

- Setup and commands that exist in the current checkout; distinguish proposed test commands from implemented ones.
- Domain invariants: exact human keyframe approval, trusted candidate/retry origin, submission uncertainty, immutable artifacts and scoped edits.
- Autonomy: carry already-authorized implementation through tests/review; ask for material product choices or required spending only; explain a concrete blocker.
- Delegation: permit bounded independent research/review and disjoint implementation tasks when explicitly enabled; one integration owner controls shared contracts.
- Verification: meaningful behavioral tests for changed logic; real SQLite races for admission; no paid calls in default CI.
- Handoff: describe changed behavior, validation evidence, remaining limitations and the next implementation task.

Add narrow directory guidance only when it prevents a repeated local mistake. Keep detailed review checklists and task plans in linked documents. Development guidance must not be discovered by the embedded production director, whose catalog is independently locked and tested.

## 4. Work in vertical slices

Give Codex a bounded task from the development plan, relevant design paths and concrete acceptance criteria. Start with a walking skeleton of one project, one fake-media plan, one human review gate and one recoverable job. Then deepen narration, parallelism, edits and real providers.

One task should yield a coherent reviewable behavior: for example, “a stale keyframe approval cannot dispatch video,” not “write all database models.” Avoid asking one turn to implement the whole product or making twenty agents touch shared contracts at once. Keep a brief task record with scope, decisions, completed work, validation and remaining work so a later session can resume from files and Git state.

Use an isolated branch/worktree per implementation task when concurrent work would otherwise overlap. Within a task, delegate bounded subproblems only after their interfaces are agreed. One agent owns integration. Useful early parallel work includes provider-contract research, fixture construction and independent review. Foundation contract edits usually stay sequential until stable.

The repository itself records durable progress; do not rely on the current chat being the only place that knows why a change was made. A successful worktree or commit is not proof that all acceptance criteria passed—include the evidence.

## 5. Test and review at the risky boundaries

For compiler, idempotency, admission, timing and revisions, write behavioral tests before or alongside implementation so the failure is demonstrable. Reproduce bugs with a failing test when practical. Use actual SQLite connections and injected provider barriers for races. Prefer assertions on resulting states, charges/accepts and media bindings rather than mocks confirming the implementation called itself.

An independent reviewer should check the changed diff against the relevant contracts after tests pass. Ask for concrete correctness failures and missing tests, especially stale approvals, paid duplication, old outputs overwriting new selections, unresolved liability and lost user pauses. Apply findings and rerun affected checks. Avoid an unbounded loop of reviewers searching for hypothetical improvements after required checks and findings are resolved.

Simple copy or documentation changes need appropriate formatting/link review, not a fabricated failing unit test. A broad schema/provider change needs broader integration coverage. The project plan maps required evidence to each slice so verification scope is concrete.

## 6. GPT-6 settings and prompt example

Use the requested GPT-6 Astra for this development workflow; there is no need to change model families to adopt the recommended process. Start with the current effective reasoning setting. As our own working default, use higher effort for architecture, reconciliation races and difficult review; reduce it for clear, small implementation follow-ups only after observing acceptable results. Do not assume maximum reasoning or more agents always reduces total turnaround.

Example task prompt for a later implementation request:

```text
Implement task T03 from docs/design/IMPLEMENTATION-PLAN.md.
Read docs/technical/PLAN-COMPILER.md and the shared contract index.
Deliver a fake two-shot plan with exact human keyframe review binding.
Do not add real provider calls or a timeline editor.
Preserve current user changes and the established module boundaries.
Use a bounded independent reviewer after the implementation passes its tests.
Resolve routine implementation choices and continue through verification;
ask only when a missing product decision materially changes the result.
Done when omitted/stale gates are rejected, valid source round-trips,
and the required checks pass. Report evidence and any remaining limitation.
```

This prompt is a task contract, not instructions to implement T03 during the design turn. Adjust its task number if the plan changes.

## 7. How we would evaluate an optional workflow package

Choose several comparable tasks from the same codebase, pin model/reasoning/runtime and dependency versions, and compare native guidance with a pinned Superpowers configuration. Track accepted behavior, escaped defects, human interruptions, elapsed time, tool/model work, conflict/rework and review findings. A single successful demo cannot establish superiority. Keep any adopted package development-only and audit its changed instructions before updates.

The immediate next step is implementation of the first planned slice with native Codex, the technical documents and focused tests. No additional orchestration framework is required to begin.
