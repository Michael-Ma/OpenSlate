# G1 · Better default picture, and a per-film video resolution the person chooses

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. G2 (native frame rate, `apps/server/src/media/**`, `code-plan/clip-frames.ts`) and G3 (`skills/**`) run at the same time; stay out of their files. You own `apps/server/src/application/provider-catalog.ts`, `apps/server/src/code-plan/**` except `clip-frames.ts`, the new route in `apps/server/src/app.ts`, `packages/providers/src/viggle-h3.ts` (price table only, if the measured prices below require it), `packages/core/src/aspect.ts` (export sizes only), their tests, and `docs/technical/PROVIDERS-ARTIFACTS.md`. The lead builds the Settings UI and its web fixtures from the contract below; do not edit `apps/web/**`.

## Problem (measured on the owner's film, 2026-11-02)

New code films call Viggle with `quality: "low"` and `768p` (`VIGGLE_PROFILE` in `provider-catalog.ts`): 768×1344 at 1.9 Mbps, exported at 720×1280. Viggle documents `quality` as "low for faster generation, high for higher-fidelity output" and bills both the same. Resolution changes the price and the person wants to choose it per film.

## Change

1. **Quality.** New code films use `quality: "high"`. Saved films keep the profile their capability lock recorded.
2. **Per-film resolution**, one of `480p`, `768p`, `1080p`, `2k`, stored with the film's code-plan settings. New code films default to `1080p`. A film without the setting uses the resolution of its locked profile (so every saved film stays at what it had).
3. **It applies to clips not yet sent.** A clip is submitted at the film's resolution at the moment it is submitted. Changing the setting never changes a succeeded, in-flight or recorded attempt, never re-keys a step, and never buys anything by itself: step keys must not depend on it. A retake or retry submitted later uses the new value. The resolution actually used is recorded on the attempt and shown wherever the call's settings are shown today.
4. **Prices follow the setting.** `read_film.models[]` price basis, dry-run/budget estimates, keyframe-card input prices and `ProviderOption.pricing` for that film use the current resolution for unsent clips. After a change, open keyframe cards show the new prices; answers already given stay. The Director cannot override the resolution in `ctx.video` (refuse it as today's settings mismatch does).
5. **Export size follows it.** A code film's finished render uses 1080 on the short side for `1080p` and `2k`, 720 for `768p`, 480 for `480p`. Graph films keep today's sizes.
6. **Price table.** Keep `VIGGLE_PRICE_CREDITS` equal to Viggle's published table unless the lead's measured charges (added below before you start) differ; then use the measured values and cite them in a comment.

## Contract for the Settings UI

```
GET /api/projects/:projectId/code-plan/video-settings
200 { version: 1, projectId, model: "viggle-h3", quality: "high" | "low", resolution: "480p" | "768p" | "1080p" | "2k",
      options: { resolution: "480p" | "768p" | "1080p" | "2k"; pricing: VideoPricing }[],   // all four, cheapest first
      exportSize: { width: number; height: number },   // for the current resolution and the film's aspect
      appliesTo: "unsent" }
409 CODE_PLAN_VIDEO_SETTINGS_UNAVAILABLE   // not a code film, or its video model is not Viggle

PUT /api/projects/:projectId/code-plan/video-settings   body { resolution }
200 the same view, after saving   ·   400 VALIDATION_ERROR for any other value
```

`VideoPricing` is the existing `{ unit: "second", modes: { mode, microsPerSecond }[], minMicrosPerSecond, maxMicrosPerSecond }` from card F3, computed by the same function. A successful PUT wakes the film's plan so open cards and estimates refresh, and emits the event the studio already uses to refetch code-plan state.

## Tests

1. A new code film locks `quality: "high"` and reports `1080p`; a saved film keeps `low`/`768p` and buys nothing on replay.
2. Changing the resolution leaves every existing step key, attempt and artifact unchanged; the next unsent clip is submitted at the new value and charged by the table for it.
3. Card, dry-run and `read_film` prices change with the setting; an answered keyframe card keeps its answer.
4. GET/PUT shapes, the 400 and the 409; the Director's explicit resolution is refused.
5. Export sizes per resolution and aspect for code films; graph-film sizes unchanged.

## Finish

Run the code-plan, provider, catalog and route suites, then `pnpm test` and `pnpm typecheck`. Write `docs/ai/film-quality/reports/G1-report.md`.

## Measured prices (lead, 2026-11-02, `GET /v1/credits` before and after each job)

Three 5-second jobs at `quality: "high"`, `enhance: false`: first frame 768p charged 15 credits, first frame 1080p 25, reference 1080p 30. All equal `VIGGLE_PRICE_CREDITS` (1 credit = $0.01), so keep the table as it is. `quality` did not change the charge. The portal's "H3 at $0.01/sec" headline does not match any measured rate.
