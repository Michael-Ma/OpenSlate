# Owned PNG reference import

September 12, 2026. Local supplied PNG images can be imported into a project through the authenticated application API. This does not activate an image provider, approve a shot, or authorize a generation job.

## Application flow

```mermaid
sequenceDiagram
  participant Human
  participant API as Local API
  participant DB as SQLite
  participant Images as LocalImageStore
  Human->>API: PNG bytes, command key, project head, request or continuation
  API->>API: Local authentication, project scope, bounded staging
  API->>DB: Reserve immutable image_import and artifact identity
  API->>Images: Exact bytes and SHA-256
  Images->>Images: Validate dimensions, decode PNG, publish immutable exact bytes
  API->>DB: Recheck request and head; atomically register artifact, revision, receipt
  API-->>Human: Artifact identity, dimensions, revision and request ID
```

`ImageApplicationService` snapshots caller data before asynchronous work. Only a current editing human with project scope can import. An immutable `image_import` binds the request, expected head, exact hash, length, dimensions and reserved artifact ID before decoding. `LocalImageStore` validates one decodable PNG using pinned local FFmpeg/ffprobe, preserving the original encoded bytes. Its cache lives inside managed artifact storage.

Publication rechecks current request authority, cancellation and project head. The artifact record, appended canonical `project.artifacts` reference, project revision, immutable `image_import_receipt` and event commit in one transaction. The artifact has `origin: supplied_image`, `fixture: false`, `attemptId: null`, exact SHA-256, dimensions, length and decoder validation digest. Neither the image library nor director metadata exposes host paths.

Exact command replay returns the saved receipt without decoding again. A changed payload under the same key is rejected. Two concurrent copies of one command publish once; different commands competing for the same head cannot both publish. A failed publication transaction leaves the original intent available for an exact retry after restart. A superseded request, changed revision or cancellation may leave validated cache bytes, but creates no canonical artifact or receipt. Cached bytes are retained because another import can reuse them. Automatic garbage collection is not implemented.

## HTTP contract

- `GET /api/projects/:projectId/images?offset=0` returns at most 40 owned supplied references, explicit pagination, current project revision/head and import capability. Read requests do not create conversation messages or holds.
- `POST /api/projects/:projectId/images/uploads?expectedHeadVersion=N` accepts `application/octet-stream` with `Idempotency-Key`. It creates a durable human import request unless `requestId` identifies an existing active project edit. `continuationRequestId` explicitly transfers the previous edit's holds; it is mutually exclusive with `requestId`.
- Uploads stream into `ManagedUploadStore`, capped at 32 MiB. No host path, URL, actor or epoch override is accepted. The service checks staged bytes against their exact receipt hash. Staging is released on success or failure.
- Registered content uses the existing authenticated `/api/projects/:projectId/artifacts/:artifactId/content` route, which checks project ownership and managed storage and verifies content identity.
- Missing FFmpeg/ffprobe leaves the library readable and reports import unavailable. An import attempt then fails before creating a human request or staging files. Limits are PNG only, maximum 4096 pixels on either axis and 8,294,400 total pixels, in addition to 32 MiB.

Local session authentication and Host/Origin checks apply to every route. The service is not exposed as a director write tool. The existing compiler can reference an imported image using `p.asset(id)`, including binding it to an exact human keyframe review. Import does not select a shot, issue grants, create approval, release edit holds or dispatch a provider.

## Workspace behavior

The reference library sits beside supplied clips. It supports bounded PNG selection, explicit reuse of a current edit, paged browsing, and one selected preview. The browser fetches authenticated image bytes, verifies SHA-256, and uses a temporary object URL that is revoked when the preview changes. Upload requests use the shared pending-command registry under an independent `images` namespace, so switching projects retains an uncertain command without resubmitting it automatically.

For native projects, **Discuss this reference** starts an explicit conversational continuation when a current project edit exists. It names the artifact and asks for visual details before planning changes. This action shares metadata only; it does not attach the image to native vision. Production native-image attachment, file-picker automation and broader image UX validation remain separate work.

## Verification

Focused checks passed: **26 tests, zero failures/skips**, covering nine service tests, eight HTTP tests and nine exact-image-store tests. They exercise byte preservation, immutable replay, authority/scope denial, caller mutation, stale heads/requests, cancellation, concurrent publication, SQL rollback/restart, compiler review identity, malformed PNG decoding, managed storage, local HTTP protection, exact content serving, explicit continuation, missing media tools, paged library coverage and bounded upload cleanup. All inputs are synthetic; no media API or native model call was made.

The built browser displayed a synthetic 320×180 PNG through the authenticated, hash-verified blob preview, and retained it after refreshing the project. The decoded natural dimensions were exact and browser warning/error logs were empty. An authenticated HTTP harness supplied the 626-byte fixture and confirmed byte-for-byte download; a database reopen confirmed one import/receipt, supplied-image provenance and no generation attempts, approvals or model/media API calls. See [browser evidence](png-reference-browser-evidence.json). The native file picker and native vision attachment remain unverified.
