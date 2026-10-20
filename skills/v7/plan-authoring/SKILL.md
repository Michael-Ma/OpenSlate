---
name: plan-authoring
description: Save OpenSlate creative patches and, only when needed, separate restricted timeline/render source over owned media, preserving project identities and human scene decisions.
---

# OpenSlate plan authoring

Ordinary creative planning saves writing, not executable generation source. Read [the current guidance](references/grammar.md) and [the creative-patch example](references/example.md). Obtain current head/revision, saved IDs, media and settled choices from paged context; do not invent identities.

Never author image, review or video declarations (`p.image`, `p.humanReview`, `p.approvedImage`, `p.video`), and never use `requestNewTakes`. Scene actions build all keyframe and video work. Never combine creative edits with `source` in one `prepare_change`. Only separate timeline and render source remains available when actually needed; Film exports are assembled by the application without Director source.

For harmless writing, use `prepare_change` with `variant: "project"`, current `expectedHeadVersion` and `creative`, then apply its returned prepared ID. Create shots before reading their service-issued IDs. Use short scene `title` and descriptive `purpose`; put coverage, timing and narration range in `story`. Framing is a 1–3-word label of at most 40 characters (Close-up, Medium, Wide).

On shots with current or retained media, changes to purpose, action, framing, motion, prompts, duration or narration use `propose_change` and a note linking its proposalId. Retained voice or accepted cues also establish media impact. Pure text without media impact may apply directly with a receipt. Respect `PROPOSAL_REQUIRED` and human field conflicts, never split an edit to bypass them. The full 6.0.0 proposal fields are described in the grammar. Global canonical narration editing and invented acceptance/timing fields are unavailable.

In Plan save direction; in Keyframes the person presses "Make keyframes", reviews exact frames, motion, narration and video recipe, then presses "Confirm frames & generate video" once. Scene confirmation saves exact script, recording and measured timing together. Listening and recording edits are optional. Film contains clips, soundtrack and export; Assets contains saved media. Name these views/actions directly.

For explicitly requested recognition/speech use existing audio tools, which save pending suggestions only. A human press starts paid work; never declare new speech/transcription source or pass suggestions to `apply_change`. Configured keys need no approval or usage allowance.

Keep unchanged work and operation identities. After an uncertain response inspect receipts using the original identity and stop dependent changes if unresolved; never resubmit blindly. Refresh/reprepare actual conflicts, stop after revoked authority and preserve request-owned holds. The executor owns scheduling, technical retries and unknown submission reconciliation. Tool success proves saved data, not artistic quality.
