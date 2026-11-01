# Q2 report — image conditioning and aspect ratios

Worktree: `codex/q2-lock`. Source is uncommitted. Q2.1–Q2.4 and the image tests in Q2.6 are complete. Q2.5 and its crop-pair regression remain blocked by the exclusive file list, as detailed below.

## Implemented

- Q2.1: the `image` declaration matches CONTRACT 0.3.0 exactly: optional `references: Artifact[]` and `aspectRatio: "1:1" | "2:3" | "3:2" | "9:16" | "16:9"`.
- Q2.2: image normalization validates reference arrays, image kinds, hashes and model limits before creating a step. Project model tables provide a host-only validator that checks the original artifact id against this film before normalization removes ids. Real image references must be validated owned PNGs, at most eight, each at most 4 MiB and 4096 pixels per side, with at most 24 MiB total. Messages tell the Director what to replace or reduce. Dispatch admission reuses the same metadata validator. Numeric limits come from the existing exported `CODEX_IMAGE_LIMITS`; the authority module no longer repeats them.
- Q2.3: Codex image ratios map to its existing versioned native canvas preferences. No aspect/default/canvas field is inserted into normalized identity when the plan omits `aspectRatio`. A supplied ratio participates in identity. Explicit dimensions must match the selected canvas. API image profiles retain their installed dimensions and accept only the matching advertised ratio; unsupported ratios fail during dry run.
- Q2.4: `read_film.models` image rows expose `imageAspectRatios` and `maxReferences`. Non-image rows do not acquire image fields. Host validation functions are never serialized into model descriptions.
- Q2.6: added offline coverage for image planning, dispatch, ownership, limits, capability facts and legacy key/replay behavior. The crop pair regression remains blocked with Q2.5 below.
- Updated the permitted current guidance digest pin after changing only the owned `image` declaration. The lead must recompute it after merging the other cards.

## Q2.5 ownership blocker

The first/last-frame crop change is **not implemented** in this working tree. Its implementation cannot stay within Q2's listed files:

1. `apps/server/src/execution/viggle-h3-receipts.ts` declares the mapping and rejects every unknown mapping field. It must accept and validate `lastFrameCrop`, including deterministic crop geometry and uploaded-image identity. Reference/text modes must reject the new crop field, and existing receipts without it must remain readable.
2. `apps/server/src/execution/viggle-h3-authority.ts` currently requires an uncropped last-frame hash/size to equal the owned source. It must check the last crop's source dimensions against that source, as it already does for the first crop.
3. `apps/server/src/code-plan/step-detail.ts` projects only `firstFrameCrop`; it must safely project the same allow-listed dimensions for `lastFrameCrop`.
4. `packages/core/src/studio-api.ts` declares only `call.firstFrameCrop`; it needs the matching optional `call.lastFrameCrop` member.

These four companion files are outside the card's ownership list. Two asynchronous questions requested the narrow ownership expansion; no response has been received as of this report. They have not been edited. Changing only the owned executor would fail the current receipt/authority validators, so no incomplete crop path was installed. The existing first-frame crop, uncropped last frame and uncropped references retain their behavior.

Once the ownership question is resolved, the executor should independently center-crop both frame inputs to the same requested ratio, retain separate per-frame crop descriptors, store both descriptors in its mapping, and leave reference uploads uncropped. Test same-source and different-source geometries, exact-aspect inputs, tampered/missing crop facts, restart/replay and receipt/backup validation.

## Actual Codex request and expected result

This conclusion comes from the checked-in adapter, without external requests or a native/live model call:

- `packages/providers/src/codex-image.ts` exports `CODEX_IMAGE_V2_CANVASES`, `codexImageCanvasValid`, and `codexImageTurnText`.
- `apps/server/src/execution/codex-image-receipts.ts` checks the same pinned profile and allows its versioned per-turn canvas without changing the installed profile or digest.
- Native Codex receives turn text and local reference images. Width/height are generation preferences in that text, not a strict native image-tool size parameter. The application measures the returned PNG.

| Plan `aspectRatio` | Adapter canvas preference | Internal turn aspect |
| --- | --- | --- |
| omitted | 1024 × 1024, original v1 request | omitted |
| `1:1` | 1024 × 1024 | `1:1` |
| `2:3` or `9:16` | 1024 × 1536 | `9:16` |
| `3:2` or `16:9` | 1536 × 1024 | `16:9` |

A real portrait call requests a 1024 × 1536 preference and is expected to return a portrait PNG; a landscape call requests 1536 × 1024 and is expected to return a landscape PNG. No live call was made to establish how often the exact preferred dimensions are returned. Exact returned dimensions are **not guaranteed**: the bounded PNG result is measured and retained even if different, as the new 941 × 1672 synthetic-result regression demonstrates. Exact 9:16 or 16:9 pixels are not requested by the current adapter. The 2:3/3:2 choices share the existing portrait/landscape turn policies; no new native turn version is introduced.

`openai-image` continues to pin size and quality through its installed profile and receipt checks. A 1024 × 1024 profile advertises only `1:1`; a 1024 × 1536 profile advertises only `2:3`. The generic fallback for other configured image adapters advertises only its matching installed ratio and zero references until that adapter has supported reference semantics. Demo fake images advertise the five plan ratios/eight references; their owned fixture references do not pretend to be validated real-provider inputs.

## Guidance for the lead to merge

- Use `aspectRatio`, not the research example's `aspect` spelling, in `ctx.image`.
- Produce character/prop references and shared room plates first, then condition scene keyframes on those owned images. Use at most eight PNG references within the measured limits.
- Inspect `read_film.models` before selecting a ratio, especially with API image profiles.
- State the intended ratio/composition in the creative prompt when useful; the adapter canvas is a preference and returned dimensions are measured.
- Do not assume first-and-last conditioning is aligned until Q2.5's companion changes are merged and tested.
- No edits were made to `SKILL.md`, `film-craft.md`, `example-plan.ts`, archived guidance, web source or `docs/implementation/STATUS.md`.

## Verification

- `pnpm check:toolchain`: passed, Node 24.15.0 / pnpm 10.33.0 / FFmpeg and ffprobe 8.1.1, required encoders present.
- `pnpm setup:test-media`: passed using the already matching local tools; no download/build was needed.
- `pnpm build`: all five workspace builds passed.
- Initial new-file gate: 18 passed / 0 failed. Two additional boundary tests were subsequently added and are included in the final gates below.
- Broader provider/Director gate: 143 passed / 0 failed / 0 skipped across `code-plan-providers`, `code-plan-reference-video`, `codex-image-execution`, `codex-image-outcomes`, `codex-image-runtime`, and `code-plan-director`.
- Final touched-file gate: **20 passed / 0 failed / 0 skipped** (`node scripts/run-tests.mjs apps/server/test/code-plan-image-continuity.test.mjs`).
- Final uninterrupted `pnpm test`: **4,923 passed / 0 failed / 1 optional native-probe skip (4,924 total)**; exit 0, 2,058 seconds. Both preliminary timing-sensitive cases also passed within this final full run.
- Final post-full `pnpm -r typecheck`: **all five workspace typechecks passed**, exit 0.
- Final `git diff --check`, guidance pin verification and branch/file ownership checks: passed.

The initial new-file run had test-authoring assertion errors: findings use `detail`, not `message`, and the existing generic image input resolver deduplicates repeated hashes. Those assertions were corrected; the dispatch test now uses eight distinct owned PNGs in a deliberately reordered array. No production reference ordering/deduplication behavior was changed. No old tests were rewritten, deleted or disabled. The preliminary full run flagged `execution-provider.test.mjs` / "ingestion lease loss aborts the hook and cannot resurrect ownership or publish" at its two-second deadline and `transcription-preparation-engine.test.mjs` / "an edit during awaited preparation aborts the old signal and settles only that obsolete unstarted attempt" with a 150 ms lease. Their file rechecks passed **16/16** and **24/24**, respectively. That preliminary full run was interrupted before `scripts/test/skills-release.test.mjs` and `scripts/test/test-toolchain.test.mjs` completed; silence did not establish a hang. The two remaining script files subsequently passed **39/39** in 1,024 seconds (about 17 minutes), establishing that their quiet runtime was not a hang. The final fresh full run then completed successfully with the aggregate counts above. A temporary diagnostic copy was removed; it made no production or retained-test change.

Self-review checked normalization/identity, original-id ownership, byte and dimension limits, adapter preflight/dispatch parity, saved-work reuse, safe model serialization and guidance digest consistency. It found the crop ownership dependency and the test-authoring issues above; no unresolved issue was found in the implemented image path. This is offline implementation evidence only; no real-provider quality or exact-size acceptance is claimed.

## Files

Changed:

- `apps/server/src/code-plan/identity.ts`
- `apps/server/src/code-plan/provider-input.ts`
- `apps/server/src/code-plan/models.ts`
- `apps/server/src/execution/codex-image-authority.ts`
- `apps/server/src/application/director-capabilities.ts` — card-permitted digest pin only
- `skills/code-plan/references/studio.d.ts` — image line only

Added:

- `apps/server/src/execution/codex-image-plan.ts`
- `apps/server/test/code-plan-image-continuity.test.mjs`
- `docs/ai/film-quality/reports/Q2-report.md`

Deleted: none. Browser contract changes: none in the current working tree.

## Proposed commits for the lead

No commits were made.

1. `feat(code-plan): validate image references and support aspect ratios` — `identity.ts`, `provider-input.ts`, `models.ts`, `codex-image-authority.ts`, new `codex-image-plan.ts`, the `studio.d.ts` image declaration, `director-capabilities.ts` digest pin, and new `code-plan-image-continuity.test.mjs`.
2. `docs(film-quality): record Q2 verification and crop ownership blocker` — this report.

If ownership is expanded, add the completed executor/validator/authority/projection/contract crop change and its regressions as a separate `fix(viggle): align first and last conditioning frames` commit. Recompute the guidance digest after card integration.
