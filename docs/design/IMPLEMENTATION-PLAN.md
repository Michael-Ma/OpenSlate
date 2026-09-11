# OpenSlate — Implementation Plan

**Version:** 0.3 · September 10, 2026
**Status:** direction and acceptance gates; the repository remains a basic application skeleton.

See the [architecture](README.md), [component overview](COMPONENT-DESIGN.md), [skill/tool framework](SKILLS-AND-TOOLS.md), and [execution/editing design](EXECUTION-AND-EDITING.md).

## 1. Delivery priorities

1. Prove reusable skill/tool lifecycle with a very small capability set.
2. Prove code-plan compilation, parallel execution, and a targeted edit against fake media.
3. Connect image/video and narration adapters; render a short sequence after human keyframe review.
4. Validate recovery, useful preview latency, and multi-minute editing before widening feature scope.
5. Add optional local H3 execution after the provider boundary is proven.

Continuity and asset direction start as references inside `production`. The initial second skill is `plan-authoring`. More specialist skills, more director agents, and more model-facing tools are not prerequisites.

## 2. Decisions and assumptions

| Selected direction | Still provisional |
|---|---|
| TypeScript application, Codex director | Exact pinned Codex release and adapter compatibility |
| Code-authored operation plan and deterministic executor | Concrete restricted planning-language syntax |
| Two skills, five domain tools, six operation families | Later skill split points based on usage |
| Scoped edits, stable work identities, output reuse | UI detail and review presentation |
| Up to six minutes; uploaded/generated narration; conversational creative edits | Exact first speech/transcription profiles and OS packaging |
| Human keyframe review; user-directed quality changes | Review layout and performance thresholds |
| Extensible LLM/image/video/audio profiles; Codex, GPT Image 2 and H3 first | Additional production adapters and local hardware/runtime |
| Public repository with MIT license | Packaging/dependency distribution details |

The product decisions are confirmed: single-user local app with user-configured credentials; exports up to six minutes; uploaded or conversationally developed/generated narration; concise plan review plus human-approved keyframes for every shot; automatic technical recovery only; conversational creative editing and visual review. Ten- and thirty-minute films and direct timeline editing are later milestones. The [commercial walkthrough](COMMERCIAL-WALKTHROUGH.md) is the 150-second acceptance story, followed by a full six-minute boundary test.

## 3. Components to implement, without premature package proliferation

| Boundary | Initial home | Add when needed |
|---|---|---|
| Project records, constraints, revisions | `packages/core` | Dedicated persistence/artifact packages |
| Codex adapter, scoped context, skill lock | `packages/director` | Runtime-specific package once adapter warrants it |
| Tool descriptors and shared domain handlers | Server modules with versioned contracts | Separate tool package when reused |
| Plan parser, graph compiler, change comparison | Core execution module | Separate compiler package if substantial |
| Scheduler, job records, events | Server/worker modules | Separate worker process for generation/rendering |
| Capability discovery and image/video/speech/transcription adapters | `packages/providers` | Provider-specific packages when useful |
| Narration readiness, scripts, source segments and cues | Core project modules with production guidance | Separate audio modules as implementation grows |
| Timeline and trusted FFmpeg compilation | Core media modules | Dedicated timeline/render packages |
| Creative instructions and reference examples | `skills/production`, `skills/plan-authoring` | Specialist skills after demonstrated need |
| Local inference | Deferred `workers/h3-python` | Python job API, model runtime, GPU management |

These are design ownership boundaries, not a request to create empty packages for every box in a diagram.

## 4. Milestones

### Phase 0 — Skill/tool runtime and compilation proof

**Build:** two minimal skill packages, an OpenSlate catalog/immutable lock, scoped request context, the five domain tool contracts, a local Codex/MCP adapter, and a small parser/compiler for the six operation families plus references and human-only review gates. Use fake handlers only.

**Exit:** a new request selects pinned skills; a follow-up request preserves the same lock and settled intent; runtime recreation reinjects the necessary guidance; unexpected skills and incompatible tools are rejected; the agent authors and prepares a valid graph with no side effects. Test runtime input/approval round trips, interruption, and uncertain turn-start recovery against the pinned release.

A source skill edit must not alter an active snapshot. Adding a test skill, media profile, or operation should require registration and focused tests, not scattered changes across the system. A fake second DirectorRuntime must satisfy the same domain-tool contract. Prove capability rejection for a video profile that cannot consume the approved keyframe. Resolve the exact planning-language subset here; the example is not a promise of general TypeScript support.

### Phase 1 — Parallel execution and live edits with fake media

**Build:** stable node/candidate identities, graph comparison, ready queue, policy/budget admission, exact keyframe review records, scoped edit holds, transactional patch publication, progress events, narration readiness/segment revisions, and fake providers capable of delayed completion/failure.

**Exit:** two independent branches overlap; an approved storyboard batch advances while an unapproved batch stays held; a mid-run shot patch reuses unaffected outputs; compatible in-flight work attaches correctly; stale outputs cannot replace new selections. Test a trim-only change, a deliberate new take with identical inputs, conflicting edits, an abandoned edit hold, and replay with fresh model tool-call IDs.

The compiler may rebuild the entire normalized graph. The acceptance criterion is preservation of valid execution and artifacts, not an incremental compiler.

### Phase 2 — Short complete cloud production

**Build:** real GPT Image 2 and H3 adapters, configurable speech/transcription adapters, cloud-reachable reference transfer, durable receipts/ingestion, scene-grouped storyboard review, uploaded/generated narration, playback/comparison, conversational take selection, a basic internal timeline, and FFmpeg rendering. Maintain the fake no-key demonstration path.

**Exit:** a bounded 30–60 second sequence runs from brief to usable export and supports replacing one shot. Exercise uploaded audio and notes-to-script-to-speech paths; reject every video submission lacking current human keyframe approval; verify quality feedback cannot autonomously purchase a take. Record actual access, capability behavior, output transfer, latency, and usage availability. Keep provider calls opt-in with a separately authorized test allowance. A local app path alone is not a valid cloud reference URL.

### Phase 3 — Recovery and fast multi-minute iteration

**Build:** complete reconciliation, phase-specific retries, cost accounting, output validation, scene previews, scoped human review, conversational timing edits, and a read-only detailed-plan/debug view. Recovery rules begin with Phase 1; this phase hardens them for real providers and longer runs.

**Exit:** restart while queued, submitting, monitoring, ingesting, and rendering. Preserve unknown submissions and liabilities, delayed receipt evidence, exact take lineage, and prior previews. Demonstrate the 150-second boots commercial and a six-minute project; measure first useful storyboard/scene preview and targeted edit turnaround/extra work. Validate duration at the product boundary, cue alignment, memory/queue behavior, review batching, and partial-source narration. Jobs advance without a model turn for each poll or completed node.

### Phase 4 — Open-source release readiness

**Build:** clean installation, migrations/export/import, examples, contribution instructions, diagnostics, compatibility fixtures, and a declared OS matrix. Keep precise provider/runtime implementation notes separate from high-level architecture documents.

**Exit:** a contributor can run the fake demo without credentials and the cloud path with their own credentials. The required recovery/editing tests pass. Performance and quality statements are supported by measured representative projects rather than assumed speedups.

### Phase 5 — Optional local H3 worker

**Build:** Python job/capability API, persistent accepted work, transferable artifacts, warm model loading, GPU admission, and a TypeScript local-provider adapter.

**Exit:** the same project/change/scheduler flow works with actual local capabilities. Local-only H3 does not make hidden hosted enhancement calls. TypeScript composes any explicitly configured hybrid stages. Benchmark hardware and model behavior separately; cloud users still do not install Python or weights.

### Later product expansion — Ten/thirty minutes and direct editing

Keep duration ceilings configurable and use scene summaries, bounded context retrieval, paged review, and stable narration segments now. Add longer-film support only after separate 600/1,800-second workload, quality, recovery, and rendering validation. Introduce a direct timeline editor through existing change services later; conversation remains a supported editing surface.

## 5. Architecture acceptance matrix

| Case | Must demonstrate |
|---|---|
| Follow-up request and context compaction | Same capability lock; fresh scoped project state; no replayed media effects |
| Skill reference changed on disk | Active snapshot unchanged until an explicit upgrade |
| Unknown operation or invalid plan | Useful compiler diagnostics before any side effect |
| Creative discussion before plan code exists | Project-only change persists decisions without paid execution |
| Notes, partial script, uploaded audio, mixed sources | Detect gaps; preserve decisions/source media; produce accepted audio and measured cues |
| Unapproved or replaced keyframe | No affected video dispatch; batch approval covers exact displayed inputs |
| Quality dislike versus technical error | Only eligible technical recovery is automatic; quality retries require user intent |
| Agent requests extra take with approved frame and budget left | Reject without a scoped user request or trusted eligible failure record |
| Changed narration | Realign immutable audio ranges/cue revisions; reuse takes for placement-only shifts and review changed duration/meaning |
| Preparation before narration timing exists | Compile pending timing; gate dependent video dispatch and resolved assembly |
| New profile outside active lock | Explicit successor lock/run boundary; preserve old attempts and enforce renewed review |
| Alternate model/runtime profile | Same domain state, explicit capability checks, no secret leakage or lost jobs |
| Six-minute release boundary | Accept up to 360 seconds and reject unsupported larger targets clearly |
| Intent changes while prompt text stays the same | Stale prompt provenance blocks unreviewed reuse/dispatch |
| Patch completes during a user pause | Only its own hold clears; dispatch remains paused |
| Two independent shots | Overlapping execution within capacity/budget |
| Review gate on one branch | Other ready branches proceed |
| Close-up request on one shot | Focused patch, reused unrelated takes, visible continuity consequences |
| Trim/music/caption edit | Reuse generation; rebuild only affected editing/render work |
| Mid-run result after unrelated edit | Compatible candidate remains attachable |
| Mid-run result after replacement | Historical take retained; no current-selection overwrite |
| Two competing edits | Revision conflict and explicit rebase, not silent lost updates |
| Director crash during edit | Hold remains visible; no automatic resumption of spending |
| Lost provider create response | Unknown liability retained; no blind resubmission |
| Late receipt after worker ownership changes | Correlated evidence reconciled without stale progress overwrite |
| Replay or identical deliberate new take | Deduplication and intentional regeneration remain distinct |
| Render for an older working edit finishes | Previous export kept as history, not promoted over new target |
| Restart/import/export | Project survives independently of conversation history |

Use narrow unit tests for compiler normalization, dependency impact, timing, revision checks, and admission. Use integration tests for registry/runtime isolation, fake execution, and race/recovery behavior. Real provider checks are bounded pilots rather than default contributor CI.

## 6. Measurements and unresolved choices

Measure orchestration overhead separately from provider inference: request-to-plan latency, model/tool round trips per batch, ready-to-dispatch delay, resource occupancy, time to first useful preview, and edit-to-updated-preview latency. Track generated seconds, reused takes, regeneration reasons, estimates/reported costs, and unsettled liabilities.

Do not promise a speed multiplier before measurement. Parallelism shortens only independent portions of the dependency path; review gates, capacity, and provider latency still matter. Start with straightforward scheduling and add optimization only where these measurements show a bottleneck.

Remaining integration choices are the first speech/transcription profiles, exact pinned runtime release, packaging/OS matrix, and measured performance thresholds. Implementation gates include runtime/model compatibility, bounded plan syntax, exact human-review enforcement, narration timing, provider transfer/recovery behavior, and future local inference capabilities. Product duration, distribution, autonomy, and conversational editing scope are settled; no further specialist skill or agent tool is needed for the confirmed scope.
