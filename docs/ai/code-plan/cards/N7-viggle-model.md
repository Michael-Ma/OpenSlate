# N7 · A real Viggle model, and video models that state what they can do

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, no network beyond loopback, never read `.env*`, never start anything on port 3001. N6 is merged; build on it.

## Problem

The owner's Director said it could not confirm that `viggle-live-six-seconds` supports 9:16, and told the owner to ask a maintainer. Both the limit and the doubt are ours:

- **The six seconds are not Viggle's.** `viggle-live-six-seconds` is a manual validation profile from 2026-09-14 ("first 6-second live shot") in `examples/live-provider-profiles.example.json`, with `minFrames` and `maxFrames` both 180. Every code film inherits it, so every clip is exactly 6 s.
- **Viggle does vertical.** Its API takes six ratios for every mode, and real calls returned 768×1344 (October 30) and 480×864 (November 1).
- **The Director cannot see any of this.** `read_film.models` reports only `minFrames` and `maxFrames`.

Viggle allows `duration_s` 5–15 in every mode (`docs.viggle.ai/v1/api-reference/videos/create-from-first-last-frame.md`).

## Change

1. **Built-in profile.** In `provider-catalog.ts`, beside `LYRIA_PROFILE`, add `VIGGLE_PROFILE`: id `viggle-h3`, adapter `viggle-h3`, `executionVersion: "1"`, model `MiniMax-H3`, `quality: "low"`, `resolution: "768p"`, `minFrames: 150`, `maxFrames: 450`. It needs only the Viggle route and key the studio already has, so it must not depend on the owner's config file, which lives in the main checkout and cannot be changed from here.
2. **New code films use it.** `codeMediaProfiles()` replaces every configured `viggle-h3` profile with `VIGGLE_PROFILE`, and a selection of a replaced profile maps to it. Configured profiles stay in the catalog, so graph films and saved code films resolve exactly as before. Saved films keep their lock, their steps and their prices.
3. **Models say what they can do.** `modelDescriptions` adds to every video model `aspectRatios` and `durationSeconds: {min, max}`, beside `videoModes` from N6. Keep each vendor's list in one place, and intersect with the profile, so `viggle-live-six-seconds` reports `{min: 6, max: 6}` and all six ratios.
4. **Guidance** (`skills/code-plan/`, update the digest pin): `read_film.models` is the full truth about a model's ratios, lengths and modes. Use it. Never ask the person or a maintainer to confirm a model's abilities. Check a real clip's size from the step's facts after it is made. Remove any wording that implies six seconds. Leave `skills/code-plan-v1` alone.
5. **Tests**, offline:
   - a new code film pins `viggle-h3` and not the six-second profile, and a selection of the six-second profile maps to it;
   - a saved film with `viggle-live-six-seconds` keeps its lock and its steps and buys nothing;
   - a plan with a 10 s 9:16 clip dry-runs, is priced by the N6 table and dispatches `duration_s=10` and `aspect_ratio=9:16`;
   - 4 s and 16 s are refused with a message giving the range;
   - `read_film.models` lists ratios, lengths and modes for Viggle, Seedance and fal;
   - the graph path is unchanged.
6. **Docs:** `docs/technical/EXECUTION-ENGINE.md` and a `docs/implementation/STATUS.md` entry.

## Files you own

`apps/server/src/application/provider-catalog.ts`, `apps/server/src/code-plan/**`, `skills/code-plan/**`, tests and the docs above. Do not touch `apps/web/**` or the example JSON files.

## Report

Write `docs/ai/code-plan/reports/N7-report.md`: what changed, the checks you ran with their results, anything you could not do, and any contract change you need.
