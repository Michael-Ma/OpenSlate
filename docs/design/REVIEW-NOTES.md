# OpenSlate — Design Review Notes

## Revision 0.4 — September 10, 2026

This revision turns the accepted architecture into eleven component designs, a shared contract index, and an implementation sequence. It also researches the current Codex/GPT-6 development guidance and Superpowers from primary sources. The repository remains a runnable skeleton; this revision does not implement the proposed application behavior.

### Coverage and review method

The [technical index](../technical/README.md) links persistence, application API, director runtime, skills/tools, plan compilation, execution, narration, providers/artifacts, timeline/rendering, review UI and operations/testing. Each document defines ownership, records or interfaces, execution logic, failure behavior and acceptance evidence. The [development plan](IMPLEMENTATION-PLAN.md) orders tasks T00–T13 around working slices and explicit compatibility gates.

Three component authors contributed runtime, execution and media designs. Cross-component review examined authority, identity, invalidation, durability and user-visible recovery; the integrating author reconciled contracts and reviewed the complete set. The [development workflow research](../development/CODEX-WORKFLOW.md) distinguishes documented product behavior from our project-specific recommendations. External skill source was read as research material; no Superpowers installation or new development instructions were activated.

### Material findings incorporated

| Finding | Resolution |
|---|---|
| Recreating a logical node could appear to renew permission for paid generation | Creative candidates consume a unique immutable service-issued grant slot independent of node identity; technical retries remain attempts of the same candidate |
| A delayed tool call could borrow the current request's authority | Bind each bridge credential to an immutable authorization epoch; revoke before an authority-changing request and recheck inside every mutation transaction |
| Native steering lacked proven per-call authorization attribution | V0 replaces the runtime/bridge when authority changes; preserve project state and compatible conversation history, and measure this cost before optimizing |
| Conditioned inputs with the same hashes could be reordered or assigned different roles | Include named destination ports, roles and ordering in normalized input and review digests |
| A project-only edit could release execution with an obsolete plan | Retain affected holds and stale bindings until a compatible executable plan restores freshness |
| Model interpretation of casual or conditional chat could approve unseen media | Require a reply bound to a displayed decision and a trusted full-message grammar, or a concrete structured decision; preserve explicit batch membership |
| An asynchronous projection could skip unseen events on reconnect | Return a snapshot's applied watermark; initially read canonical state and its matching event counter in one transaction |
| New audio or cue identities could unnecessarily invalidate unchanged videos | Separate full narration lineage/readiness from consumed meaning and relative timing; render inputs still include exact audio and placement |
| Artifact-local cue coordinates could be confused with assembled timeline offsets | Keep cue source ranges local to the referenced audio artifact and represent placement separately |
| A renamed file could be called durable before its bytes/directory were synced | Require a tested durable-file publication barrier before usable database publication; verify and quarantine missing/corrupt media on startup |
| Worker completion could overwrite a newer creative choice | Workers publish evidence and guarded outputs; the application projector alone promotes compatible draft selections and previews |
| Roadmap tasks could imply implemented capabilities or guaranteed external behavior | Mark all new component work pending; require fake-provider races and compatibility probes before bounded paid pilots |

The author pass also aligned authorization field names, attempt ordinals, artifact staging paths and shared contract terminology. Checks cover local Markdown links and anchors, fenced-block balance, whitespace and the changed-file scope. Illustrative TypeScript and Mermaid diagrams remain design artifacts; no runtime test or visual diagram-rendering claim is made.

### Implementation gates still open

- Pin and test the Node/SQLite/parser/FFmpeg dependencies and the Codex release's skills, MCP, permissions, process replacement and input behavior.
- Prove approval/admission/edit races, epoch revocation, unknown submissions, duplicate grants, artifact publication and recovery using real SQLite plus controllable fake operations.
- Validate image/video/audio account access, exact conditioning transfer, measured cue timing, provider pricing bounds and error classifications before enabling each profile.
- Measure restart latency, ready-work throughput, time to review/preview, memory and recovery on short, 150-second and six-minute workloads. There is no measured speed claim yet.
- Validate local packaging, credentials, backup/restore and a single active installation owner. GPU workers and ten/thirty-minute support remain later work.

Earlier sections below are historical review records. The v0.4 technical contracts supersede any inconsistent earlier terminology, including candidate versus technical-attempt authorization.

## Revision 0.3 — September 10, 2026 (historical)

This revision records the user's product decisions: up to six-minute films (ten/thirty later), uploaded or generated narration with conversational gap discovery, a single-user local app with extensible models, human-reviewed keyframes for every shot before video spending, technical-error recovery without autonomous quality regeneration, and conversational creative edits with visual review.

### Changes reviewed

- Narration readiness split into text and audio dimensions; scripts, source segments, accepted audio, and measured cue timing have persistent identities.
- Speech synthesis and transcription/alignment add two operation families while preserving two skills and five agent-facing tools.
- Every video depends on a human-approved conditioning image and current relevant shot/motion/profile settings; scene batches keep review manageable.
- Detailed shot plans and execution provenance remain available for debugging while normal review uses summaries, images and playback.
- DirectorRuntime and media-provider adapters have separate extension contracts; Codex compatibility is not universal LLM compatibility.
- A 150-second leather-boots walkthrough maps conversation, narration, storyboard review, generation, editing and export to services and saved records.

### Review findings incorporated

| Finding | Resolution |
|---|---|
| Previous plan example allowed a video without its own reviewed keyframe | Replace it with two image-to-video branches behind an explicit human scene review; compiler rejects missing conditioning/gates |
| Previous narration edit wording implied unconditional take reuse | Reuse only when meaning, timing and coverage remain compatible; explain scoped changes otherwise |
| Roadmap retained old operation count and provisional product choices | Six operation families and confirmed product scope are consistent across current documents |
| Reusable keyframe approval and budget could be mistaken for permission to generate extra takes | Candidate admission requires an initial authorized slot, a scoped user request, or trusted technical-failure evidence and retry allowance |
| Narration timing could block the preparation that produces it | Preparation graphs accept pending timing; dependent dispatch/assembly require measured accepted cues |
| Narration edits could leave downstream timestamps stale | Bind segments to immutable audio ranges and cue revisions; realign replacements and separate placement shifts from changed generation inputs |
| Active profile switching conflicted with immutable run locks | Switch within a locked catalog as a scoped change; new capabilities require an explicit successor-lock boundary while old jobs retain their identity |
| A profile lock could imply immutable hosted model identity | Preserve requested profile and reported resolved identity where available; do not claim a local lock freezes hosted weights |

Independent runtime and execution reviews completed with the findings above incorporated; a focused re-review found no remaining blocking contradiction. They were followed by the author consistency pass. Local checks cover document links, code-fence balance, and cross-document scope/terminology. The illustrative TypeScript syntax and Mermaid definitions are design artifacts, not tested runtime implementations. No paid media, application code, or new skill implementations are included in this revision.

### Remaining validation gates

- Pin and test the Codex release, permissions, skills/MCP catalog, model compatibility and interruption/input flows.
- Choose the first speech/transcription models and validate narration timing, voice behavior and credentials.
- Prove exact review binding, controlled retries, partial narration sources, and stale-result prevention with fake operations before live pilots.
- Measure short-sequence, 150-second commercial, and six-minute workloads; ten/thirty-minute release support remains future work.
- Validate actual image/video provider capabilities, reference transfer, account access and recovery. Select packaging/OS support during detailed design.

Earlier sections below are historical review records; their provisional defaults were superseded by v0.3, and the current v0.4 contracts govern implementation.

## Revision 0.2 — September 10, 2026 (historical)

This revision responds to the request for a smaller initial skill/tool set, reliable capability lifecycle across requests, code-authored fast execution, live targeted edits, and a high-level component document. It changes design documents only; the application remains a skeleton.

### Changes reviewed

- Two initial skills, with continuity and asset direction kept as production references.
- OpenSlate-owned immutable package/handler locks and explicit activation across requests, separate from native Codex discovery.
- Five typed domain tools, including project-only creative changes before plan code exists.
- Restricted TypeScript plan source compiled without side effects into a durable operation graph.
- Parallel ready-work execution, semantic versus execution dependencies, and result reuse across plan revisions.
- Scoped edit holds, atomic patches, stale-result protection, and explicit user-pause ownership.
- Short diagrams and execution algorithms in the component overview, with dedicated framework/execution companions.

### Review findings incorporated

| Finding | Resolution |
|---|---|
| Discussion-only decisions had no persistence route | Prepare/apply tools accept a project-only variant without generating execution intents |
| Literal prompt text could remain unchanged after creative intent changed | Bind prompts/specs to generation-relevant intent; require reauthoring or reconfirmation before reuse/dispatch |
| Edit scope could miss semantic dependents | Initial hold covers known semantic and execution influence; newly discovered in-flight work is reported honestly |
| Patch completion or model controls could override a user pause | Release only the owned edit hold; all other applicable controls remain in force |

Independent Codex-framework and execution-reliability reviews were followed by an author consistency pass. Validation checks document links, code fences, diagram structure, and alignment across architecture, component, framework, execution, and roadmap documents. Diagram rendering and the illustrative planning language are not runtime-validated implementations.

The new native Codex claims were checked against official skill, MCP, and App Server documentation. Compatibility with the chosen release, precise planning-language support, provider behavior, real speed gains, and creative quality remain implementation gates. The defaults for video format, distribution, and autonomy remain provisional.

## Revision 0.1 — September 8, 2026 (historical)

The following records the initial architecture review before the application skeleton and the 0.2 document reorganization. References to component count and document layout describe that earlier snapshot. Current behavior is proposed in the 0.2 documents; build checks are tracked separately in CI.

### Initial review method

The primary author drafted the architecture, ten component breakdowns, ownership map, and phased plan. Three independent agents researched/reviewed Codex integration, media/H3 architecture, and execution reliability. The author evaluated their findings, revised the documents, and checked the resulting cross-document consistency and internal navigation.

Provider/runtime facts were checked against primary documentation. Suggested OpenSlate interfaces and behavior are labeled as proposals. No image/video generation was purchased and no end-to-end runtime, provider, or render test was performed.

### Material findings resolved in the draft

| Finding | Resolution |
|---|---|
| A replayed agent can invent new operation IDs and repeat paid work | Service-owned generation intents/candidates, uniqueness checks, and revision-checked regeneration actions |
| Lost runtime turn-start acknowledgment could cause another turn | Reconcile runtime and project evidence before restarting; at-least-once wakeups with domain deduplication |
| Runtime approval/input events lacked a return path | Added normalized pending requests, reply operation, timeout/cancellation, and a Phase 0 round-trip test |
| A project-scoped MCP process could be reused across projects incorrectly | Project/action-scoped capabilities and per-project runtime/bridge lifecycle |
| Completion events could restart a director the user interrupted | Persist automation pause until explicit resume; keep dispatch and accepted-job monitoring separate |
| H3 cancel/delete has a terminal-state race | Disable H3 remote cancellation in v0 unless a safe method is verified; stop new dispatch while preserving accepted jobs |
| Strict lease fencing could discard a delayed successful receipt | Permit correlated append-only receipt evidence; only current owner updates canonical job state |
| Synchronous image generation did not fit the asynchronous job diagram | Added direct submission-to-ingestion and definite-rejection paths; distinguished render phases |
| User-approved replacement could erase original unknown liability | Separate replacement reservation; preserve original uncertain/estimated charge |
| H3 image-to-video could use the wrong composition despite correct final export size | Prepare and record correctly shaped keyframe derivatives before submission |
| Optional context enhancement could be confused with vendor-internal processing | Distinguish extra standalone enhancement jobs from the normal hosted request pipeline |
| Hybrid local/cloud execution could hide hosted calls inside Python | TypeScript composes explicit hosted and local jobs; Python retains inference-only responsibility |

### Cross-component checks

The final draft addresses the whole production loop: brief, story/bible, scenes/shots, reference assets, prompt compilation, generation, take review, timeline/audio, render/post-processing, and selective revision. Each has an owner and an output artifact or committed state.

It also distinguishes creative acceptance from technical completion; project persistence from conversation history; provider completion from local ingestion; a requested cancellation from a confirmed outcome; and estimated admission control from exact provider billing. The local worker reuses the provider boundary without claiming cloud capability parity.

The roadmap starts with a small complete video and a fake provider. It reserves advanced editor features, multiple autonomous directors, hosted multi-user infrastructure, and GPU inference for demonstrated needs or later phases.

### Remaining uncertainty

- Product assumptions still need confirmation: first genre/duration, local versus hosted distribution, and default autonomy. Imported narration/music is a proposed initial scope.
- Codex integration is documentation-backed. Compatibility testing of the intended pinned runtime remains a Phase 0 gate.
- Account-specific API access, transfer behavior, latency, concurrency, usage reporting, and real generation quality require bounded live pilots during implementation.
- No exactly-once external generation guarantee is claimed. Lost-response cases remain visible and conservatively accounted for unless provider evidence resolves them.
- The exact GPU/runtime, performance, and license packaging for local H3 remain Phase 5 decisions.
- Markdown structure, local links, and diagram definitions were checked. Mermaid rendering has not been visually tested in a separate renderer.

These are explicit validation gates or product choices, not completed implementation work. The artifact is ready for architecture discussion and a Phase 0 prototype after those assumptions are accepted or adjusted.

Return to the [main design](README.md), [component breakdown](COMPONENT-DESIGN.md), or [implementation plan](IMPLEMENTATION-PLAN.md).
