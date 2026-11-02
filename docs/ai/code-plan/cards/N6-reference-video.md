# N6 · Reference-image video and true Viggle prices

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, no network beyond loopback, never read `.env*`, never start anything on port 3001.

## Problem

The owner wants keyframes used as **reference images**: the clip keeps the look of the picture without having to start on it. Today `ctx.video` requires `firstFrame`, and the provider path assumes one.

A live call on 2026-11-01 proved the vendor side: `POST https://apis.viggle.ai/v1/videos` with `prompt`, `quality`, `resolution`, `enhance=false`, `aspect_ratio=9:16`, `duration_s=5` and one `reference_image` file, and no frame fields, returned `status: "ready"` with a 480×864 clip.

The same check found that **Viggle prices are wrong**. Code-plan charges each clip `unitCostMicros` ($0.10). The adapter sends no `enhance`, so the vendor default (on) applies and a 6 s 768p first-frame clip costs $0.30. Spend and the limit have been understated about threefold, and Viggle has been rewriting our prompts.

## Vendor facts

**Viggle** (`docs.viggle.ai/v1/pricing.md`, `.../api-reference/videos/create-from-reference-video.md`). One endpoint; the fields sent select the mode.

- Reference: `reference_image` file part, repeated, 1–4 images, 20 MiB each. Cannot be combined with `first_frame_image` or `last_frame_image`.
- `duration_s` 5–15 in reference mode. `aspect_ratio`: 16:9, 9:16, 1:1, 4:3, 3:4, 21:9. `resolution`: 480p, 768p, 1080p, 2k, 4k. `enhance` boolean, default true.
- Credits per 5 generated seconds, 1 credit = $0.01:

| Mode | enhance | 480p | 768p | 1080p | 2k | 4k |
|---|---|---|---|---|---|---|
| text | either | 10 | 15 | 25 | 30 | 50 |
| first frame | on | 20 | 25 | 35 | 40 | 60 |
| first frame | off | 10 | 15 | 25 | 30 | 50 |
| first and last | on | 25 | 30 | 40 | 45 | 65 |
| first and last | off | 15 | 25 | 30 | 35 | 55 |
| reference | on | 35 | 45 | 50 | 55 | 75 |
| reference | off | 15 | 25 | 30 | 35 | 55 |

Cost = `ceil(duration_s) × (credits per 5 s ÷ 5) × $0.01`. `quality` and `aspect_ratio` do not change it. A task that ends `failed` or `cancelled` is not charged.

**Seedance 2.x** (BytePlus ModelArk). `content` items with `role: "reference_image"`, 1–9 images. Mutually exclusive with `first_frame` and `last_frame`. Real human faces are refused. Only the 2.0 and 2.5 families do this; Seedance 1.0 models keep first-frame only.

**fal** endpoints in `fal-video-i2v` stay image-to-video and need a first frame. Do not add endpoints.

## Change

1. **Studio input.** `ctx.video` takes `references?: Artifact[]`, and `firstFrame` becomes optional. The input selects the mode:
   - `references` non-empty: `reference`. Refuse it together with `firstFrame` or `lastFrame`.
   - `firstFrame`: `first_frame`, or `first_last_frame` with `lastFrame`.
   - neither: `text`. It requires an explicit `aspectRatio`.
   - `lastFrame` without `firstFrame` is refused.
   - Each model declares the modes it supports. Viggle: all four. Seedance 2.x: all four. Seedance 1.0, MiniMax H3 and fal: their current modes only. Refuse the rest with `CODE_PLAN_INPUT` and a message naming the modes that model has. The fake video model accepts all four.
   - Count limits are per vendor (Viggle 4, Seedance 9). References must be owned images of this film, stored in the input as content references the way `firstFrame` is, in order. Order is part of the step's identity.
2. **Step identity.** A saved plan that passes `firstFrame` must keep exactly the same step key and input. `references` appears in the input only when used. A test must prove that no existing step is repaid.
3. **Aspect ratio.** `videoAspect` uses the first reference's measured shape in reference mode, as it uses the frame today. The existing `journaledDefault` rule stays. Reference images are sent uncropped; only a first frame is cropped.
4. **Viggle adapter and execution.** Add `reference_image` parts and `enhance` to `packages/providers/src/viggle-h3.ts`, with the mode in the description and metadata digest. Code-plan calls always send `enhance=false`; it is not a Studio or profile option. An attempt saved before this change must still validate, so an absent `enhance` or `references` keeps today's digest. Carry the references through mapping, authority, receipts and `persistence/viggle-backup.ts`, and through text mode where the path assumes a frame. Graph films keep their behaviour.
5. **Seedance.** Add `reference_image` and text mode to `seedanceBody`, the execution path and the price input. With references, use the first reference's size where the price needs one.
6. **Prices.** Add one pure Viggle price function in the provider package, used by `modelPrice`, the reservation and `provider-authority.ts`, as Seedance and fal do. Viggle becomes `priceUnit: "input"` in code plans. Assert the 6 s 768p values: reference $0.30, first frame $0.18, first and last $0.30, text $0.18. `modelDescriptions` gives the Director the price basis and the model's `videoModes`. Steps already journaled keep their recorded price: history is not rewritten. A new attempt of an old step is priced by the new rule.
7. **Shot links.** `codePlanShotLinks` also links a video through its references to a `<shot>-keyframe` choice, when they point at exactly one shot.
8. **Details and views.** `CodePlanStepDetail` already declares `mode`, `references` and `lastFrame`. Fill them. Add `mode` and `enhance` to the `call.settings` allow list, and record them so they appear for new calls. `current` for an image in Assets also counts a picture used as a reached video's reference. Credits or a price reported by the vendor, if any, are not trusted over this table.
9. **Guidance** (`skills/code-plan/`, update the digest pin):
   - `references` is the default: `ctx.video({references: [frame], prompt, ...})`. Say why in one line: the clip keeps the look without having to open on that picture.
   - Use `firstFrame` only when the person asks for a clip to start or end on an exact picture.
   - In reference mode the prompt must describe the action and the camera, since the picture no longer fixes the composition, and Viggle clips need 5–15 s.
   - Update `references/studio.d.ts` and `references/example-plan.ts`. Leave `skills/code-plan-v1` alone.
10. **Tests**, offline:
    - every mode and every refusal, per model;
    - the multipart body for Viggle reference mode, with no frame field and `enhance=false`;
    - the Seedance body;
    - the price table, including rounding up a fractional duration;
    - no re-pay for a saved first-frame plan;
    - an old attempt's digest still validates, and a restart recovers a reference attempt;
    - the reservation equals the charged price;
    - a shot links through a reference;
    - the P2c end-to-end flow still passes, and `demo:code` finishes.
11. **Docs:** `docs/technical/EXECUTION-ENGINE.md` and a `docs/implementation/STATUS.md` entry.

## Files you own

`apps/server/src/code-plan/**`, the Viggle and video execution files and their receipts, `packages/providers/src/**`, `skills/code-plan/**`, tests and the docs above.

Do not touch `apps/web/**`. `packages/core/src/studio-api.ts` already has this card's contract; if it must change, list that in your report.

## Report

Write `docs/ai/code-plan/reports/N6-report.md`: what changed, the checks you ran with their results, anything you could not do, and any contract change you need.
