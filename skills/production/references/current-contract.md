# Current production contract

Compatibility: tool, workflow, and planning contracts `1.0.0`. These instructions target the implemented foundation, not every feature in the design documents. Current provider profiles execute fake fixtures. Upload probing, real transcription, mixed-source cue editing, real rendering, and vendor generation require further implementation. Loading this skill does not provide those capabilities.

## Reading the current state

Call `read_context` with `{}` for the first overview, or `{ "section": "shots", "offset": 0 }` for a specific page. Supported sections are `overview`, `shots`, `scenes`, `plan`, `aliases`, `grants`, and `receipts`. Follow the returned `page.nextOffset` until null for the collections needed by the task. Do not infer that the first page is the full project. Overview contains compact shot/scene identities, messages, workflow and work summaries, request scope, and locked profiles; read `shots` and `scenes` for complete intent records.

Keep pages from the same state: compare `guard.headVersion`, `revisionId`, `activePlanId`, `graphDigest`, `capabilityLockId`, and `domainCursor` across reads; compare `guard.dataDigest` within the same section. If these change, refresh the affected context and restart its pagination. The raw `cursor` is an event-stream position and changes for tool audit events; do not use it as the pagination guard. A size error is explicit missing context, never permission to assume the omitted content.

For an existing-plan edit, load all `plan` pages and concatenate each returned `source` in offset order. These are chunks of the saved **canonical source**, not complete independent programs. The offset unit is `utf16_characters`; always use `page.nextOffset` instead of calculating a byte offset. Retain matching plan/source identities across chunks and load all `aliases` pages to preserve existing node and review identities. An alias with `current: false` is historical, not evidence of a current operation. Read the affected complete shot intents and preserve untouched branches from the saved source. If `activePlanId` is null, no existing executable plan has been supplied.

Use `grants` to inspect unused slots and their recorded authority relationship. This is information, not new authorization; the service rechecks current request, scope, origin, and consumption. `receipts` returns compact command/tool identities and digests for reviewing earlier outcomes, not full stored proposals. If a tool outcome is unresolved, inspect available application evidence and stop dependent mutations when the result cannot be established; there is no automatic reconciliation API. Do not issue a fresh creative interpretation or new candidate to recover a lost response.

## Preparing and applying a change

The application accepts a `ChangeProposal` with `variant` equal to `workflow`, `project`, or `plan`, and the current integer `expectedHeadVersion`. Optional fields are `stages`, `creative`, `source`, and `requestNewTakes`. At least one stage proposal, creative patch, or source is required. The tool transport may wrap this value: use the exposed schema rather than guessing a call signature.

A stage proposal has `stageId`, an existing `scopeId`, a concise `reason`, and optional `gaps: [{ key, message }]`. Use stable gap keys within the scope. Do not send the proposed design's `mode`, `basedOn`, completion status, severity, or approval fields: they are absent from the implemented schema. The service determines contract coverage even for project-only and plan-only inputs.

Supported creative fields:

- `brief`, `story`, `narrationScript`, and `narrationSource` (`undecided`, `uploaded`, or `generated`).
- `createScenes: [{ key, purpose }]` and `updateScenes: [{ id, purpose }]`.
- `createShots`: each entry supplies `key`, `sceneId`, `purpose`, `action`, `framing`, `motion`, integer `desiredFrames`, `imagePrompt`, `videoPrompt`, `referenceArtifactIds`, and `cueId` (existing cue ID or null). A scene's creation key can be used within the same creative patch; the application allocates permanent IDs.
- `updateShots`: existing `id` plus changed purpose/action/framing/motion/duration/prompts and `reauthorPrompts: true`. Deliberately rewrite or reconfirm the prompts against the changed intent before setting that flag. Updating references or cue IDs is not supported by this patch shape.

Do not send `promptIntent` hashes, project/shot revisions, audio acceptance, measured cue times, or grant records as creative patch fields. The service owns these records and validates links. Creating shots and referring to their not-yet-issued IDs in executable source in the same proposal is unsupported: apply the creative draft, read its saved IDs, then author the plan. Existing-shot edits and their replacement source can be proposed atomically.

`prepare_change` returns a compact result: `id`/`preparedId`, `proposalDigest`, `baseVersion`, `semanticChange`, `graphDigest`, `impactCounts`, and `stageCount`. The full proposal, next project, and compiled graph remain stored in the application; do not expect them in the response. Check the returned summary and any diagnostics, then call `apply_change` with `{ "preparedId": "the returned identity" }`. A successful preparation does not apply the draft or approve media. After applying, refresh the relevant context pages; never guess newly allocated IDs from creation keys.

`requestNewTakes` contains existing video **node IDs**, not shot IDs or source aliases, and requires source in the same proposal. Use it only for a requested additional take covered by human authority. Matching inputs can reuse valid frame approval; they must not silently substitute a cached take for the requested new candidate.

On a revision conflict, refresh the affected state and reprepare. On revoked authority, stop mutations under that request. Holds and global pause remain application controls: do not clear them as a planning shortcut. A project-only edit can leave affected execution held until a compatible plan is applied. A new human message may explicitly continue an older edit; the model cannot fabricate that continuation.

Preparation has no paid effects. Polling, generation attempts, reservations, and uncertain submissions belong to the executor. A service error stating that an allowance, current input, or review is missing is a requirement to resolve, not permission to try another identity or stage label.
