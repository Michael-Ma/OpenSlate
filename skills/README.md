# Creative skills

Two instruction-only packages are shipped and validated by the director loader:

- [production](production/SKILL.md): intent and narration gap discovery, script development, story/shot planning, continuity/assets, human keyframe review, and conversational editing guidance.
- [plan-authoring](plan-authoring/SKILL.md): code-authored execution plans and focused patches against existing project state.

Stage-specific guidance lives in declared lazy references. OpenSlate validates exact package contents, creates immutable content-addressed snapshots, locks compatible versions and records explicit activation across requests. Skills supply instructions; typed tools enforce project state, authorization and budgets.

These are OpenSlate product packages; they are not installed into a contributor's global Codex configuration. Two application-backed model turns accepted the explicit native skill inputs and the supplied focused references. Code-host isolation and production workflow wiring remain pending; see [native validation](../docs/implementation/CODEX-SKILL-VALIDATION.md). See the [implemented framework and remaining gates](../docs/implementation/T06-SKILLS-TOOLS.md).

See the [skill and tool framework](../docs/design/SKILLS-AND-TOOLS.md) and [execution/editing design](../docs/design/EXECUTION-AND-EDITING.md).
