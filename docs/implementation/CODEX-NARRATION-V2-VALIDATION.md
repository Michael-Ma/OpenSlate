# Native V2 narration validation

September 12, 2026. **One live V2 narration draft request passed all 22 checks** using Codex **0.153.4**, **gpt-6-astra**, low reasoning effort and Node **24.15.0**. The native runtime completed in **27.853 seconds**, with three successful application tool calls: `read_context(narration)` → `revise_narration_draft` → `read_context(narration)`. This timing includes native thread setup and catalog verification; it excludes the preceding application setup/upgrade and final archive.

The agent added two short drafts in one revision, preserved an existing accepted opening, and explained the remaining script review, recording, voice/profile and timing gaps. Canonical project state and both request-owned holds remained unchanged. **No media API calls occurred.** Machine-readable identities, checks, timing and source-report hashes are in [the evidence record](codex-narration-v2-evidence.json).

## What was exercised

The harness used the actual authenticated application routes, `LocalDirectorController`, `DirectorSupervisor`, `createDirectorInput`, `CodexDirectorRuntime` and loopback tool bridge. It created an independent project and native projection, installed a V1 skill lock, and saved one human-accepted script section: “Every journey begins with a first step.” Its narration version was 2; no recording or timing was attached.

An old epoch selected the original V1 lock. After fencing that epoch, the harness explicitly upgraded the project through the authenticated guidance-upgrade endpoint, supplying the exact predecessor lock ID/digest. The upgrade created a V2 successor while preserving the old immutable lock and both sets of on-disk skill snapshots. Repeating the upgrade command returned the same receipt without advancing the event cursor. This setup created no model turn and changed no creative authority or canonical state.

The subsequent human message asked for two English sections: a craftsmanship section whose recording the user would upload later, and a closing invitation with generated source intent and undecided voice/profile. It explicitly requested a narration read, one draft edit, and another read. The normal input builder selected the saved V2 lock and fresh request/epoch. The real native runtime verified the six-tool V2 catalog with the V1 and V2 snapshots coexisting.

The saved narration advanced from version **2 to 3**:

| Section | Saved text | Source intent | Acceptance |
|---|---|---|---|
| Existing opening | Every journey begins with a first step. | Undecided, unchanged | Original script acceptance preserved |
| New craftsmanship | From the texture of the leather to the precision of each stitch, craftsmanship lives in the details. | Uploaded | Draft, unaccepted |
| New closing | Find your next pair. Step into your next chapter. | Generated; voice and profile `null` | Draft, unaccepted |

All sections still had no audio or timing cues. The model neither accepted content nor created plans, prepared changes, grants, approvals, candidates, attempts or artifacts. Both the old and new epochs were revoked at completion. The narration state and completed turn matched exactly after closing the application and reopening SQLite read-only.

## Dispatch and cleanup

The full checkout check passed **539 tests, zero failures/skips**, plus builds/typechecks and the installed no-turn probe before live dispatch. A separate zero-model-turn preflight passed 17 checks and stopped deliberately before `turn/start`; it exercised the upgrade, exact catalog, authority, persistence and cleanup without spending a model start.

An independent durable allowance permitted **one** actual native start. The live run reserved that start before dispatch and recorded its acknowledgment; the result was known and no retry occurred. This allowance is exhausted. The recorded historical native-start count advances from **17 to 18**.

| Identity | Value |
|---|---|
| Application request | `d38249b1-6485-41dd-9413-012cca15c615` |
| Application turn | `6fdc8bf9-d61f-4061-8c5d-48c4b6d9614c` |
| New authority epoch | `10f4d06c-acec-4cdf-9ad6-4ecd39ee5c7d` |
| Native thread | `01a097bd-4e9c-7bf0-ad33-596780b9410d` |
| Native turn | `01a097bd-5589-7a00-ad1f-65d0adfa89c7` |
| Start reserved / acknowledged | `2026-09-12T22:29:22.870Z` / `2026-09-12T22:29:22.983Z` |

All five observed setup/runtime processes closed with exit code 0. A separate zero-turn archive request archived the native thread, and that process exited. Application/provider/database handles closed successfully. Authentication used the installed runtime's normal sign-in; the harness did not read or copy personal credential files. No production implementation changes were needed for this live run.

Earlier preflights encountered outer-sandbox filesystem denial and then a zero-turn catalog timeout while the initial highly concurrent test suite was running. Those attempts dispatched no model turns. The successful preflight used normal execution permissions after the bounded-concurrency suite passed; the production 15-second RPC deadline was unchanged. The experiment bounded runtime execution to 90 seconds.

## Limits and retained evidence

This is one explicitly directed, short drafting request. It does not establish narration quality, autonomous stage selection, long-script coverage or a general latency guarantee. Live browser drafting, speech generation, transcription, image attachment, canonical narration application and real media execution were outside this experiment. Browser narration review and guidance upgrade have separate evidence; see [narration review](NARRATION-BROWSER-VALIDATION.md) and [guidance upgrade](DIRECTOR-TOOLS-UPGRADE.md).

The development workspace retains the harness, exhausted allowance and reports under `work/openslate-live-probe/narration-v2-validation/`. The successful fixtures are `preflight-3peuzC` and `live-uv1tnH`. The committed evidence contains sanitized results and report hashes; databases, native projections, logs, credentials and generated runtime files are not committed. Implementation boundaries and offline regressions are documented in [versioned narration tools](NARRATION-TOOLS.md).
