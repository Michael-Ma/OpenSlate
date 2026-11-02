# F1 · Crop the Viggle first frame to the film's shape before upload

Read `docs/ai/uiux-plan/codex/RULES.md` first. Its hard rules apply in full.

## Problem

For a 9:16 film we send Viggle H3 `aspect_ratio=9:16`, but the first frame is a 2:3 Codex keyframe: 1024×1536, because Codex has no 9:16 canvas. H3 follows the frame's shape, not the field, and snaps to its own sizes. The real run produced 768×1152, 768×1216 and 768×1344 clips. The export now centre-crops near-shape clips (`packages/core/src/clip-fit.ts`), but the clips themselves are the wrong shape. The same happens for 16:9 films with 1536×1024 frames.

## Change

1. When a Viggle attempt's aspect ratio is `9:16` or `16:9`, upload a deterministic centre crop of the approved keyframe in the film's exact shape:
   - 1024×1536 → 864×1536 (80 px off each side);
   - 1536×1024 → 1536×864.

   General rule: the largest centred rectangle of the target ratio with even integer sides. If the frame already has that shape, or the ratio is 1:1, upload it unchanged.
2. The crop must be byte-reproducible, because re-preparation after a restart compares the saved mapping canonically and `bodySha256` binds the upload bytes.
   - Prefer a pure Node PNG crop: decode with `node:zlib`, copy rows, re-encode with fixed filter and compression settings, and drop ancillary chunks except what is required.
   - Do not use ffmpeg for this; its version is not pinned per attempt.
   - Put the pure function in `packages/core` or `packages/providers` with its own tests: dimensions, ratios, an odd input size, an already-exact input, and determinism (same bytes in → same bytes out).
3. Where to do it: inside `ViggleH3Execution.prepare` / `resolveViggleFrame` in `apps/server/src/execution/viggle-h3-execution.ts`, or the closest equivalent.
   - The approved keyframe artifact stays the pinned identity (`viggleFramePin`): lineage, approval and the keyframe's own bytes do not change.
   - Record the crop in the mapping, e.g. `firstFrameCrop: { recipe: "center-crop-v1", sourceWidth, sourceHeight, width, height }`, so receipts and recovery can explain the upload.
   - Update the receipt and lineage validators (`viggle-h3-receipts.ts`, `viggle-h3-lineage.ts`) to accept and verify it.
4. **Recovery and integrity, which must not regress:**
   - An attempt whose mapping was saved before this change has no crop record. It must re-prepare, replay and reconcile byte-identically using the uncropped frame.
   - No double submission. An unknown outcome is never blindly resubmitted.
   - The existing tests for these paths must keep passing unchanged, or be extended, not loosened.
5. Fixture and demo paths (`fake-video-v1`) need no crop, unless a shared helper makes it free.
6. Docs: update `docs/ai/aspect/2026-10-28-aspect-ratio.md`. The follow-up it lists becomes done. Explain why export cover-fit stays as a safety net for older clips.

## Tests (minimum)

- 9:16 and 16:9 attempts upload the exact-shape crop. The multipart `first_frame_image` part decodes to 864×1536 / 1536×864. The description and `bodySha256` are stable across two prepares.
- A 1:1 attempt, or a frame already of the right shape, uploads unchanged bytes.
- A saved pre-change mapping without `firstFrameCrop` reconciles and replays with the original uncropped bytes and the same `bodySha256`.
- Tampering with the crop record makes the receipt or lineage check fail closed.

## Out of scope

- Any web UI.
- Changing Codex image sizes.
- Changing export cover-fit.
