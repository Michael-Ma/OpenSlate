# Supplied-media rendering bridge

This T08 slice connects the installed OpenSlate plan to real local media. It produces a measured MP4 preview from project-owned supplied clips and committed narration, stores immutable output evidence, and selects the preview only while the captured project target is still current. It makes no image, video, speech or transcription API calls and never dispatches the fake executor.

The implementation is in `apps/server/src/media/application.ts`, with public types in `application-types.ts`. It uses the existing `LocalMediaService` for bounded normalization, exact frame/sample assembly, full decode validation and immutable filesystem receipts. `managed-video.ts` installs verified video bytes into the same private artifact root used by the authenticated artifact-serving route. The application service and HTTP/UI adapters remain separate.

## Host contract

```ts
const media = new LocalMediaService({
  rootDir: configuredPrivateMediaDirectory,
  allowedInputRoots: configuredUploadDirectories,
  ffmpegPath: configuredAbsoluteFfmpegPath,
  ffprobePath: configuredAbsoluteFfprobePath,
});
const rendering = new MediaApplicationService(production, media);

await rendering.importVideo(projectId, human, {
  expectedHeadVersion, path: trustedHostSelectedUploadPath, key,
});
const job = await rendering.prepareRender(projectId, actor, {
  expectedHeadVersion, renderNodeId, key,
});
await rendering.run(projectId, actor, job.id, { signal });
await rendering.recover(projectId, actor, job.id);
rendering.cancel(projectId, human, job.id);
rendering.snapshot(projectId, actor); // { jobs, preview }
```

Every call requires authenticated project scope. A human render command may use a current `editing:false` request: requesting a local preview does not itself need an edit hold. A director requires its current active write epoch and editable request. Import additionally requires human editing authority because it adds an asset to the canonical project. Cancellation is human-only. Host-selected paths are accepted solely by the human import boundary, checked against configured local roots, and never form a model tool argument. Agent plans reference saved artifact IDs.

`registerMediaRoutes(app, {production, media: rendering, uploads})` installs an encapsulated plugin beneath the parent's authenticated local-session hook. Its binary upload parser does not consume files until authentication succeeds. The shared `ManagedUploadStore` bounds and verifies a private staged copy and releases it after import. Browser callers submit bytes, never filesystem paths.

| Route suffix under `/api/projects/:projectId/media` | Behavior |
| --- | --- |
| `GET` at the base path | Compact jobs, current preview and supplied-video summaries; creates no request/message |
| `POST /uploads?expectedHeadVersion=N` | Octet-stream upload with required idempotency key; returns artifact and request ID |
| `POST /renders` | `{expectedHeadVersion, renderNodeId}`; prepare, background run, return 202 and job ID |
| `GET /renders/:jobId` | Compact current job status and state-based `canRun`/`canRecover` hints |
| `POST /renders/:jobId/run` | Explicitly start a saved prepared job after an admission issue is resolved |
| `POST /renders/:jobId/cancel` | Persist explicit human cancellation |
| `POST /renders/:jobId/recover` | Background receipt reconciliation; never rerender |

All POST routes require an idempotency key. Uploads may reuse an explicit current human `requestId`, or create a new request with an explicit `continuationRequestId`; these query options are mutually exclusive. A continuation transfers only the named request's holds through `ProductionService`. Upload domain-error responses also include the created/reused request ID so a rejected file does not hide its import session. A new import request never silently releases earlier edit holds. Render commands create read-only human requests, do not supersede the current editing request, and remain blocked by outstanding edit holds. State hints are advisory; authorization, currentness and pause are rechecked on every action.

The plugin owns its background task registry. Tasks enter only after registration, including synchronous port failures. Server shutdown aborts locally owned work and awaits its completion before closing. An admission failure remains prepared with a bounded error code and can be explicitly run later. Reloading status does not start anything.

Imports first reserve a service-issued artifact ID under an idempotency key. Local normalization and installation happen outside a database transaction. The final short transaction rechecks the original human request and expected project head, inserts owned artifact/source records, advances the project revision, and stores the import receipt. Reusing a completed key returns the same receipt; different input with the same key is rejected. A revoked or stale import can leave private unreferenced immutable files, but cannot modify the project.

## Resolving the frozen timeline

Preparation selects a `render` node from the active compiled plan, its `timeline` input, and the ordered video take inputs. It validates the current node bindings against the saved plan. A source can be a current selected output of a video operation or a directly imported video artifact. Both need matching project-owned artifact metadata and a `media_source` descriptor issued by `LocalMediaService`. Fake fixture records are explicitly rejected. Future real provider ingestion must register this measured descriptor before its output can be rendered here.

The current plan language has cuts and ordered takes, but no source trim declaration. A directly imported take uses its entire measured frame count. A video-operation take uses the current shot's planned frame count from frame zero, with fresh prompt/shot intent and matching shot duration. The media layer rejects insufficient source frames; a one-second clip cannot satisfy a six-second shot. There is no automatic looping, final-frame freeze or stretch. Output geometry comes from the render node; fitting currently uses letterboxing (`contain`).

Narration is resolved from the selected timeline's saved cue fingerprints and the current `narration_canonical_head`. Each fingerprint must select exactly one canonical segment, whose accepted/measured cue still equals the current project cue. Audio artifact identity and hash must match the canonical source. The script must still be current. Every narrated shot represented by a video operation needs matching selected cue coverage. A project with narration cannot silently produce an empty soundtrack.

The canonical segment's exact `startSample`, `durationSamples` and `atSample` control rendering. Source ranges remain local to the source artifact. These fields are not reconstructed from rounded cue frames. Multiple selected segments may use different accepted recordings; the optional single DSL narration input must refer to a selected canonical source and does not replace the other segments. This slice rejects ambiguous cue fingerprints and audio extending outside the picture timeline. A partial-scene timeline whose absolute narration placement is outside its duration requires an explicit future scene-offset/edit contract.

The persisted job binds:

- Project revision, head version, active plan ID and graph digest.
- Render/timeline node identities and all resolved source artifact IDs and hashes.
- Current canonical narration ID, selected cue/sample placements, and all hold-relevant dependency scopes.
- The complete immutable media manifest, measured durations, normalization descriptors and toolchain digest.
- Original request/epoch authority and one service-issued output artifact ID.

Preparation freezes the manifest outside SQL, then compares the captured target again inside its commit. It never reserves paid generation budget or starts work.

## Execution, selection and recovery

`run` atomically changes a prepared job to running with an owner token and renewable lease before starting FFmpeg. Another connection cannot dispatch that job. The local service runs at most one media operation per instance; this bridge is not a separate distributed scheduler. Global pause and active holds covering the timeline/dependent shots block admission. Rendering does not clear any holds or user pause.

After rendering and full validation, `LocalMediaService` installs a completion receipt before returning. The bridge copies/verifies the final bytes into the managed artifact root outside SQL. Its final transaction registers a real artifact (`fixture:false`, `attemptId:null`, `origin:local_render`), fences on the job's current owner token, and compares the current plan, project head, selected inputs, narration, original authority, pause and holds. A current result becomes `published`; a late, cancelled, paused or superseded result becomes `historical`. Both retain artifact lineage. No executor output binding is rewritten.

`media_preview` is a derived selection pointer. `snapshot.preview` is null if the selected job's target no longer matches the project; previous results remain in `jobs`. A project edit therefore cannot make an older preview appear current merely because its file is still present. Pause prevents future selection; it does not erase an already selected, still-current preview.

Cancellation records intent and aborts a locally owned subprocess through `AbortSignal`. Another process notices cancellation during its lease heartbeat. Work already completed can still be registered as history. A pause or target edit does not promise immediate FFmpeg termination; it suppresses selection. An abort before a valid completion leaves no publishable result.

Recovery is explicit and bounded. A live owner lease prevents takeover. Once the owner is absent/expired, `recover` scans receipts for the exact frozen manifest, validates their hashes, and repeats only managed-file installation and the final SQL registration. It never starts FFmpeg. A verified receipt for the same exact manifest may satisfy another interrupted local job with identical inputs. An absent receipt yields `interrupted` (or `cancelled`) and requires a new explicit preparation/run; there is no hidden local retry. A database failure after receipt installation is therefore recoverable without assuming the process failed before producing output. Recovery still retains stale completion evidence without selecting it.

## Persisted records

| Kind | Purpose |
| --- | --- |
| `media_import`, `media_import_receipt` | Stable import identity and completed canonical registration |
| `media_source` | Project-owned immutable normalized supplied-video descriptor |
| `media_render` | Frozen request/target/manifest plus mutable local execution state and lease |
| `artifact` | Immutable real input/output artifact metadata, distinguished from fixtures |
| `media_preview` | Guarded current real preview selection |

Filesystem work never runs within a SQLite transaction. Immutable-file installation and the SQL transaction are intentionally separate; receipts cover the successful-output/failed-SQL gap. Neither this slice nor its tests claim a cross-filesystem/SQLite transaction or complete power-loss recovery.

## Validation and limits

The focused integration tests use the actual compiler, two SQLite connections, the actual local media service, and synthetic FFmpeg clips. They verify decoded color order, exact picture frame count, registered real artifact metadata, accepted multi-segment audio placement, import idempotency, request revocation across asynchronous work, pause/hold admission, cancellation, stale completion, fixture/foreign-artifact rejection, too-short selected video, lease exclusion, and recovery after a failed completion transaction and backend reopen. The provider's accepted-call count remains zero and the generation attempts table stays empty.

The local renderer's current limits are CFR 30/1, 48 kHz working audio, a 360-second timeline/source cap, at most 64 video clips, **64 audio placements from at most 8 distinct normalized audio streams**, and **at most 8 simultaneous audio lanes**. `maxAudioPlacements` controls the placement count; `maxAudioTracks` bounds distinct audio inputs and concurrent lanes. Inputs are deduplicated by normalized content hash, with explicit source splits. An artifact identity cannot name conflicting source descriptors. Sequential placements concatenate exact source ranges and generated silence in each lane, then at most eight lanes mix; late cues do not allocate long per-cue delay buffers. Mixing uses fixed gain without automatic normalization, ducking or a limiter, so overlapping loud sources can clip and require an explicit mix decision.

Other bounds remain: even output dimensions up to a 1920×1080 pixel area, configured byte/time limits, cuts and letterboxing. The narration domain can describe more segments than this renderer accepts; excess placements, sources or overlaps fail validation rather than dropping speech. Supplied video normalization removes embedded audio, so narration/sound must be imported and placed separately. Crossfades, captions, ducking, timeline trimming UI, automatic missing-output retries, media garbage collection and longer-source imports are deferred.

`apps/server/test/media-audio-scale.test.mjs` decodes 64 alternating source cues and their intentional silence gaps, checks placement/source/overlap limits, and rejects conflicting source identities. The optional `node apps/server/test/media-six-minute.mjs NEW_OUTPUT_DIRECTORY` workload renders 10,800 frames at 1280×720 with 64 cuts and 64 cues, validates every picture frame plus audio source order and silence at every cue, and writes a bounded evidence report. It samples only numeric PID/parent/RSS metadata for its own process tree; if the environment blocks that reading, the workload fails its resource-evidence gate rather than claiming a peak. This script is outside the default test suite and must be run explicitly. Its synthetic repeated colors and tones are not evidence of real H3 generation or a completed commercial workflow.

The 2026-09-12 local acceptance run passed with two six-minute audio sources consumed in descending source-range order while the output timeline ran forward. All 10,800 picture frames/cuts, all 64 alternating tone identities and all 64 intentional silence gaps were checked after full decode. The 1280×720 MP4 was 9,313,831 bytes (`sha256:a3dececa9c5d2a84726e2f0e9f90470e80daad101f9803822af137e541dd717e`). The render/validate/install phase took 34,208 ms. Approximate process-tree peak RSS was 819,808 KiB (800.6 MiB), observed through 336 samples at 100 ms intervals, including the Node coordinator and sampling overhead. This is one measured synthetic workload on one local toolchain; eight distinct full-length recordings, all overlap patterns, other codecs/resolutions and a hard memory ceiling remain unverified. The benchmark's sampled 1 GiB abort threshold is an experimental guard, not an OS-enforced product limit.

The first sandboxed attempt produced a render receipt but could not read process RSS, so it did not pass the acceptance gate. The successful run used reviewed local process-metadata access and no network or media API calls. The retained report is `report.json` in the separate `openslate-media-six-minute-reviewed-2026-09-12` output directory; the optional script regenerates the same validations without adding the large media files to the repository.

The sanitized measured report is checked in as [media-six-minute-evidence.json](media-six-minute-evidence.json); local output paths are omitted.
