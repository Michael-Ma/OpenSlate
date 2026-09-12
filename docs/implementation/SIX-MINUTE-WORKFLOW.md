# Six-minute synthetic workflow acceptance

September 12, 2026. The standalone offline probe passed a **60-shot, 360-second plan** through the application compiler, durable fake executor, exact review, a one-shot revision and restart recovery. It makes no native model or media API calls. Creative records, cue acceptance and review decisions are explicitly simulated. Its fake video and final preview files are one-second fixtures; this is not a generated six-minute film.

The separate [physical six-minute render](MEDIA-INTEGRATION.md) exercises decoded picture/audio timing. Both checks are needed: the renderer cannot establish generation authority/reuse, and the fake workflow cannot establish media quality or physical duration.

## Scenario and assertions

The fixture creates an application capability lock and seeds sixty six-second shot intents with sixty accepted synthetic cues. One physically six-second silent recording supplies the fixture cues. It then uses normal application request, authorization, preparation and application services to install a plan with **122 operations**: sixty images, sixty videos, one timeline and one render. Sixty exact review members guard the video operations.

Canonical plan source round-trips to the same graph. Appending one more six-second take is rejected by the six-minute duration cap. All sixty keyframes complete before any video is submitted. A simulated human approves four displayed batches of fifteen; after each batch, only those approved members have video attempts. The normal fake-profile concurrency limits remain two per profile.

After initial completion, a scoped request changes shot 30 to stitching detail. Its replacement plan has **four replaced nodes** (image, video, timeline, render) and **118 reused media nodes**. The other 59 shot records, scenes, canonical narration, cues, candidate IDs and output identities remain unchanged. The new video stays blocked until its exact replacement image is approved.

The fake provider then accepts that replacement video and deliberately loses its response. The application and provider databases close and reopen. Recovery reconciles the original uncertain attempt, preserves all unaffected outputs and completes the new assembly without resubmission. Total fake accepts are **120 initially and 122 after the edit**, with zero duplicate accepted attempts. All 122 current output hashes verify; the previous keyframe remains in history.

## Observed timings

One macOS arm64 run under Node 24.15.0 recorded:

| Work | Time |
|---|---:|
| Initial plan preparation, including isolated compiler | 509.8 ms |
| Initial plan application | 733.2 ms |
| All sixty fake keyframes | 19.77 s |
| Four review batches and sixty fake videos | 16.97 s |
| Scoped edit preparation | 445.4 ms |
| Scoped edit application | 322.1 ms |
| Restart reconciliation and replacement assembly | 238.6 ms |

These measurements include local SQLite/file work on a shared development machine. They are not cloud-generation latency, an end-to-end performance guarantee or a peak-memory benchmark. Machine-readable counts and timings are in [the evidence record](six-minute-workflow-evidence.json).

## Reproduce

```sh
pnpm probe:workflow /absolute/path/to/a/new/probe-directory
```

Use Node 24 and pnpm 10.33.0. Omitting the directory creates a new temporary directory. The probe refuses an existing application/provider database and retains its synthetic state and `workflow-summary.json` for inspection. It is separate from the ordinary test suite because it runs the full sixty-shot state machine. No credentials or media API allowance are needed.

This does not validate autonomous story/narration planning, real provider output, real paid-job reconciliation, captioning, export/import or the complete six-minute product experience. The real boots-commercial and generated six-minute acceptance remain gated on connected providers and approved live spending.
