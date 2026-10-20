# Creative skills

Two instruction-only packages are shipped and validated by the director loader. The current guidance is [V7 production](v7/production/SKILL.md) and [V7 plan authoring](v7/plan-authoring/SKILL.md), package version `7.0.0` with JSON tool contract `6.0.0`. Historical V1–V6 package bytes remain available for verifying existing immutable locks.

- [production](v7/production/SKILL.md): intent and narration gap discovery, script development, story/shot planning, continuity/assets, human keyframe/video review, and conversational editing guidance.
- [plan-authoring](v7/plan-authoring/SKILL.md): creative-only writing and separate timeline/render source when needed; scene actions own keyframe and video work.

A shipped package and a shipped tool catalog are never edited in place. This includes the root `production` and `plan-authoring` packages, `v2` through `v6`, and catalogs `1.0.0` through `5.0.0`; later shipped versions are equally immutable. Every later guidance or schema change ships as a new version with a new identity. Package and catalog digest tests pin that history; do not update a historical pin to accommodate an edit. Historical saved locks are verified against shipped identities and their immutable snapshots, rather than reconstructed from current repository files.

V7 replaces the old plan-authoring generation example with an offline-tested creative-patch example. It separates short scene titles from direction, routes media-impacting intent edits through human previews, and describes one scene confirmation for frames, motion and narration.

Stage-specific guidance lives in declared lazy references. OpenSlate validates exact package contents, creates immutable content-addressed snapshots, locks compatible versions and records activation across requests. Compatible current guidance loads automatically before an eligible fresh native turn; already-started epochs keep their saved lock. Skills supply instructions; typed tools enforce current project inputs, scope and exact media review. Configured provider credentials require no separate API-key approval or usage allowance.

These are OpenSlate product packages; they are not installed into a contributor's global Codex configuration. Bounded native validation accepted the pinned inputs and supplied references, including a fresh V3 → V4 upgrade that saved one scoped shot script. The accepted local runtime trusts the pinned native installation; independent code-host isolation is not an additional deployment gate. Complete conversational production, real-media acceptance and user quality remain pending; see [native validation](../docs/implementation/VALIDATION-EVIDENCE.md), [runtime trust](../docs/implementation/RUNTIME-TRUST-DECISION.md) and the [implemented framework](../docs/technical/SKILLS-TOOLS.md).

See the [skill and tool framework](../docs/technical/SKILLS-TOOLS.md) and [execution/editing design](../docs/technical/PLAN-COMPILER.md).
