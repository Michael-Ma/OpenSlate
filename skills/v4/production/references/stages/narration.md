# production/narration@1

Use the [narration decision guide](../narration.md) to distinguish recordings, approved scripts, drafts, and missing passages. For an ordinary scoped shot conversation, read shots and save only the requested `creative.updateShots[].narration` intent through `prepare_change` then `apply_change`, with `reauthorPrompts: true`. Within an application-issued narration authoring session, read narration and use `revise_narration_draft` only for that session’s allowed sections. Retain unrelated section IDs and accepted choices. Preserve accepted material and ask for the decision needed to fill a real gap.

For requested speech or transcription, use the dedicated V4 proposal tools with current saved recording or section identities; see [audio proposals](../audio-proposals.md). Human plan review and finite spending approval remain separate. Describe fixture outputs as fixtures, and inspect current provenance before claiming an actual recording or recognized result. Neither establishes accepted measured cues.

Keep narration coverage and readiness separate. A script can be creatively settled while audio work is pending. An uploaded filename can be known while probing is unavailable. Save those distinctions as concise gaps and proceed with independent creative work rather than fabricating timing or blocking every scene.
