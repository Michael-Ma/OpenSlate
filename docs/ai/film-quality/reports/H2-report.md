# H2 — Edit tools for a cut that tells the story

Implemented all five H2 items. Work stayed in `codex/h2-edit-tools`; no commits, stash, checkout/reset, browsers, real providers, credentials or port 3001 were used. Tests use temporary directories and offline fixture transports.

## Final shapes for H1 and H3

### 1. Still timeline rows

```ts
type StillRow = {
  artifact: ImageArtifact; // owned keyframe.frame, ctx.image result, or uploaded picture
  durationFrames: number; // required integer 1..300, in 1/30-second ticks
  fit?: "contain" | "cover"; // default contain
  zoom?: { scale: number; x?: number; y?: number };
};
```

`ctx.render({ timeline: [...] })` and the array shorthand accept still rows, including a stills-only film. Stills share the existing 64-row and 10,800-tick/360-second limits. `startFrame`, `speed`, `holdFrames`, and other extra still-row fields fail with `CODE_PLAN_RENDER_INPUT`, e.g. `Row 3: a still row takes durationFrames, fit and zoom only`. Bare image artifacts fail with `Row 3: a still row needs durationFrames`.

The same film-scoped content resolver used for image references verifies ownership before render admission. The local executor snapshots the owned picture, verifies its SHA-256, decodes with explicit local image demuxers, and makes a silent held-picture source inside the render operation. It does not create another journal step, call a provider or add a price. The frozen timeline and render receipt preserve the verified held source on replay. Code films still export probed H.264 MP4 at 24 fps; plan positions remain 30 Hz ticks. Existing graph/default render behavior stays at 30 fps. The fake-provider fixture accepts stills without a new paid operation. Fit warnings use measured still dimensions and skip unknown dimensions.

### 2. Zoom

Both video and still rows accept `zoom.scale > 1 && zoom.scale <= 2`; optional `x` and `y` are finite numbers in 0..1, default 0.5. The shared existing fit/zoom filters implement both row kinds.

### 3. Cut pairs

```ts
type ClipFramesInput = {
  artifactId: string;
  startFrame?: number;
  endFrame?: number;
  everyFrames?: number;
  cuts?: boolean;
  fromCut?: number; // 1-based integer 1..63, default 1 when cuts is true
};
```

`cuts: true` requires an owned render, otherwise `cuts: true reads a render`. It cannot accompany `startFrame`, `endFrame` or `everyFrames`. `fromCut` requires `cuts: true` and cannot be past the final cut. A sheet contains at most 18 cuts/36 cells, labelled `cut N before · fX` and `cut N after · fY`. The existing text + JPEG response and bounded transient-file lifecycle remain.

Render contact-sheet metadata gains only this optional field:

```ts
cuts?: {
  cut: number;           // 1-based boundary between rows
  frame: number;         // first frame after the cut, in finished-film 30 Hz positions
  beforeShotId?: string;
  afterShotId?: string;
}[];
```

`frames` contains `[frame - 1, frame]` per cut. Frozen render recipes supply edited durations and native-output rounding, so source trims/speed/holds/stills do not shift the film-frame numbers. Repeated sample indices remain separate labelled cells. Zero-picture native-rate rows produce no visible boundary; a render with no visible cuts returns an empty cut list and a blank contact sheet. Shot ids are included when the supplying journal step identifies them. No pixels are persisted in tool invocation receipts.

### 4. Cut-list findings

Scene declaration data:

```ts
cuts?: { sees: string; seconds: number; clip: string }[];
```

`seconds` must be positive and finite. Advice examines at most 64 cuts across the reached scenes; malformed or over-bound data emits `CUTS_SHAPE`. No `cuts` means none of the `CUTS_*` findings. Length compares the sum of cut seconds with each reached render's edited timeline when all row lengths are known, allowing a difference of one second. The pure function has table-driven tests. Findings never reject a plan.

| Code | Sample detail |
| --- | --- |
| `CUTS_UNUSED_SHOT` | `No cut names these shots: reaction, clock.` |
| `CUTS_UNKNOWN_CLIP` | `Cuts name undeclared shots: missing.` |
| `CUTS_LENGTH` | `The cuts total 3 seconds; the rendered timeline is 1 seconds.` |
| `CUTS_SHAPE` | `Use at most 64 cuts: an array of objects with string sees, positive number seconds and string clip.` |
| `ZOOM_SOFT` | `Row 4 enlarges the picture 2.3×; it will look soft.` |
| `SUGGEST_UNAVAILABLE` | `Shot opening: the suggested video input is not offered on this card.` |

Softness uses `min(outputWidth/sourceWidth, outputHeight/sourceHeight)` for contain, `max(...)` for cover, multiplied by zoom. It emits only above 1.5× and only with measured source dimensions. Video measurements come from owned media descriptors, then poster/artifact dimensions; stills use the owned picture dimensions. Viggle export policy dimensions take precedence, as at actual render admission.

### 5. Suggested video input

```ts
ctx.keyframe(shot, {
  // existing image fields and video settings
  suggest?: {
    input: "keyframe_and_references" | "references_only" | "first_frame";
    why: string; // 1..160 characters
  };
});
```

The `suggest` object accepts exactly `input` and `why`. Invalid modes, types, empty/overlong reasons or extra fields fail with `CODE_PLAN_KEYFRAME_INPUT` before an image dispatch. Suggestion data is removed before image normalization, identity, pricing or provider input. It is separate from choice options and their digest. Adding/changing/removing it preserves the image/video step, card identity, `askedAt`, saved answer, prices and provider calls, including across restart.

The browser contract change is exactly:

```ts
export interface CodePlanInputSuggestion {
  input: "keyframe_and_references" | "references_only" | "first_frame";
  why: string;
}
// Added to CodePlanChoiceView:
suggest?: CodePlanInputSuggestion;
```

Projection includes the suggestion only if that card offers the named input. Otherwise it omits the field and emits `SUGGEST_UNAVAILABLE`. `read_film` naturally carries the same projected choice with its suggestion and answer. General `ctx.choose` cannot inject this keyframe-only metadata.

## Compatibility and catalog

The tool contract remains 0.3.0. The authoritative tool schema lives in `packages/core/src/tools.ts`; Director adapters consume it, so no duplicate schema was added under `packages/director`. The existing 0.1.0 and 0.2.0 catalogs are untouched. Media normalization adds no defaults to old step identities. `fixtures/h2-saved-plan.json` uses no new fields and proves unchanged media keys, prices, choices, answers and provider submission counts on restart/replay.

Catalog SHA-256 changes from `81ec5a9290ad8e66909c89f316ef148bcf5dea7c2a3e4baa86ecd42ce61fea30` to `830b7b794eb63417421e8bcd9fbd1a86d7664d2180bb23f0164535b724ef3e6e`. Following the existing 0.3.0 fresh-turn guidance refresh path, an unbound new turn now refreshes a stale handler digest even if its guidance package is already current. The old lock is preserved as history; an already-bound turn never switches its lock. An already-bound pre-H2 handler remains fail-closed on this build and needs a fresh turn. No pending/uncertain media submission is replayed or repurchased by this lock refresh. Tests preserve the older archived descriptor digest by reconstructing its actual old schema, and verify a fresh old-handler/current-guidance turn can invoke the current read tool.

The saved-plan fixture also pins three normalized inputs, step keys and prices. A separate read-only check loaded the pre-H2 `HEAD` normalizer and verified all three golden inputs/keys against it; the plan itself always executes in QuickJS.

## Files and ownership

- Code plan: `artifacts.ts`, `clip-frames.ts`, `cut-findings.ts` (new), `director.ts`, `identity.ts`, `index.ts`, `records.ts`, `view.ts`.
- Media: `local-media.ts`, `local-timeline.ts`.
- Necessary existing render integration: `apps/server/src/execution/local-media-executor.ts`, because it owns code-film capture, frozen timelines and local rendering.
- Core: `studio-api.ts` (the two declarations shown above), `tools.ts` (additive read-tool fields and description).
- Tests: `code-plan-edit-tools.test.mjs` and `fixtures/h2-saved-plan.json` (new), `film-quality-render.test.mjs` (extended), `code-plan-port.test.mjs` (bare-image fixture now uses an explicit still duration), `code-plan-uploads.test.mjs` (archived schema reconstruction and fresh-handler lock coverage).
- This report. No web or skill files changed; no files deleted.

## Verification

- `pnpm check:toolchain`: passed (Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1, required codecs/demuxers and CJK font).
- `pnpm build`: passed; all five workspace builds succeeded. The existing web bundle-size advisory remains.
- `node scripts/run-tests.mjs apps/server/test/code-plan-edit-tools.test.mjs apps/server/test/film-quality-render.test.mjs apps/server/test/code-plan-port.test.mjs apps/server/test/code-plan-uploads.test.mjs apps/server/test/code-plan-keyframes.test.mjs apps/server/test/code-plan-review.test.mjs`: **158 passed, 0 failed, 0 skipped**.
- Saved-plan golden check: **3/3** normalized inputs/step keys match the pre-H2 `HEAD` normalizer. The edit-tools test file also passed **29/29** with the pinned golden fixture.
- Added **38** tests (29 edit-tool cases, eight rendering/cut-pair cases and one fresh-handler lock case). Rewrote three existing assertions/fixtures for the intentional zoom-cap, bare-image and archived-schema changes; deleted **0** tests.
- Final `pnpm test`: **5,361 total; 5,360 passed, 0 failed, 1 skipped, 0 cancelled**. The sole skip is `opt-in native Codex probe never starts a model turn`; no native probe/provider test was opted in. The command exited **0**.
- Final `pnpm -r typecheck`: **5 passed, 0 failed** (`@openslate/core`, `@openslate/providers`, `@openslate/director`, `@openslate/server`, `@openslate/web`); command exited **0**.
- Earlier full-run failures were the bare-image hold/release fixture and historical-catalog reconstruction noted below. Both are corrected and pass in the final full run.
- Both full-test processes exited; no server or test process remains holding either full-run log.
- `git diff --check`: passed.

## Self-review and proposed commits

Reviewed the complete diff for correctness, bounds, ownership, stale/replayed choices, provider inputs, cross-file callers and missing tests. Fixed measured-geometry fallback without a poster, strict suggestion input typing, and cut-sheet repeated-frame/native-rate boundary handling, including the correct supplying shots across zero-picture rows. Added still-only audio coverage and a native-24fps pixel-motion test for nearby cuts. The existing 1.41-refusal assertion was rewritten to refuse 2.01, because H2 intentionally raises the cap. The hold/release test now renders its picture with an explicit duration; its money/hold assertions remain intact. The archived catalog test strips new fields when reconstructing the old schema rather than accidentally hashing the new fields into an old fixture. No money or integrity tests were removed.

Proposed conventional commit split (no commits created):

1. `feat(code-plan): add H2 edit and review tools`
   - `apps/server/src/code-plan/artifacts.ts`
   - `apps/server/src/code-plan/clip-frames.ts`
   - `apps/server/src/code-plan/cut-findings.ts` (added)
   - `apps/server/src/code-plan/director.ts`
   - `apps/server/src/code-plan/identity.ts`
   - `apps/server/src/code-plan/index.ts`
   - `apps/server/src/code-plan/records.ts`
   - `apps/server/src/code-plan/view.ts`
   - `apps/server/src/execution/local-media-executor.ts`
   - `apps/server/src/media/local-media.ts`
   - `apps/server/src/media/local-timeline.ts`
   - `packages/core/src/studio-api.ts`
   - `packages/core/src/tools.ts`
   - `apps/server/test/code-plan-edit-tools.test.mjs` (added)
   - `apps/server/test/code-plan-port.test.mjs`
   - `apps/server/test/code-plan-uploads.test.mjs`
   - `apps/server/test/film-quality-render.test.mjs`
   - `apps/server/test/fixtures/h2-saved-plan.json` (added)
2. `docs(film-quality): record H2 contracts and verification`
   - `docs/ai/film-quality/reports/H2-report.md` (added)

Total: **15 changed, 4 added, 0 deleted**. `code-plan-keyframes.test.mjs` and `code-plan-review.test.mjs` were also run unchanged as regression coverage.

No browser or live-provider acceptance was attempted under this card's rules. H1 must copy the shapes into the skill/type declaration and H3 must display `choices[].suggest`; those owned surfaces are outside H2.
