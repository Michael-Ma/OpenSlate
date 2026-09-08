# OpenSlate — Implementation Plan

Companion to the [overall design](README.md) and [component design](COMPONENT-DESIGN.md). This is a proposed sequence, not a time or cost commitment. Build a complete vertical slice before adding more providers or agent hierarchies.

## 1. Decision register

| Item | Status | Design treatment |
|---|---|---|
| TypeScript application, Codex director | Selected | Foundation of all milestones |
| H3 cloud first, local Python H3 later | Selected | Provider interface from the start; local execution deferred |
| GPT Image 2 asset generation | Selected | Initial image adapter |
| Local web app / own credentials | Proposed, awaiting confirmation | Default deployment; no hosted multi-user scope |
| Narrated 2–5 minute acceptance example | Proposed, awaiting confirmation | Architecture also accommodates other genres |
| Plan/reference review then budgeted execution | Proposed, awaiting confirmation | Policy supports full-auto and per-shot review later |
| Imported narration/music first | Proposed | Exact speech/music provider selection deferred |
| App Server stdio + MCP | Proposed implementation | Phase 0 proves a compatible pinned release |
| Fastify, React/Vite, Zod, SQLite, local files, FFmpeg | Proposed implementation | Keep packages replaceable behind domain boundaries |
| Repository license | MIT | Track dependency/model licenses separately |

The product defaults remain provisional. They do not change the selected TypeScript/Codex/cloud-to-local boundary. Multi-user hosting would materially expand the first milestone and should not be assumed implicitly.

## 2. Suggested repository ownership map

```text
apps/
  web/                     # React workspace, storyboard, review and timeline
  server/                  # Local HTTP API, SSE, runtime and worker supervisor
  worker/                  # Job dispatch, reconciliation, ingestion and rendering
  cli/                     # Setup, project import/export, diagnostics, headless commands
packages/
  domain/                  # Entities, revisions, policies and invariants
  contracts/               # Versioned API/tool/provider schemas
  persistence/             # SQLite repositories, migrations, transaction/outbox logic
  artifacts/               # Blob store, ingestion, derivatives, cloud media transfer
  director/                # Runtime interface, context builder, wakeup/session manager
  director-codex/          # App Server adapter and pinned protocol bindings
  tools/                   # MCP transport and shared domain-command bindings
  production/              # Scene/shot planning validation and dependency analysis
  jobs/                    # Admission, attempts, leases, retry and budget ledger
  providers/               # Image/video contracts, GPT Image 2, H3 cloud, fake provider
  timeline/                # Edit model, time conversions and validators
  render/                  # FFmpeg compiler, profiles and output checks
skills/                    # Versioned creative instructions and reference guides
examples/                  # Synthetic demo, sample briefs and portable projects
docs/                      # Setup, architecture, provider contracts and troubleshooting
workers/h3-python/         # Later optional local inference package
```

These are ownership boundaries, not a requirement to create every package immediately. Start with a few packages and split when dependencies justify it. Application code must not import a provider’s raw response schema outside its adapter or Codex protocol types outside `director-codex`.

## 3. Milestones and exit criteria

### Phase 0 — Prove the integration boundaries

**Build:** a minimal TypeScript service, pinned Codex adapter, one OpenSlate MCP tool, a small versioned project object, and fake asynchronous generation. Use a read-only project projection and scoped scratch space. Establish how local media reaches H3, and which credentials each component needs.

**Verify:**

- Start/authenticate the chosen Codex release; load a skill; call an MCP tool; receive stream/turn events; complete a user-input/approval request round trip; interrupt; and resume after a restart.
- Demonstrate a real permission boundary: the agent cannot read media-provider keys or write authoritative state directly, and unapproved jobs are rejected by the service.
- Prove that submitting a fake job returns promptly, completes after the Codex turn ends, and produces one durable result despite duplicate wakeups or a replayed turn with fresh tool IDs. Use application-owned generation intents.
- Verify project/action scoping across two projects and that an interrupted director stays paused despite completion events. Reconcile a lost turn-start acknowledgment before starting another turn.
- Generate protocol types or validate checked-in bindings for the pinned release. Confirm release support for the exact stdio features used.
- Confirm model input support for sampled image review; leave audio/video interpretation claims out until tested.
- With a separately authorized test budget and configured credentials, run one image request and one H3 request, including input transfer and output download. Record actual responses, latency, usage availability, and capability assumptions.

**Exit:** a working runtime/tool/job seam, a documented startup path, and a decision on App Server versus the bounded-run SDK fallback. If App Server fails the gate, retain Codex as director and adjust the adapter; do not replace the selected runtime silently.

**Validation status:** the skeleton has no Codex or live generation integration yet. Pin and test the intended runtime and provider behavior during Phase 0.

### Phase 1 — Build one complete short production

**Build:** project/bible/scene/shot schemas, revision commits, asset ingestion, GPT Image 2 and H3 adapters, durable attempts and budget admission, one director with core skills, and a basic storyboard.

Support a 30–60 second sequence with a few scenes and reusable references. Add imported audio, simple take selection, ordered trims/cuts, a draft timeline, and MP4 export. Include no-credential demo mode using fake jobs and small redistributable synthetic media.

**Exit:** brief → reviewed plan → selected reference → generated takes → edited timeline → playable export, with exact provenance and visible job costs. Successful export does not depend on the original conversation remaining available.

### Phase 2 — Prove recovery and selective revision

**Build:** complete reconciliation, phase-specific retries, ingest recovery, fencing, domain events/wakeups, pause/cancel semantics, revision impact lists, and scoped approvals. These safeguards begin in Phase 1; this phase validates difficult failure paths before broad use.

**Exit:** restart during each job phase; recover a known remote job without resubmission; expose an unknown submission without silently repeating it; survive failed output downloads; and replace one shot while leaving unrelated media intact. An old result arriving after an edit cannot replace the new selection. Concurrent budget requests cannot double-admit the same allowance.

### Phase 3 — Deliver the multi-minute authoring experience

**Build:** scene-level planning and context retrieval, audio cue planning, batch production controls, bounded take review, timeline reorder/trim controls, captions, transitions, audio fades/mixing, scene previews, and final render validation.

**Exit:** the agreed multi-minute reference project meets its narrative and timing targets; the user can inspect decisions and revise a scene or shot without a full rerun. Measure continuity issues and regeneration burden on several representative briefs. Use those results to set expectations; do not claim universal long-form coherence from a single demo.

### Phase 4 — Prepare the open-source release

**Build:** clean installation, dependency checks, schema migrations/backup/import/export, examples, diagnostic tooling, provider fixture tests, contribution guide, dependency license inventory, and documented extension contracts.

**Exit:** a new contributor can run the synthetic demo with no API spend and the cloud workflow with their own credentials. Test cloud-mode setup on the declared OS matrix. Document shutdown/sleep behavior, credential locations, disk use, paid-call limits, and unsupported provider features. Public release readiness requires the Phase 2 recovery guarantees, not only an attractive demo.

### Phase 5 — Add local H3 inference

**Build:** versioned Python worker API and worker persistence, idempotent job acceptance, model/capability discovery, artifact transfer, warm model loading, GPU admission, progress, and failure recovery. Implement the TypeScript local-provider adapter against that API.

**Exit:** the same OpenSlate project and editing flow work with local Base capabilities. Benchmark the chosen hardware/runtime; distinguish local-only and hybrid hosted enhancement. Verify cancellation/restart behavior and model identity. Cloud behavior and local installation remain independent; cloud users still do not install Python or model weights.

## 4. Acceptance tests that exercise the design

| Test | What it proves |
|---|---|
| No-key synthetic end-to-end project | Installation, tools, edits, jobs, and export without provider spend |
| Short real cloud production | Actual provider integration, reference transfer, output ingestion |
| Lost create response in fake provider | Unknown-submission handling and retained budget liability |
| Creation client with automatic retries disabled | No hidden duplicate paid calls after ambiguous failure |
| Worker crash and lease takeover | Existing receipts monitored; stale progress fenced; late correlated receipt evidence preserved |
| Crash during blob/metadata publication | Recovery does not expose a missing artifact as ready |
| Concurrent admission near cap | Atomic reservation and job creation |
| User edits while director proposes a patch | Revision conflict prevents lost updates |
| Reference/wardrobe revision mid-generation | Correct dependency invalidation and late-result lineage |
| Director restart after batch completion | Project reconstruction and coalesced wakeups |
| Director replay with fresh tool IDs | Logical generation intent prevents duplicate admission |
| User authorizes replacement of unknown submission | New reservation created while original liability remains |
| H3 stop control during accepted work | Stops new work without unsafe remote record deletion |
| Unsupported conditioning combination | Failure before spend, with a clear planning alternative |
| Different source frame rates and audio rates | Correct normalization, trims, and timeline duration |
| Killed render followed by retry | Frozen edit survives and existing export remains intact |
| Export/import and checksum verification | Portable state independent of runtime conversation |
| Fake local worker with different capabilities | Provider abstraction handles non-parity explicitly |

Use unit tests for timeline arithmetic, validation, budget admission, and revision conflicts; integration tests for runtime/MCP boundaries, jobs, and artifacts; and end-to-end tests for production and recovery. Live provider tests are explicit, bounded-cost checks and should not run in ordinary contributor CI. Synthetic failures test contracts; they cannot establish undocumented provider guarantees.

## 5. Quality and cost evaluation

Record technical success separately from creative acceptance. Technical success means valid, available media and an export matching the edit. Creative acceptance measures story coverage, character/style continuity, action/prompt adherence, pacing, and usefulness of agent revisions.

For each representative project, record output duration, generated seconds, take count, accepted takes, regeneration reasons, estimated/reported spend, queue/generation/ingestion/render time, and unresolved liabilities. Ratios such as generated seconds per accepted second show waste without requiring a fixed provider price assumption.

Use a small curated set of briefs spanning the initial format, a recurring character, a location change, an audio-led section, and a requested shot replacement. Set release quality thresholds after the first measured pilots. Runtime model and provider behavior may change, so record versions with results.

## 6. Open questions and validation work

| Question | Why it matters | Resolve by |
|---|---|---|
| First genre and typical duration | Planning, audio, and creative acceptance emphasis | Before Phase 1 acceptance brief |
| Local app versus hosted service | Identity, isolation, storage, deployment scope | Before implementation foundation |
| Default autonomy and budget behavior | Review screens and admission policy | Before paid batch execution |
| Narration/music generation provider | Integrated audio production and cost | Before claiming full audio generation |
| Codex release and authentication path | Installation and runtime compatibility | Phase 0 |
| H3 transfer path and URL lifetime | Reference availability from a local app | Phase 0 |
| H3 idempotency/cancellation/reconciliation details | Unknown states and potentially duplicate spending | Phase 0; retain conservative defaults if unverified |
| Real latency/concurrency/pricing behavior | Batch sizing, estimates, user expectations | Authorized pilot measurements |
| Local GPU/runtime/checkpoints | Memory, performance, supported modes | Before Phase 5 |
| Dependency licenses and distribution packaging | Public contribution and dependency distribution | Before Phase 4 release |

## 7. First implementation work items

1. Confirm or keep the three product assumptions visible, and choose one representative brief.
2. Initialize a minimal TypeScript workspace with domain contracts and a fake provider.
3. Implement the Codex adapter/MCP spike with project state outside agent write access.
4. Define scene/shot/take/spec/timeline revisions and durable command idempotency.
5. Implement job admission, reservations, submission ambiguity, and atomic artifact ingestion.
6. Complete the short end-to-end path with cloud adapters and a basic FFmpeg edit.

Avoid starting with a full timeline UI or a library of autonomous subagents. The first useful engineering proof is a small film that can survive a restart and a targeted revision.
