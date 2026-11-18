# H1 — Skill 2.1.0: idea and cut

## Done

Implemented H1 items 1–4 in `codex/h1-skill-idea-cut`. The lead’s ideation/craft/template prose is retained except for the factual corrections listed below. The package is 2.1.0 on unchanged tool contract 0.3.0, plan language 1.0.0 and workflow 1.0.0.

- Added `references/templates.md` immediately after film craft in the manifest. All five files are injected in turn context, verified byte for byte for the templates reference.
- Updated the API reference with H2’s still row (owned image, required integer 1–300 ticks, optional fit/zoom), zoom bound `1 < scale <= 2`, advisory keyframe `suggest` with the existing three input values and 1–160-character reason, and the first-scene idea fields. Render accepts mixed video/still rows in object and array form. A confirmed keyframe’s `frame` is typed as an image.
- The 72-line offline example records fixed points, three takes with a basis and exactly one chosen, reading, visual rule and four cuts. Two video requests still differ (7 and 5 seconds, for 5- and 3-second footage targets). The first clip supplies ranges 0–89 and 90–149; a confirmed second-shot keyframe is held for 45 ticks. Cut lengths are 3, 1.5, 2 and 3 seconds, total 9.5 seconds / 285 ticks / 456,000 audio samples. Every cut names a declared shot. The first keyframe suggests `first_frame`.
- Updated the package digest and the release/context/snapshot/example tests. Added a five-file word-budget tripwire and an actual runtime example test reaching confirmation, review and render. The final dry run checks the reached render, rather than stopping its assertions at an unresolved keyframe. Updated the existing offline HTTP fixture’s expected four-row render layout; its replay, unknown-submission, cost and hold checks remain.

## Release and visibility

Code-plan is a schema 1 package outside storyboard release automation. `skills/shipped-releases.json` accepts guidance major 8 or later and storyboard contracts 7 or later (`packages/director/src/skills/releasing.ts`); code-plan 2.1.0 / contract 0.3.0 cannot be registered there. Following the existing code-plan release path (`docs/technical/SKILLS-TOOLS.md` and G3), the registry and all storyboard release directories remain byte-identical. No release schema/runtime change is needed or made. `pnpm skills:check` validates all four existing storyboard releases.

- New code films receive 2.1.0 on their first Director turn, with either Codex or Claude Code.
- Existing 0.3.0 code films receive it on their next fresh, unbound human, repair or review turn. Refreshing guidance does not submit a plan, rewrite source, dispatch media or change saved media identities.
- Bound epochs keep their lock. Recorded locks, reads, contexts and immutable package snapshots are not rewritten. An old bound epoch can fail the strict current-digest verification on a new build; it must receive a fresh turn rather than silently changing instructions.
- Contract 0.1.0 and 0.2.0 films retain `code-plan-v1` and `code-plan-v2`. Storyboard films retain their own releases.
- The preservation test uses a synthetic 2.0.1 package without templates, not a claim to reproduce exact historical 2.0.1 bytes. It verifies the old snapshot/read/lock survive while the new turn gets templates.

Old current digest: `18e10aa56b6c1d2909595e33048507e8210d4782b86d4ee6dea569d4912a50f0`.

New current digest: `06dae004a63aa0be71d990c2a881c0390f23c9a71359e2afb32d801af2108f0a`.

## Factual corrections to the lead’s prose

Only these factual clauses in `SKILL.md` changed; their surrounding prose is preserved:

1. First-scene visibility: removed `: the person sees it above the storyboard` after the idea-field list. The server records the generic scene declaration, but this checkout’s `declaredPlan` projects scene title/purpose/shots, not the idea fields. Their UI display belongs to separate work.
2. Suggestion reason: `why at most 160 characters` → `why 1–160 characters`. `ctx.keyframe` refuses an empty reason, not merely overlong text (`code-plan/index.ts`, keyframe validation).
3. Suggestion availability: the unconditional `the card shows it` → `the card data includes it only if that input is offered, and the person still picks`. H2 omits unavailable suggestions and adds `SUGGEST_UNAVAILABLE`; the person’s confirmation remains authoritative.
4. Suggestion visibility: the same replacement describes returned card data rather than claiming the UI already displays it. H2 projects `choices[].suggest`; its report leaves display to H3, and this checkout’s UI does not yet consume the field.
5. Zoom lower bound: `zoom.scale goes up to 2` → `zoom.scale is greater than 1 and goes up to 2`. H2 validates `1 < scale <= 2`.
6. Softness threshold: `above about 1.5 the picture softens` → `measured enlargement after fit and zoom above 1.5 triggers ZOOM_SOFT`. The finding uses the output/source size ratio selected by contain/cover, multiplied by zoom; it skips unknown dimensions. A zoom factor alone is not the criterion.

The first-scene and suggestion-display corrections came from self-review of current callers/UI projection. The example’s `basis` values also follow the supplied template vocabulary (`bent: ...`, `template: ...`, `own`). This changes the new example, not the lead’s prose.

`references/film-craft.md` and `references/templates.md` are unchanged. In particular, `clip: "still"` remains valid for a held picture belonging to no shot; `cut-findings.ts` explicitly exempts it from undeclared-shot findings. The example uses declared shot IDs even for its keyframe still, as the H1 test requires.

The diff sentence in the supplied `SKILL.md` already says “findings” and names `CUTS_UNUSED_SHOT`, `CUTS_UNKNOWN_CLIP`, `CUTS_LENGTH`, `CUTS_SHAPE`, `ZOOM_SOFT` and `SUGGEST_UNAVAILABLE`. It already states they never refuse a plan, so no rewrite was needed. Checked still restrictions, 30 Hz positions / 24 fps export, zoom bounds and measured softness, cut-pair paging (18 cuts / 36 labelled cells), suggestion validation/projection, keyframe results, declaration results, media results and review behavior against H2 and source. No corrections to the craft or template text were needed.

## Files

Changed:

- `skills/code-plan/SKILL.md`
- `skills/code-plan/openslate.skill.json`
- `skills/code-plan/references/studio.d.ts`
- `skills/code-plan/references/example-plan.ts`
- `apps/server/src/application/director-capabilities.ts` (current generated guidance digest only)
- `apps/server/test/code-plan-director.test.mjs`
- `apps/server/test/code-plan-e2e-fixture.mjs`

Added:

- `apps/server/test/code-plan-skill.test.mjs`
- `docs/ai/film-quality/reports/H1-report.md`

Deleted: none. Total: 7 changed, 2 added, 0 deleted. The lead’s already-tracked templates file is newly listed in the manifest, not a new working-tree file.

## Tests and verification

Added 2 tests. Rewrote assertions in 3 existing Director tests (current context/version/file count, preserved older snapshot, pinned example layout/music) and the existing HTTP flow fixture used by the end-to-end test. No tests were deleted. No money, integrity, unknown-submission or replay assertions were relaxed.

Pinned toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and Hiragino Sans GB. `pnpm setup:test-media` found the existing tools already correct; `pnpm check:toolchain` passed.

| Check | Result |
| --- | --- |
| `pnpm skills:check` | Exit 0; 4 shipped storyboard releases verified. |
| Skill/code-plan suites (command below) | Exit 0; **671 passed, 0 failed, 0 skipped/cancelled/todo**, 310.189 s. Run before the final factual UI clauses and example basis labels were refined; the subsequent focused and full runs validate final bytes. |
| Final `pnpm build` | Exit 0; all **5 workspace builds passed**. Existing Vite dynamic-import/bundle-size advisories only. |
| Final affected tests (command below) | Exit 0; **36 passed, 0 failed, 0 skipped/cancelled/todo**, 5.188 s. |
| Direct Studio declarations + example strict TypeScript check (command below) | Exit 0; **1 passed, 0 failed**. These supplied reference files are outside workspace compilation, so checked explicitly. |
| Final `pnpm test` | Exit 0; **5,364 total; 5,363 passed, 0 failed, 1 skipped, 0 cancelled/todo**, 731.809 s. |
| Final `pnpm -r typecheck` | Exit 0; **5 passed, 0 failed**: `@openslate/core`, `@openslate/providers`, `@openslate/director`, `@openslate/server`, `@openslate/web`. |
| Five-file word budget | **9,055 words**, under 9,500 (72-line example). |
| Package pin and report consistency | Source package digest equals compiled `CODE_PLAN_GUIDANCE_DIGEST`; embedded API/example diffs exactly match the working tree. |
| `git diff --check` | Passed. |

Skill/code-plan suites:

```sh
node scripts/run-tests.mjs scripts/test/skills-release.test.mjs packages/director/test/*skill*.test.mjs packages/director/test/tools.test.mjs apps/server/test/director-guidance-release.test.mjs apps/server/test/director-skills-v8*.test.mjs apps/server/test/provider-catalog.test.mjs apps/server/test/code-plan-*.test.mjs
```

Final affected tests (the e2e test exercises the changed fixture):

```sh
node scripts/run-tests.mjs apps/server/test/code-plan-director.test.mjs apps/server/test/code-plan-skill.test.mjs apps/server/test/code-plan-e2e.test.mjs
```

Direct API/example typecheck:

```sh
node node_modules/typescript/bin/tsc --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext skills/code-plan/references/studio.d.ts skills/code-plan/references/example-plan.ts
```

Final build/test/typecheck output: `/tmp/openslate-h1-build-final.log`, `/tmp/openslate-h1-focused-final.log`, `/tmp/openslate-h1-suites.log`, `/tmp/openslate-h1-full-test.log`, `/tmp/openslate-h1-typecheck.log`.

An initial focused run had 34 passes and 2 failures: the synthetic old package still linked an undeclared template file, and the held-frame assertion compared a normalized `{kind, sha256}` reference with a full artifact containing `artifactId`. Both were test-fixture defects corrected without changing runtime behavior. The next focused run and the final focused run each passed 36/36. The full run’s sole skip is `opt-in native Codex probe never starts a model turn`; no native probe was opted in. There are no unresolved failures.

## Self-review

Reviewed the full diff for declaration/input shapes, source/edited timing, still restrictions, suggestion availability, unchanged media identity, historical locks/snapshots, all example callers and missing failure coverage. Fixed the unsupported UI-display claims above, kept still rows free of video-only/motion fields, and checked that reused video rows retain their motion annotation in the fake renderer (whose two clips otherwise share fixture bytes). The still uses a confirmed keyframe, the cut-list total and music trim both equal 9.5 seconds, retries still preserve human consent, and shot/video/retry quotes remain 7/5 seconds. The direct API/example TypeScript check passes. No runtime behavior or browser/core contract was changed. Final diff/ownership and whitespace checks passed: 7 modified and 2 added files, all within the card scope; no changes to craft/templates, storyboard release registry, core/browser contract or archived guidance. The branch remains `codex/h1-skill-idea-cut`. All build/test/typecheck command sessions exited normally; no background service remains from this task.

## Contract changes

None to `packages/core/src/studio-api.ts` or any tool catalog. H2’s contract is copied into the guidance only.

## Proposed commits

No commits created. Proposed split:

1. `feat(code-plan): release idea and cut guidance 2.1.0`
   - `skills/code-plan/SKILL.md`
   - `skills/code-plan/openslate.skill.json`
   - `skills/code-plan/references/studio.d.ts`
   - `skills/code-plan/references/example-plan.ts`
   - `apps/server/src/application/director-capabilities.ts`
   - `apps/server/test/code-plan-director.test.mjs`
   - `apps/server/test/code-plan-e2e-fixture.mjs`
   - `apps/server/test/code-plan-skill.test.mjs` (added)
2. `docs(film-quality): record H1 release and verification` — this report.

## Open issues and limits

- The card mentions `skills/shipped-releases.json`, but its schema cannot register this code-plan version. The existing digest-pinned code-plan release path is used; no synthetic storyboard release or release-framework redesign was made. The lead should retain this distinction when integrating.
- Displaying the idea above the storyboard and displaying suggestions are separate UI work (H3); no web files are edited here. The Director receives the idea/template guidance and the server already records/projects the H2 data.
- Browser and subjective film-quality acceptance remain unverified under the card’s hard rules. Existing Vite bundle-size/dynamic-import advisories are unrelated to H1.

No browser, real Director model turn, real provider, paid generation, credential access or port 3001 was used. All test state is in temporary directories; the fake transports test behavior, not subjective film quality or vendor acceptance. No git commit/stash/checkout/reset/push was run. No process was terminated by name or process group.

## Exact API/example line changes

Unified diffs below show every removed/added line relative to the supplied worktree baseline. A `-` line is before; a `+` line is after; `@@` carries the old/new positions. Unchanged lines are omitted.

### `skills/code-plan/references/studio.d.ts`

```diff
diff --git a/skills/code-plan/references/studio.d.ts b/skills/code-plan/references/studio.d.ts
index bd84c1b8..651dcd6e 100644
--- a/skills/code-plan/references/studio.d.ts
+++ b/skills/code-plan/references/studio.d.ts
@@ -7,0 +8 @@ interface Artifact { artifactId: string; kind: "image" | "video" | "audio" | "do
+type ImageArtifact = Artifact & { kind: "image" };
@@ -13,0 +15,2 @@ interface KeyframeInput {
+  /** Advisory only; shown when offered on the card. why is 1–160 characters. */
+  suggest?: { input: VideoInputChoice; why: string };
@@ -15 +18 @@ interface KeyframeInput {
-type KeyframeResult = { ok: true; frame: Artifact; choice: VideoInputChoice; input: { references: Artifact[] } | { firstFrame: Artifact } }
+type KeyframeResult = { ok: true; frame: ImageArtifact; choice: VideoInputChoice; input: { references: Artifact[] } | { firstFrame: Artifact } }
@@ -27 +30,7 @@ interface TimelineClip {
-  zoom?: { scale: number; x?: number; y?: number }; // 1 < scale <= 1.4; x/y 0–1, default 0.5.
+  zoom?: { scale: number; x?: number; y?: number }; // 1 < scale <= 2; x/y 0–1, default 0.5.
+}
+interface StillRow {
+  artifact: ImageArtifact;
+  durationFrames: number; // Required integer 1–300, in 1/30-second ticks.
+  fit?: "contain" | "cover";
+  zoom?: { scale: number; x?: number; y?: number }; // 1 < scale <= 2; x/y 0–1, default 0.5.
@@ -32,0 +42 @@ interface Studio {
+  /** The first scene may carry fixed, takes, reading, rule and cuts. */
@@ -44,3 +54,3 @@ interface Studio {
-  /** Owned video refs or timeline rows; 48 kHz, cuts only. Frame numbers are 1/30-second positions
-   * (30 per second); each clip keeps its own frame rate and the finished film plays at 24 fps. Each row lasts
-   * round(durationFrames / speed) + holdFrames. Zoom is a fixed punch-in, not camera motion.
+  /** Owned video refs, video rows or owned still rows; 48 kHz, cuts only. Frame numbers are 1/30-second positions
+   * (30 per second); each clip keeps its own frame rate and the finished film plays at 24 fps. Each video row lasts
+   * round(durationFrames / speed) + holdFrames; stills take only durationFrames, fit and zoom. Zoom is a fixed punch-in, not camera motion.
@@ -53 +63 @@ interface Studio {
-  render(input: Artifact[] | TimelineClip[] | (MediaInput & { timeline: (Artifact | TimelineClip)[]; audio?: (AudioPlacement | SoundPlacement)[]; captions?: Caption[]; width?: number; height?: number })): Promise<MediaResult>;
+  render(input: (Artifact | TimelineClip | StillRow)[] | (MediaInput & { timeline: (Artifact | TimelineClip | StillRow)[]; audio?: (AudioPlacement | SoundPlacement)[]; captions?: Caption[]; width?: number; height?: number })): Promise<MediaResult>;
```

### `skills/code-plan/references/example-plan.ts`

```diff
diff --git a/skills/code-plan/references/example-plan.ts b/skills/code-plan/references/example-plan.ts
index 02a8a785..78b01397 100644
--- a/skills/code-plan/references/example-plan.ts
+++ b/skills/code-plan/references/example-plan.ts
@@ -2 +2,11 @@ export default async function film(ctx: Studio): Promise<void> {
-  await ctx.scene({ id: "scene-1", title: "A quiet morning" });
+  await ctx.scene({ id: "scene-1", title: "A quiet morning",
+    fixed: ["A kitchen at dawn", "Tea by the window", "A calm ending"],
+    takes: [{ title: "A room wakes", basis: "bent: A day in one place", chosen: true },
+      { title: "An absent guest", basis: "template: Trace of someone" },
+      { title: "Light finds its home", basis: "own" }],
+    reading: "The viewer first reads this as an empty room. Through light reaching a waiting cup, that becomes a place ready for someone. The image they keep is steam rising in the first sun.",
+    rule: "Stay beside the window; let the light be the only arrival.",
+    cuts: [{ sees: "The curtain reveals dawn", seconds: 3, clip: "shot-1" },
+      { sees: "A cup waits in stillness", seconds: 1.5, clip: "shot-2" },
+      { sees: "Light settles on the sill", seconds: 2, clip: "shot-1" },
+      { sees: "Steam makes the room feel lived in", seconds: 3, clip: "shot-2" }] });
@@ -21 +31,2 @@ export default async function film(ctx: Studio): Promise<void> {
-      video: { model: videoModel.id, durationSeconds, aspectRatio: "16:9" } });
+      video: { model: videoModel.id, durationSeconds, aspectRatio: "16:9" },
+      ...(id === "shot-1" ? { suggest: { input: "first_frame" as const, why: "Keep the window composition across the cuts." } } : {}) });
@@ -25 +36 @@ export default async function film(ctx: Studio): Promise<void> {
-    if (clip.ok) return { artifact: clip.artifact, motion };
+    if (clip.ok) return { artifact: clip.artifact, motion, frame: keyframe.frame };
@@ -36 +47 @@ export default async function film(ctx: Studio): Promise<void> {
-    return { artifact: retried.artifact, motion };
+    return { artifact: retried.artifact, motion, frame: keyframe.frame };
@@ -38 +49 @@ export default async function film(ctx: Studio): Promise<void> {
-  const ready = clips.filter((clip): clip is { artifact: Artifact; motion: string } => clip !== null);
+  const ready = clips.filter((clip): clip is { artifact: Artifact; motion: string; frame: ImageArtifact } => clip !== null);
@@ -43,2 +54,4 @@ export default async function film(ctx: Studio): Promise<void> {
-  const cuts = shots.map(({ targetSeconds }) => ({ startFrame: 0, durationFrames: targetSeconds * 30 }));
-  const timeline = ready.map((clip, index) => ({ ...clip, ...cuts[index], fit: "cover" as const }));
+  const range = (index: number, startFrame: number, durationFrames: number) => ({
+    artifact: ready[index].artifact, motion: ready[index].motion, startFrame, durationFrames, fit: "cover" as const });
+  const timeline = [range(0, 0, 90), { artifact: ready[1].frame, durationFrames: 45, fit: "contain" as const },
+    range(0, 90, 60), range(1, 0, 90)]; // One clip, two distinct ranges; a confirmed frame held for 1.5 s.
@@ -46 +59 @@ export default async function film(ctx: Studio): Promise<void> {
-  const filmSamples = cuts.reduce((sum, cut) => sum + cut.durationFrames, 0) * 1600;
+  const filmSamples = timeline.reduce((sum, row) => sum + row.durationFrames, 0) * 1600;
```
