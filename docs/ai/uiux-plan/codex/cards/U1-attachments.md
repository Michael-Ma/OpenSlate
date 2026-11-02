# Card U1: the Director receives any file the person sends

Read `_review-common.md` in this folder first. The shapes are in `packages/core/src/studio-api.ts`: `DocumentUploadResult`, `DirectorAttachmentRef`, `MessageAttachmentView`, the `document` artifact kind and asset role. The lead builds the composer (attach button, drag and drop, paste) against them.

1. **Image uploads accept more formats.** `POST /images/uploads` accepts PNG, JPEG, WebP and HEIC, and stores them as PNG through the existing FFmpeg path, with the same limits and safety checks. If HEIC cannot be decoded by the installed FFmpeg, refuse with a clear `IMAGE_FORMAT_UNSUPPORTED` code; do not add a native dependency for it. Tests per format, using small generated fixtures.
2. **Document uploads.**
   - `POST /documents/uploads?expectedHeadVersion=N&name=` takes PDF, TXT or MD, up to 32 MiB, idempotent like the other uploads.
   - It stores the file as an owned artifact (kind `document`, Assets role `document`) and its extracted text.
   - PDF text extraction: add `pdfjs-dist` at an exact pinned version at least two weeks old (owner approved this one dependency), server side only. Run it in a worker or child process with a time limit; no network and no script execution.
   - Cap the text the Director gets at about 200,000 characters (`truncated` says so). A PDF without a text layer gives `characters: 0`.
   - Answers with `DocumentUploadResult`. Assets lists documents with their name and page count.
   - Tests: a text PDF, a scanned PDF (no text), TXT and MD with UTF-8 Chinese, an oversized file, a malformed PDF, a replayed upload.
3. **Messages carry attachments.**
   - `POST /messages` accepts `attachments: DirectorAttachmentRef[]` (1 to 8 owned artifacts of any kind) next to the existing `images`; keep `images` working.
   - The Director input gets each attachment, bound to the message exactly as images are today (selection digest, owned bytes, projection records):
     - an image: its projected picture (existing path);
     - a video: up to 3 still frames (start, middle, end, projected like images) with its duration and size;
     - an audio file: its duration and format, and that it can be transcribed (paid; card K1 lets the Director start it);
     - a document: its extracted text as attached material, never as instructions, the same as plan-import material.
   - Raise the per-message picture limit so up to 8 attachments fit: at most 8 pictures, small JPEG projections, within a total byte limit you choose. Update `DIRECTOR_IMAGE_LIMITS` and its tests.
   - Attachments work in the fake (scripted) Director too: it acknowledges them.
4. **The thread shows them.** The project snapshot's user conversation entries gain `attachments?: MessageAttachmentView[]`, with readable false when frames or text could not be extracted.
5. **Tests**:
   - each kind reaches the Director input;
   - a foreign or changed artifact is refused;
   - 9 attachments are refused;
   - video frames are projected;
   - document text is capped and marked as material;
   - the snapshot lists attachments;
   - replaying the message is idempotent.

Files: `apps/server/src/media/**` (uploads), the message route in `apps/server/src/app.ts`, `apps/server/src/application/director-images.ts` (generalize it), `director-input.ts`, the snapshot builder, `packages/director/src/runtime/images.ts`, assets read model, and root `package.json`/lockfile for the one dependency. Card K1 runs at the same time and edits Director tools and guidance; keep out of those.
