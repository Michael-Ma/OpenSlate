# Native narration stage and gap validation

Validated September 12, 2026, on commit `1db5bcff80142c0499c8b983d0b753ab8f42d804`, with a clean checkout. Two actual native turns used Codex **0.153.4**, `gpt-6-astra`, low reasoning and the normal local sign-in. Each had a 90-second runtime deadline. Both finished, their threads were archived, all native/application processes closed, and read-only database reopen checks passed.

**The objective checks passed, with a capability-disclosure limitation in both responses.** Codex chose useful narration work from ordinary user requests and saved partial narration. It preserved accepted material and application authority. However, its guidance did not clearly distinguish planned built-in speech generation from a capability that can already be enabled through provider configuration.

Machine-readable evidence: [separate audit and semantic assessment](codex-stage-gap-evidence.json). This assessment supplements the original reports; it does not rewrite their results.

## What was exercised

Each case used a separate disposable project, the real `LocalDirectorController`, supervisor, saved native selection, default V2 skill/tool lock, normal input builder, authenticated application bridge and narration service. Prompts did not name tools, prescribe their sequence or specify workflow stage IDs. No skills, runtime policy or production source were changed for this experiment.

Both projects contained an accepted opening, an unfinished craftsmanship outline and a rough closing. None had narration audio or measured timing. The 2–3 minute film length was a user target, not a claim that the short fixture text was complete or that its duration had been measured.

| Case | User intent | Observed behavior | Result |
|---|---|---|---|
| Gap triage | Discuss what is needed next; choose between personal recording and generated narration; preserve saved work | One narration context read, followed by an ordinary assistant question. No draft mutation. | 16.887 seconds; 18/18 harness checks |
| Closing draft | Finish only the saved closing as two warm English sentences; mark eventual OpenSlate voicing, with no chosen voice | Overview read → narration read → one draft revision → narration read. Only the existing closing changed. | 27.734 seconds; 21/21 harness checks |

The shared ledger recorded exactly two unique, acknowledged starts. Both outcomes were known and cleanup completed before the experiment ended. Historical native starts increased from **21 to 23**. Exact message replay created no extra turn. No real media API, fake generation attempt, reservation or spending consumption occurred.

## Independent objective audit

All **37 independent checks** passed against the original reports and read-only reopened SQLite databases. The audit verified:

- Exact runtime, clean commit, harness digest, per-case start identity and immutable request/epoch/catalog bindings.
- Saved narration supplied by the normal context builder and actual successful context-read receipts.
- Unchanged canonical film, protected authority/media rows, accepted opening, craftsmanship outline and original stored script JSON.
- The closing's existing segment identity, one narration version increment, unaccepted draft status, generated source intent and null voice/profile; no audio or timing was invented.
- Persisted results and turns after reopen, revoked epochs, successful native archive/process cleanup and database integrity.

Exact input delivery proves provenance, not comprehension. Context reads, state changes and the actual responses provide the evidence for the separate semantic assessment below. Creative relevance was not passed using keyword matching.

## Semantic assessment

The triage response correctly identified the opening as script-approved, the middle and closing as outlines, and audio/timing as missing. It proposed finishing and reviewing the writing, reviewing a recording and its measured timing, then planning shots and reviewing exact keyframes before video generation. Its single next choice was practical:

> Would you prefer the commercial to sound personally told by you, or performed by an OpenSlate-generated narrator?

This was an ordinary prose question. No native pending-question record was created. The prompt did not mandate structured input, so that choice is legitimate; this case is not evidence for the structured question/answer UI.

The closing saved by the second turn was:

> Slip into these leather boots and take your next step. Wherever you’re headed, make the journey your own.

It meets the two-sentence, warm invitation request without adding a discount or durability guarantee. The response accurately said it remained a draft, identified the unchanged accepted opening and craftsmanship outline, and explicitly stated that no audio was generated. It described the remaining script review, voice/source, recording/timing, visual reference, keyframe and spending decisions.

Both responses nevertheless described eventual OpenSlate voicing largely as a matter of choosing a voice/profile and configuring production providers. **Built-in speech generation is not implemented.** Provider configuration alone cannot enable it; generated recordings currently need to be supplied from elsewhere. The triage response was especially easy to read as offering an already available voice-generation option. This is a capability-disclosure weakness, not an unauthorized generation or persistence failure. A subsequent improvement should provide explicit implementation/readiness facts to the director and verify that its explanation reflects them.

## Retained exceptions and limits

The zero-turn native preflight passed 15/15 checks and made no `turn/start` call. Archiving its never-dispatched thread returned “no rollout found”; the original report retains `cleanupComplete: false`. A separate 12-check disposition confirmed no model turn, no uncertain live result, closed native processes and an unchanged unused ledger. This exception does not waive cleanup requirements for actual dispatched turns; both live turns archived successfully.

The first independent audit used UUID-sorted tool receipts when checking chronology and failed that assertion. The corrected audit uses SQLite insertion order for chronology and identity order for byte comparisons. A separate audit note preserves this mistake. No model was repeated and no original report, ledger or source was changed.

These are two independent, bounded narration examples. They do not establish broad model reliability, complete scene/shot workflow autonomy, a finished commercial, real media integration or speech-generation support. No browser was exercised in this experiment. The original reports continue to carry `subjectiveAssessment: not_assessed`; this document and its JSON are the separate assessment.

## Subsequent application improvement

Every context section/page now includes host-authored `applicationCapabilities`: synthesis and transcription workflows are unavailable, timing uses human-supplied sample ranges, and imported recordings can be human-supplied or externally generated. Saved voices, API keys and provider profiles cannot enable an unimplemented workflow. Implementation support is distinct from host readiness, which this projection does not evaluate.

A separate `applicationCapabilitiesDigest` guards these facts across pages; existing section digests and immutable skill/tool locks are preserved. The full captured context digest also binds them. All 29 focused context, persistence and narration-tool checks passed in implementation and independent reruns. These checks establish correct delivery and unchanged authority, not improved model behavior; a new bounded native check is still needed for that claim.
