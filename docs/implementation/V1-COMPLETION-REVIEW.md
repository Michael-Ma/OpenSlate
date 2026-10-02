# October 1 workflow completion and code review

This milestone implements the seven workflow items requested after the storyboard rebuild. It is a local development milestone; remaining provider and user acceptance gates still apply. Runtime evidence uses disposable projects, synthetic media and bounded native Codex turns. No paid media API call was made.

## Delivered scope

| Requested item | Result | Boundary |
|---|---|---|
| 1. No narration through generation | Explicit none plus no cue uses planned shot frames, review and provider duration contracts | Undecided narration remains blocked; no silent recording is fabricated |
| 2. Compact shot audio | Script-first or recording-first upload/generate, listen, exact binding/range and explicit acceptance | Advanced narration/transcripts remain available; recorded sources are not padded |
| 3. Covering continuation | A fresh human request can continue all fully covered saved edits atomically | Revision/hold proof, owner and scope checks remain; no automatic grants |
| 4. Guided generation | Plan → keyframes → clips → export with relevant next action and exact spending candidate | Generation, cost/usage and returned-frame/motion approvals retain separate authority |
| 5. Timeline sound | Muted picture with accepted narration/music, seek/pause/buffering and revision cleanup | Browser clock preview; FFmpeg is the exact final output |
| 6. Recorded voice | Provider-neutral project identity, explicit consent/revocation and existing eligible OpenAI custom-ID dispatch | New sample enrollment and ElevenLabs speech require provider/account choice; no biometric upload or live synthesis yet |
| 7. First-run setup | Private no-overwrite config template, redacted doctor, prerequisite remedies and fail-fast provider setup | Source checkout launcher; broader OS packaging remains pending |

Existing projects keep their saved director tools. For conversational per-shot writing, enable V4 from Project settings → Director → Project guidance → Enable audio planning after active work finishes.

The owned audio library imports and auditions music/recordings without changing narration, creating creative holds or fencing the director. Short voiceover stays within the planned 3–15 second picture. Compact placements follow shot/scene order; existing absolute narration keeps its saved placement.

## Review findings resolved

| Severity | Defect | Resolution and evidence |
|---|---|---|
| P1 | Silent shots required a measured audio cue | Shared explicit video-timing contract; silent, undecided, exact legacy and within-shot tests |
| P1 | An old stock/text speech proposal could survive a shot narration edit | Mapped current script/mode/voice/pending checks at review, admission and dispatch; no stale reservation or provider POST |
| P1 | A compact audio session could alter other sections or borrow broad edit scope | Immutable shot scope and section pin; cross-section, collection, shared-section and foreign-hold rejection tests |
| P1 | Stop/edit/selection races after asynchronous image preparation could still send old provider work | Shared current-selection first-dispatch guard for image/video adapters; negative dispatch proof releases only work positively known unsent |
| P1 | Short narration shortened or blocked the picture | Protected within-shot overlay timing retains planned frames and original audio range; actual one-second voice/six-second FFmpeg proof with and without music |
| P1 | A second accepted narration could leave the existing timeline/render plan stale | Trusted bounded AST rebase refreshes only canonical audio and derived assembly; successive two-voice regression preserves picture specs, review gates, grants and attempts |
| P1 | Adding a schema field changed saved tool catalog identities | Immutable legacy schemas retain exact V1–V3 hashes; V4 carries the extension with explicit upgrades and preserved epoch bindings |
| P1 | More than eight individual shot recordings could not export | Separate 65-source/65-placement and eight-simultaneous-lane bounds; actual 65-placement synthetic mix and six-minute document tests |
| P2 | Unrelated progress could invalidate reviewed generation, while new holds needed explicit freshness | Head/revision/control and relevant hold digest; Stop/resume and newly held edit rejection tests |
| P2 | A newly rendered artifact could momentarily display the previous blob under a new identity | Synchronous identity/API/abort gating before exposing URLs; stale frame and audio range review tests |
| P2 | All storyboard videos and narration sources could be retained at once | Viewport media release, indexed Timeline data and eight-entry current/upcoming audio cache with late-result cleanup |
| P2 | Reconfirming unchanged prompts during narration writing changed the visual revision | Classify actual field changes; focused tests and a native V4 turn reproduce unchanged prompts while preserving the visual revision |
| P2 | Request lineage traversed history repeatedly | Bounded queue traversal with cycle handling and a 1,500-request test |

Review covered application commands/continuation, compiler/workflow contracts, provider admission and execution, narration/canonical state, local media/rendering, browser state/preview and local setup. It was an implementation and failure-boundary review, not an independent security certification or subjective media-quality assessment.

## Verification

**Final `pnpm check`: 2,173 passed, zero failed, one optional native probe skipped.** All workspace builds and typechecks passed under Node 24.15.0 and pnpm 10.33.0. Focused checks include 135 V4/core/upgrade/compact tests, 29 audio/canonical/FFmpeg tests and 26 image transport tests.

Four bounded native Codex turns completed during this milestone: initial silent/continuation context, initial scoped writing, a V4 rehearsal that exposed unchanged-prompt revision churn, and the final V4 fix proof. All used Codex 0.153.4 / gpt-6-astra and created zero grants, media attempts or provider media jobs. One setup attempt stopped before any turn. The final V4 proof made five successful registered calls and preserved both reconfirmed prompts, the visual revision and other shot.

- [Native silent/covering-edit context evidence](silent-continuation-native-evidence.json): one completed native turn; no grants, attempts or media jobs.
- [Disposable browser evidence](studio-browser-evidence.json): two accepted one-second recordings keep six-second shots; future second-cue playback, music import, covering permission, V4 upgrade and 390px layout passed. Screenshots are saved outside Git.
- [V4 native discovery](scoped-narration-v4-native-discovery.json): known completed rehearsal retained as failure evidence before the changed-field fix.
- [Native selected-shot writing evidence](scoped-narration-native-evidence.json): one completed writing turn; preserves the other shot, visual revision and narration collection; no fabricated cues or grants.
- [Shot audio and Timeline](SHOT-AUDIO.md): acceptance, relative placements, cache, local rendering and source bounds.
- [Owned audio library](AUDIO-LIBRARY.md): actual normalization, ownership, replay and interrupted publication recovery.
- [Personal voice](PERSONAL-VOICE.md): exact provider-ID mapping, consent, revocation and durable speech authority tested offline.
- [First-run setup](LOCAL-SETUP.md): doctor/private config and provider readiness contracts.

## Remaining work

New voice enrollment requires the user’s provider/account choice and explicit sample-upload consent. A complete native conversation-to-film run, live speech/transcription/API-image checks, longer real multi-shot production, and user quality acceptance remain unverified. They require suitable provider access and finite current test allowances.

Waveforms, richer timeline editing/transitions, music looping/fades/ducking, streaming large previews, portable relocation and broader OS packaging remain later scope. V0 still runs on one computer. Existing provider keys and old test allowances do not authorize new paid runs.
