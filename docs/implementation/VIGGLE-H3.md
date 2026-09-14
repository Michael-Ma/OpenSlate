# Viggle H3 integration

September 13, 2026. Offline integration is implemented and verified. Live generation is explicitly on hold and has not been validated.

The first live H3 provider for OpenSlate is Viggle. It uses a separate `viggle-h3` execution identity and `viggle-video` credential alias. Existing MiniMax-direct project locks and historical receipts retain their original meaning.

## Local key setup

Create `.env.local` in the repository root and set:

```dotenv
OPENSLATE_VIGGLE_API_KEY=your_project_api_key
```

This file is ignored by Git. Do not put the key in browser configuration, prompts, fixtures, logs or chat. The empty [.env.example](../../.env.example) contains the supported alias. Key presence is readiness information, not generation authorization. The ordinary launcher does not automatically load this file; an explicitly configured server/test process must load it, for example with Node's `--env-file=.env.local` option. The new route uses separate settings:

```dotenv
OPENSLATE_ENABLE_VIGGLE_H3_GENERATION=1
OPENSLATE_VIGGLE_H3_DOWNLOAD_HOSTS=storage.googleapis.com
OPENSLATE_PROVIDER_CONFIG=examples/viggle-provider-profiles.example.json
```

The hostname above is the host in Viggle's documented example output; live validation must confirm the account's actual output host. A different host is not automatically trusted. The [example profile](../../examples/viggle-provider-profiles.example.json) reserves a conservative $0.15 upper estimate per attempt for its maximum 15-second duration. It is not a per-second setting or a spending allowance. A live-test fixture should instead pin one exact short duration.

After a successful build, the explicit local startup command is:

```sh
node --env-file=.env.local apps/server/dist/index.js --serve-web
```

Choose the Viggle profile when creating a new project. Existing project profile locks are preserved; starting the server never migrates a MiniMax-direct project to Viggle. Provider activation does not bypass keyframe review, generation permission or the separate spending allowance. Keep the generation switch off during the current manual-review stage.

## Initial scope and contract

The initial application path sends the exact human-reviewed, locally owned PNG as a multipart first-frame file. It does not require public image hosting. Text-only and optional last-frame support belong to the transport; reference/character-animation modes are outside this slice. Unsupported creative options must fail explicitly rather than silently change generation mode.

The [create-video contract](https://docs.viggle.ai/v1/api-reference/videos/create-from-text) accepts `POST https://apis.viggle.ai/v1/videos` with a Bearer project key, a nonempty prompt, quality, duration and output settings. First-frame field presence selects image conditioning. Duration is 3–15 seconds; quality is low/high; resolution is 480p/768p/1080p. Generated video includes native audio. OpenSlate retains the raw provider file, but its current `silent-h264-30fps-v1` normalization removes clip audio and renders separately accepted narration. Native H3 audio is therefore not yet part of the assembled soundtrack; preserving or mixing it needs a later explicit audio-policy change.

The POST acknowledges a queued `vid_` identity. [Get Video](https://docs.viggle.ai/v1/api-reference/videos/get) supplies processing state and the completed signed download URL. It does not confirm the requested model, duration or resolution; OpenSlate retains requested settings separately and measures downloaded media before accepting it.

## Execution and recovery

1. Validate the consumed human allowance, full pinned profile, candidate, exact reviewed frame and current operation.
2. Prepare bounded PNG bytes; persist the semantic request and exact multipart digest/length.
3. Recheck the original lease, cancellation, current selection and edit holds; persist the one-use dispatch marker before one POST.
4. Persist the accepted video ID or uncertain outcome. A timeout, malformed reply or ambiguous server failure never authorizes another POST. `X-Request-Id` is correlation, not documented idempotency.
5. Poll the saved ID under a durable claim/cooldown. Retain late observations even when an edit supersedes their intended use.
6. Download through the protected host-allowlisted downloader, without API credentials. An expired signed URL permits a later GET of the same job and a new immutable locator receipt.
7. Verify the exact winning receipt/task lineage, normalize locally, and publish a reusable take. Winning local bytes recover without another provider call.

Store validation and media-inclusive backup inspection must preserve the same chain. Valid unresolved dispatches and accepted jobs remain recoverable records; restoration never grants permission to submit imported attempts for the first time.

## First live-test allowance

The user approved **up to $1 total** for the initial Viggle tests, then explicitly put live Viggle API testing **on hold**. Do not run live tests until the user resumes them, even if a key is configured. No call has used this allowance. Other image/audio providers are not covered.

The supplied contract and the independently checked [pricing page](https://docs.viggle.ai/v1/pricing) state one credit ($0.01) per rounded-up generated second for both qualities. The public rate makes a three-second test $0.03; this is not evidence of an actual account charge. Before a live POST, verify the applicable account rate and use an exact short-duration profile. The existing `unitCostMicros` field reserves a flat per-attempt upper bound, not a per-second rate. Maintain a cumulative test ledger; count uncertain submissions conservatively against the ceiling and never retry them blindly. Start with one candidate and one authorized attempt. A key alone does not remove the separate application review and spending gates.

## Offline verification

The transport passes 25 injected-HTTP checks, including exact multipart identity, accepted/terminal states, bounded cancellation, one submission and rejection of PNG tags with non-ASCII high bits. Application configuration, credential aliases, model selection, spending display and runtime preflight pass 75 focused checks. Invalid per-shot overrides leave the reviewed allowance unused; whole-second duration and pinned profile boundaries are checked before admission.

Four backup tests use actual synthetic video, local FFmpeg, SQLite backup and same-root restore. Both a published normalized take and a filesystem completion saved before SQL publication recover without another provider call or conversion. Missing completed-job evidence, changed reviewed image bytes, altered multipart identity and foreign record identities prevent backup publication. A saved normalization intent cannot substitute for missing provider evidence.

The shared fixture independently passed reviewed PNG import, exact human frame approval, a finite spending allowance, one injected submission, completed download and real measured normalization. These are offline integration checks, not live generation quality, latency, billing or account/CDN validation. The complete repository passes 1,725 tests, builds and typechecks, including the installed no-turn Codex probe. All 376 captured source/test/configuration/style files remained unchanged. Twenty-four bridge checks additionally cover stale workers and holds, unknown submission/reopen, late accepted evidence, polling claims, expired locators, custom-ingester bypasses and the exact historical human approval command.

## Manual testing gate

Finish offline Viggle integration and conversational audio preparation/review first. The user will manually test those flows before real production validation or release work. Keep all live Viggle calls on hold, even with a configured key. Real speech, transcription and image tests also need a separate explicit allowance.
