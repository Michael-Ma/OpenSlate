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

The local renderer's current limits still apply: CFR 30/1, 48 kHz working audio, a 360-second timeline/source cap, at most 64 video clips, at most **8 audio placements total** (including sequential segments), bounded even output dimensions up to a 1920×1080 pixel area, configured byte/time limits, cuts, letterboxing and fixed audio gain. The narration domain can describe more segments than this renderer currently accepts; a ninth placement fails validation rather than dropping speech. Supplied video normalization removes embedded audio, so narration/sound must be imported and placed separately. Crossfades, captions, ducking, timeline trimming UI, automatic missing-output retries, media garbage collection and longer-source imports are deferred. This validates the bounded local rendering path; it is not evidence of real H3 generation or a complete six-minute commercial workflow.
