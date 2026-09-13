# Transcribe an owned draft recording

September 13, 2026. **Planned next implementation sequence.** The configured transcription runtime and durable local preparation waiting are implemented. This sequence connects an uploaded recording to reviewed transcription without requiring a script, cue or canonical narration acceptance first.

## User and authority flow

```mermaid
flowchart LR
    Upload[Owned uploaded recording] --> Proposal[Exact ungranted transcription proposal]
    Existing[Complete existing video plan] --> Proposal
    Proposal --> Human[Human reviews recording, model and language]
    Human --> Apply[Atomic grant, candidate and composed plan]
    Apply --> Allowance[Separate finite spending approval]
    Allowance --> Engine[Existing admitted attempt and preparation]
    Engine --> Candidate[Unreviewed transcript candidate]
    Candidate --> Adoption[Existing separate word and timing review]
```

Preparing an operation does not issue a creative grant or consume a spending allowance. Exact human review creates and consumes the needed grant atomically with the candidate and plan. The existing separate allowance then bounds execution. A model, a generic read-only message or an earlier allowance cannot stand in for that review.

## 1. Compiler and owned-file foundation

Add a trusted bounded `CompileContext.transcriptionInputs` catalog. Each entry contains an opaque binding ID/digest, one consumer alias and an exact audio artifact reference. The application will later derive these entries from verified immutable recording bindings; the planning language cannot create them. `p.transcriptionInput(id)` returns an internal reference that only the named transcription operation can consume. Images, video, timeline narration, rendering and other transcription aliases must reject it. Ordinary `p.asset()` remains limited to canonical project artifacts.

The new node has an optional `applicationInput` link with the fixed `owned_transcription` kind and exact binding ID/digest. Keep it outside provider operation arguments. Include it conditionally in both symbolic node identity and the effective execution fingerprint; absence preserves legacy node and request hashes. Snapshot bounded plain data without executing accessors, preserve the snapshot across the compiler worker and reject duplicate identities, malformed audio references or unbounded inputs.

Use the existing restricted AST printer to compose one new transcription declaration into the complete existing source. Update only the base revision and insert the application-owned declaration before the final return, preserving existing returned outputs. All declared operations already belong to the execution graph, so the new transcription need not replace the existing render output. For a project without a plan, return the single transcription operation. Recompile the rewritten baseline and result in a bounded worker, then verify every unrelated node and review gate remains exactly identical. Reject conflicting aliases, invalid historical graph/source pairs or an existing plan that no longer compiles against current canonical state. Never concatenate compiled graphs while claiming unrelated source as the executable plan.

This first foundation supports appending one operation. Stable replacement of an existing section operation will receive an explicit composition contract before conversational edits depend on it. Preserve old outputs and history; do not silently retire omitted video work. Compilation is not publication or permission. Until the application binding/review service is installed, Engine installation and admission reject nodes containing this new application-input field.

Reuse the existing exact narration artifact installer and byte format, with additive original-signal cancellation. Keep the saved artifact identity compatible with later canonical application. Do not add the draft recording to `project.artifacts`, narration cues or acceptance records merely to make it available for transcription.

## 2. Exact recording proposal and human application

A narrow application service captures the original request, project head, current capability lock, full selected profile/options, source-record digest and complete owned source descriptor/range. Its target is explicit: an independent recording, or a named narration section with exact selected section revision/audio. Never infer a section from matching bytes.

After asynchronous byte installation and bounded compilation, recheck the original signal/request, source and project/section versions before storing the immutable source binding and ungranted proposal. Detailed source and compiled-plan records remain available for debugging; human review can show concise recording, recognition, model and configured-estimate summaries. Proposal replay returns the retained result rather than creating a new plan or authority.

The current general preparation service requires unused grants before it can save a prepared change. Refactor a shared synchronous finalization/apply kernel for the exact human review path; do not issue a broad unused grant before asynchronous compilation, and do not forge a prepared row that skips footprint, stage, capability-lock or request checks. Apply revalidates the displayed proposal and creates the grant, candidate, full composed plan and immutable review receipt in one command transaction. Restore must not revive an imported proposal's ability to mint fresh authority.

Keep record dependencies acyclic: the source binding pins its originating request, exact source/target and consumer alias; the proposal references that binding and compiled result; the human review receipt references the proposal, applied plan and newly consumed candidate/grant. A source-binding digest does not itself claim human approval. Admission must resolve the review for that exact candidate, not find an unrelated review of the same recording.

Choose the authenticated review request deliberately. Existing generic creative mutation requires an active editing request, while existing spending review uses a purpose-bound non-editing request. The specialized transcription review must not silently turn a read-only message into general creative authority or release another request's holds. If it uses the editing path initially, retain the current request/epoch and exact hold ownership rules. Any narrower non-editing review path needs its own exact context-digest authorization and shared validation, rather than weakening general `assertActor` behavior.

## 3. Execution, persistence and review integration

Before activation, Engine must validate every noncanonical recording consumer, including callers that bypass the compiler. Pin the source-binding link in immutable admission metadata and check its exact section/source selection at admission, preparation resume and the final first-dispatch marker. An unrelated narration-section edit must not invalidate this work; replacement of its selected recording must. Historical result recovery checks the retained binding rather than requiring the old section to remain current.

Extend Store and media-inclusive backup closure for the source binding, proposal and human review. Retain the same candidate/attempt/reservation/allowance machinery. Transcript publication remains unreviewed; the existing human word/timing adoption and independent narration acceptance paths are unchanged.

General future plan edits must be able to retain already reviewed application-owned transcription nodes. Supply only their validated historical bindings through the trusted compiler context; otherwise a video edit would fail to recompile the saved source or drop the recording operation. Retention is not permission to change that operation: changed profile, language, source or candidate still requires exact new review. Validate unchanged-node reuse and a separate unrelated shot edit before activating this path for normal projects.

After the backend path passes, add authenticated recording-generation review routes and a browser action. Keep the current V2 director contract unchanged. The later conversational entry point needs an explicit new tool version and guidance upgrade, alongside the planned speech-section/chunk flow. Correct the existing unconditional `fixtureOnly` context claim before advertising real generated work through that entry point.

## Acceptance evidence

- Pure and isolated compilation: exact bound audio input, wrong-consumer rejection, detached caller data, bounded parsing and unchanged legacy identities.
- Full-plan composition: audio-only project plus an existing reviewed multi-shot plan, preserving unrelated aliases, node bytes, review gates and returned render outputs.
- Owned file installation: original cancellation throughout reads/publication and exact compatibility with current canonical artifacts.
- Backend upload-first path: no script/cues/acceptance required; proposal creates no grant, then exact human apply and a separate allowance lead through injected HTTP and real local conversion to one unreviewed candidate.
- Request/version/source replacement during each await, explicit section identity, unchanged unrelated sections, replay and changed-body rejection, restore fencing and no repeated provider POST.

No live media API is needed to implement these slices. See [activation sequence](AUDIO-ACTIVATION.md), [implemented waiting](AUDIO-PREPARATION-WAITING.md), [human transcript review](TRANSCRIPT-REVIEW-ADOPTION.md) and [development status](STATUS.md).
