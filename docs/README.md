# OpenSlate documentation

These pages describe the current local studio and its implemented boundaries. [Status](implementation/STATUS.md) separates available behavior from remaining acceptance work. Dated evidence establishes only the scenario it actually exercised.

| Start here | Purpose |
|---|---|
| [Quick start](../README.md#getting-started) | Run the studio |
| [Local setup](implementation/LOCAL-SETUP.md) | Tools, server configuration and provider keys |
| [Launcher](implementation/LOCAL-LAUNCHER.md) | Start, restart, pairing and process ownership |
| [Studio guide](design/STORYBOARD-STUDIO.md) | Chat, storyboard, audio, reviews and Timeline |
| [Owner test guide](ai/code-plan/TEST-INSTRUCTIONS.md) | Chinese checklist, code films, Codex models and Claude Code |
| [Human testing](implementation/MANUAL-LIVE-PRODUCTION.md) | Small real-provider walkthrough |
| [Audio rehearsal](implementation/MANUAL-AUDIO-TESTING.md) | Writing/recording review without paid media |
| [Backup and recovery](implementation/INSTALLATION-RECOVERY.md) | Private same-root installation recovery |

| Understand the system | Purpose |
|---|---|
| [Architecture](design/README.md) | Capabilities, ownership and main execution loop |
| [Technical references](technical/README.md) | Source-backed component contracts |
| [Remaining work](design/IMPLEMENTATION-PLAN.md) | Current improvements and release acceptance |
| [Runtime trust decision](implementation/RUNTIME-TRUST-DECISION.md) | Accepted local Codex trust boundary |
| [Evidence index](implementation/VALIDATION-EVIDENCE.md) | Dated tests, native turns and real/synthetic distinction |
| [Current cleanup report](ai/DOCS-CLEANUP-REPORT.md) | D1 deletions, current source/link checks and exact test results |
| [AI records map](ai/README.md) | Current code/quality work and linked historical designs |
| [Earlier documentation audit](audit/DOCUMENTATION-RECONCILIATION.md) | Dated reconciliation evidence |

Current implementation references: [model catalog](implementation/PROVIDER-CATALOG.md), [provider activation](implementation/MEDIA-EXECUTION-LAUNCHER.md), [configured admission](technical/EXECUTION-ENGINE.md), [settings and updates](implementation/PROJECT-SETTINGS-AND-UPDATES.md), [director guidance](implementation/DIRECTOR-TOOLS-UPGRADE.md), [shot audio](implementation/SHOT-AUDIO.md), [personal voice](implementation/PERSONAL-VOICE.md), [output recovery](implementation/OUTPUT-SPOOL.md), [database schema](technical/DATA-PERSISTENCE.md#schema), and [installation readiness checkpoint](implementation/HUMAN-TESTING-READINESS.md).

Historical work logs were consolidated into these references; Git retains their earlier versions. Sanitized JSON evidence is preserved. Versioned `skills/` files are runtime inputs and remain intact.
