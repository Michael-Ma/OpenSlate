# F3 report: code-film video prices per second

## Done

F3 adds optional `pricing` to provider catalog rows for every video adapter whose code-plan `modelPrice` depends on duration: Viggle H3 (built-in and custom profiles), Seedance, and fal video. The same rows reach `GET /api/providers` as `profiles[]` and `GET /api/projects/:projectId/settings/models` as `options[]`. Installed readiness does not affect whether a configured price is displayed.

The existing price function and video defaults now live in a shared pure helper. `models.ts` re-exports `modelPrice`, keeping its existing callers. Catalog rates call this exact function with the code-plan defaults, including resolution, audio and Viggle's `enhance: false`. Rates never derive from `unitCostMicros`.

Direct MiniMax H3/H3-Max still use per-call estimates in `modelPrice`, so they have no `pricing`. Fake profiles, images, speech, transcription, music and storyboard-only lip sync likewise have no field. This card does not introduce a new charging rule for them.

Profile definitions, catalog digests, saved locks, step identities, storyboard quotes, reservations, recorded prices and dispatch behavior remain unchanged. The endpoint test checks that both catalog reads leave the fixture's entire entity store unchanged and produce no generation authority or provider acceptance.

## Contract changes

`packages/core/src/studio-api.ts`: none. The browser's `ProviderOption` and Start-page provider types live in the lead-owned web tree and were not edited. The lead should add the following optional field to those types and use it for code-film display:

```ts
pricing?: {
  unit: "second";
  modes: {
    mode: "first_frame" | "reference" | "first_last_frame" | "text";
    microsPerSecond: string;
  }[];
  minMicrosPerSecond: string;
  maxMicrosPerSecond: string;
};
```

The server exports `ProviderPricing` from `code-plan/model-pricing.ts` and inferred `ProviderOption` / `ProviderCatalogView` aliases from `application/provider-catalog.ts`. Both catalog and model-settings response inference carry `pricing?: ProviderPricing`; the latter already uses `catalog.view().profiles`, so no route or settings-service edits were needed. No shared card contract or tool version changed.

For the built-in Viggle H3 profile (`768p`, enhance off), both routes return:

```json
{
  "unit": "second",
  "modes": [
    { "mode": "reference", "microsPerSecond": "50000" },
    { "mode": "first_frame", "microsPerSecond": "30000" },
    { "mode": "first_last_frame", "microsPerSecond": "50000" },
    { "mode": "text", "microsPerSecond": "30000" }
  ],
  "minMicrosPerSecond": "30000",
  "maxMicrosPerSecond": "50000"
}
```

This means about $0.03–$0.05 per second: a six-second first-frame/text clip is $0.18 and a reference/first-and-last-frame clip is $0.30. Existing `estimatedCost` and `profile.unitCostMicros` remain legacy per-call/storyboard data; the lead should prefer `pricing` when displaying these code-film video models.

## Estimate boundaries and decisions for the lead

- Seedance rounds token-based clip prices up to an integer micro-dollar. Its rate is the default-duration clip price divided by that duration, then rounded up to one micro-dollar per second. For example, Mini 2.0 at 720p / 4:3 costs `456459` micros for the default six seconds, so the displayed rate is `76077`. The exact five-second price stays `380383`; multiplying the displayed rate is only an estimate.
- Seedance adaptive output dimensions depend on the future source frame. With no owned frame in the installation catalog, the estimate uses a representative 1280×720 (16:9) frame. A configured explicit ratio is honored; adaptive text estimates use explicit 16:9 because text calls require a ratio. Other source proportions can change the actual token price. Exact keyframe cards and dispatch still price their real owned image dimensions.
- Viggle prices whole output seconds, and code-plan inputs already require whole seconds. Legacy profiles capped below five seconds omit reference mode, which they cannot use, instead of breaking catalog reads.
- Veo keeps the existing code-plan choice of the first allowed discrete duration (normally four seconds), rather than adding a new default. Existing default duration values and journal inputs are preserved for every adapter.
- Web display and rendered browser checks remain the lead's work. No browser, real provider, non-loopback network call, port 3001 server or personal configuration file was used.

## Files

Changed:

- `apps/server/src/application/provider-catalog.ts`
- `apps/server/src/code-plan/models.ts`
- `apps/server/test/provider-catalog.test.mjs`

Added:

- `apps/server/src/code-plan/model-pricing.ts`
- `apps/server/test/model-pricing.test.mjs`
- `docs/ai/film-quality/reports/F3-report.md`

Deleted: none. No F1/F2 or web files were edited.

## Tests and verification

Added ten tests: nine pure/model tests cover built-in Viggle six-second card prices, custom resolution/quality and stale estimates, legacy short bounds, all three fal models' supported modes/settings, all three Seedance models, token rounding, and per-call identity/prices. One endpoint test covers both response paths, omitted fields on per-call options, preserved legacy estimates and unchanged persisted data. Rewritten/deleted tests: none; existing money/integrity coverage is retained.

Toolchain: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1. `pnpm setup:test-media` found matching installed binaries without downloading anything; `pnpm check:toolchain` passed.

| Check | Result |
| --- | --- |
| `pnpm build` | Passed, exit 0. Existing web chunk-size / mixed-import warnings only. |
| `node scripts/run-tests.mjs apps/server/test/provider-catalog.test.mjs apps/server/test/model-pricing.test.mjs apps/server/test/code-plan-viggle-model.test.mjs apps/server/test/video-models.test.mjs apps/server/test/code-plan-keyframes.test.mjs` | 94 passed, 0 failed, 0 skipped; exit 0. |
| `pnpm test` | 5,234 tests: 5,231 passed, 1 failed, 2 skipped, 0 cancelled; exit 1. The sole timing-sensitive failure cleared on the file rerun below. |
| `node scripts/run-tests.mjs apps/server/test/code-plan-music.test.mjs` | 21 passed, 0 failed, 0 skipped; exit 0, including the previously failing check. |
| `pnpm typecheck` | Package build and all 5 workspace typechecks passed; exit 0. |
| `pnpm -r typecheck` | All 5 workspace typechecks passed; exit 0. |
| `git diff --check` | Passed. |

An extraction check comparing the original `modelPrice` function with its new helper implementation passed byte-for-byte. Existing integration tests in the focused run also verified exact charged prices, owned-dimension reservations, unknown-submission retention, restart/replay and storyboard quotes.

The full-run failure was `code-plan Lyria LYRIA_BUSY retains honest retry and price evidence` at `apps/server/test/code-plan-music.test.mjs:54`: the test observed `in_flight` while expecting `failed` after two ticks. The entire file was rerun as requested and passed 21/21. This is an unchanged music test outside F3; no music source or test was edited. The initial full-suite result remains exit 1 and is not represented as a clean full run. The two skips were the animated-WebP decoder capability check and the opt-in native Codex probe.

Verification logs: `/tmp/openslate-f3-build.log`, `/tmp/openslate-f3-focused.log`, `/tmp/openslate-f3-test.log`, `/tmp/openslate-f3-music-rerun.log`, `/tmp/openslate-f3-typecheck.log`, `/tmp/openslate-f3-recursive-typecheck.log`.

Supplemental diagnostic: declaration-only emission to `/tmp/openslate-f3-route-types` confirmed `pricing?: ProviderPricing` in both response types, but that nonstandard command exited 1 on five TS4053 errors in unchanged code (`local-director.ts`: private `UpgradeReceipt`; `service.ts`: private `Approval` twice and `Hold`; `scene-confirmations.ts`: private `SaveShotScript`). Declaration emission is not enabled by the normal project build/typecheck scripts. No files outside F3 ownership were changed to address it.

## Self-review

Reviewed the entire diff, the moved price function/defaults, existing callers, imports, duration/mode boundaries, money arithmetic, catalog identity and persistence effects. The legacy under-five-second reference case is explicitly handled and covered. No important correctness issue remains from this review.

## Open issues

No F3 implementation blocker remains. The lead owns browser type/display integration and browser verification, and should review the documented Seedance adaptive-frame assumption and rounded rate estimates. The initial full run had the timing-sensitive music failure described above, which did not recur on the required file rerun. Supplemental declaration-emission limitations are recorded separately from the passing standard typechecks.

## Commits

No commits made, as requested. Proposed single conventional commit for the lead:

`fix(server): expose code-film video prices per second`

Files: all six files listed above, including the tests and this report.
