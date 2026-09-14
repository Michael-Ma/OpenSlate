---
name: plan-authoring
description: Author or revise OpenSlate's restricted declarative video plan from saved shot intents, locked profiles, and registered assets, preserving logical identities, exact keyframe review, and scoped execution reuse.
---

# OpenSlate plan authoring

Produce a validated declaration graph for the current authorized request. The plan is parsed as data; it is never executed as JavaScript. Read [the implemented grammar](references/grammar.md) before authoring source and use [the compiled example](references/example.md) for the exact shape.

Obtain current project revision/head, saved shot IDs, prompts, cues, asset IDs, existing source aliases, and locked profiles through the paged context flow in [the grammar reference](references/grammar.md). For scoped edits, reconstruct all saved canonical source chunks and load existing aliases before changing declarations. Keep established aliases: changing one is not a harmless formatting edit. Never invent permanent node, artifact, approval, or candidate IDs. Shot creation must be applied before source can reference its service-issued IDs.

Use the actual `prepare_change` schema. Its supported change value contains `variant`, `expectedHeadVersion`, and `source`, with optional creative changes and stage proposals. For an existing-shot edit, deliberately update/reconfirm prompts through `reauthorPrompts: true` and supply replacement source consistent with that proposed state. Do not attach proposed design fields that the current schema lacks. Narration script/source edits belong to `revise_narration_draft`; creative patches cannot update canonical narration. Use human-accepted canonical cues for executable timing.

Every video must reference a declared exact review and its conditioning image through `p.approvedImage`. That helper declares a dependency; it does not approve an image. Image prompt strings must match current shot image prompts; video and review motion prompts, profile, duration, settings, and frame must agree. Pending media outputs are valid dependencies; unresolved measured timing or human review stays pending at dispatch.

Keep the change focused and retain independent branches. The compiler may reparse the full source while the executor reuses unchanged candidates and outputs. An explicit user-requested additional take is different from continuation: include the existing video node ID in `requestNewTakes` only when current human authority covers it. Do not rename nodes, alter random seeds, or change prompts to bypass grants or force an unrequested variant.

Inspect preparation diagnostics and its compact `impactCounts`/`graphDigest` summary; the full proposal remains stored, not returned. Apply with `{ "preparedId": "the returned identity" }` only while its scope and authority remain current. Inspect receipt context after an uncertain result; stop dependent mutations if evidence is inconclusive, until the application supervisor establishes an authoritative receipt after fencing the old epoch. Refresh/reprepare on actual conflicts; stop old-epoch mutations when authority is revoked. Never release another request's hold or a user pause to advance a graph.

The executor schedules jobs, polls providers, handles trusted technical retries, and reconciles unknown submissions. Do not create per-node agent loops or embed LLM calls in the plan. Report planned work and remaining requirements accurately; inspect current artifact provenance; fixture outputs remain placeholders and successful execution does not establish creative quality.

For new recognition of an owned recording or speech from saved narration, use the dedicated audio proposal tools and human review instead of synthesizing new declarations or grants. Preserve existing reviewed audio nodes, source bindings and aliases in ordinary plan edits. Do not move a noncanonical owned-recording input into a timeline or another consumer.
