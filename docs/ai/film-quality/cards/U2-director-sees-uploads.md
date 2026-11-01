# U2 · The Director of a code film sees and can use what the person uploads

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. No other stream is running, so you may edit every file this card names, plus any test that pins what this card changes. No UI change is needed. If you find you need a file that is not named here, edit it and say so in your report rather than stopping.

## Problem

The owner attached a photo in a code film. The upload worked. The message "这个是素材" carries the attachment. The Director replied "我这边还没看到可读取的照片附件" twice, and it was right: it received only the text.

Real data: `request_attachment_selection` has 1 row, `request_attachment_projection` has 0. The photo is stored as a 2880×2880, 9.4 MB PNG, `origin: "supplied_image"`.

Four breaks, all in code films (`project.planMode === "code"`):

1. **Attachments are skipped.** `apps/server/src/application/local-director.ts` returns early for code films in both supervisors (`fake` and `native`), before attachment preparation. This has been so since `17486637`.
2. **Later turns cannot name an upload.** Every code-film turn starts a fresh native thread. `readCodeFilm` does not list uploads, and `attachedMaterial` is bound to one message.
3. **Later turns cannot see an upload.** A fresh thread has at most an ID. `read_clip_frames` only accepts video.
4. **A large photo cannot be an image reference.** `assertImageReferenceRecords` refuses PNGs over `CODEX_IMAGE_LIMITS.referenceBytes` (4 MiB) in `ctx.image({references})`. Viggle video takes 32 MiB frames and 20 MiB references, so this limit only hits image models.

## Change

### 1. Prepare attachments for code films

In both `prepareInput` functions in `local-director.ts`, code films must go through `this.attachmentProjector.prepare(input, bridge.actor, projection, preparation)` with the same `join(config.dataDirectory, "native", turn.projectId, "workspace")` projection (created with `mkdirSync(..., { recursive: true, mode: 0o700 })`). Do not run `describeUnattachedKeyframes` or the keyframe projector for code films.

`prepare` already returns its input unchanged when the request has no selection. Failure handling stays as it is in `prepareAttachments`: extraction failures become `readable: false`, integrity failures are fatal.

Every contract version gets this. It changes no tool.

### 2. `read_film` and the turn context list uploads

`readCodeFilm` in `apps/server/src/code-plan/director.ts` gains `uploads`, newest first, at most 24, one per distinct `sha256`. It covers `artifact` rows of this film with `origin === "supplied_image"` and `fixture === false`.

```ts
interface FilmUpload {
  name: string;                 // the file name, untrusted data
  artifact: Artifact;           // { artifactId, kind: "image", sha256 } usable by every installed model
  width: number; height: number; byteLength: number;   // of `artifact`
  reduced?: true;               // `artifact` is the smaller copy from section 4
  imageReferences?: false;      // present only when `artifact` is still too large for ctx.image references
}
```

`readCodeFilm` feeds both the `read_film` tool and `context.film`, so this reaches every turn. Do not add it to the public `CodePlanView`. Every contract version gets this.

### 3. `read_clip_frames` also shows pictures

In `apps/server/src/code-plan/clip-frames.ts`, `readClipFrames` accepts an owned `image` artifact as well as a video:

- Same ownership check, same hash check against the stored bytes, 32 MiB bound.
- Decode with `@napi-rs/canvas`, scale so the long side is at most 1536 without enlarging, encode JPEG with the same quality ladder and `MAX_BYTES`.
- `startFrame`, `endFrame` and `everyFrames` are ignored for a picture.
- Result: the same two content blocks, text then image. Metadata is `{ artifactId, kind: "image", width, height, sheet: { sha256, byteLength } }`, width and height being the stored picture's. Make the metadata type a union and keep the video shape unchanged.
- Image bytes are never persisted. No artifact, entity, media step or paid operation is created. The replay branch in `tool-invocations.ts` must keep working.
- A foreign artifact is still refused with `CODE_PLAN_ARTIFACT_INVALID`, and the message must now say it accepts a video or picture owned by this film.

Update the `read_clip_frames` descriptor in `packages/core/src/tools.ts` so its description says it also shows an owned picture. Input schema unchanged. This changes the 0.3.0 catalog digest. Contract 0.3.0 is unreleased, so edit it in place. `codeDirectorInput` already moves a fresh turn to a new lock when the guidance digest differs, and section 5 changes that digest; check that an existing 0.3.0 film with the old lock still gets a working fresh turn, and test it.

### 4. A smaller copy for large pictures

Follow the poster pattern in `apps/server/src/code-plan/posters.ts` and `LocalMediaService.poster`.

- New `LocalMediaService` method, for example `reducedPicture({ path, sha256, artifactDir }, { signal })`: snapshot and hash-check the source like `poster`, then scale with FFmpeg using `imageInputArgs(imageFormat(bytes))`, long side 2048 (never enlarge), then 1536, 1280, 1024, 768, keeping the first PNG that is at most `CODEX_IMAGE_LIMITS.referenceBytes` and fits `CODEX_IMAGE_LIMITS.dimension`. Store it through `LocalImageStore.ingest` under the artifact root, as `poster` does, so it has a `validationDigest`. Refuse with `MEDIA_OUTPUT_LIMIT` if none fits.
- New entity kind `code_plan_image_reference`, keyed by the source artifact id: `{ id, projectId, source: ArtifactRef, reference?: ArtifactRef, failed?: boolean }`. The derived `artifact` row has id `digest({ imageReference: source.artifactId, sha256 })`, `fixture: false`, `attemptId: null`, `physicalDurationSeconds: null`, measured `width`, `height`, `byteLength`, and no `origin`.
- New function `prepareCodePlanUploads(...)` in a new file `apps/server/src/code-plan/uploads.ts`, which also owns the `uploads` listing. It makes copies for every listed upload that fails `assertImageReferenceRecords`, sequentially, skipping rows that already exist. Call it from both `prepareInput` functions for code films, before `readCodeFilm` is read by the turn input. Reorder what you must so the first turn after an upload already sees the copy. It runs when `config.media` is present.
- Failure never fails the turn. Copy the poster policy: `MEDIA_BUSY`, shutdown and quarantine leave no row, so the next turn tries again. Any other failure stores `failed: true`, the listing then shows the original with `imageReferences: false`, and the next turn does not retry.
- `codePlanArtifacts` in `apps/server/src/code-plan/artifacts.ts` must expose these so Assets hides them the way it hides posters: extend `posterIds`, or add a set and skip it in `apps/server/src/code-plan/assets.ts`. An upload must appear in Assets exactly once.
- In `assets.ts`, an upload whose copy is used as a `firstFrame` or video reference counts as `current`, as if the upload itself had been used.
- Check that `installation-backup` keeps these rows valid: the copy is an ordinary `artifact` row. Add one assertion to an existing backup test if that is cheap, otherwise say how you checked.

### 5. Tell the Director

In `codeDirectorInput`, extend `instructions` for every version: `film.uploads` lists pictures the person uploaded to this film; use `uploads[].artifact` exactly as given for `references`, `firstFrame` or `lastFrame`, not the IDs in `attachedMaterial`, which may be a larger original; never ask the person to upload again when the picture is listed. For versions whose catalog has `read_clip_frames`, add: call `read_clip_frames` with an upload's `artifactId` to look at it before building on it.

In `skills/code-plan/SKILL.md`, add a short section on uploads with the same rules, including: a picture from the person is the reference for that subject; use it for the character sheet and keep it in the references of every picture of that subject. In `skills/code-plan/references/studio.d.ts`, document the `Artifact` literal an upload provides. Keep `references/film-craft.md` unless a line is needed.

Then recompute `CODE_PLAN_GUIDANCE_DIGEST` in `apps/server/src/application/director-capabilities.ts`. The failing test prints the new digest; otherwise use `loadSkillCatalog` on `skills/code-plan`.

## Tests

Add `apps/server/test/code-plan-uploads.test.mjs`. Real FFmpeg and real HTTP or service paths, no mocks of the projector. A reduced-size PNG must really exceed 4 MiB: generate 2880×2880 noise with FFmpeg.

1. **The regression.** A code film, a human message with an uploaded JPEG attachment, through the same `prepareInput` the supervisor uses: the result has `images` with a real JPEG file inside the workspace, `context.attachedMaterial.attachments[0].readable === true`, a `request_attachment_projection` row, and `messageAttachmentViews` reports `readable: true`. Both the fake and the native paths, or say why one cannot be driven and how you covered it. This test must fail before the change. Show that in your report.
2. A second turn with no attachment: `context.film.uploads` holds the picture, and `read_clip_frames` on its `artifactId` returns a JPEG image block, creates no entity beyond the tool invocation, and refuses another film's picture.
3. A 2880×2880 noise PNG over 4 MiB: a copy at most 4 MiB exists after preparation, `uploads[0].artifact` is the copy with `reduced: true`, the copy passes `assertImageReferenceRecords`, and a real plan dry run with `ctx.image({ references: [uploads[0].artifact] })` is accepted while the original is refused. A plan with `ctx.video({ firstFrame: uploads[0].artifact })` is also accepted.
4. Preparation is idempotent: a second turn adds no rows.
5. A forced failure leaves the turn running and the listing shows `imageReferences: false`; `MEDIA_BUSY` leaves no row.
6. Assets lists the upload once, and a video using the copy marks that upload `current`.
7. A film holding a 0.3.0 lock with the previous guidance digest gets a working fresh turn. A 0.2.0 film gets attachments and `uploads` and its catalog is unchanged.
8. Ordinary non-code films behave exactly as before: run `director-attachments`, `message-attachments`, `code-plan-director`, `code-plan-review`, `code-plan-e2e` and any test pinning catalogs or digests.

## Finish

Run `pnpm test`, `pnpm typecheck` and lint for the files you touched. Write `docs/ai/film-quality/reports/U2-report.md`: what changed, the before and after of test 1, what you could not cover, and anything in this card you decided against.
