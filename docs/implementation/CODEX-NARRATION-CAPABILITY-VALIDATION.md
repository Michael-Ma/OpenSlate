# Native narration capability disclosure validation

September 12, 2026. One bounded native follow-up correctly explained the missing application speech/transcription workflows while guiding the user through unfinished narration. It completed in **21.118 seconds**, passed **20/20 harness checks**, and passed **28/28 independent source/ledger/SQLite checks**. This is a positive observation from one triage case, not a general reliability claim.

The clean source was `0a95fd07b3a31afbc0c2e29e7870c8410ee1b687`. The experiment used Codex `0.153.4`, `gpt-6-astra`, low reasoning and a 90-second turn deadline. Its separate one-start allowance is exhausted: one transport start, one acknowledged completed turn, no unknown outcome or retry. Historical native starts increased from **23 to 24**. No media API was called.

## What the model received and did

The user prompt was unchanged from the earlier [stage/gap triage experiment](CODEX-STAGE-GAP-VALIDATION.md): make a 2–3 minute leather boots commercial from an accepted opening and unfinished middle/closing, discuss whether to record personally or have OpenSlate voice it, and preserve saved work. The prompt did not prescribe tools or tell the model the desired capability explanation.

The production controller, supervisor, V2 tool catalog and pinned skill snapshots remained in use. New application capability facts explicitly described unconnected speech/transcription, manually supplied timing and unchecked host import readiness. The independent audit reconstructed the exact runtime context from saved snapshot, pinned skill bytes and committed input construction, then verified its context/input hashes against the immutable native-start intent.

The model called `read_context` for overview and narration, then answered with one ordinary prose question. No structured question was required. It accurately distinguished approved script from missing recording, timing and visuals; suggested finishing/reviewing the script and measuring recorded pacing before planning shots; and preserved exact image review before video spending.

Its capability explanation addressed the earlier weakness directly:

> OpenSlate cannot currently synthesize narration—selecting a voice/profile or adding an API key won’t enable it.

It offered personal recording or an externally produced narrator, explained human upload, binding and review, identified automatic transcription/alignment as unconnected, and left import-tool readiness unchecked. It correctly described this project's selected media profiles as fixtures. It ended by asking which recording route the user preferred.

## Independent evidence

| Check | Result |
| --- | --- |
| Harness and imported helper identities | Exact hashes match the exhausted allowance; previous stage/gap allowance remains unchanged |
| Current request | Read-only `local-user`, exact saved prompt, current scoped epoch |
| Runtime input | Reconstructed exact context and native-start input digest match; capability facts are digest-bound |
| Tool work | Two successful context reads, exact request/epoch/catalog/result hashes |
| Canonical film and narration | Unchanged, including all script/revision/state rows and the accepted opening |
| Authority and media | Original seed hold retained; no grants, candidates, approvals, media attempts, reservations, recordings or cues created |
| Restart evidence | Read-only SQLite reopen is healthy and retains the single completed turn and exact response |
| Cleanup | Application closed; all three recorded native processes exited zero; exact thread archived and archive process exited |

The original report retains its unassessed subjective field. This separate assessment and sanitized JSON add interpretation without rewriting the report, ledger or earlier negative evidence. The complete response and source/report hashes are retained in `codex-narration-capability-evidence.json`.

## Limits

This was a service/HTTP-driven native run, not a new browser test. It did not generate or import audio, exercise recording quality, align timestamps or call speech/transcription/image/video APIs. Standalone audio transports existed at this source revision, but the application workflows were still unconnected; the model's disclosure is accurate at that boundary. Cleanup was audited from preserved RPC/process evidence and reopened SQLite, without new native requests. One corrected answer does not establish consistent disclosure across other prompts, contexts or future capability changes.
