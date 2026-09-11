# OpenSlate — Technical Design

**Version:** 0.3 · September 10, 2026
**Status:** architecture proposal; implementation remains an initial TypeScript skeleton.

OpenSlate turns a creative brief into an editable film of up to six minutes: conversational narration development, story and shot planning, human-reviewed keyframes, generated takes, timeline assembly, and finishing. It is a single-user local application with user-configured credentials and extensible model adapters. Codex, GPT Image 2, and H3 cloud are the first director/image/video integrations. A later Python H3 worker implements the video provider boundary; ten- and thirty-minute films are later validation targets.

## 1. Direction

The application should be fast to execute and easy to revise. Once the intent and current project state are clear for a requested scope, the director writes an execution plan in a small TypeScript planning language. OpenSlate compiles it into a durable dependency graph and executes ready operations directly. The user can intervene during production; the director translates the request into a scoped change rather than rebuilding the film.

| Decision | Purpose |
|---|---|
| TypeScript application, React UI, Fastify service | Share contracts across the product and execution engine |
| Codex behind a director adapter | Reuse conversation and reasoning while OpenSlate owns project state |
| Two initial skills; five agent-facing tools | Prove extensibility and lifecycle before adding specialist features |
| Uploaded or generated narration | Discover readiness, close gaps through conversation, and time shots against accepted audio |
| Human-reviewed keyframe for every shot | Confirm composition and intended motion before admitting video generation |
| Code-authored plan, compiled dependency graph | Batch decisions and remove the agent from routine dispatch/polling |
| Versioned project and scoped atomic patches | Change one shot while preserving valid completed and running work |
| SQLite, local artifacts, separate TypeScript worker | Straightforward local installation and durable progress |
| Role-specific image/video/speech/transcription adapters | Start with GPT Image 2 and H3; add models without changing project logic |
| Optional Python H3 worker later | Isolate model/GPU dependencies from cloud users |

The two skills are `production` and `plan-authoring`. Continuity and asset direction begin as guidance inside `production`, with references loaded when relevant. They can become separate skills when real usage justifies the split.

## 2. Overall architecture

```mermaid
flowchart TB
    User[User conversation and review decisions] <--> UI[Web workspace]
    UI <--> App[Application service]
    App <--> State[(Project and execution state)]
    App <--> Director[Codex director adapter]
    Catalog[Locked skills and tool catalog] --> Director
    Director --> Tools[Five validated domain tools]
    Tools --> Change[Change service and plan compiler]
    Change --> State
    Change --> Graph[Versioned execution graph]
    Graph --> Scheduler[Ready-work scheduler]
    Scheduler --> Workers[Trusted operation handlers]
    Workers --> Cloud[Image video and narration adapters]
    Workers -. later .-> Local[Python H3 worker]
    Workers --> Edit[Timeline and FFmpeg rendering]
    Workers --> Media[Artifact library]
    Workers --> State
    State --> Events[Progress and decision events]
    Events --> UI
    Events --> Director
```

The director makes creative decisions and authors plans. The compiler validates those plans. The scheduler and workers execute them. Only decisions needing reasoning return to the director; task completion and provider polling do not inherently require a model call.

## 3. Four durable artifacts

| Artifact | What it preserves |
|---|---|
| **Project revision** | Brief, narration readiness and scripts/cues, story/bible, scenes/shots, references, review decisions, selected takes, editorial intent |
| **Plan revision** | Readable plan source, normalized operation graph, exact input bindings, execution policy and version lock |
| **Execution records** | Service-owned generation intent/candidate IDs, attempts, receipts, cost reservations, node progress |
| **Media and timeline revisions** | Immutable outputs/provenance, exact edit selections, render recipes and finished exports |

These records survive conversation resets. Skill loading and conversation summaries are context management, not the production database. A shot is an intended moment, a take is a generated candidate, and a timeline clip is an editorial use of an exact take.

## 4. Main execution loop

1. **Understand the request.** Read current project state and clarify only missing decisions that affect the requested work.
2. **Author the creative change.** Assess narration text/audio readiness; close gaps through options and conversation. Develop the initial story/shot plan or a local revision with its continuity consequences.
3. **Write plan code.** Describe operations, dependencies, reference bindings, and review gates for that scope.
4. **Prepare and inspect.** Compile without side effects. Return a proposed project/plan diff, reused work, new work, holds, and estimated cost/time impact.
5. **Commit under policy.** Apply the approved or already-authorized change atomically. Admit new work only within the active policy and budget.
6. **Execute ready work.** Prepare accepted narration and shot keyframes in parallel where independent. Admit a video only after a human approves its exact keyframe and relevant shot intent/settings. Ingest outputs and advance dependencies without routine agent turns.
7. **Guide at decision points.** Surface storyboard batches, technical failures, material edit impacts, or exhausted budgets. The user decides creative quality; automatic retries handle eligible technical errors only. Resume only eligible branches.
8. **Finish or revise.** Resolve an editable timeline, render a preview/export, and accept further scoped changes at any time.

“Finalizing intent” applies to the scope being executed. It does not require locking the whole project against future changes or waiting for every scene before useful work can start.

## 5. What must be built first

| Build the framework now | Keep the initial content small |
|---|---|
| Skill discovery, compatibility checks, immutable version locks, request activation | Production guidance and plan authoring |
| Tool registry, schemas, permissions, idempotency, shared handlers | Read context, prepare change, apply change, control execution, inspect artifact |
| Plan compiler, dependency scheduler, stable identities, revision comparison | Image/video generation, speech synthesis, transcription/alignment, timeline assembly, rendering |
| Scoped edit protocol, stale-result protection, progress events | Conversational shot replacement, trim/reorder, reference selection; visual playback and review |

The first executable proof should use fake media operations, demonstrate parallel work and editing a running plan, and then connect real providers. Avoid building a large skill library or a professional timeline editor before those behaviors work.

## 6. Confirmed product decisions

The first release is a single-user local web app supporting video exports up to 360 seconds. Users can upload narration, develop and generate it through conversation, or combine sources with explicit segment choices. Imported music and optional native shot audio are supported; a music-generation adapter is deferred. The agent identifies missing script/audio/timing decisions and offers useful options rather than assuming every project starts from scratch.

Users review a concise production plan and scene-grouped keyframes. Every shot requires a human-approved conditioning image before video generation; a batch decision covers exact displayed shots and inputs. Detailed shot plans, prompts, settings, versions, and execution records remain available for debugging. The agent never purchases quality-driven regeneration autonomously. Technical recovery is bounded and preserves uncertain submission liability.

V0 creative edits are conversational. The interface supports playback, frame/take comparison, shot selection for chat context, review decisions, and pause/resume; a direct timeline editor comes later. Six minutes is a release acceptance limit, not a hard-coded shot count. Ten- and thirty-minute support require later scale/quality validation.

Fast execution does not mean unbounded concurrency or speculative paid takes. Optimize the critical path, overlap independent work, cache valid artifacts, and batch reasoning. Measure time to first useful preview and time to apply a shot edit, not only total job throughput.

## 7. Reading map

| Document | Read for |
|---|---|
| [Component design](COMPONENT-DESIGN.md) | Architecture diagrams, component ownership, and high-level execution algorithms |
| [Skills and tools](SKILLS-AND-TOOLS.md) | Loading, versioning, multi-request lifecycle, extension rules, and minimal initial surface |
| [Execution and editing](EXECUTION-AND-EDITING.md) | Code plan example, scheduler logic, incremental changes, and user intervention |
| [Commercial walkthrough](COMMERCIAL-WALKTHROUGH.md) | A 150-second leather boots example, narration branches, services and saved records |
| [Codex and providers](CODEX-AND-PROVIDERS.md) | Native runtime responsibilities, application ownership, and model extension boundaries |
| [Implementation plan](IMPLEMENTATION-PLAN.md) | Milestones and acceptance criteria |
| [Review notes](REVIEW-NOTES.md) | Design review findings and unresolved validation gates |

## 8. Runtime and provider boundaries

Use a locally scoped Codex App Server adapter over stdio and OpenSlate MCP tools, subject to a pinned-release compatibility test. A DirectorRuntime interface permits another runtime later; media provider adapters are a separate boundary. Model profiles declare actual capabilities and reference backend-only credentials. Codex custom-provider configuration is not universal LLM compatibility; see the [runtime/provider design](CODEX-AND-PROVIDERS.md). The official documentation covers session integration and skill activation; OpenSlate's version locks, tool policies, and plan execution are application features. [Codex App Server](https://learn.chatgpt.com/docs/app-server), [Codex skills](https://learn.chatgpt.com/docs/build-skills)

Providers expose their actual conditioning modes and limits. Cloud success is not local completion until media is copied and validated. Preserve ambiguous submissions without blindly repeating paid requests. H3 cloud and local Base must remain separate capability profiles. Python owns local inference, while TypeScript retains scheduling, policy, plans, and editing; any hybrid hosted stages are explicit TypeScript jobs. Local H3 inference alone does not make the Codex director or image generation offline.
