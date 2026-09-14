# Current production contract

Compatibility: tool contract `3.0.0`; workflow and planning contracts `1.0.0`. Eight tools support narration drafts, exact audio proposals and creative/plan work. Audio proposals require separate human plan review and finite spending approval. Upload, attachment, transcript adoption, exact script/audio/timing acceptance and canonical narration review remain human application actions. Media execution also requires a supported saved profile and configured host; loading a skill supplies neither setup nor permission.

## Reading the current state

Call `read_context` with `{}` for the first overview, or `{ "section": "shots", "offset": 0 }` for a specific page. Supported sections are `overview`, `shots`, `scenes`, `plan`, `aliases`, `grants`, `receipts`, `narration`, and `audio_operations`. Follow the returned `page.nextOffset` until null for the collections needed by the task. Do not infer that the first page is the full project. Overview contains compact shot/scene identities, messages, workflow and work summaries, request scope, and locked profiles; read `shots` and `scenes` for complete intent records.

Keep pages from the same state: compare `guard.headVersion`, `revisionId`, `activePlanId`, `graphDigest`, `capabilityLockId`, and `domainCursor` across reads; compare `guard.dataDigest` within the same section. If these change, refresh the affected context and restart its pagination. The raw `cursor` is an event-stream position and changes for tool audit events; do not use it as the pagination guard. A size error is explicit missing context, never permission to assume the omitted content.

For an existing-plan edit, load all `plan` pages and concatenate each returned `source` in offset order. These are chunks of the saved **canonical source**, not complete independent programs. The offset unit is `utf16_characters`; always use `page.nextOffset` instead of calculating a byte offset. Retain matching plan/source identities across chunks and load all `aliases` pages to preserve existing node and review identities. An alias with `current: false` is historical, not evidence of a current operation. Read the affected complete shot intents and preserve untouched branches from the saved source. If `activePlanId` is null, no existing executable plan has been supplied.

Use `grants` to inspect unused slots and their recorded authority relationship. This is information, not new authorization; the service rechecks current request, scope, origin, and consumption. `receipts` returns compact command/tool identities and digests for reviewing earlier outcomes, not full stored proposals. If a tool outcome is unresolved, inspect available application evidence and stop dependent mutations when the result cannot be established; the application supervisor can reconcile authoritative receipts after fencing the old epoch, but the model cannot force replay. Do not issue a fresh creative interpretation or new candidate to recover a lost response.

## Preparing and applying a change

The application accepts a `ChangeProposal` with `variant` equal to `workflow`, `project`, or `plan`, and the current integer `expectedHeadVersion`. Optional fields are `stages`, `creative`, `source`, and `requestNewTakes`. At least one stage proposal, creative patch, or source is required. The tool transport may wrap this value: use the exposed schema rather than guessing a call signature.

A stage proposal has `stageId`, an existing `scopeId`, a concise `reason`, and optional `gaps: [{ key, message }]`. Use stable gap keys within the scope. Do not send the proposed design's `mode`, `basedOn`, completion status, severity, or approval fields: they are absent from the implemented schema. The service determines contract coverage even for project-only and plan-only inputs.

Supported creative fields:

- `brief` and `story`. Narration text/source fields are deliberately unavailable here; use `revise_narration_draft` for narration.
- `createScenes: [{ key, purpose }]` and `updateScenes: [{ id, purpose }]`.
- `createShots`: each entry supplies `key`, `sceneId`, `purpose`, `action`, `framing`, `motion`, integer `desiredFrames`, `imagePrompt`, `videoPrompt`, `referenceArtifactIds`, and `cueId` (existing cue ID or null). A scene's creation key can be used within the same creative patch; the application allocates permanent IDs.
- `updateShots`: existing `id` plus changed purpose/action/framing/motion/duration/prompts and `reauthorPrompts: true`. Deliberately rewrite or reconfirm the prompts against the changed intent before setting that flag. Updating references or cue IDs is not supported by this patch shape.

Do not send `promptIntent` hashes, project/shot revisions, audio acceptance, measured cue times, or grant records as creative patch fields. The service owns these records and validates links. Creating shots and referring to their not-yet-issued IDs in executable source in the same proposal is unsupported: apply the creative draft, read its saved IDs, then author the plan. Existing-shot edits and their replacement source can be proposed atomically.

`prepare_change` returns a compact result: `id`/`preparedId`, `proposalDigest`, `baseVersion`, `semanticChange`, `graphDigest`, `impactCounts`, and `stageCount`. The full proposal, next project, and compiled graph remain stored in the application; do not expect them in the response. Check the returned summary and any diagnostics, then call `apply_change` with `{ "preparedId": "the returned identity" }`. A successful preparation does not apply the draft or approve media. After applying, refresh the relevant context pages; never guess newly allocated IDs from creation keys.

`requestNewTakes` contains existing video **node IDs**, not shot IDs or source aliases, and requires source in the same proposal. Use it only for a requested additional take covered by human authority. Matching inputs can reuse valid frame approval; they must not silently substitute a cached take for the requested new candidate.

On a revision conflict, refresh the affected state and reprepare. On revoked authority, stop mutations under that request. Holds and global pause remain application controls: do not clear them as a planning shortcut. A project-only edit can leave affected execution held until a compatible plan is applied. A new human message may explicitly continue an older edit; the model cannot fabricate that continuation.

Preparation has no paid effects. Polling, generation attempts, reservations, and uncertain submissions belong to the executor. A service error stating that an allowance, current input, or review is missing is a requirement to resolve, not permission to try another identity or stage label.

## Saving narration drafts

Read `read_context({ "section": "narration" })` before writing. It returns saved section IDs/revisions, exact draft text, independent text/audio/timing readiness, gaps and path-free recording inventory. Its section, recording and gap collections share pagination; follow the provided offset and compare the guard. A recording descriptor proves saved measured bytes, not a transcript or accepted performance.

Call `revise_narration_draft` with `expectedVersion` from `narrationDraft.version` and a `patch` containing `add`, `update`, `remove`, and/or `order`. Each draft has exactly `text`, `textKind` (`notes`, `outline`, or `draft`), `language`, `meaning`, and `source`. Source is `{ "kind": "undecided" }`, `{ "kind": "uploaded" }`, or `{ "kind": "generated", "voice": null, "profileRevisionId": null }`; use a settled voice or real supplied profile ID only when known. These fields record intent, not a synthesis request or proven provenance. Updates use `{ "segmentId": "saved ID", "draft": { ...complete draft... } }`.

One call changes only requested sections. Preserve each unchanged field when updating. New sections append; `order` must name every remaining saved section exactly once and cannot accompany additions. Add first, use returned IDs, then reorder. Never fabricate section IDs. The command returns the committed narration version/revision and ordered section identities, not full text; refresh narration context after success.

Changed sections lose their exact script/audio/timing acceptance and cue selection. A source change also detaches its recording candidate. Unchanged sections retain their records. Removal unselects a section but keeps immutable history. Explain these consequences when editing accepted material. The canonical film, active plan, grants and execution holds remain unchanged until separate human review and canonical application.

An old expected version is a conflict, not permission to overwrite newer writing. Read the current draft and reconcile the requested change. A lost response is not a reason to submit a second add under a new call ID; inspect context and receipt evidence first. Approval cannot be supplied in tool JSON or inferred from a conversational “looks good”: direct the user to exact script/recording/timing review controls.

## Preparing audio for human review

Read [the audio proposal contract](audio-proposals.md), narration, and `audio_operations` before forming inputs. Recording transcription needs the exact owned recording ID and `sourceRecordDigest`; it can target an independent recording with no narration section. Speech preparation uses one saved section ID and revision, never model-supplied replacement text. Both preserve the active plan and return only a bounded proposal identity/digest. They create no grant, attempt, spending consumption, accepted recording, transcript adoption or canonical change.

Use the returned proposal in the application's human review controls. Never pass it to `apply_change`. If the user wants to revise the words, save the draft change first, reread its new revision, then prepare speech from that revision. A missing credential or disabled provider is setup information; it cannot be fixed by inserting a provider name, key or approval into tool arguments. A returned transcript remains unreviewed evidence, and a returned recording must still be listened to and explicitly attached/accepted by the human.
