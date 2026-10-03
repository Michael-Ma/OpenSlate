# Documentation reconciliation

October 3, 2026. Scope: `README.md`, `CONTRIBUTING.md`, and human/developer documentation under `docs/`. Current source is authoritative; historical experiment counts remain dated evidence. No source, tests, provider configuration, credentials, private projects or runtime skill inputs are changed by this cleanup.

## Kept and updated

- README: concise studio capabilities, implemented architectural differentiators, portable quick start, current limits and status links.
- Design: current architecture, studio behavior and outstanding acceptance; redundant earlier component/walkthrough/flow plans consolidated.
- Technical: all twelve component pages plus index rewritten around actual module ownership and source contracts, replacing speculative APIs/tables and stale unimplemented labels.
- Operations: setup/launcher, catalog/activation, generation/spending, settings/guidance, audio/voice, spool, migrations and same-root recovery guides updated.
- Evidence: five useful dated Markdown campaigns and all 41 tracked sanitized JSON records preserved; one index replaces many overlapping milestone narratives.

## Substantive drift corrected

- Existing-project model preview/apply is implemented; old catalog prose claimed no endpoint existed.
- Current SQLite schema is V3; old migration prose described V2-only and treated installation recovery as future work.
- Current narration supports short within-shot voiceover; old live instructions required/padded a six-second recording.
- Director guidance/tool compatibility is distinct from narration writing, personal-voice consent and media spending.
- The default current UI is storyboard/treatment/scenes/shots; superseded Film plan/Precision layouts are no longer presented as current design.
- Personal-voice ID dispatch remains partial item 6, not in-app clone enrollment; setup tooling is distinct from distribution packaging.
- October 3 resize/Markdown/activity/settings/guidance behavior is reconciled against shipped source and the 2,207-test full gate; final integrated verification and the repaired bounded native guidance rerun passed. Design-system adoption and the larger plan-card proposal remain human choices.

## Consolidated and removed

The following tracked Markdown files are removed from the working tree and recoverable through Git. Their current contract moves to the linked guide; dated JSON evidence remains intact. Redundant milestone counts, abandoned next-step plans and earlier UI layouts do not remain competing sources of truth.

| Removed file | Current reference | Reason |
|---|---|
| `docs/design/CODEX-AND-PROVIDERS.md` | [README](../design/README.md) | Superseded architecture/layout proposal |
| `docs/design/COMMERCIAL-WALKTHROUGH.md` | [README](../design/README.md) | Superseded architecture/layout proposal |
| `docs/design/COMPONENT-DESIGN.md` | [README](../design/README.md) | Superseded architecture/layout proposal |
| `docs/design/EXECUTION-AND-EDITING.md` | [README](../design/README.md) | Superseded architecture/layout proposal |
| `docs/design/SIMPLIFIED-VIDEO-FLOW.md` | [STORYBOARD-STUDIO](../design/STORYBOARD-STUDIO.md) | Superseded architecture/layout proposal |
| `docs/design/SKILLS-AND-TOOLS.md` | [README](../design/README.md) | Superseded architecture/layout proposal |
| `docs/implementation/ALLOWANCE-HTTP.md` | [SPENDING-REVIEW](../implementation/SPENDING-REVIEW.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/AUDIO-ACTIVATION.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/AUDIO-APPLICATION-BRIDGES.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/AUDIO-LIBRARY.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/AUDIO-PREPARATION-WAITING.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/AUTOMATIC-LOCAL-ASSEMBLY.md` | [TIMELINE-RENDERING](../technical/TIMELINE-RENDERING.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/CHAT-STOP.md` | [DIRECTOR-RUNTIME](../technical/DIRECTOR-RUNTIME.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/CODEX-BROWSER-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-CAPABILITY-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-IMAGE-ATTACHMENT-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-IMAGE-PROVIDER.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/CODEX-LIVE-PROBE.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-MCP-FOLLOWUP.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-NARRATION-CAPABILITY-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-NARRATION-V2-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-PROBE.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-QUESTION-BROWSER-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-QUESTION-CONTINUATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-SKILL-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-STAGE-GAP-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CODEX-SUPERVISOR-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/CONVERSATION-WORKSPACE.md` | [DIRECTOR-RUNTIME](../technical/DIRECTOR-RUNTIME.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/CONVERSATIONAL-AUDIO.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/DIRECTOR-IMAGE-ATTACHMENTS.md` | [DIRECTOR-RUNTIME](../technical/DIRECTOR-RUNTIME.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/EXTERNAL-SPENDING-ALLOWANCES.md` | [SPENDING-REVIEW](../implementation/SPENDING-REVIEW.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/GENERATED-AUDIO-INGESTION.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/GENERATED-NARRATION-ATTACHMENT.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/GENERATED-VIDEO-DERIVATION.md` | [OUTPUT-SPOOL](../implementation/OUTPUT-SPOOL.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/IMAGE-INGESTION.md` | [OUTPUT-SPOOL](../implementation/OUTPUT-SPOOL.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/INGESTION-COMPOSITION.md` | [OUTPUT-SPOOL](../implementation/OUTPUT-SPOOL.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/LOCAL-EXECUTION-IDENTITY.md` | [TIMELINE-RENDERING](../technical/TIMELINE-RENDERING.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/LOCAL-MEDIA-RECOVERY.md` | [TIMELINE-RENDERING](../technical/TIMELINE-RENDERING.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/LOCAL-RUNTIME-SETUP.md` | [DIRECTOR-RUNTIME](../technical/DIRECTOR-RUNTIME.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/LOCAL-TIMELINE-DOCUMENT.md` | [TIMELINE-RENDERING](../technical/TIMELINE-RENDERING.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/MEDIA-CREDENTIALS.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/MEDIA-INTEGRATION.md` | [TIMELINE-RENDERING](../technical/TIMELINE-RENDERING.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/MINIMAX-H3-EXECUTION.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/MINIMAX-H3.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/NARRATION-BROWSER-VALIDATION.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Repeated historical validation prose; exact JSON retained |
| `docs/implementation/NARRATION-INTEGRATION.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/NARRATION-TOOLS.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OPENAI-AUDIO-TRANSPORTS.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OPENAI-IMAGE-EXECUTION.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OPENAI-IMAGE.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OPENAI-SPEECH-EXECUTION.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OPENAI-TRANSCRIPTION-EXECUTION.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OWNED-RECORDING-TRANSCRIPTION.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OWNED-TRANSCRIPTION-PROPOSALS.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OWNED-TRANSCRIPTION-REVIEW.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/OWNED-TRANSCRIPTION-WORKSPACE.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/PNG-REFERENCE-IMPORT.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/PRECISION-UI.md` | [VALIDATION-EVIDENCE](../implementation/VALIDATION-EVIDENCE.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/PROJECT-BUDGET.md` | [SPENDING-REVIEW](../implementation/SPENDING-REVIEW.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/PROJECT-LOCAL-EXECUTION.md` | [TIMELINE-RENDERING](../technical/TIMELINE-RENDERING.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/PROVIDER-EXECUTION.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/PROVIDER-ROUTING.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/SPOOL-COMPLETIONS.md` | [OUTPUT-SPOOL](../implementation/OUTPUT-SPOOL.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/T06-SKILLS-TOOLS.md` | [SKILLS-TOOLS](../technical/SKILLS-TOOLS.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/TIMELINE-CAPTURE.md` | [TIMELINE-RENDERING](../technical/TIMELINE-RENDERING.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/TRANSCRIPT-CANDIDATES.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/TRANSCRIPT-REVIEW-ADOPTION.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/TRANSCRIPTION-AUDIO-PREPARATION.md` | [NARRATION](../technical/NARRATION.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/VIDEO-DOWNLOAD.md` | [OUTPUT-SPOOL](../implementation/OUTPUT-SPOOL.md) | Component milestone/contract consolidated against current source |
| `docs/implementation/VIGGLE-H3.md` | [PROVIDERS-ARTIFACTS](../technical/PROVIDERS-ARTIFACTS.md) | Component milestone/contract consolidated against current source |

## Verification boundary

This documentation change makes no provider/model calls and requires no media acceptance. Post-publication verification passed:

- Final repository documentation scan: 113 Markdown files including immutable skill inputs, 489 relative file/anchor links; zero missing targets or anchor warnings.
- `git diff --check`: passed.
- All 41 tracked sanitized evidence JSON files: unchanged.
- Integration redirected the auxiliary `skills/README.md` and `workers/h3-python/README.md` crosslinks to current references while preserving immutable skill package bytes. The final source scan found zero deleted-page references outside the current docs.

Source/build/browser verification for the concurrent UI/backend changes belongs to the integrated review and is not inferred from documentation.

Immutable versioned `skills/` packages, all JSON evidence, runtime/configuration files, databases/media and non-documentation files are untouched. Source reference scan found `scripts/setup-readiness.mjs` links to `MANUAL-LIVE-PRODUCTION.md`, which is retained; `AGENTS.md` status/trust links are retained.
