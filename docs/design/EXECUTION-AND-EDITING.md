# OpenSlate — Execution Plans and Live Editing

**Version:** 0.2 · September 10, 2026
**Status:** proposed algorithms and illustrative plan syntax, not implemented APIs.

## 1. Code as the production plan

After clarifying the requested intent and reading current state, Codex writes a small TypeScript plan. It describes operations, input bindings, dependencies, and decision gates. OpenSlate compiles that source into a persistent directed acyclic graph (DAG), then trusted workers execute it.

The planning language accepts a bounded subset of TypeScript: literal parameters, named references, operation declarations, lists, and approved composition helpers. Parse and validate this subset; do not run model-written JavaScript using `eval`, arbitrary imports, filesystem access, network calls, or subprocesses. Compilation has no generation side effects. This is a declarative code format, not a general-purpose agent-written server program.

```ts
// Illustrative syntax. Each call declares a graph node or reference.
definePlan({ baseRevision: "r12" }, (p) => {
  const maya = p.asset("maya-approved@3");
  const frame = p.image("shot-7/keyframe", {
    intent: p.shot("shot-7@5"),
    references: [maya], prompt: "Maya in a red coat at the station entrance",
  });
  const chosenFrame = p.review("shot-7/reference-choice", frame);
  const shot7 = p.video("shot-7/take", {
    intent: p.shot("shot-7@5"),
    firstFrame: chosenFrame, prompt: "Maya turns toward the train", seconds: 6,
  });
  const shot8 = p.video("shot-8/take", {
    intent: p.shot("shot-8@2"),
    references: [maya], prompt: "Maya watches the departing train", seconds: 6,
  });
  const chosenTakes = p.review("scene/take-choice", [shot7, shot8]);
  const edit = p.timeline("scene/edit", { takes: chosenTakes, transition: "cut" });
  return p.render("scene/preview", { timeline: edit });
});
```

`p.shot` binds the creative intent revision used to author the prompt; it is not an execution-order dependency. The example demonstrates dependencies, not mandatory review of every shot in every project. `review` declares a gate whose resolution comes from user decisions or the established policy; plan code cannot grant approval. Missing creative parameters or provider constraints are compiler diagnostics, not silently invented defaults.

```mermaid
flowchart LR
    Maya[Approved Maya reference] --> Frame[Generate shot 7 keyframe]
    Frame --> Gate[Reference choice]
    Gate --> S7[Generate shot 7]
    Maya --> S8[Generate shot 8]
    S7 --> Review[Take selection gate]
    S8 --> Review
    Review --> Timeline[Assemble edit]
    Timeline --> Render[Render preview]
```

Shot 8 can run while shot 7's keyframe is being generated or reviewed. Narrative order alone does not create a dependency. Actual output references and explicit gates determine readiness.

## 2. Compile and execute

### Compile algorithm

1. Read the expected project/plan revision and the locked operation catalog.
2. Parse allowed syntax and normalize it into nodes with stable logical IDs.
3. Bind immutable project inputs and symbolic references to future outputs; validate prompt/spec provenance against the current generation-relevant intent.
4. Validate required fields, unique IDs, references, cycles, provider modes, limits, and gates; return useful diagnostics together.
5. Compare the candidate graph with the active graph and identify reuse, new work, obsolete work, and review requirements.
6. Produce a human-readable impact summary and a prepared change ID. Commit only when policy permits and the base revision still matches.

Store readable source and the normalized graph as one versioned artifact. The graph is the execution representation. Future edits can be small patch commands; the service can regenerate canonical source and recompile the whole graph without asking the LLM to rewrite unchanged content. An incremental compiler is unnecessary for the initial scale.

### Scheduling algorithm

1. Maintain a ready queue of nodes whose input artifacts, selection bindings, and gates are resolved.
2. Prioritize the estimated critical path and work that yields an early scene preview; use a simple ready queue until measurements justify more sophisticated priorities.
3. Transactionally check current node binding, holds, policy, cost allowance, and resource capacity before recording dispatch intent.
4. Execute the registered handler directly. Persist provider receipts and monitor completion outside the director turn.
5. Ingest and validate artifacts; resolve the node's outputs; update dependent readiness.
6. Emit UI progress continuously, but coalesce director wakeups into decisions, exceptions, or review batches.

References, generation, download, and rendering can overlap across independent branches. There is no global barrier requiring every scene's references or every shot's video to finish before useful downstream work starts. Optional scene previews operate on ready sections; the final render waits for its required complete timeline.

### Where speed comes from

| Technique | Benefit | Constraint |
|---|---|---|
| Plan a useful scope in one reasoning pass | Fewer model/tool round trips | Clarify material uncertainty first |
| Execute the graph in application code | No agent polling or per-shot dispatch loop | Every operation still passes admission checks |
| Parallel ready branches | Overlap API latency | Respect rate, concurrency, memory, and budget limits |
| Reuse accepted assets and deterministic derivatives | Avoid repeated generation and processing | Exact effective inputs must match |
| Coalesce reviews and automatic wakeups | Reduce conversation overhead | User requests preempt queued automation |
| Recompile/diff after a local edit | Preserve valid work | Meaningful dependency changes still propagate |

Do not generate speculative extra takes just to appear faster. Code execution reduces orchestration overhead; provider inference may still dominate wall time. Measure time to first useful preview, ready-to-dispatch delay, critical-path wait, edit turnaround, and extra generated seconds per edit.

## 3. Identity, dependencies, and reuse

Keep four identities separate:

| Identity | Example meaning |
|---|---|
| Logical node ID | The shot 7 generation slot, stable across revisions |
| Plan revision | One immutable version of source and graph |
| Candidate/attempt ID | One explicitly requested take and its execution attempts |
| Execution fingerprint | Effective inputs/settings used to decide whether work can be reused |

A changed global plan revision must not invalidate every node. A retry delivering the same intent is not a request for another take. “Generate another take” creates a distinct authorized candidate even when the prompt is identical.

Maintain two kinds of relationship:

- **Semantic influence:** wardrobe, setting, narrative state, or audio intent affects what a shot should depict. A change may require review, prompt revision, or regeneration.
- **Execution dependency:** an operation needs an actual output/choice before it can run, such as an accepted keyframe or predecessor clip.

The director records semantic influence in structured project data; the compiler handles mechanical dependencies and impact. Semantic influence alone does not serialize shots. Scene order and scene membership are not execution dependencies.

Reuse is based on consumed fields and exact input bindings, not the entire bible/project revision. At compile time, downstream references can be symbolic. Finalize an execution fingerprint only when actual input artifact identities are resolved. Include the effective prompt, input roles/content, model/profile, settings, and relevant handler/transform behavior. Exclude transient signed URLs, UI labels, and unrelated project edits.

Literal prompts and operation specs also record the creative intent and referenced bible constraints they were authored against. If framing, appearance, or action changes, require reauthoring or explicit reconfirmation before dispatch or reuse, even when the old prompt string and media fingerprint match. V0 can conservatively bind the full generation-relevant intent snapshot; narrower field dependencies need validated contracts. The compiler checks freshness, not whether prose is artistically correct. Executable patches update intent, prompt/spec provenance, and graph bindings together.

A matching generated take is eligible for explicit reuse, not an instruction to suppress a deliberate new candidate. Deterministic thumbnails, normalized clips, and render intermediates can use ordinary content-based caching.

## 4. User changes during execution

```mermaid
sequenceDiagram
    participant U as User
    participant A as Application
    participant D as Director
    participant C as Compiler/change service
    participant W as Workers
    U->>A: Make shot 7 a close-up
    A->>A: Persist edit scope and hold affected dispatch
    A->>D: Current shot, relevant context, active jobs
    Note over W: Unrelated work continues
    D->>C: Prepare scoped creative and plan patch
    C->>C: Recompile, compare, calculate impact
    C-->>A: Reuse / replace / review / render changes
    A-->>U: Explain effect and request only needed choices
    A->>C: Apply under existing or updated authorization
    C->>C: Atomic revision and binding update
    C->>W: Release affected hold; resume ready work
```

### Edit algorithm

1. **Capture scope immediately.** A storyboard edit identifies its target directly. For chat, use selected context or explicit object IDs; if the scope cannot be identified safely, pause new dispatch briefly at project scope and ask for clarification. Holds are persisted before lengthy planning begins and conservatively include known potentially affected semantic dependents and execution consumers. Unrelated known-safe work continues when the scope is known.
2. **Read current evidence.** Provide the director the target, relevant neighbors, consumed references, dependency summary, active candidates, and latest accepted decisions. The latest message changes that state; it does not replace the original objective.
3. **Prepare atomic changes.** The agent proposes the smallest meaningful set of changes: intent fields, reference bindings, operation parameters, selection policy, and editing consequences. Code calculates mechanical impact; the agent explains creative consequences and flags uncertain semantic relationships for review.
4. **Expand scope when necessary.** If a “shot-only” request also changes a continuity-dependent successor or a shared reference, extend the hold to block further dispatch. Newly discovered affected work might already have started; classify it under the in-flight rules and report that fact rather than promising retroactive prevention. Present the additional consequences. Do not automatically modify the global character reference for a local wardrobe change.
5. **Preview the patch.** Classify work as reuse, compatible in flight, regenerate, re-review, reassemble/re-render, or retire. Show estimated extra cost/time and accepted jobs that cannot be stopped. Ask only for unresolved choices or authorization beyond the current policy.
6. **Commit atomically.** Verify base revision, edit ownership, applicable holds, candidate bindings, policy, and budget. In one transaction, publish the new project/plan revision, preserve reusable bindings, retire obsolete unsent work, create authorized replacement intents, append events, and release/narrow only this edit's own hold. User pauses, other edits' holds, and unresolved gates still apply. External execution remains asynchronous.
7. **Resume from the graph.** Workers advance ready work directly. If another edit won the revision race, return its delta and rebase the proposed patch; do not silently merge conflicting creative changes.

Holds are visible, scoped controls. If the director crashes during an edit, leave the affected scope held with an actionable status. The user can resume the edit or discard it and resume the prior plan. An expired lease alone does not resume spending. After a successful patch, remaining required choices become explicit gates rather than forgotten editing holds.

### Concrete edit examples

| Request | Typical atomic change set | What is preserved |
|---|---|---|
| “Make shot 7 a close-up” | Change framing; reuse references; replace its keyframe/video candidate if needed; re-review direct continuation; update edit/render bindings | Other independent shots and their running jobs |
| “Trim shot 7 by one second” | Change source trim; validate handles/overlaps; adjust downstream timeline placement or flag audio constraint; rebuild edit/render | All generated takes |
| “Make Maya's coat blue throughout” | Change appearance requirement; identify affected shots via semantic influence; prepare a reference variant and replacement candidates; re-review continuity | Shots unaffected by the visible wardrobe and all historical takes |
| “Use take 2 instead” | Change selection binding; validate dependent continuation and trim ranges; reassemble/re-render where needed | Existing take 2 and independent clips |

A framing edit might not require regeneration if an acceptable crop exists; the agent can offer that cheaper/faster alternative with the composition tradeoff. Broader consequences are explained, not hidden behind a “regenerate project” action.

## 5. Results arriving while the user edits

The decisive boundary is persisted dispatch intent. Before it, a hold or superseded binding prevents submission. After it, treat work as potentially sent, retain its liability, and keep monitoring even if the user changes the plan. V0 H3 remote cancellation remains conservative because its API combines queued cancellation and terminal record deletion. [H3 cancel/delete contract](https://platform.minimax.io/docs/api-reference/video-generation-v2-delete)

Ingest outputs regardless of whether they are still selected. Attach a result to current work only if its logical node, candidate, and effective input binding still match. An unrelated project edit does not make it stale; an incompatible replacement does. Serialize binding updates against patch commits so late results cannot overwrite the latest intent.

Keep the last good timeline/preview while a working revision waits for replacement media. Render from a frozen, fully resolved timeline, never “latest take for each shot.” A late render for a superseded target is retained as history and cannot silently become the current preview.

Media effects cannot be rolled back transactionally. Undo creates a new project revision that reuses eligible earlier assets; it does not undo provider billing. Unknown submissions retain their uncertainty and allowance even when a replacement is approved.

## 6. Decision and execution controls

“Interrupt the director,” “pause dispatch,” and “edit this shot” are different controls. Persist director automation pause until explicit resume so a job event cannot immediately restart an interrupted conversation. A scoped edit holds only affected work; monitoring accepted jobs continues. Agent-issued resume and patch completion cannot clear a user pause or another edit's hold without the corresponding authorization; dispatch requires every applicable control to permit it. User requests take precedence over queued automatic review turns, with one active director turn per project to avoid competing proposals.

Discussion-only requests can save decisions and a non-executing proposal. Applying a creative change can be already authorized under the standing policy; it does not require repeatedly asking the user to approve harmless edits. Paid work or expanded scope beyond that policy produces a focused decision request. The director guides the user through choices while the application enforces the boundary.

## 7. First acceptance scenario

Using fake asynchronous operations, start two independent shot branches, hold one for a reference choice, and allow the other to finish. Edit the first shot while a task is in flight. Confirm that the old result is preserved without replacing the new candidate, unchanged work is reused, the current preview points to the latest resolved edit, and restarting the director/worker does not duplicate submission. Then repeat a bounded version with real providers.
