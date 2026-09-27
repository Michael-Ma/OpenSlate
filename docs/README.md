# OpenSlate documentation

Start with the current status or the local run guide. Architecture documents describe the target; dated component and validation notes record narrower implementation evidence.

## Run and use OpenSlate

| Document | Purpose |
|---|---|
| [Project quick start](../README.md#quick-start) | Start, inspect and restart the local app |
| [Local launcher](implementation/LOCAL-LAUNCHER.md) | Lifecycle, troubleshooting and process ownership |
| [Manual live run](implementation/MANUAL-LIVE-PRODUCTION.md) | Configure providers and validate a real production |
| [Manual audio rehearsal](implementation/MANUAL-AUDIO-TESTING.md) | Test narration with media APIs disabled |
| [Video creation flow](design/SIMPLIFIED-VIDEO-FLOW.md) | Brief → storyboard → frames → clips → export |
| [Backup and recovery](implementation/INSTALLATION-RECOVERY.md) | Same-machine backup, restore and review |

## Current delivery and design

| Document | Purpose |
|---|---|
| [Implementation status](implementation/STATUS.md) | What works, what was tested and remaining limits |
| [Development plan](design/IMPLEMENTATION-PLAN.md) | Remaining release work and acceptance gates |
| [Architecture](design/README.md) | Scope, stack and ownership |
| [Components](design/COMPONENT-DESIGN.md) | High-level component diagrams and execution logic |
| [Technical designs](technical/README.md) | Per-component contracts and algorithms |
| [Commercial walkthrough](design/COMMERCIAL-WALKTHROUGH.md) | Example production and saved data |
| [Local runtime trust decision](implementation/RUNTIME-TRUST-DECISION.md) | Accepted single-user, single-machine boundary |

## Implementation references and evidence

- Director: [local setup](implementation/LOCAL-RUNTIME-SETUP.md), [versioned tools](implementation/DIRECTOR-TOOLS-UPGRADE.md), [skills/tools](implementation/T06-SKILLS-TOOLS.md).
- Providers: [catalog](implementation/PROVIDER-CATALOG.md), [execution activation](implementation/MEDIA-EXECUTION-LAUNCHER.md), [Codex images](implementation/CODEX-IMAGE-PROVIDER.md), [Viggle H3](implementation/VIGGLE-H3.md), [OpenAI image execution](implementation/OPENAI-IMAGE-EXECUTION.md).
- Audio: [conversational preparation](implementation/CONVERSATIONAL-AUDIO.md), [speech execution](implementation/OPENAI-SPEECH-EXECUTION.md), [recording transcription](implementation/OWNED-TRANSCRIPTION-WORKSPACE.md), [transcript adoption](implementation/TRANSCRIPT-REVIEW-ADOPTION.md).
- Execution: [spending review](implementation/SPENDING-REVIEW.md), [output recovery](implementation/OUTPUT-SPOOL.md), [assembly](implementation/AUTOMATIC-LOCAL-ASSEMBLY.md), [migrations](implementation/DATABASE-MIGRATIONS.md).
- UI: [Precision layout](implementation/PRECISION-UI.md), [settings and SSE](implementation/PROJECT-SETTINGS-AND-UPDATES.md), [Stop behavior](implementation/CHAT-STOP.md).
- Acceptance evidence: [real six-second pipeline](implementation/LIVE-VALIDATION.md), [synthetic six-minute workflow](implementation/SIX-MINUTE-WORKFLOW.md), [clean checkout](implementation/CLEAN-CHECKOUT-VALIDATION.md).

Other files under `implementation/` preserve component contracts and dated experiments. Their old test totals and next steps describe that milestone, not current project status or permission to make new paid calls. Use the status page and development plan for current decisions. Versioned files under `skills/` are runtime inputs, not disposable documentation.
