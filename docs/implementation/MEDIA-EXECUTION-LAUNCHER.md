# Opt-in media execution

The local launcher composes application-owned image/H3 bridges, spending admission, output storage, ingestion and real local assembly through one runtime factory. External generation is **off by default**. Installing a model profile or configuring a key does not enable a provider or issue spending permission.

The trusted startup switches are independent:

| Setting | Meaning |
|---|---|
| `OPENSLATE_ENABLE_IMAGE_GENERATION=1` | Register the image execution bridge and enable its admission path |
| `OPENSLATE_ENABLE_H3_GENERATION=1` | Register the H3 bridge, durable polling and protected downloading |
| `OPENSLATE_H3_DOWNLOAD_HOSTS` | Comma-separated exact lowercase output hostnames; required for H3 |
| `OPENSLATE_PROVIDER_CONFIG` | Existing bounded JSON model/profile configuration |
| `OPENSLATE_OPENAI_API_KEY` | Existing backend credential for the image provider |
| `OPENSLATE_MINIMAX_API_KEY` | Existing backend credential for H3 |

Only `1` enables a generation switch. Omitted, empty and `0` mean disabled; ambiguous values fail configuration validation. Output hosts cannot be wildcards, URLs, IP addresses or host/port strings. They must be established for the user's provider account; the repository does not invent a universal CDN hostname. Validation performs no DNS query. Download-time checks still require HTTPS, public pinned IPv4, bounded bytes and no redirects or credentials.

Enabled generation requires executable local FFmpeg and ffprobe. Missing media keys allow the app to open and show that the enabled route is not ready. Readiness checks happen before creating an attempt or consuming an allowance. The model catalog distinguishes host enablement, adapter registration, local tools and credential presence; it does not claim live API access has been verified.

## Composition and saved projects

The fake provider stays installed for default demo projects. One shared local media service owns uploads, narration normalization, generated-video normalization and rendering. The output spool's owned blob directory is included among its trusted import roots. Exact image/video ingestion uses dedicated handlers; fixture ingestion retains fixture provenance. Construction creates only local storage/configuration objects and performs no network call or generation-authority write.

With local tools available, real local assembly remains installed even when cloud generation is disabled, so previously rendered production work can still be verified and reused. When H3 is enabled, **new projects that select an external video profile** receive the exact local assembly pin. Default fake projects and image-only external selections with fake video retain their previous demo behavior. Existing project locks are never rewritten by startup configuration.

An older externally configured project without a local assembly pin cannot start H3 work through this launcher. Admission reports that the saved execution mode needs an explicit upgrade, before consuming an allowance or submitting video. Creating a new production project is currently the supported path; an in-place human-reviewed local execution upgrade is separate work. A key or environment switch cannot silently reinterpret an old plan.

An enabled, ready provider still needs an exact current candidate/grant, any required human keyframe review, project budget capacity and an unexpired human allowance. Admission permanently consumes that allowance's start/configured-estimate capacity in the same transaction as the attempt and reservation. A previously saved valid allowance can become usable when its provider becomes ready; toggling startup configuration does not create a new allowance or extend its expiry. Known/unknown submissions retain their existing reconciliation rules and are never blindly resubmitted.

## Validation scope

The complete checkout passed **842 tests with zero failures/skips**, all builds/typechecks and the installed no-turn Codex probe. Configuration checks prove default-off behavior, that credential presence is not an activation switch, immutable host-list capture, independent switches, sanitized errors and rejection of unsafe or ambiguous configuration. Factory checks cover missing tools/keys, dynamic credential status, actual allowance admission, exact PNG publication, historical H3 denial and one reviewed H3 submission with injected HTTP.

The full factory pipeline also passed: real human narration acceptance and canonical mapping, generated PNG bytes, independent allowance and exact frame review, one injected H3 POST/poll/download, measured video normalization, automatic real timeline/render and restart without repeated submission or rendering. The output contained 180 decoded blue frames and an audible six-second synthetic tone accepted as narration. This does not verify model creativity, vendor access or billing.

A built-browser check started both provider routes with their credential variables explicitly removed. It displayed missing-key setup, explained the historical H3 project's incompatible saved assembly mode, created a newly pinned production project and preserved default demo profiles. Saved setup and corrected conversation guidance survived restart. Authenticated API and read-only database checks verified unchanged historical state and **zero requests, holds, grants, candidates, attempts, approvals, allowances, consumptions, native starts or media dispatches** across these empty projects. The browser console was clear; all application processes were stopped afterward. Local development evidence is retained under `work/openslate-media-activation-browser` outside the repository.

H3 live calls remain deferred until its key is provided; live image/audio generation still requires an explicit test allowance. See [current status](STATUS.md) for subsequent work.

Source: `apps/server/src/application/media-execution-config.ts`, `media-execution-runtime.ts`, `apps/server/src/index.ts` and `provider-catalog.ts`. See [spending review](SPENDING-REVIEW.md), [automatic local assembly](AUTOMATIC-LOCAL-ASSEMBLY.md) and [provider credentials](MEDIA-CREDENTIALS.md).
