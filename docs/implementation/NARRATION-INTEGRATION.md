# Canonical narration integration

September 12, 2026. This document covers the implemented narration commit adapter and authenticated HTTP route plugin. The browser narration workspace is also implemented. Speech generation, transcription and model-facing narration proposal tools remain outside this slice.

## Responsibility and flow

`NarrationService` owns editable segment drafts, supplied recordings, human cue boundaries and separate human acceptances for script, recording and timing. `NarrationCanonicalService` installs a reviewed, accepted projection into the canonical project and records the exact audio placements needed by local rendering. It creates no generation requests, plans, approvals or paid attempts.

```mermaid
flowchart LR
  Human[Human script / recording / timing acceptance] --> Draft[NarrationService]
  Draft --> Prepare[Canonical preparation and impact preview]
  Prepare --> Bytes[Verify and install immutable normalized audio]
  Bytes --> Check[Recheck request, head, narration and workflow]
  Check --> Commit[(Atomic project, cues, mappings and receipt)]
  Commit --> Plan[Explicit matching plan / prompt revision]
  Commit --> Render[Exact audio source and sample placements]
```

The adapter uses a narrow trusted transaction rather than a general creative patch. The existing creative patch cannot install cue records, recording metadata or a shot's `cueId`; changing `narrationScript` through that path invalidates all cue acceptances. The adapter derives these fields exclusively from saved narration records and human decisions. A caller cannot supply a replacement project, cue or acceptance in its input.

## Application interface

```ts
const canonical = new NarrationCanonicalService(narration);

const prepared = canonical.prepare(projectId, actor, {
  expectedHeadVersion,
  expectedNarrationVersion,
  shotMappings: [{ shotId, segmentId }], // null explicitly detaches
  key: commandKey,
});
// Show prepared.shotImpact and the accepted narration before committing.
const receipt = await canonical.apply(projectId, actor, prepared.id);
const saved = canonical.current(projectId, actor);
```

Both preparation and application require a current editing request that includes project scope. Director calls additionally require their active epoch. Preparation is owned by its exact principal, request and epoch; another request cannot adopt it. Script/audio/timing acceptance remains human-only in `NarrationService`, regardless of who prepares the canonical change.

Preparation returns the frozen source projection, proposed project and per-shot impact. Its command key replays the same result and rejects different input. Application has an intrinsic replay key, the preparation ID. A lost response can be recovered after reopening SQLite without advancing the project again. A revoked actor cannot replay a mutation under obsolete authority.

Authenticated host code may call `narration.workspaceSnapshot(projectId)` and `canonical.workspaceCurrent(projectId)` to populate browser views. These trusted reads create no requests, epochs, holds or events. Model access must use the actor-checked `snapshot` and `current` methods. HTTP composition must enforce the local application's authentication boundary before calling the host methods.

## What is persisted

| Record | Purpose |
| --- | --- |
| `narration_prepared` | Immutable expected project/narration fingerprints, source projection, mappings, impact and workflow binding versions. |
| `narration_canonical` | Immutable selected script, origin declaration, canonical cue records, exact audio placements, human acceptance IDs and request provenance. |
| `narration_canonical_head` | Project pointer to the selected immutable canonical record. |
| `narration_commit_receipt` | Immutable replay result, canonical/project identities, impact and active-plan status; ID equals the preparation ID. |
| `artifact` | Verified normalized WAV reference and internal path, `fixture: false`, `attemptId: null`, `origin: "narration_audio"`. |
| Project / revision / stage records | Canonical script, source, cues, artifacts, affected shot bindings and updated workflow inputs. |

Each canonical segment carries this rendering contract:

```ts
{
  segmentId, segmentRevisionId,
  cue: { id, meaning, durationFrames, placementFrames,
         audio: { artifactId, sha256, kind: "audio" },
         accepted: true, measured: true },
  frameCoverage: { startFrame, endFrame },
  audioPlacement: {
    source,             // frozen SuppliedMedia descriptor
    startSample,        // local to source, never a project offset
    durationSamples,
    atSample,           // position in the project
    gainMilliDb: 0
  },
  provenance: {
    audioId, declaredOrigin,
    originEvidence: "human_declared_supplied_recording",
    scriptAcceptanceId, audioAcceptanceId, timingAcceptanceId,
    originalSha256, toolchainDigest
  }
}
```

Audio is normalized to measured 48 kHz stereo PCM. All source trims and placement positions remain integer samples. Video uses 30 fps, or 1,600 samples per frame. The cue's relative duration rounds the segment length alone; frame coverage rounds each absolute endpoint. Coverage can differ by one frame from placement plus relative duration, so the renderer must use exact `audioPlacement` samples, not reconstruct audio from frame values.

A project may combine uploaded recordings with supplied recordings that the human declares were generated elsewhere. Its canonical source is `uploaded`, `generated` or `mixed`. A declared generated origin is not evidence that OpenSlate called a speech provider; provenance explicitly records this distinction.

## Granular updates and execution safety

The first commit takes explicit shot-to-segment mappings. Later commits inherit earlier mappings unless explicitly changed. Removing a segment still bound to a shot requires an explicit remap or detachment. Unknown shots, unknown segments, duplicate mappings and malformed input are rejected. Cues owned by prior canonical narration are replaced as a set; unrelated cues and artifact references are retained, and identity collisions fail closed.

A mapped shot inherits the accepted cue's relative duration. The adapter compares the old and new consumed video intent using `shotIntentDigest`:

- Changed meaning or relative duration clears that shot's video prompt binding. Its existing prompt text remains available for explicit reauthoring or confirmation. Its image prompt binding stays intact.
- Changed audio bytes, cue identity or absolute placement do not invalidate a video prompt whose consumed meaning and duration are unchanged.
- Only changed shot records receive new revision IDs. Placement-only changes preserve every shot record.
- Removed cue bindings invalidate only the detached shot's consumed video intent.

No plan is installed by this adapter. Existing plans, candidates, node outputs, human review decisions, attempts and budget reservations remain intact, including `submission_unknown` liability. Active edit holds remain owned by their request and are never released here. Existing matching holds are reused. A later explicit matching-plan operation performs normal compilation, prompt freshness checks, grant selection and hold handling. `requiresMatchingPlan` in the receipt indicates that an existing active plan remains installed; an initially unplanned project still needs its first plan.

## Transaction and file ordering

Preparation is a short SQLite command. Application first checks the exact project and narration snapshots, then verifies service-issued media descriptors and their bytes outside any SQLite transaction. Audio copies are bounded and hashed while streaming into a temporary file. The file is synced and installed by an exclusive same-filesystem hard link under the project artifact directory; an existing destination is hash-checked instead of overwritten. The destination directory is synced before metadata can become usable.

The final short transaction rechecks request/epoch authority, project head and digest, narration version and digest, accepted subjects, the canonical head, capability lock and workflow binding versions. Only then does it install artifact metadata, the new project revision, canonical record, pointer and receipt. An intervening edit or revocation rolls back the entire SQL change. Verified unreferenced files may remain after a stale commit; they are not usable artifacts and do not justify changing project state.

The current local storage policy trusts the installed application and same-machine filesystem. This adapter does not claim hostile-host isolation. Atomic installation and sync behavior rely on the supported local filesystem, as in the existing media service.

## Verification and remaining integration

The focused verification passed 38 tests: 13 canonical integration tests, 9 HTTP/upload tests, 11 existing narration-domain tests and 5 browser-model tests. Server and browser TypeScript checks/builds also passed. The dedicated canonical suite exercises mixed source provenance and exact trims; lost-response replay after reopening SQLite; placement-only reuse; single-shot meaning/duration invalidation; preservation of an uncertain paid fake attempt and its reservations; explicit detach/remap; human-only acceptance; stale project/narration and epoch fences during asynchronous file work; corrupt bytes; metadata conflicts; malformed input and read-only workspace views. Existing narration-domain tests cover readiness, sample rounding and acceptance invalidation independently. All media used by these tests is synthetic local audio; no vendor or model API is called.

The adapter and HTTP plugin are working application components. Main-server/browser composition, model-facing narration proposal tools and the render-job bridge have separate integration ownership. Speech synthesis and transcription adapters remain future work; no model can manufacture the human decisions required to make a projection canonical.


## HTTP session and review contract

`registerNarrationRoutes(app, { production, narration, canonical, uploadDirectory })` is a plugin for the existing authenticated local application. It inherits the parent's loopback, origin and bearer-token checks. It must not be registered on an unauthenticated server. All mutation routes require a bounded `Idempotency-Key`; neither an actor nor a local filesystem path is accepted from the request body.

| Route beneath `/api/projects/:projectId/narration` | Input and behavior |
| --- | --- |
| `GET /` | Project head/revision, narration snapshot, selected canonical record, narration session, and saved recording library. No new message or hold. |
| `POST /sessions` | Optional `text` and explicit `continuationSessionId`; creates one project-scoped `local-user` editing request. Reuse the returned session for subsequent actions. An existing session must be explicitly continued, rather than silently replaced. |
| `POST /segments` | `sessionId`, `expectedVersion`, `patch` with add/update/remove/order draft operations. |
| `POST /bindings` | `sessionId`, `expectedVersion`, exact `segmentId` and `audioId`. |
| `POST /cues` | `sessionId`, `expectedVersion`, `segmentId`, artifact-local `startSample` and `endSample`. |
| `POST /placements` | `sessionId`, `expectedVersion`, exact segment/project-sample placements. |
| `POST /acceptances` | `sessionId`, `expectedVersion`, `kind: script \| timing`, and current script-revision or cue IDs. |
| `POST /audio-acceptances` | `sessionId`, `expectedVersion`, exact `{segmentRevisionId,audioId}` bindings. |
| `POST /prepare` | `sessionId`, expected project/narration versions and explicit shot mapping updates. |
| `POST /apply` | `sessionId`, `preparedId`; returns the intrinsic preparation-keyed commit receipt. |
| `POST /audio?sessionId=…&declaredOrigin=uploaded\|generated` | Binary `application/octet-stream` upload, at most 128 MiB. |
| `GET /audio/:audioId/content` | Project-owned, verified normalized WAV bytes with `X-Content-SHA256`; available before acceptance so the human can listen. The 80 MiB preview bound accommodates six-minute normalized PCM. |

The session records its application request and local principal. Every mutation verifies that request is still active, editing and project-scoped. Another conversational edit can supersede it; subsequent narration commands fail with `NARRATION_SESSION_STALE`, and the browser must offer explicit continuation. Continuing transfers only the selected prior request's holds under the existing application policy. The route never grants generation or releases holds itself.

The saved recording library includes unbound uploads, allowing attachment after reload. `audioLibrary` returns up to 400 path-free recording descriptors, newest first. `coverage.audioLibrary` supplies offset, count, total and next offset; `GET ?audioOffset=400` retrieves the next page. Compare the returned project/narration identities and library totals while paging. Selected segment recordings also remain visible within the narration snapshot.

`ManagedUploadStore` consumes the authenticated request stream incrementally, bounds bytes, and hashes the content. It stages an exclusive file at a deterministic identity/content path, then passes that trusted path to `NarrationService.importAudio`. The existing import command binds the stable path and declared origin. Repeating identical bytes with the same session/key returns the original recording; changing bytes or origin conflicts even after reopening the backend. Temporary and staged files are removed in `finally` after the importer finishes; same-process overlapping readers share a reference count. Abrupt process termination may leave unreferenced staging files for the application's eventual cleanup policy; these are never registered as usable audio. Managed original/normalized recordings remain in the media store.

The helper requires one shared instance per upload root in the single local backend. Narration and video uploads should use separate roots. The host must include its chosen upload directory in `LocalMediaService.allowedInputRoots`; that configuration is never model- or browser-selected.

HTTP tests use real Fastify routing and local synthetic audio. They verify inherited authentication, strict schemas, no-mutation reads, session reuse/explicit continuation, stale and cross-project rejection, upload conflicts and backend restart, pre-acceptance playback, three deliberate acceptance actions, canonical commit replay, saved-library pagination, byte bounds and cleanup. No real media service or model is contacted.


## Browser narration workspace

`NarrationPanel` is connected to these HTTP contracts through `StudioApi`. It presents saved narration as expandable sections, with notes/outline/draft maturity, explicit source selection, script and meaning fields, upload/library attachment, lazy verified playback and separate human acceptance buttons. Recording range and project position are entered in seconds and converted to exact 48 kHz samples; no timeline editor is implied.

GET refreshes do not replace dirty writing, trims or placements. A changed saved version presents a comparison and requires an explicit choice before overwriting it. Writing for a remotely removed section remains available to restore as a new section or explicitly discard. The application keeps this panel mounted when switching workspace tabs. Project changes isolate form state; a shared command registry retains running state, exact retry inputs, and completion results by API instance/project in a separate narration namespace. Changing projects cannot enable a second dispatch while the first request runs. Completion never calls an unmounted component, and a preparation returned after remount or an explicit retry restores its review preview. Uploaded file bytes are released from the registry after a confirmed result.

The panel does not accept scripts, audio or timing automatically. Approval buttons target saved revision/cue/audio identities and disable themselves while the corresponding displayed fields have unsaved edits. Overlaps and out-of-range narration are explained before preparation. Untouched shot mapping controls preserve existing links; choosing no narration explicitly detaches that shot. The change preview is tied to both project head and narration version, and it explains when no shot links will change. Applying narration leaves holds in place, followed by an explicit conversation continuation for matching-plan work when a native director is available.

Uncertain requests retain their original command key, payload and selected file. Retry sends the same request; refreshing saved data does not clear that uncertainty. Load errors are separate from mutation errors so successful polling can clear a transient connection failure without hiding a failed change. Preview eligibility checks its originating human request as well as project/narration versions; explicitly continuing a session requires a fresh preparation even when those versions are unchanged. Five browser-model tests verify exact sample conversion, stale preview guards, safe editable draft copies, useful recovery messages and timing-gap detection. Six shared command-registry tests cover retained requests, metadata/results, project/session isolation and remount behavior. Visual/end-to-end browser verification is recorded separately by the integration owner.
