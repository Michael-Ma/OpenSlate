# Reviewed transcription of owned recordings

September 13, 2026. The backend connects exact human review of a retained recording proposal to one transcription candidate. Preparation still requires no accepted script, timing or canonical narration. Browser entry points and conversational tool exposure are separate follow-through work.

```mermaid
flowchart LR
    Proposal[Saved recording proposal] --> Verify[Verify exact audio and recompile saved plan]
    Verify --> Human[Active human request with project scope]
    Human --> Transaction[One atomic publication]
    Transaction --> Review[Grant and exact review]
    Review --> Plan[Full plan and one candidate]
    Plan --> Receipt[Immutable application receipt]
    Receipt --> Allowance[Separate finite spending approval]
    Allowance --> Attempt[One admitted attempt]
    Attempt --> Prepare[Recoverable local audio preparation]
    Prepare --> Submit[One-use transcription submission]
    Submit --> Candidate[Unreviewed transcript candidate]
```

## Review and atomic publication

`OwnedTranscriptionService.review` accepts an exact proposal ID/digest and command key from an active human editing request with project scope. A director can prepare a proposal but cannot approve it. A new human request can explicitly review an older proposal while its exact inputs remain current; the source and proposal keep their original authorship. This does not transfer another request's holds or let a generic prepared change borrow a later actor.

Before any grant exists, review verifies the owned source bytes, the retained generated-audio provenance when applicable, and the exact installed artifact. It independently recomposes the complete plan in the bounded compiler worker. It compares the entire result and logical identity map with the saved proposal. It checks the original cancellation signal, current human authority, complete project head, capability lock, source/artifact digests, selected section revision/audio, stage bindings and logical IDs after asynchronous work. An unrelated narration section may change without invalidating the selected section.

The synchronous `ProductionService.commitOwnedTranscriptionReview` rechecks current input and human authority, derives the existing footprint/stage assessment, and shares the normal prepared-record and plan-publication kernels. One outer transaction creates the one-use grant, exact review, fresh human-owned prepared change, full installed plan, candidate and application receipt, releases only the reviewing request's resolved holds, and saves the command result. The original signal is checked after the final command insert and before transaction commit. Failure at any point rolls back the entire publication, including its events, identities, stages, holds and authority. No asynchronous work runs inside this transaction.

Exact successful command replay precedes current-file/head requirements, while actor and restore fences still apply. Concurrent identical review commands converge on the saved receipt. The proposal's immutable creation state remains `ungranted`; subsequent approval is separate evidence.

## Retained evidence

| Record | Key and retained proof |
|---|---|
| `owned_transcription_review` | The new grant ID; exact human request/principal, grant digest, proposal/source references, operation ID/specification and full compiled-plan digest. |
| `owned_transcription_application` | The resulting candidate ID; review/candidate digests, full prepared/plan/project-revision row references and the exact `change.applied` receipt/event cursor. |
| Attempt `applicationInput` | Immutable source-binding and application ID/digest references outside the provider request arguments. |

Store validates this acyclic closure and makes review/application records immutable. A used grant cannot acquire a later review. A candidate under a reviewed grant must retain its exact operation. An attempt cannot add, remove or change the application input after admission. Historical validation recomputes the effective operation fingerprint and checks the exact retained profile and request. Absence of this optional metadata preserves legacy request identity.

An exact review grant never enters the ordinary unused-grant pool. Installation checks every supplied reviewed grant before saved-plan replay or candidate creation. New installation requires the complete reviewed plan and its exact base-to-published project revision. Retention requires the prior active candidate, byte-identical operation and historical application receipt. Removing an application-input field cannot turn its grant into general generation permission. Literal artifact authority is checked separately from legitimate historical upstream-output reuse.

Ordinary later plan preparation receives only the validated input catalog referenced by the saved base plan. This permits recompiling an unrelated video edit while retaining the same transcription operation. The catalog cannot authorize a changed recording, language, model or candidate; those require another exact reviewed proposal.

## Execution and recovery

Review creates no attempt, reservation or spending allowance. Admission still requires a separately issued finite allowance and the existing budget/hold checks. It captures the exact candidate-to-application chain in attempt metadata. The owned source record is pinned through initial preparation proof, local derivative and final transcription mapping; another equivalent recording cannot substitute for it.

Admission and the final first-submission boundary require the selected section/audio and active operation to remain current. A superseded selection before submission settles as obsolete without a provider POST. Initial preparation can still retain positive proof that it never submitted when selection changes immediately after admission. Busy local preparation stays on the same attempt, consumed allowance and reservation; it does not create a replacement paid attempt.

After the one-use dispatch marker, actual provider observations and completed historical output recovery use the retained chain. They do not discard a valid result because the narration section later changed. Unknown submissions retain liability and never silently repeat. Transcript output remains an unreviewed candidate; recognizing words does not accept the script, audio, cues or canonical narration.

Media-inclusive backup independently verifies owned bytes, proposal recompilation and review/application/candidate/attempt closure. Restored proposals, reviews and applications join the permanent imported-authority fence. Releasing restore quarantine does not authorize first submission or create a fresh review from imported evidence. A new request may prepare a fresh proposal from the retained recording.

## Verification and remaining work

**Full checkout:** 1,593 tests passed, zero failures/cancellations/skips, with all builds/typechecks and the installed no-turn Codex probe. All 357 authored source/test/configuration/style files stayed unchanged through the full check. The 70 additions include 44 review/continuity, 11 authority/restore and 15 actual execution checks; focused runs also passed 80 existing production/preparation and 96 adjacent execution regressions. Independent review covered both human publication and Engine/preparation boundaries with no remaining findings. See [sanitized evidence](owned-transcription-review-evidence.json).

The execution fixtures imported synthetic PCM, performed real local derivative conversion and sent one injected transcription POST per successful candidate. They verified candidate-publication rollback and recovery after reopen without another provider call or conversion, unchanged narration acceptance, selected-section obsolescence at four pre-submit boundaries, late historical completion, and an actual ordinary shot edit retaining/resuming the same admitted transcription. Actual backup/restore preserved all exact authority/input records and owned bytes while maintaining permanent imported-authority fences. Initial focused failures were corrected test assumptions about explicit hold continuation, the section-edit draft shape and readonly fixture file permissions; no production assertion was weakened. No live media calls or model turns occurred. User-facing recording selection, proposal display and approval routes/UI remain next, followed by an explicit versioned conversational entry point. The existing V2 director catalog is unchanged.

See [proposal preparation](OWNED-TRANSCRIPTION-PROPOSALS.md), [overall recording sequence](OWNED-RECORDING-TRANSCRIPTION.md), [same-attempt preparation](AUDIO-PREPARATION-WAITING.md), [spending approvals](EXTERNAL-SPENDING-ALLOWANCES.md) and [transcript adoption](TRANSCRIPT-REVIEW-ADOPTION.md).
