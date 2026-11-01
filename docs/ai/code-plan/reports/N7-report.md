# N7 report — Viggle model and video capability facts

## Done

1. Added the built-in `viggle-h3` profile beside Lyria. Enabling the existing Viggle route installs it without a provider configuration file: `MiniMax-H3`, execution version `1`, low quality, 768p, 150–450 frames (5–15 whole seconds). It uses the existing key/readiness/registry/media-tool fences, one concurrent attempt and no vendor retries. Its legacy flat estimate is $0.75; code mode continues to reserve exact N6 mode/resolution/duration prices.
2. New code-film media lists replace configured Viggle profiles with the built-in. Trusted creation selections also map a selected legacy profile to it and record the effective id in provenance. Other ready video/music profiles remain available. Configured Viggle definitions stay installed for graph and saved code-film resolution. Saved locks, normalized inputs, steps, receipts and historical prices are never rewritten.
3. Every video model description now includes `aspectRatios`, effective `durationSeconds: {min, max}` and N6's `videoModes`. Seedance and fal reuse their provider-package policy tables. The Viggle ratio list is shared by code-plan description, validation and aspect inference. Saved six-second profiles report 6–6 seconds and all six ratios. Veo additionally reports `durationValuesSeconds`, intersecting its discrete choices with the saved profile. Profiles with no duration in today's vendor interval report null min/max instead of an inverted range.
4. Profile duration validation now runs during normalization/dry run as well as argument translation, so four- and sixteen-second built-in requests fail before any attempt or provider submission and name the 5–15-second range. Existing historical profile bounds remain intact.
5. Current guidance makes `read_film.models` authoritative for ratios, lengths and modes, disallows asking a person/maintainer to verify model capabilities, uses a ten-second pricing example and requires measured output facts after generation. `read_film.steps[].output` now exposes the same owned measured facts as step details, so the Director can follow this instruction with its existing tools. Requested dimensions are never substituted for measured output. Current guidance digest: `f27fdffe86fbfee8d8c53084283557b417060bab5228cc45ebd650ec3ed23912`. Archived `skills/code-plan-v1` is untouched.
6. Updated `docs/technical/EXECUTION-ENGINE.md` and `docs/implementation/STATUS.md`; this report is the lead handoff.

## Files

Added:

- `apps/server/src/code-plan/video-capabilities.ts`
- `apps/server/test/code-plan-viggle-model.test.mjs`
- `docs/ai/code-plan/reports/N7-report.md`

Changed:

- `apps/server/src/application/provider-catalog.ts`
- `apps/server/src/application/service.ts` — supporting one-line creation-mode argument, required to distinguish new code selections from graph selections.
- `apps/server/src/application/director-capabilities.ts` — supporting update of the card-required current guidance digest pin.
- `apps/server/src/code-plan/artifacts.ts`
- `apps/server/src/code-plan/director.ts`
- `apps/server/src/code-plan/identity.ts`
- `apps/server/src/code-plan/models.ts`
- `apps/server/src/code-plan/provider-input.ts`
- `apps/server/src/code-plan/step-detail.ts`
- `apps/server/test/code-plan-providers-fixture.mjs`
- `apps/server/test/video-models.test.mjs`
- `skills/code-plan/SKILL.md`
- `docs/technical/EXECUTION-ENGINE.md`
- `docs/implementation/STATUS.md`

Deleted: none. No web source, browser contract, example JSON, provider transport, DDL or schema version changes.

## Tests

Added **11 tests** in `code-plan-viggle-model.test.mjs`: config-free installation and readiness; replacement/deduplication/provenance and graph preservation; actual new-film pins with/without a configured legacy profile; ten-second vertical dry run, exact $0.50 reference reservation, wire values, measured facts and restart reuse; four-/sixteen-second refusals in all modes without effects; saved six-second lock/step/price retention; all installed Seedance/fal capability rows through `read_film`; profile/discrete duration intersection; empty legacy intersections; both five-/fifteen-second boundaries for all four Viggle modes and N6 prices; graph profile/quote preservation.

Rewrote **one existing assertion group** in `video-models.test.mjs`: new films now expect the selected Viggle model to be `viggle-h3`, while retaining the existing graph assertion. The shared provider fixture explicitly loads a historical saved lock by default, preserving the older three-second adapter/recovery regressions; `newFilm: true` exercises real N7 creation. No tests were deleted or disabled. Existing double-submission, unknown-outcome, retry, authority, price and replay protections remain exercised.

Final verification results:

- `pnpm setup:test-media` — passed; FFmpeg/ffprobe 8.1.1 were already available locally, with no download.
- `pnpm check:toolchain` — passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders.
- `pnpm build` — all five workspace builds passed on final source. Existing Vite chunk-size and ineffective-dynamic-import warnings remain warnings.
- `node scripts/run-tests.mjs apps/server/test/code-plan-viggle-model.test.mjs apps/server/test/video-models.test.mjs apps/server/test/code-plan-director.test.mjs apps/server/test/code-plan-assets-prompts.test.mjs apps/server/test/code-plan-providers.test.mjs apps/server/test/code-plan-reference-video.test.mjs apps/server/test/code-plan-retry.test.mjs apps/server/test/code-plan-music.test.mjs apps/server/test/code-plan-shots-posters-limit.test.mjs apps/server/test/provider-catalog.test.mjs apps/server/test/code-plan-port.test.mjs apps/server/test/code-plan-e2e.test.mjs` — **228 passed / 0 failed / 0 skipped**.
- `pnpm test` — **4,875 passed / 0 failed / 1 optional native-probe skip (4,876 total)**; completed normally on final source in 767.94 seconds. Its included rebuild also passed all five workspaces.
- `pnpm -r typecheck` — **all five workspace typechecks passed**, zero failures.
- Current and archived code-plan source package digests match their compiled pins; `git diff --check` passed. Ownership diff confirms no web, browser-contract, archived-guidance or example changes.

Verification is offline: synthetic in-memory transports, disposable local state, loopback test services and local FFmpeg/ffprobe. The ten-second synthetic returned clip is measured at 160×288; its wire request is 9:16. This establishes request/price/reconciliation and measured projection behavior, not real Viggle quality, dimensions or billing acceptance. No browser check, real provider/native-model call, non-loopback network, protected-state read or port-3001 listener was used.

A preliminary focused gate passed 131/131. The first full run was superseded and interrupted after self-review added the empty-interval correction and Director output projection; it is not final acceptance evidence. Its one observed empty-interval regression was testing new test source against the earlier build and is covered again by the final gates below.

Final logs are local disposable evidence: `/private/tmp/openslate-n7-build-final.log`, `/private/tmp/openslate-n7-focused-final.log`, `/private/tmp/openslate-n7-full-final.log` and `/private/tmp/openslate-n7-typecheck.log`.

## Review

Self-review checked profile identity/provenance, saved-lock resolution, graph callers, dry-run versus dispatch validation, exact N6 pricing, capability intersections, measured-output ownership, current/archived guidance pins and scope. It found and fixed two material issues before final validation: an empty vendor/profile duration intersection could report an inverted range, and the Director needed measured output facts in `read_film` to follow the new guidance. The measured-output helper is shared with step details to avoid a second interpretation of those facts. The final diff and ownership checks found no remaining material issues.

## Contract changes

`packages/core/src/studio-api.ts`: **none**. No shared port or tool catalog/schema/version changes are needed.

The existing free `read_film` response gains video `aspectRatios`, `durationSeconds` and optional `durationValuesSeconds` in model rows, plus optional owned measured `output` in its step rows. These additive server-side projections do not alter browser view shapes, execution identities or authority.

## Proposed commits

No commits or pushes were made, per the card rules. Suggested split for the lead:

1. `feat(code-plan): install Viggle model and expose video capability facts`
   - `apps/server/src/application/provider-catalog.ts`
   - `apps/server/src/application/service.ts`
   - `apps/server/src/code-plan/{artifacts,director,identity,models,provider-input,step-detail,video-capabilities}.ts`
   - `apps/server/test/{code-plan-providers-fixture,code-plan-viggle-model.test,video-models.test}.mjs`
2. `docs(code-plan): use model facts for Viggle planning`
   - `skills/code-plan/SKILL.md`
   - `apps/server/src/application/director-capabilities.ts`
   - `docs/technical/EXECUTION-ENGINE.md`
   - `docs/implementation/STATUS.md`
   - `docs/ai/code-plan/reports/N7-report.md`

## Open issues and lead checks

- No unfinished N7 implementation or failing final checks remain.
- The built-in uses 16:9 as its profile fallback to satisfy the existing strict settings validator. All six ratios remain available; code input overrides/inference follow N6.
- A custom configured definition that collides with the new `viggle-h3` identity is refused unless it exactly matches the built-in. Distinct historical ids such as `viggle-live-six-seconds` remain untouched. This prevents ambiguous profile identity; the lead should retain that reserved-id policy when integrating.
- The two supporting application-file edits above are necessary for the card's creation mapping and digest update; they are explicitly called out for lead review.
- Real-provider acceptance and browser checks are outside this card's permitted scope. The lead owns integration and committing this worktree.
