# OpenSlate — Implementation Plan

**Version:** 0.2 · September 10, 2026
**Status:** direction and acceptance gates; the repository remains a basic application skeleton.

See the [architecture](README.md), [component overview](COMPONENT-DESIGN.md), [skill/tool framework](SKILLS-AND-TOOLS.md), and [execution/editing design](EXECUTION-AND-EDITING.md).

## 1. Delivery priorities

1. Prove reusable skill/tool lifecycle with a very small capability set.
2. Prove code-plan compilation, parallel execution, and a targeted edit against fake media.
3. Connect real image/video providers and render a short complete sequence.
4. Validate recovery, useful preview latency, and multi-minute editing before widening feature scope.
5. Add optional local H3 execution after the provider boundary is proven.

Continuity and asset direction start as references inside `production`. The initial second skill is `plan-authoring`. More specialist skills, more director agents, and more model-facing tools are not prerequisites.

## 2. Decisions and assumptions

| Selected direction | Still provisional |
|---|---|
| TypeScript application, Codex director | Exact pinned Codex release and adapter compatibility |
| Code-authored operation plan and deterministic executor | Concrete restricted planning-language syntax |
| Two skills, five domain tools, four operation families | Later skill split points based on usage |
| Scoped edits, stable work identities, output reuse | UI detail and review presentation |
| GPT Image 2 and H3 cloud first; Python worker later | Local inference hardware/runtime |
| Public repository with MIT license | Packaging/dependency distribution details |

The initial product assumptions remain a single-user local app, narrated 2–5 minute acceptance example, imported narration/music, and plan/reference review followed by budgeted execution. Confirm them before setting product acceptance thresholds; they do not prevent proving the framework with fake operations.

## 3. Components to implement, without premature package proliferation

| Boundary | Initial home | Add when needed |
|---|---|---|
| Project records, constraints, revisions | `packages/core` | Dedicated persistence/artifact packages |
| Codex adapter, scoped context, skill lock | `packages/director` | Runtime-specific package once adapter warrants it |
| Tool descriptors and shared domain handlers | Server modules with versioned contracts | Separate tool package when reused |
| Plan parser, graph compiler, change comparison | Core execution module | Separate compiler package if substantial |
| Scheduler, job records, events | Server/worker modules | Separate worker process for generation/rendering |
| Capability discovery and media adapters | `packages/providers` | Provider-specific packages when useful |
| Timeline and trusted FFmpeg compilation | Core media modules | Dedicated timeline/render packages |
| Creative instructions and reference examples | `skills/production`, `skills/plan-authoring` | Specialist skills after demonstrated need |
| Local inference | Deferred `workers/h3-python` | Python job API, model runtime, GPU management |

These are design ownership boundaries, not a request to create empty packages for every box in a diagram.

## 4. Milestones

### Phase 0 — Skill/tool runtime and compilation proof

**Build:** two minimal skill packages, an OpenSlate catalog/immutable lock, scoped request context, the five domain tool contracts, a local Codex/MCP adapter, and a small parser/compiler for the four operation families plus references and gates. Use fake handlers only.

**Exit:** a new request selects pinned skills; a follow-up request preserves the same lock and settled intent; runtime recreation reinjects the necessary guidance; unexpected skills and incompatible tools are rejected; the agent authors and prepares a valid graph with no side effects. Test runtime input/approval round trips, interruption, and uncertain turn-start recovery against the pinned release.

A source skill edit must not alter an active snapshot. Adding a test skill or operation should require registration and focused tests, not scattered changes across the system. Resolve the exact planning-language subset here; the example is not a promise of general TypeScript support.

### Phase 1 — Parallel execution and live edits with fake media

**Build:** stable node/candidate identities, graph comparison, ready queue, policy/budget admission, scoped edit holds, transactional patch publication, progress events, and a fake provider capable of delayed completion/failure.

**Exit:** two independent branches overlap; one reference gate does not block unrelated work; a mid-run shot patch reuses unaffected outputs; compatible in-flight work attaches correctly; stale outputs cannot replace new selections. Test a trim-only change, a deliberate new take with identical inputs, conflicting edits, an abandoned edit hold, and replay with fresh model tool-call IDs.

The compiler may rebuild the entire normalized graph. The acceptance criterion is preservation of valid execution and artifacts, not an incremental compiler.

### Phase 2 — Short complete cloud production

**Build:** real GPT Image 2 and H3 adapters, cloud-reachable reference transfer, durable receipts/ingestion, a simple storyboard, imported audio, take selection, a basic timeline, and FFmpeg rendering. Maintain the fake no-key demonstration path.

**Exit:** a bounded 30–60 second sequence runs from brief to usable export and supports replacing one shot. Record actual access, capability behavior, output transfer, latency, and usage availability. Keep provider calls opt-in with a separately authorized test allowance. A local app path alone is not a valid cloud reference URL.

### Phase 3 — Recovery and fast multi-minute iteration

**Build:** complete reconciliation, phase-specific retries, cost accounting, output validation, scene previews, scoped creative review, and lightweight timeline controls. Recovery rules begin with Phase 1; this phase hardens them for real providers and longer runs.

**Exit:** restart while queued, submitting, monitoring, ingesting, and rendering. Preserve unknown submissions and liabilities, delayed receipt evidence, exact take lineage, and prior previews. Demonstrate the agreed multi-minute project and measure a targeted edit's turnaround and extra work. Jobs advance without a model turn for each poll or completed node.

### Phase 4 — Open-source release readiness

**Build:** clean installation, migrations/export/import, examples, contribution instructions, diagnostics, compatibility fixtures, and a declared OS matrix. Keep precise provider/runtime implementation notes separate from high-level architecture documents.

**Exit:** a contributor can run the fake demo without credentials and the cloud path with their own credentials. The required recovery/editing tests pass. Performance and quality statements are supported by measured representative projects rather than assumed speedups.

### Phase 5 — Optional local H3 worker

**Build:** Python job/capability API, persistent accepted work, transferable artifacts, warm model loading, GPU admission, and a TypeScript local-provider adapter.

**Exit:** the same project/change/scheduler flow works with actual local capabilities. Local-only H3 does not make hidden hosted enhancement calls. TypeScript composes any explicitly configured hybrid stages. Benchmark hardware and model behavior separately; cloud users still do not install Python or weights.

## 5. Architecture acceptance matrix

| Case | Must demonstrate |
|---|---|
| Follow-up request and context compaction | Same capability lock; fresh scoped project state; no replayed media effects |
| Skill reference changed on disk | Active snapshot unchanged until an explicit upgrade |
| Unknown operation or invalid plan | Useful compiler diagnostics before any side effect |
| Creative discussion before plan code exists | Project-only change persists decisions without paid execution |
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

Unresolved product choices are video genre/duration, default autonomy, audio generation provider, and local versus hosted distribution. Implementation gates are exact Codex/skill behavior, the bounded plan syntax, H3 transfer/recovery behavior, and local inference capabilities. None requires expanding the initial skill/tool inventory.
