# K1 — confirm every shot's keyframe before new video

Implemented in `codex/k1-keyframes`, offline, with no commits. Read the K1 card, Codex hard rules, film-quality contract, implementation status, repository instructions and UI/UX plan. No browser, real provider/native-model call, external network, protected configuration/state read or port-3001 listener was used.

## Done

1. **K1.1 — `ctx.keyframe`.** The existing host class is named `CodePlanRuntime` in this checkout (the card calls it `CodePlanService`). Its synchronous replay callback composes the ordinary image step with the ordinary durable choice. It validates a declared shot and required video duration, propagates pending/failed image results, and offers `keyframe_and_references`, `references_only`, then `first_frame` according to `videoModes`. Each option retains flat image artifact fields, the person's original ordered references and the exact normalized mode price from `modelPrice`/`codePlanPriceFrame`. Combined references are capped at four for Viggle and nine otherwise. A pending card creates no video step. The shot title is its question, with the shot id as fallback. No new persistence entity/schema is needed.
2. **K1.2 — video gate.** Contract 0.3.0 passes that declare shots need a confirmed keyframe for each new video. Missing/undeclared shot or missing confirmation refuses with `CODE_PLAN_KEYFRAME_REQUIRED`. `references_only` prohibits the frame in any image input; the other choices require its content in an input. Stable variant retakes keep the answer; a first-frame retake is allowed after `keyframe_and_references`, refused after `references_only`. Existing journal keys remain exempt, including saved films, re-cuts and recovery attempts. No-shot engine programs remain ungated. One `filmQualityEnabled` flag controls both `review` and `keyframe`; 0.1.0/0.2.0 expose neither and have no new gate.
3. **K1.3/K1.5 — Assets.** Added `reference` to `AssetRole`. Code image steps use their actual `shotId`: present means keyframe, absent means reference, regardless of contract age. References receive take numbering. The only web edit is the card's exact `ROLE_ORDER` line. Storyboard projection and `asset-library.ts` are untouched.
4. **K1.4/K1.6 — guidance, example and music.** Current guidance/API teaches shared `ctx.image` references without a shot, one `ctx.keyframe` per shot, person-chosen inputs spread into video, stable retakes and picture edits that reopen the card. Independent pipelines still start with `Promise.all`, with each card ready independently. The two-shot example now buys two keyframes rather than six alternatives. Music requests round up to 30-second blocks; usable-length checks, cut trim and fades remain. The skill explains why exact-length requests repurchase on re-cuts. `read_film.models` music notes and archived guidance are unchanged. Current guidance digest: `ea247f33fa281be83716a0b4acab0efb7ecad1cedd6da885fcd07477e6e6150b`.

## Plan API as built

```ts
type VideoInputChoice = "keyframe_and_references" | "references_only" | "first_frame";
interface KeyframeInput {
  prompt: string;
  references?: Artifact[];
  aspectRatio?: "1:1" | "2:3" | "3:2" | "9:16" | "16:9";
  model?: string;
  variant?: string;
  video: { model?: string; durationSeconds: number; aspectRatio?: string };
}
type KeyframeResult =
  | { ok: true; frame: Artifact; choice: VideoInputChoice;
      input: { references: Artifact[] } | { firstFrame: Artifact } }
  | { ok: false; error: { code: string; message: string;
      retry: "safe" | "consent" | "none"; mayHaveCharged: boolean } };
keyframe(shot: string, input: KeyframeInput): Promise<KeyframeResult>;
```

Choices use the stable id `${shot}-keyframe` and normal options digest/replay. `input` is exactly one of the three supported selections; the program spreads it into `ctx.video`.

**Small addition to the card's option example:** each option also carries `video`, the normalized video recipe used to price that option. Otherwise a duration/model edit on a flat-rate model could keep identical artifact/references/price fields and silently retain the answer. This extra JSON field makes the requested reconfirmation reliable even when price is unchanged. Artifact fields remain flat, and existing `option.sha256`, shot linking and `sameImage` readers keep working. No browser contract interface changed for this metadata because choice options are already JSON.

## Files

Changed:

- `apps/server/src/code-plan/index.ts`, `sandbox.ts`, `assets.ts`.
- `apps/server/src/application/director-capabilities.ts`, `fake-director.ts`.
- `packages/core/src/studio-api.ts`.
- `apps/web/src/next/model/assets.ts` — only `ROLE_ORDER`.
- `skills/code-plan/SKILL.md`, `references/film-craft.md`, `references/studio.d.ts`, `references/example-plan.ts`.
- `apps/server/test/code-plan-e2e-fixture.mjs`, `code-plan-e2e.test.mjs`, `code-plan-director.test.mjs`, `code-plan-assets-prompts.test.mjs`, `code-plan-shots-posters-limit.test.mjs`, `code-plan-retry.test.mjs`.

Added: `apps/server/test/code-plan-keyframes.test.mjs` and this report. Deleted: none. No edits outside the card's named source/test scope. The existing `scripts/demo-code.mjs` consumes the changed shared fixture, so it needs no separate edit.

## Tests and verification

Added **19 regressions** covering: submit refusal before dispatch/charge; keyframe validation; independently progressing shot pipelines; all three choices with real `read_film` capabilities and Viggle prices; exact input/return shapes; first-frame-only models, no-reference choices and four-reference truncation; forbidden frame placement/missing frame, missing/undeclared shot on a new take; variant and first-frame retakes; unchanged answers and image reuse across versions/restart; prompt/variant/reference/duration/model changes; unchanged-price duration reconfirmation; journaled-video replay and free re-cut; failed images without a choice; archived 0.1.0/0.2.0 API/gate behavior; old/new asset roles and numbering; real music ingestion and 19.5s-to-21s re-cut reuse at one $0.08 charge.

Existing tests rewritten:

- E2E expectations now pin one frame per shot, two input options without references, six initial media steps, eight after edit/restart, $0.30 initial/$0.40 final fixture spend, and unchanged lookup/idempotency guarantees.
- Director example test invokes `keyframe` and reserves `choose` for retry consent. Archived sandbox testing uses the renamed shared feature flag.
- Assets adapter fixture confirms a keyframe, then uses the selected first-frame input. Its synthetic source/request are both five seconds so reference options can be quoted truthfully.
- Shot-metadata replay test first creates a historical journal without declarations, then tests adding/changing/removing annotations with declarations. This preserves its saved-media reuse purpose.
- Retry engine fixture drops an unused shot declaration; it tests transport, accounting and consent, not storyboard/keyframe behavior. Retry assertions are retained.
- Declaration tests in `code-plan-runtime`, `code-plan-port` and `code-plan-sandbox` need no changes: they do not submit a new declared-shot video through this gate.

None deleted, skipped or disabled. Development fixture mistakes (video bytes overwritten by settings, a three-second file for a five-second request, and selecting two primary video profiles) were fixed without weakening application validation. A negative test was corrected to use a new variant, since changing only shot metadata correctly reuses the exempt journaled clip.

Pinned Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. Setup/preflight passed using the already matching installed media binaries, without downloads.

| Command / gate | Result |
| --- | --- |
| `pnpm setup:test-media` / `pnpm check:toolchain` | Passed. |
| `pnpm build` | All five builds passed. |
| `node scripts/run-tests.mjs apps/server/test/code-plan-keyframes.test.mjs apps/server/test/code-plan-e2e.test.mjs apps/server/test/code-plan-director.test.mjs apps/server/test/code-plan-assets-prompts.test.mjs apps/server/test/code-plan-shots-posters-limit.test.mjs apps/server/test/code-plan-retry.test.mjs` | **94 passed, 0 failed/skipped/cancelled/todo**, 39.739 seconds. |
| `pnpm test` | **5,079 passed, 0 failed, 2 skipped, 0 cancelled/todo; 5,081 total**, 743.914 seconds; exit 0. |
| `pnpm -r typecheck` | Core/providers pass; web fails with the missing `assets.kind.reference` typed message (TS2345, `assets.ts:103`). Recursive execution stops before director/server. |
| `pnpm --filter @openslate/director --filter @openslate/server typecheck` | Both pass. Combined with the recursive result: **4 packages pass, 1 fails**. |
| `pnpm typecheck` | Requested root command also run; package builds pass, then the same single web error stops recursive typechecking. |
| `pnpm demo:code` | Passed: versions **1 → 2 → 3 → 4**, two keyframe choices, **4 reused / render + video new**, **0 duplicate submissions**, **1 lookup recovery**, **$0.40 / $4.00 fixture spend**, final **done**. |
| `git diff --check` | Passed. |

The full run completed normally, including the long quiet release-script tail. No timing-sensitive failure occurred in that full run, so no unrelated test file required a failure recheck. Recursive typechecking was run again after the full suite completed and reproduced the same single web integration error. No source changed during the full run; only this report was filled in.

## Self-review

Reviewed the complete diff for gate placement, default model selection, replay/retry accounting, option identity, artifact/shot readers and guidance callers. Corrected the unchanged-price option identity gap and test fixtures described above. Preserved the explicit journal exemption rather than broadening the gate to old clips. `git diff --check` passed.

## Contract changes

`packages/core/src/studio-api.ts`: only adds `"reference"` to `AssetRole`. The plan API adds the K1 types/method in the current skill declaration; archived API/guidance stays byte-identical. Sandbox's internal `reviewEnabled` option is renamed `filmQualityEnabled` and covers both methods. No DDL or schema version change.

## Open issues and decisions for the lead

- **Assets route integration:** the shared `/assets` query schema in `apps/server/src/asset-library.ts` still enumerates the earlier roles, so `?role=reference` is rejected. Unfiltered code-film asset lists correctly expose the new role. The card explicitly prohibits changing that file, so it is untouched; the lead should add the query enum entry if using server-side role filtering.
- Lead-owned web card presentation and reference translations/labels remain for integration. Only the authorized web ordering line was edited. No browser check was run under the hard rules.
- **Web typecheck requires the lead's label patch:** `apps/web/src/next/model/assets.ts:103` reports TS2345 because `assets.kind.reference` is absent from the typed message catalog. `ROLE_ORDER` alone does not make this checkout's web typecheck pass. The card explicitly reserves all other web edits for the lead, so neither `kindMsg` nor the catalogs were changed.
- No installed model currently advertises text-only video modes; the empty-options refusal is implemented defensively, but that unreachable catalog combination was not exercised with a fabricated capability table. Actual first-frame-only and reference-capable models are covered through `read_film`.
- No live media quality/billing acceptance is claimed. All provider paths use synthetic transports/bytes and disposable state.
- Kept existing engine support for image `shot` annotations so old programs retain replay/asset behavior; only current guidance and its TypeScript API prohibit authoring shot images directly.
- The normalized `video` metadata addition to choice options is the one deliberate shape extension beyond the sample, for the unchanged-price reconfirmation case above. Nothing else in K1 was declined.

## Proposed commits (not created)

1. `feat(code-plan): require confirmed shot keyframes for new videos` — runtime/sandbox, new keyframe tests, current skill's four files, guidance digest, fake Director, E2E fixture/tests, Director/shot/retry regression adaptations.
2. `fix(assets): distinguish shared references from shot keyframes` — code-plan assets projection, core role union, authorized web ordering line, assets regression adaptation.
3. `docs(film-quality): record K1 implementation and verification` — this report.

No git commit, stash, checkout, reset or push was run.
