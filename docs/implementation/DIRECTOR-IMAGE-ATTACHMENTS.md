# Selected reference images in native conversations

September 12, 2026. OpenSlate can attach explicitly selected, project-owned PNG references to a native director request. The library's **Attach and discuss** action sends a read-only request with the chosen image identity and hash. It does not continue an earlier edit, transfer its holds or authorize generation. Later messages retain saved observations but do not automatically attach image bytes again.

This implementation has offline HTTP, persistence, native-input and real local image-process coverage. A built-browser/native model experiment is pending. The preceding [capability experiment](CODEX-CAPABILITY-VALIDATION.md) tested native image input with a synthetic host-selected fixture; it did not exercise this production library flow.

## Request and input boundaries

```mermaid
flowchart LR
  Human[Attach and discuss] --> Message[Authenticated message route]
  Message --> Selection[Immutable ordered image selection]
  Selection --> Queue[Durable director queue]
  Queue --> Verify[Verify original owned PNG bytes]
  Verify --> Derive[Fixed local JPEG thumbnail recipe]
  Derive --> Receipt[Immutable request projection receipt]
  Receipt --> Input[Original refs and thumbnail hashes in input identity]
  Input --> Native[Native image validation and model turn]
```

The message API accepts an optional `images` array containing one to four `{artifactId, sha256}` values. Unknown fields, duplicate artifacts, foreign references, fake media and references outside the supplied-PNG library are rejected. Paths, URLs, generated image artifacts, question replies and review replies are outside this attachment route. Normal editable messages may explicitly include images; the library discussion button always uses `editing: false` and no continuation request.

The API binds ordered selections into the message command digest and saves a `request_image_selection` record in the same transaction as the message and queue insertion. Reusing the exact command returns the original request after later project changes. Changing, dropping or reordering its selection conflicts with that command identity. Existing requests without images keep their original digest formula.

The native input hook uses the supervisor's original abort signal. It resolves only the saved selection for that exact project/request/epoch, verifies regular files in managed artifact storage without following a final symlink, checks bounded size and SHA-256, and feeds frozen PNG bytes to the trusted local FFmpeg executable. The recipe is fixed: preserve aspect ratio within 768 pixels, one JPEG frame, Lanczos scaling, quality 8 and `yuvj444p`. Each thumbnail must fit 128 KiB; four images therefore fit the existing native 512-KiB total. A complex reference exceeding that fixed output limit receives actionable failure guidance before model dispatch.

Files are installed through immutable hard links under the project's native projection. Each request/order position has a separate path, so two supplied artifacts with identical content can retain their ordered identities. The `request_image_projection` receipt binds original artifact IDs/hashes, ordered thumbnail hashes/lengths/media types, recipe digest and configured executable hash. The input context records those same path-free identities, and `directorInputDigest` also binds the exact ordered native image hashes/media types. The runtime performs its existing projection containment, byte/hash and dimension checks before submitting images.

## Recovery and cancellation

Selection and projection records are immutable and enforce same-project message/artifact references. Reopening the application reconstructs the same projected input from its receipt. A saved thumbnail that is missing, changed or inconsistent with its recipe is rejected; the request does not silently replace it. Requests without selections receive no images, including follow-ups and question answers.

After asynchronous preparation, the supervisor rechecks its signal, epoch and owned running turn before recording dispatch intent. Cancellation kills the local image process, removes only the preparation's temporary directory, and prevents a successful projection result. A validated immutable file may remain as unreferenced cache when cancellation races publication; shared or completed files are not removed. This remains a local, trusted-computer boundary, not independent isolation from other host processes.

Neither the selection nor the projection changes canonical content, narration, shot selection, approvals, budgets or media-generation authority. Read-only discussion leaves existing edit holds unchanged. The only model call is the explicitly queued native conversation.

## Verification and source map

Twelve focused server tests cover selection-before-queue ordering, distinct paths for identical content, runtime image acceptance, no carry-forward, exact replay after revision advance, foreign/fake/stale/path-bearing input, immutable records, original corruption, missing/changed completed thumbnails, symlink rejection, size limits, store reopen, corrupted receipt identity, and cancellation using the original signal. The web model test checks that discussion freezes the chosen identity without edit or continuation authority. Existing controller, supervisor, input-identity and web model regressions also passed in the focused check.

- `apps/server/src/application/director-images.ts`: selection validation, original verification, fixed derivation and projection receipts.
- `apps/server/src/app.ts`: authenticated message schema and atomic selection/queue transaction.
- `apps/server/src/application/local-director.ts`: host configuration, native preparation hook and actionable image failure messages.
- `apps/server/src/application/director-supervisor.ts`: optional preparation signal and existing dispatch fences.
- `apps/server/src/persistence/store.ts`: immutable selection/projection identity checks.
- `apps/web/src/ImagePanel.tsx`, `App.tsx`, `model.ts`: explicit read-only discussion and exact retry payload.
- `apps/server/test/director-images.test.mjs`: offline integration and real local process regressions.

Thumbnails are reduced and lossy; they do not prove fine visual details, text recognition or creative quality. Runtime upgrades, alternative image sources, user-authored attachment messages, thumbnail quality choices and broader multimodal evaluations remain future work. Full-resolution originals stay in the reference library.
