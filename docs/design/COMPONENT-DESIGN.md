# OpenSlate — Component Design

**Version:** 0.4 · September 10, 2026
**Level:** architecture and execution logic. API fields, SQL tables, worker protocols, and implementation details are covered in the technical companions.

Read the [overall design](README.md) first. Focused companions cover [skills/tools](SKILLS-AND-TOOLS.md), [execution/editing](EXECUTION-AND-EDITING.md), [Codex/providers](CODEX-AND-PROVIDERS.md), and a [commercial walkthrough](COMMERCIAL-WALKTHROUGH.md).

Implementation-level contracts for these components are in the [technical design index](../technical/README.md).

## 1. Components and ownership

```mermaid
flowchart LR
    UI[Conversation and storyboard] <--> App[Application and change service]
    App <--> Store[(Project revisions)]
    App <--> Agent[Director and context manager]
    Framework[Skill and tool framework] --> Agent
    Agent --> Compiler[Plan compiler]
    Compiler --> Runner[Scheduler and workers]
    Runner --> Providers[Media providers]
    Runner --> Timeline[Timeline and renderer]
    Providers --> Assets[Artifact library]
    Assets --> Timeline
    Runner --> Progress[Durable progress and decisions]
    Progress --> App
```

| Component | Owns | Produces |
|---|---|---|
| Application/change service | User actions, policy, revision conflicts, scoped change commits | Accepted project and plan revisions |
| Director/context manager | Intent, creative reasoning, relevant context, decision dialogue | Creative proposals and plan source/patches |
| Skill/tool framework | Discovery, compatibility, activation, authorization boundaries | Locked capabilities for each request/run |
| Plan compiler | Allowed plan syntax, operation validation, dependency analysis, graph diff | Validated execution graph and impact report |
| Scheduler/workers | Readiness, concurrency, receipts, budgets, restart recovery | Durable progress and usable outputs |
| Narration workflow | Text/audio readiness, gap decisions, script/audio revisions and timing | Accepted narration with cues and lineage |
| Artifact/provider layer | Media requests, transfers, ingestion, provenance, capability differences | References and generated takes |
| Timeline/renderer | Edit resolution, media normalization, audio, captions, export | Editable timeline, previews, final video |
| Project/event store | Persistent revisions, execution state, decisions and lineage | Reconstructable state and reconnectable updates |

The browser, director, and CLI use the same application rules. None gets an alternate route around job admission or revision checks.

## 2. Director, context, skills, and tools

**Goal:** reason at useful decision points and carry context across requests without making the model the job runner.

```mermaid
flowchart LR
    Request[Request or decision event] --> Context[Read current scope and version lock]
    Context --> Activate[Activate relevant skill references]
    Activate --> Reason[Codex reasoning]
    Reason --> Read[Read or inspect]
    Read --> Reason
    Reason --> Proposal[Plan source or scoped patch]
    Proposal --> Domain[Validated application tools]
```

**Algorithm:** resolve the selected scene/shot and current execution state; activate the pinned production and/or plan-authoring guidance; retrieve additional context only as needed; propose a plan or change; use tools to prepare and apply it; end the turn when work can proceed deterministically. Wake the director for a new user request, an actionable technical failure, or a required user choice—not every provider poll. Quality observations can inform the user but cannot launch autonomous creative regeneration.

The initial skills are `production` and `plan-authoring`. Production includes story, shot planning, basic continuity, asset selection, review, and edit guidance as small references. A skill does not own mutable project state or grant tool permissions. The [framework design](SKILLS-AND-TOOLS.md) defines how the same versions are activated after subsequent requests, compaction, or session recreation.

## 3. Creative planning and reference direction

**Goal:** turn narrative intent into feasible shots and reusable assets.

**Algorithm:** establish narration readiness and story beats within the six-minute release limit; define a minimal bible for recurring characters/locations; split scenes into provider-sized shots; record action, composition, timing, continuity requirements, and audio intent; reuse known references and request only missing assets; mark review gates where later expensive work depends on a creative choice.

For audio-led films, settle affected narration/music cues before final video dispatch. Generate every shot's keyframe, group them for human review, and require an exact approval before its video job. Other image/audio preparation can overlap. Desired edit duration and requested generation duration are different: a take may include trim handles. V0 maps one generated shot to one provider clip; longer films come from editorial assembly.

| Function | Example | Required now? |
|---|---|---|
| Continuity direction | Shot 7 must preserve the red coat and left-hand suitcase from shot 6; a direct continuation may depend on shot 6's accepted frame | Basic guidance and dependency recording: yes. Separate specialist skill: no |
| Asset direction | Reuse the approved character portrait; create one station reference and a correctly composed keyframe for shot 7 | Basic reference planning: yes. Separate specialist skill: no |

Continuity requirements belong in project state, not only prose inside prompts. A semantic relationship can require review without requiring a generation-order dependency. Independent shots that share an approved character reference can execute in parallel.

### Narration workflow

**Goal:** accept whatever narration the user already has and close the remaining gaps through conversation.

**Algorithm:** classify text readiness (none/notes/outline/draft/approved) independently of audio readiness (none/partial/complete/accepted); ingest uploaded material; identify missing content, voice/language, facts, timing, and source choices; present a small set of options; save accepted decisions and revised script segments; synthesize only authorized missing/replacement audio or retain uploaded recordings; measure and align the accepted audio; update affected shot timing.

The director writes the script; a speech provider produces audio. Transcription/alignment uses a separate configured operation when required. Preserve original uploads and segment provenance. Editing a transcript does not change the recording: the agent must resolve whether to re-record, synthesize a replacement, or keep the original. Speech estimates help planning; the actual audio/cue revision controls timing. Each narration segment points to immutable source audio and measured ranges, and shot timing binds to cue revisions. Replacing audio triggers remeasurement/alignment and impact analysis through downstream cues, even when the first narration was one waveform. A later absolute timeline shift normally preserves its video takes; changed duration, coverage or meaning may require a new shot specification and renewed approval. Offer choices when audio and target duration disagree instead of silently cutting words or regenerating visuals.

## 4. Plan compiler and change service

**Goal:** convert code-authored intent into bounded executable work and small reviewable revisions.

```mermaid
flowchart LR
    Code[Plan code or patch] --> Parse[Parse allowed syntax]
    Parse --> Bind[Bind revisions and operations]
    Bind --> Validate[Validate graph and capabilities]
    Validate --> Diff[Compare with active plan]
    Diff --> Preview[Reuse and change impact]
    Preview --> Commit[Policy-checked atomic commit]
```

**Algorithm:** accept source/patch plus its expected base revision; parse a restricted TypeScript planning language without executing arbitrary code; resolve operation and input references; reject unsupported operations, cycles, or invalid provider combinations; compare normalized node specifications; calculate affected work and estimates; commit the project patch, new plan revision, and admission intent together when authorized.

Recompiling a whole small graph is cheap. The compiler can do that after each edit while preserving unchanged nodes and results; the agent only needs to author the requested patch. The graph's stable logical IDs are distinct from its revision number and individual generation candidates.

Bind literal prompts/specs to the generation-relevant creative intent and bible constraints used to author them. An intent edit makes that provenance stale until the prompt is reauthored or explicitly reconfirmed; unchanged prompt text alone is insufficient for reuse. The compiler checks freshness without judging prose. Project-only discussion changes can be saved before plan code exists, but must hold affected active work if they invalidate its intent.

Plan validation has no media side effects. A valid plan is still subject to execution policy, budget, input availability, and review gates. The concrete code example and edit algorithm are in [Execution and Editing](EXECUTION-AND-EDITING.md).

## 5. Scheduler and durable operations

**Goal:** keep ready work moving with minimal model round trips.

```mermaid
flowchart LR
    Graph[Committed graph] --> Ready[Find ready nodes]
    Ready --> Admit[Policy budget and capacity]
    Admit --> Run[Trusted operation handler]
    Run --> Ingest[Persist receipt and output]
    Ingest --> Advance[Update bindings and readiness]
    Advance --> Ready
    Advance --> Decision[Only unresolved choices reach director or user]
```

**Algorithm:** select nodes whose required inputs and gates are satisfied; prioritize estimated critical-path work and first useful previews; admit them within provider limits and budget; dispatch directly to registered handlers; persist external receipts; poll/reconcile independently; ingest results; advance dependent nodes. Limit work in flight so upload, GPU, API, or render bottlenecks do not overwhelm each other.

Six operation families serve the confirmed scope: image generation, video generation, speech synthesis, transcription/alignment, timeline assembly, and rendering. Two skills and five agent-facing tools still suffice; narration is additional registered worker capability. Transfer, polling, and technical validation are trusted lifecycle steps inside those handlers. New operations later enter the same registry and compiler.

Recovery preserves completed nodes and known external jobs. A lost submission response is uncertain, not an instruction to generate again. Stable service-issued work identities prevent a replayed director request from duplicating admission. Unknown liability remains accounted for even if the user authorizes a replacement. Retry eligible transient/terminal technical failures only within policy; do not label aesthetic dissatisfaction a technical failure. Download/render recovery should reuse existing media before any new paid generation. Invalid inputs and policy refusals need resolution rather than blind retries.

## 6. Assets and provider adapters

**Goal:** make imported/generated media durable and keep provider differences explicit.

**Algorithm:** resolve immutable input assets; validate their role and geometry; prepare a supported cloud transfer or local upload; submit through the job handler; save the receipt; retrieve output; verify bytes and media properties; publish the artifact and its provenance; create inexpensive review proxies.

Keep original references and takes immutable. Every derived crop/keyframe records its parents. In image-to-video, prepare keyframes at the intended composition before generation; final export cropping cannot repair an incorrectly composed source. A provider output URL is a temporary retrieval location, not the project archive.

Separate DirectorRuntime and media-provider adapters keep the application extensible across LLMs and image/video/audio models. Registered profiles reference credentials stored only by the backend. Adapters report supported modes, input constraints, output properties, concurrency, and recovery/cancellation behavior. They do not silently drop required references or substitute another model. Every v0 video must consume its human-reviewed keyframe through a supported image-conditioning mode. A text-only profile is incompatible with this workflow. V0 uses polling and conservatively avoids H3's cancel/delete race; stop controls can always stop new dispatch. Provider-specific API details belong in adapter implementation notes and contract tests, rather than this architecture overview.

A later Python worker owns model residency and inference. TypeScript continues to compose cloud, local, or explicitly hybrid jobs. A local worker uses its own capability profile and transferable asset references rather than application-machine paths.

## 7. Timeline, review, and rendering

**Goal:** preserve editorial decisions while making previews and exports reproducible.

**Algorithm:** resolve technically usable draft selections or user-accepted candidates into exact take references; place trims/cuts, audio, and captions against a declared time base; validate coverage and overlaps; normalize incompatible media; compile supported edit operations into trusted FFmpeg arguments; render a temporary output; validate it; then publish with a frozen manifest.

A working edit can describe pending replacements, but a render uses only a resolved snapshot with exact usable media. The last good preview stays available while replacements are being generated. Caption-only changes reuse video takes. A narration edit reuses takes when their meaning, coverage, and timing remain compatible; otherwise it proposes the specific new coverage or timing decisions required. Changing a generated action creates a new candidate only for the shots affected by that action.

Native shot audio is a mixed stream unless stems are actually available. Uploaded or synthesized narration and imported music are the initial external tracks. Sampled images help visual review but cannot prove motion, lip sync, or dialogue accuracy; full playback remains available. The user controls creative quality and requests any alternative takes. A draft preview can assemble technically valid clips without claiming creative acceptance; final acceptance is recorded separately.

## 8. User intervention and project state

**Goal:** support editing during production without stale results overwriting the latest intent.

**Algorithm:** identify the requested scope; immediately hold new dispatch for that scope and its known potentially affected semantic and execution dependents; read the current revision; have the director explain and prepare the required atomic changes; recheck conflicts; commit a replacement plan revision; resume authorized affected work while unrelated branches continue.

Scope expansion blocks future dispatch; work already started before its relevance was discovered is handled as in-flight work. Committing a patch releases only its own edit hold, never an independent user pause or another edit.

A result is checked against its current logical node/candidate binding, not just the global project revision. Accepted provider work may finish even after an edit. Keep its take with its original lineage; it cannot automatically replace a newer candidate. A final preview/export assembled for an older target remains a historical output rather than becoming the current one.

The UI displays a small impact summary: what changes, what will be reused, what needs a choice, and the likely extra time/cost. V0 supports creative changes only through conversation; future direct editing will use the same change service. The review UI provides scene-grouped keyframes, audio/scene/full-film playback, comparison, shot-linked timestamps, selection as chat context, and approval/pause controls. It does not require a timeline editor. One approval can cover all displayed frames in a scene; approvals bind exact inputs and cannot be fabricated by the agent. If a request is ambiguous, the agent asks about the affected scope while preserving everything else.

### Detailed plan and debug record

Keep a versioned shot-level plan even though normal review shows summaries: scene/shot IDs, purpose, action, composition/motion, timing and narration cue links, continuity/reference constraints, prompt revisions, input artifacts, selected model profile, approvals, candidates and job receipts. A read-only debug view/export links these to plan code, patches, public decision rationale and execution events. It excludes credentials and private model reasoning. The normal review screen shows only details useful to a creative decision.

## 9. Invariants and first proof

- Skills, tool handlers, and compiled plans have pinned identities; updates do not silently change running work.
- Project state and the budget ledger remain outside direct agent write access.
- A logical patch commits atomically; external media production completes asynchronously and cannot be rolled back like a database transaction.
- Provider completion becomes usable media only after local ingestion succeeds.
- Creative candidates consume an immutable authorized initial/user-request grant slot once; technical recovery keeps that candidate and creates another attempt with trusted failure evidence and retry allowance. The agent cannot manufacture a recovery reason.
- Every video job requires an exact human-reviewed keyframe and current relevant intent; general autonomy policy cannot bypass that gate.
- Review/authorization gates block only the work they govern.
- A user interrupt pauses automatic director turns until resume; dispatch controls and monitoring are separate.
- Reconnecting the UI or replacing the Codex session reconstructs current state rather than restarting production.

The first proof is a small fake-media graph with parallel branches, one review gate, a mid-run shot edit, and restart recovery. Add real providers after the compiler, framework, and edit semantics pass that test.
