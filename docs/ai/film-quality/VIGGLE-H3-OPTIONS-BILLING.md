# Viggle H3 options and billing investigation

Date: 2026-11-03 (America/Los_Angeles).

## Why $0.01/second is misleading today

The search-index version of Viggle's developer page still advertises $0.01/s at 480p–2K. Fetching the current page and pricing reference gives a different, mode-specific table. The installed OpenSlate provider table already matches that current reference. This establishes a stale public price claim, but not when the vendor changed its rates.

Official sources:
- https://docs.viggle.ai/v1/pricing
- https://docs.viggle.ai/v1/api-reference/videos/create-from-text
- https://docs.viggle.ai/v1/api-reference/videos/create-from-reference-video
- https://viggle.ai/developers

## Complete H3 price table

USD per **5 generated seconds**; one credit is $0.01. These are documented rates; live observations are recorded separately below.

| Mode | enhance | 480p | 768p | 1080p | 2k | 4k |
|---|---|---:|---:|---:|---:|---:|
| Text | either | .10 | .15 | .25 | .30 | .50 |
| First frame | false | .10 | .15 | .25 | .30 | .50 |
| First frame | true/default | .20 | .25 | .35 | .40 | .60 |
| First + last frame | false | .15 | .25 | .30 | .35 | .55 |
| First + last frame | true/default | .25 | .30 | .40 | .45 | .65 |
| Reference images/video | false | .15 | .25 | .30 | .35 | .55 |
| Reference images/video | true/default | .35 | .45 | .50 | .55 | .75 |

Cost = ceil(requested seconds) × (table cell / 5). The minimum documented duration is 5 seconds, maximum 15, default 5. OpenSlate's adapter still accepts text durations from 3 seconds in local validation; this investigation does not establish live acceptance below the current documented minimum.

## Options

- Mode is selected by input fields, rather than a `mode` form field: no images for text; `first_frame_image` for first frame; add `last_frame_image` for first+last; `reference_image` and/or `reference_video` for references. Upload and corresponding URL forms exist. Reference supports up to four images and one video; frame and reference fields cannot be mixed.
- `quality`: required `low`/`high`; changes generation speed/fidelity, not published price.
- `resolution`: 480p, 768p (API default), 1080p, 2k, 4k; changes price.
- `enhance`: optional prompt rewrite, defaults true at the API. Changes conditioned-mode price substantially. Code films explicitly send false.
- `duration_s`: requested generated duration, independent of reference-video length; billed rounded up to a whole second.
- `aspect_ratio`: 16:9 (default), 9:16, 1:1, 4:3, 3:4, 21:9; no price effect documented.
- `seed`: nonnegative integer, omit for random generation; does not select a price tier.
- `watermark`: false by default; burns a watermark when true; no separate published price tier.
- `priority`: documented server queue tiers 1000/0; no separate published H3 price tier. Not exposed by the OpenSlate adapter.
- Native audio is included; there is no separate H3 audio toggle or audio fee.
- File-vs-URL transport does not select a documented price tier.
- The same `/videos` endpoint also supports Viggle-Animate (character images + driving video), a separate model with normal/planner rates; it is not an H3 mode. Video Remix `/renders` is also a separate product still priced at $0.01 per character/output second.

## OpenSlate behavior and removal

New code films default to high/1080p, with explicit enhance=false. At 1080p this means $0.05/s for text/first frame and $0.06/s for first+last/reference; six seconds costs $0.30/$0.36. Lowering quality alone saves no money. Lowering resolution or avoiding unnecessary reference mode does.

Removed `viggle-live-six-seconds` from both live-provider example catalogs. Its label was the source of “Use Viggle H3 · first 6-second live shot”. The built-in Viggle model remains available when its execution route is enabled. Saved project locks retain historical definitions and are intentionally not rewritten. A running server needs to reload/restart with the changed catalog.

## Verification

- Both changed JSON catalogs parse; obsolete profile absent (4 and 10 remaining profiles).
- Existing provider tests: 31 passed, zero failed, against the existing built artifacts in the original checkout. No provider source changed.
- `git diff --check` passed. Self-review: deletion only; both catalog copies handled, saved locks unaffected. No web code or browser contract changed.
- Full build/test/typecheck were not rerun for this JSON-only change.

## Live measurements

The 40-case matrix (4 modes × 5 resolutions × enhance false/true), one high-quality text case, and one reference-video case all reached ready: **42/42 successful**. Four additional isolated first-frame checks also reached ready and individually matched published charges: 480p/on 20 credits; 768p/off 15; 768p/on 25; 1080p/off 25 (85 credits total). A final isolated reference-video repeat is recorded in the evidence.

The initial 42 cases have a published-price total of **1,380 credits ($13.80)**, but the account balance moved from 7,995 to 6,560: **1,435 credits ($14.35)**. That is an unexplained **55 credits ($0.55)** above the table sum. The difference appears as 40 credits during the initial first-frame group and another 15 during the reference-video test. The first-frame discrepancy did not recur in isolated repeats. Do not describe the whole matrix as individually verified billing or claim the vendor definitively overcharged: GET Video exposes no per-job charge, and the shared account balance may include other operations. Listing videos showed the expected test task identities; other resource operations were not exhaustively audited. No task was blindly resubmitted.

The reference-video request uses a synthetic 5-second blue 640×360 H.264 clip, high quality, 480p, enhance=false, seed=0, aspect_ratio=9:16, watermark=true and priority=0. The image matrix uses a synthetic blue 640×360 PNG, low quality, 5 seconds, seed=42, 16:9 and watermark=false. These establish parameter acceptance and account observations, not creative quality, actual output dimensions/audio/watermark fidelity, or reproducibility from a seed. The high-quality text case completes quality-value coverage. Duration rounding and all ratio values have offline tests/documentation coverage, not an exhaustive live Cartesian product. URL inputs, reference counts 2–4, omitted-enhance defaults, all durations, and every priority/ratio combination were not live tested.

Credit reads immediately after acceptance can still show the previous balance; prefer terminal/final observations. Driver restarts reused recorded task IDs and skipped completed indices. A driver's finish.expectedCredits is only its resumed subset; use the deduplicated intent sum for the full run.

The evidence JSON contains task IDs, submitted option tuples, terminal states and account snapshots; no credentials, media or signed URLs. All experiments stay below the $20 authorization bound. No provider code or price table was changed based on an unexplained balance difference.

Final result: **47/47 ready**, no failed or unknown jobs left. Account balance 7,995 → 6,460, a decrease of **1,535 credits ($15.35)**. Published total for all deduplicated intents: **1,480 credits ($14.80)**. The five isolated repeats each match their published rate (100 credits total); the original unexplained 55-credit difference remains. Reference-video repeat: 6,475 → 6,460, exactly 15 credits.

Evidence: [VIGGLE-H3-LIVE-EVIDENCE.json](VIGGLE-H3-LIVE-EVIDENCE.json).
