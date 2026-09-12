# Implementation status

September 12, 2026. This page describes working code; technical designs describe the broader target.

OpenSlate has a local conversation/review workspace, per-project native Codex setup, durable planning and fake execution, versioned conversational narration drafts, accepted narration ingestion, a PNG reference library, and application-owned local clip rendering. Native Codex has passed scoped edits across restart, browser conversations, and a small image/structured-question experiment. A synthetic six-minute render passed decoded picture/audio checks. **The app does not yet generate a real commercial.** Image and H3 application bridges, recoverable generated-video normalization and durable spending allowances are implemented offline. The browser can select installed image/video profiles for new projects. The shipped launcher still enables only fake execution; allowance UI, paid activation and automatic real-media assembly remain open.

V0 runs for one user on one computer. Cloud model/media APIs remain part of the architecture. The accepted [runtime trust decision](RUNTIME-TRUST-DECISION.md) trusts the pinned installed runtime/sandbox while retaining application authority; independent code-host/authentication isolation remains unverified. The user authorizes local milestone commits and bounded live Codex tests. Defer live H3 tests until its key is available. Other real media calls require a test allowance; pushing is not authorized.

## Latest evidence

- Latest complete checkout check: **704 tests passed, zero failures/skips**, all builds/typechecks passed, installed no-turn Codex probe enabled. This adds H3 application execution, permanent allowance consumption, catalog/project selection, mixed ingestion and artifact-based fixture labels to the earlier 634-test baseline. The runner bounds test-file concurrency to four; protocol fixture deadlines allow child startup headroom without changing production deadlines. A heartbeat-disabled negative control fails the lease-renewal regression as intended.
- H3's **19 bridge tests** cover exact reviewed PNG/body identity, one POST, durable polling cooldown, protected downloads, normalization and restart recovery after simultaneous receipt-write failure and lease loss. Independent review fixes passed; all HTTP/CDN responses are injected. Durable spending allowances add **22 tests**, including separate SQLite workers, exact candidate/full-profile binding, expiry/revocation and permanent consumption in the admission transaction. See [H3 execution](MINIMAX-H3-EXECUTION.md) and [allowances](EXTERNAL-SPENDING-ALLOWANCES.md).
- The built browser created an image/H3-profile project, displayed configured estimates/missing keys, reopened its saved choices after server restart, and created no generation authority or attempts for that project. A separate default project completed two exact frame approvals and six fake operations; its decoded one-second preview and enlarged keyframes retained fixture labels. Browser console checks were clear before the deliberate restart; refresh restored the connection afterward. No model/media calls. See [provider selection](PROVIDER-CATALOG.md).
- A mixed-ingestion check published exact synthetic PNG bytes, waited for human frame review, normalized a six-second synthetic video and rendered that take through the existing local renderer. The Engine's automatic timeline/render operations remain fixtures; this real export used the explicit media application service. See [ingestion composition](INGESTION-COMPOSITION.md).
- The image bridge's **20 new tests** cover exact application/transport identity, ordered input bytes, one-POST concurrency, original caller lease fences, unknown restart, local spool recovery and actual Engine-to-PNG publication with injected HTTP. Nine generated-video checks cover real local normalization, measured trims, SQL rollback, lease loss, corruption, short outputs and recovery without repeat transcoding. Independent review found and fixed the downloader's late-cancellation bug and strengthened the explicit caller lease contract. No real media API calls. See [image execution](OPENAI-IMAGE-EXECUTION.md), [routing](PROVIDER-ROUTING.md) and [video derivation](GENERATED-VIDEO-DERIVATION.md).
- The protected-video downloader passed **14 focused tests**, including two durable output-store integrations and delayed socket-cleanup cancellation/deadline checks. It pins an explicitly allowed HTTPS hostname to validated IPv4 and bounds streams; completed spool replay makes no second GET. DNS/network responses are injected. The store's writer limit does not bound outstanding cancelled socket cleanup. See [download boundaries](VIDEO-DOWNLOAD.md).
- The earlier spool-consumption slice passed **83 focused tests**, including 18 new contract/integration checks. It preserves legacy evidence, recovers winning output slots before provider calls, keeps synchronous task IDs null, fully decodes exact PNG bytes, and aborts publication on lease loss. The shipped launcher still uses fake execution. See [spool completions](SPOOL-COMPLETIONS.md).
- Nine migration checks and five existing persistence tests passed, including historical JSON preservation, verified pre-upgrade backup, real uniqueness-failure rollback, two-process migration and committed-WAL restore. Twelve attachment tests cover exact ordered selections, bounded thumbnails, immutable receipts, corruption/restart and original-signal cancellation before native dispatch. See [migrations](DATABASE-MIGRATIONS.md) and [image attachments](DIRECTOR-IMAGE-ATTACHMENTS.md).
- Two native browser turns took 14.7 and 20.5 seconds, including restart and a persisted brief-only edit. The second made four successful application tool calls. No media attempts/grants/approvals. See [browser evidence](CODEX-BROWSER-VALIDATION.md).
- Two subsequent capability turns described a synthetic image and persisted a native question after enabling the pinned feature. One later service-level continuation recognized the exact answer `Warm`, completed in **8.633 seconds**, and preserved canonical state. That brought the historical native-start count to **17**; zero media API calls. Positive browser/HTTP question answering remains unverified; later browser image evidence is below. See [capability evidence](CODEX-CAPABILITY-VALIDATION.md) and [question continuation](CODEX-QUESTION-CONTINUATION.md).
- One subsequent native V2 narration request passed **22 checks** in **27.853 seconds**, using narration read → one draft edit → read after an explicit V1 upgrade. It preserved the accepted opening, canonical project and holds, and left two new sections unaccepted. Native start count is now **18**; zero media calls, native thread archived and all processes cleaned up. This is a short explicitly directed request, not general stage-selection evidence. See [native V2 validation](CODEX-NARRATION-V2-VALIDATION.md).
- A subsequent actual browser **Attach and discuss** request passed **23 checks** in **9.914 seconds**. Codex correctly described the undisclosed synthetic image layout; the original preview and response survived refresh, with unchanged project, narration, hold and generation authority. Native starts now total **19**; no media calls, all native/application processes closed and the thread archived. See [browser image validation](CODEX-IMAGE-ATTACHMENT-VALIDATION.md).
- The 360-second 720p synthetic render covered 10,800 frames, 64 cuts and 64 narration placements, including reversed source ranges. All decoded pictures, cue identities and silence gaps passed. Render/validate/install took **34.2 seconds**, with about **801 MiB** peak sampled process-tree RSS. This is one workload, not a memory guarantee or model-generation benchmark. See [media implementation](MEDIA-INTEGRATION.md).
- A separate **60-shot, 360-second fake workflow** passed all 122 operations, four exact review batches, a scoped edit preserving the other 59 shots, and restart reconciliation with zero duplicate fake accepts. Initial/scoped plan preparation took **510/445 ms**. It uses one-second fixture video bytes and simulated acceptance; physical timing is covered by the render check above. See [workflow evidence](SIX-MINUTE-WORKFLOW.md).
- Browser narration review created a section, attached a test recording, accepted exact script/audio/timing, reviewed and applied canonical narration. The browser decoded the six-second recording and imported 640×360 clip with no media errors. Files were submitted through the authenticated HTTP harness after the automation file picker stalled; the picker action remains unverified. No model/media API calls. See [browser evidence](NARRATION-BROWSER-VALIDATION.md).

Local milestones include `54303be` versioned narration, PNG references and durable output storage; `03f5db8` six-minute fake workflow; `c89d413` owned completion recovery; `d4050de` database migrations and exact request image attachments; `bb2c443` browser image discussion evidence; and `60f8fce`/`4c814c6` protected downloading and its reviewed cancellation fix. Earlier foundations and the latest provider-integration milestone are recorded in Git history and their component evidence. Nothing has been pushed during these milestones.

- The built browser upgraded an existing V1 project to V2 without altering canonical state or creating creative authority. It also displayed a supplied 320×180 PNG, retained the preview after refresh and passed exact-byte API/reopen checks. No browser warnings/errors or model/media calls. File selection used the HTTP harness; native file-picker automation remains unverified. See [guidance upgrades](DIRECTOR-TOOLS-UPGRADE.md) and [PNG library](PNG-REFERENCE-IMPORT.md).

## What runs

```mermaid
flowchart LR
  Human[Conversation and review] --> App[Authenticated local application]
  App --> Director[Native Codex or scripted director]
  Director --> Tools[Locked skills and versioned typed tools]
  Tools --> Prepare[Stage checks and prepare / apply]
  Prepare --> Compiler[Bounded plan compiler]
  Compiler --> DB[(Canonical state and durable jobs)]
  DB --> Fake[Fake production executor]
  Fake --> Review[Exact keyframe review]
  Review --> Fake
  Human --> Narration[Script / recording / timing acceptance]
  Narration --> DB
  Human --> Images[Owned PNG reference library]
  Images --> DB
  Human --> Upload[Owned local clip import]
  Upload --> Render[Frozen timeline and FFmpeg]
  DB --> Render
  Render --> Preview[Guarded preview and saved history]
  Preview --> Human
  Transport[Offline image / H3 transports] -. integration pending .-> DB
```

`pnpm demo:headless` remains an offline two-shot boots proof with simulated human review, scoped replacement and unknown-submission reconciliation. Its one-second fixture playback is distinct from the physical rendering acceptance test. It contacts no model/vendor.

## Task evidence and remaining work

| Task | Implemented and exercised | Remaining exit work |
|---|---|---|
| T00 compatibility | Node/SQLite/compiler/FFmpeg; pinned native setup, MCP, scoped edits, restart, browser conversation, small image/question experiment | Broader stage/gap and vision evaluations; answered native-question browser flow |
| T01 persistence | WAL/FULL sync, immutable records, transactions/replay, two-connection races, checksummed V1-to-V2 migrations, verified pre-upgrade snapshots and WAL-consistent restore | Media-inclusive export/import and restore-starts-paused release flow |
| T02 commands/API | Local authentication, persisted requests, request-bound tools, prepare/apply, snapshots/SSE, exact review, native setup, explicit guidance upgrades, image/upload/narration/render routes; backend environment credential resolver | Credential settings/wiring, broader decision inbox and release contracts |
| T02A workflow | Nine scoped contracts, mutation-derived checks, prompt freshness, versioned identities, advisory gaps, bounded no-progress handling, explicit continuation | Richer evidence projection and actual model stage/gap evaluations |
| T03 compiler | Restricted declarations, worker bounds, ordered roles, imported/generated keyframes, exact review, stable aliases, canonical source, cue-aware scoped reuse, duration cap; measured 60-shot compilation and source round-trip | Richer timeline operations and broader large-plan performance coverage |
| T04 fake execution | Immutable adapter registry, frozen profile/request identity, durable candidate/profile spending allowances and atomic consumption, leased provider calls, late-acceptance recovery, spool and exact PNG/generated-video ingestion, grants/candidates/reservations and scoped reuse | Human allowance HTTP/UI and launcher activation, broader crash/filesystem tests |
| T05 workspace | Conversation/native setup, storyboard approval, playback, scoped demo edits, pause/resume, narration review, PNG/clip libraries, render controls, saved model selection and artifact-based fixture labels | File-picker verification, broader accessibility/error UX, spending approval and real generation |
| T06 skills/tools/runtime | Two skill families, immutable V1/V2 locks/fresh activation, explicit upgrades, versioned MCP and draft narration tool, paged context, durable supervisor/epochs/questions, explicit PNG attachment with immutable thumbnail receipts and actual browser/native validation | Wider behavior/latency tests and browser question continuation |
| T07 narration | Immutable drafts/recordings/cues, exact independent acceptance, partial/mixed sources, normalization, guarded canonical commit, scoped shot impact, HTTP/browser review and versioned conversational draft writes | ASR/TTS, transcript alignment and generated provenance |
| T08 media/render | Owned imports, physical duration checks, frozen plan/cue resolution, exact cuts/audio, receipts, cancellation/recovery, guarded previews, HTTP/browser playback | Captions/overlays/transitions, broader revision/recovery campaign and streaming large media |
| T09 image/audio APIs | GPT Image 2 transport and optional Engine bridge; exact input/profile/lease binding, one-use dispatch marker, redacted result/usage, spool recovery and exact PNG publication; backend credential resolver and saved project profiles | Paid launcher activation and allowance UI, speech/transcription adapters, allowed live tests |
| T10 H3 cloud | H3/H3-Max transport and application bridge, exact reviewed first-frame transfer, one POST, durable bounded polling, protected download/spool and measured normalization with restart tests | Explicit launcher/CDN configuration, automatic real assembly and keyed short production |
| T11 integrated revisions | Scoped execution reuse, scripted browser edits, native scoped planning, narration impact and stale-render protection | Real end-to-end narration/story/frame/take/trim revision campaign |
| T12 six-minute acceptance | Synthetic 720p six-minute render, 64 cuts/cues, reversed ranges, decoded content and sampled resources; 60-shot fake workflow, batch review, scoped reuse and uncertain-job restart | Real 150-second boots commercial, generated six-minute workload, cost/latency/recovery campaign |
| T13 release packaging | Built single-process local launcher, exclusive installation ownership, bounded static serving, clean event-stream shutdown, backend environment credential resolver and backed-up schema upgrades | Credential configuration, media-inclusive export/import and clean-install verification |

These are implemented slices, not completion of every task's eventual exit criteria. The director mode and media fixture labels are separate: previews use saved artifact metadata. Only fake/v1 is registered by the shipped launcher. Optional image/H3 execution bridges are exercised through injected HTTP responses; profile selection and bridge construction do not grant spending permission.

## Reproduce validation

Use Node 24 and pnpm 10.33.0:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm demo:headless
pnpm probe:toolchain
pnpm probe:workflow
OPENSLATE_CODEX_PROBE_BINARY=/absolute/path/to/codex pnpm check
```

Tests use synthetic media and no credentials. Full coverage needs loopback listeners and FFmpeg; the last command also checks installed Codex without a model turn. Environment denials are blocked checks, not passes. The six-minute resource probe is separate from the normal suite; see [media implementation](MEDIA-INTEGRATION.md).

Verified: macOS arm64, Node 24.15.0, pnpm 10.33.0, TypeScript 7.0.2, Babel parser 8.0.5, Ajv 8.20.0, better-sqlite3 13.0.3 / SQLite 3.53.4, FFmpeg 8.1.1, Codex 0.153.4. Linux CI has not been observed for these unpushed changes.

## Key boundaries and limits

- Codex proposes validated data. OpenSlate owns state, authority, review, budgets, execution and artifact selection. Model-authored JavaScript is never evaluated.
- New edits fence old epochs. Holds belong to their request; only explicit human continuation transfers them. A compatible plan releases only its request's holds. Global user pause is separate.
- Tool and native-start intents persist before dispatch. Unknown outcomes are not automatically repeated. Context is reconstructed in a fresh native thread; a question answer receives fresh application authority.
- Native setup pins runtime/model/catalog and checks the question feature. Explicitly selected supplied PNGs receive request-bound, hash-verified JPEG thumbnails within four-file/512-KiB limits. The library's discussion action is read-only and does not transfer earlier edit holds. Later requests do not automatically receive those image bytes. Artifact inspection exposes sanitized metadata only.
- Paged context includes owned assets, canonical cues, draft narration and explicit coverage. Draft text is advisory, not acceptance or a media grant. Canonical commit verifies exact script/audio/timing, versions and authority; it retains holds until a matching plan. A user-declared externally generated recording is not proof of an OpenSlate generation job.
- Local rendering requires registered real sources and physical durations. Fake footage cannot masquerade as a longer take. Limits: 360 seconds, 64 cuts/64 audio placements, eight distinct audio inputs and eight simultaneous audio lanes. Embedded video audio is removed. No limiter/automatic ducking is claimed.
- Immutable outputs and completion receipts retain stale results as history. Current previews require the frozen target to remain current. Leases coordinate this machine, not a distributed deployment.
- General media uploads are bounded to 128 MiB; PNG uploads to 32 MiB. Playback verifies full content before creating a browser blob; audio is capped at 80 MiB and general artifacts at 256 MiB. Full-buffer verification has memory costs and no range streaming yet.
- Transports do not grant authority, guarantee provider idempotency, settle billing or replace ingestion. The registry resolves exact saved adapter/profile identities; external admission defaults to denied. Image/H3 bridges persist a single dispatch marker and never repeat an unknown POST. Allowances cap starts and configured estimates, not actual vendor bills; admission consumes those caps permanently. Legacy inline evidence remains bounded to 64 MiB. The durable store supports 32-MiB PNG/256-MiB MP4 streams; PNG ingestion preserves original bytes, while generated-video derivation retains separate raw and normalized hashes with measured frames. Initial video normalization accepts at most 128 MiB input. Paid worker activation and human allowance controls remain pending. See [routing](PROVIDER-ROUTING.md), [image execution](OPENAI-IMAGE-EXECUTION.md), [H3 execution](MINIMAX-H3-EXECUTION.md), [video derivation](GENERATED-VIDEO-DERIVATION.md) and [spool completions](SPOOL-COMPLETIONS.md).
- Tokens stay in tab memory. Pending browser requests survive project remounts within one API session; page reload/disconnect does not persist upload bytes or tokens. Server command receipts remain durable.
- Schema V2 migration validates historical definitions, verifies and syncs a pre-upgrade database snapshot, and preserves domain JSON. Restore includes committed WAL content. These metadata snapshots do not bundle media or establish execution ownership for an imported copy. Portable project export/import, disk quotas and power-loss guarantees remain release work.

## Next development sequence

1. Narration/media integration and the native capability slice are complete for this milestone. Retain the explicit file-picker verification limit; broader browser recovery coverage continues with release work.
2. Build on both provider bridges, saved model selection, durable spending allowances and explicit ingestion composition: add human allowance HTTP/UI, deliberate launcher activation and automatic real-media assembly. Preserve reviewed keyframes and unresolved liabilities; wait for the appropriate key/allowance before live media calls.
3. Versioned narration tools, human upgrades and trusted image attachment are implemented. Actual V2 narration drafting and browser image discussion passed. Evaluate broader stage/gap selection and browser native-question continuation with bounded Codex starts.
4. Complete supplied-media editing/recovery and release packaging/export. Finish independent work before requesting live prerequisites.
5. With keys and approved spending, verify a short real production, the 150-second boots commercial, then the generated six-minute workload.

See the [development plan](../design/IMPLEMENTATION-PLAN.md) for dependencies and [documentation index](../README.md) for component contracts and historical evidence.
