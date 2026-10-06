# Creative skills

Two instruction-only packages are shipped and validated by the director loader. The current guidance is [V5 production](v5/production/SKILL.md) and [V5 plan authoring](v5/plan-authoring/SKILL.md), package version `5.0.0` with the existing `4.0.0` JSON tool contract. Historical V1–V4 package bytes remain available for verifying existing immutable locks.

- [production](v5/production/SKILL.md): intent and narration gap discovery, script development, story/shot planning, continuity/assets, human keyframe/video review, and conversational editing guidance.
- [plan-authoring](v5/plan-authoring/SKILL.md): code-authored execution plans and focused patches against existing project state.

Stage-specific guidance lives in declared lazy references. OpenSlate validates exact package contents, creates immutable content-addressed snapshots, locks compatible versions and records activation across requests. Compatible current guidance loads automatically before an eligible fresh native turn; already-started epochs keep their saved lock. Skills supply instructions; typed tools enforce current project inputs, scope and exact media review. Configured provider credentials require no separate API-key approval or usage allowance.

These are OpenSlate product packages; they are not installed into a contributor's global Codex configuration. Bounded native validation accepted the pinned inputs and supplied references, including a fresh V3 → V4 upgrade that saved one scoped shot script. The accepted local runtime trusts the pinned native installation; independent code-host isolation is not an additional deployment gate. Complete conversational production, real-media acceptance and user quality remain pending; see [native validation](../docs/implementation/VALIDATION-EVIDENCE.md), [runtime trust](../docs/implementation/RUNTIME-TRUST-DECISION.md) and the [implemented framework](../docs/technical/SKILLS-TOOLS.md).

See the [skill and tool framework](../docs/technical/SKILLS-TOOLS.md) and [execution/editing design](../docs/technical/PLAN-COMPILER.md).
