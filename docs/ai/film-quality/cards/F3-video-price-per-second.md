# F3 · Code films price video by the second everywhere, not by a stale clip estimate

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. F1 and F2 run at the same time: stay out of `apps/server/src/studio-launcher.ts`, `apps/server/src/index.ts`, `apps/server/src/code-plan/index.ts`, `view.ts` and `apps/web/src/**` (the lead builds the web side against section 2). You own `apps/server/src/application/provider-catalog.ts`, `apps/server/src/code-plan/models.ts`, any pricing helper they use, and their tests.

## Problem

The New film dialog and Settings › Models say Viggle H3 costs "about $0.10 a clip" (the profile's legacy `unitCostMicros`), and Settings adds "Video is priced per clip, whatever its length". In a code film the real price comes from `modelPrice`: the live run paid $0.18 for a 6-second first-frame clip and was offered $0.30 for reference modes, so per second.

## 1. What the catalog reports

For every installed video profile whose code-plan price depends on duration (Viggle H3 built-in, Seedance, fal, MiniMax: whatever `modelPrice` prices per second), the provider option gains:

```ts
pricing?: {
  unit: "second";
  /** Per input mode the code plan can use, from the same price function the keyframe cards use. */
  modes: { mode: "first_frame" | "reference" | "first_last_frame" | "text"; microsPerSecond: string }[];
  /** The cheapest and dearest of those. */
  minMicrosPerSecond: string;
  maxMicrosPerSecond: string;
};
```

Compute it from the real price function at the profile's default settings (resolution, enhance, whatever the code plan sends by default), never from `unitCostMicros`. If a mode's price is not linear in seconds, use the price of the default duration divided by that duration and say so in the report. Profiles priced per call keep no `pricing`. Add the field to the provider catalog view and to the model settings options the browser reads, typed in the route responses. Storyboard pricing and every recorded price are unchanged.

## 2. Contract for the lead

`ProviderOption.pricing` as above, on `GET /api/providers` options and `GET /settings/models` options. Document it in your report with an example for Viggle H3.

## Tests

The Viggle H3 option reports first frame and reference rates that reproduce the card prices for a 6-second clip; a per-call profile has no `pricing`; nothing recorded or charged changes.

## Finish

Run `pnpm test`, `pnpm typecheck`. Write `docs/ai/film-quality/reports/F3-report.md`.
