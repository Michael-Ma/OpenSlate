# P1 — accept or decline a proposal from the person's message

## Done

- **P1.1 tools and application:** contract 6.0.0 now exposes `accept_proposal` and `reject_proposal`, each taking exactly `{proposalId}`. The application accepts an exact proposal ID or a case-insensitive app-assigned note letter, checks the current typed editing request, and calls the same `proposalCommand` as the banner. The current Now/After digest is captured inside that command's transaction; the model cannot supply a digest or actor. Patch publication, touched fields, linked-note acceptance, competing-choice settlement, media invalidation and web Undo retain the existing banner behavior.
- **P1.1 authority and provenance:** app-created, automatic, keyframe-review, review-answer, discuss-only and read-only turns receive `PROPOSAL_DECISION_NOT_AUTHORIZED`. The proposal must also fit the current human request's scope. Decisions carry the actual human message ID and `director_on_user_request` in the view, receipt and `proposal.changed` event. The proposal's original top-level `requestId` continues to identify its creation request. Banner decisions carry `human` provenance. Old stored views/receipts may omit this optional field.
- **P1.1 first wins and recovery:** banner/tool races publish once; settled or dynamically stale proposals receive `PROPOSAL_STALE` with their current state in the message. A duplicate invocation returns its original receipt; a changed use of its identity is refused. The authoritative decision receipt commits with the nested command, patch, note and event. Lost transport replies reconcile from this receipt without executing the tool again. A failure to save the authoritative receipt rolls the entire decision back and leaves the invocation unresolved for explicit follow-up.
- **P1.2 guidance:** skills v7, the 6.0.0 descriptors, film guidance and native input tell the Director to accept/decline a specific proposal on a clear human message, identify it by letter/subject or a clear reference to the only held proposal, ask which one when ambiguous, report the actual result and continue the person's other requested work with accepted prompts. Video remains a clicked `confirm_video` decision after the exact frames are opened. Keyframe request authority is unchanged.
- **P1.2 current context:** the V6 `read_context` notes section now includes current proposal views alongside note items. Both collections share bounded pagination and one data digest, including proposals with no linked note. This makes subject/only-held disambiguation and current-state reporting possible. V5 retains its previous notes-only shape.
- **P1.3 fake Director:** a bounded `accept|reject|decline proposal <letter-or-id>` path calls the actual tool. It reports successful accepted fields and Undo, unchanged direction on decline, current state on refusal, and an unresolved receipt honestly without a retry.
- **P1.4 compatibility:** complete V1–V5 catalog/handler digest pins and skill packages v1–v6 remain unchanged. The exact pre-P1 6.0.0/v7 branch identity remains shipped; its complete source fixture was captured before amendment. The new pair is appended, and automatic fresh-turn plus explicit same-version upgrades preserve old locks, snapshots and application work.

Source and patch review covered authority, callers, scope, first wins, receipt failure boundaries, note parity, Undo, current context and historical compatibility. Independent backend and catalog reviews found no outstanding must-fix issue. One fake-Director review finding was fixed: a lost transport receipt after a committed acceptance must report uncertainty plus the saved state, not say that the proposal was not accepted. The supervisor already revokes an epoch in the same transaction as terminal turn settlement, so existing epoch checks fence terminal calls without a second turn-state predicate.

## Files

Changed:

- `packages/core/src/tools.ts`
- `packages/core/src/studio-api.ts`
- `packages/core/test/guidance-successor.test.mjs`
- `packages/director/test/tools.test.mjs`
- `packages/director/test/runtime-fixture.mjs`
- `packages/director/test/skills-v7.test.mjs`
- `apps/server/src/application/director-proposals.ts`
- `apps/server/src/application/tool-invocations.ts`
- `apps/server/src/application/context-projection.ts`
- `apps/server/src/application/director-shipped-guidance.ts`
- `apps/server/src/application/director-input.ts`
- `apps/server/src/application/film-planning-guidance.ts`
- `apps/server/src/application/fake-director.ts`
- `apps/server/test/director-guidance-maintenance.test.mjs`
- `apps/server/test/director-successor-host.test.mjs`
- `skills/v7/plan-authoring/SKILL.md`
- `skills/v7/plan-authoring/openslate.skill.json`
- `skills/v7/plan-authoring/references/grammar.md`
- `skills/v7/production/SKILL.md`
- `skills/v7/production/openslate.skill.json`
- `skills/v7/production/references/current-contract.md`
- `skills/v7/production/references/keyframes.md`
- `skills/v7/production/references/notes.md`
- `skills/v7/production/references/stages/review.md`
- `skills/v7/production/references/stages/video.md`

Added:

- `apps/server/test/director-proposal-decisions.test.mjs`
- `apps/server/test/fake-director-proposal.test.mjs`
- `apps/server/test/fixtures/director-guidance-v7-before-p1.json`
- `docs/ai/uiux-plan/codex/reports/P1-accept-on-word.md`

Deleted: none. No `apps/web` source, STATUS, DDL, released catalog or older skill files changed. Builds produced only their ordinary ignored output. `context-projection.ts` is the extra application file needed to expose current proposal evidence; `director-shipped-guidance.ts` is where this repository actually keeps the required compatibility pins.

## Tests

Added **53 regression cases**: 35 application/receipt/context cases, 11 fake Director cases, one schema case, two stdio cases and four guidance compatibility cases. They cover the card's failure matrix, exact request provenance, scope, current preview, all settled states, banner/tool orderings and simultaneous acceptance, web Undo, repeat/changed call identity, both receipt failure boundaries, ambiguous letters, paginated current states, V5 compatibility and acceptance followed by keyframes built from the accepted prompts.

Seven existing tests were rewritten for the amended design or its new immutable identities:

- Core `V6 proposes all creative shot fields and scene title independently of purpose`: includes both new tools in the V6 name list.
- Director `every shipped tool catalog has an immutable complete catalog and handler digest`: updates only V6's current pin.
- Director `every shipped skill package has an immutable packageDigest`: updates only the amended v7 package pins.
- Server `K1 preserves the exact earlier 6.0.0 catalog and V7 package identity alongside the amended current pins`: expects the newly appended fourth 6.0.0 identity while retaining every predecessor.
- Server `current host guidance offers chat confirmation and preserves clicked application authority`: scopes the click-only stance explicitly to video and its open `confirm_video` choice.
- Director skills `V7 keeps clicked confirmation for video while clear typed decisions settle proposals` replaces the obsolete test `V7 uses clicked chat choices for video, remakes and proposals without claiming reply authority`: explicit proposal messages now have authority, and ambiguous messages still do not. The shared runtime fixture also advertises the complete amended V6 catalog.
- Server `contract-6 host guidance permits typed proposal decisions and requested keyframes while video requires a clicked chat or workspace choice` replaces the earlier video-only test title and blanket reply assertion. It keeps clicked-video/no-start, paid-state, transcription and V5 boundaries and now checks typed proposal tools, identity, user/editing source, ambiguity and continuation in both injected host outputs.

No tests were deleted, disabled or skipped to accommodate this card. Existing money and integrity tests remain, including idempotency, stale-version refusal and no blind unknown-outcome resubmission.

Verification uses Node **24.15.0**, pnpm **10.33.0**, FFmpeg/ffprobe **8.1.1**. `pnpm setup:test-media` found the pinned system tools and downloaded nothing; `pnpm check:toolchain` passed.

| Final check | Result |
| --- | --- |
| `pnpm build` | Passed all five workspace builds; existing web chunk-size advisory only. |
| Touched and related files, using `node scripts/run-tests.mjs` | **317 passed** across the 312-case run and corrected 5-case host file; **0 failed, cancelled, skipped or todo** in those final runs. |
| `pnpm test` | **4,008 passed; 0 failed/cancelled/todo; 1 optional native Codex probe skip; 4,009 total.** Includes a successful build. |
| `pnpm -r typecheck` | **All 5 workspace package/app typechecks passed; 0 failed.** |

The 14-file focused command selected `guidance-successor`, Director `tools`, `runtime`, `skills-v7`, server `director-guidance-maintenance`, `director-proposal-decisions`, `fake-director-proposal`, `fake-director-confirm`, `director-proposals`, `tool-invocations`, `context-projection`, `director-keyframes`, `director-keyframe-reconciliation` and `director-input-identity`. The additional touched file `director-successor-host` passed its complete five-case isolated run after the full suite exposed the obsolete assertion described below.

Earlier exploratory failures: a combined fake/guidance/video run returned 22/26. The three new `V6 fake Director truthfully reports proposal refusal for` cases (`{"source":"app"}`, `{"editing":false}`, `{"review":true}`) wrongly expected a failed durable invocation, but authorization refuses before dispatch; those assertions now require only the context read and no decision effects. `V6 fake Director preserves an unresolved acceptance receipt without retrying or denying the saved effect` ran stale compiled output; rebuilding incorporated its corrected truthful wording. All four passed in the isolated fake suite (11/11) and in the final 312-test run. No unrelated failing test is hidden by a changed expectation.

The first full run also found `contract-6 host guidance directs requested keyframes and eligible transcription while video requires a clicked chat or workspace choice` in `director-successor-host.test.mjs`. Isolating that file reproduced **4 passed, 1 failed**: its exact blanket `Chat replies...` assertion no longer matched the deliberately video-scoped guidance. The rewritten expectation above passed the complete isolated file, **5/5**. No production source or build output changed for this correction.

That first full `pnpm test` finished with **4,007 passed, 1 failed, 1 optional native-probe skip; 4,009 total**, zero cancelled/todo. The obsolete assertion was its only failure. The complete final rerun after the correction passed **4,008 tests with zero failures and the same one optional skip (4,009 total)**. The subsequent exact `pnpm -r typecheck` command passed core, providers, Director, web and server. There are no outstanding check failures.

## Contract changes

One additive optional field in `packages/core/src/studio-api.ts`:

```ts
DirectorProposal.decision?: {
  action: "accept" | "reject";
  actor: "human" | "director_on_user_request";
  requestId: string;
  at: string;
};
```

The field is present inside the ordinary `ProposalReceipt.proposal` and proposal list views. An accepted view retains it through Undo as historical decision provenance. Existing historical records may omit it. Accept/reject HTTP request shapes are unchanged.

The server-internal V6 notes-context response also gains a paginated `proposals` collection; this does not change the browser API. Only tool contract 6.0.0 adds the two decision tools. V1–V5 tool descriptors, schemas and catalogs remain pinned unchanged.

## Commits

No commits made. Proposed conventional commits for the lead:

1. `feat(director): accept and decline proposals from typed requests` — all source, skill, test and historical fixture files listed above, together so the amended catalog, manifests and shipped identity pins stay atomic.
2. `docs(director): record P1 proposal decision verification` — this report.

## Open issues

No remaining blocker to the backend card. Decisions and handoff boundaries:

- **Letters:** notes assign letters per turn. The server accepts a letter only if it maps to exactly one proposal across the film's retained notes. A letter reused by several turns, or a note containing several proposal choices, returns `PROPOSAL_AMBIGUOUS`, even if only one is still held. The Director should read current notes/proposals and use the exact ID once the subject is clear. It must never redirect a late acceptance to a different proposal.
- **Declines:** they deliberately retain the existing banner's behavior: the proposal becomes rejected, its linked note remains open and there is no rejection Undo. The one-line Undo promise applies to accepted changes. No new decline semantics were introduced.
- **Authority:** model understanding selects the intended proposal; application code verifies source, editing epoch, ownership, scope, preview and state. It does not keyword-match natural-language consent. The scripted fixture's recognized grammar is intentionally narrower than real model understanding. Ordinary new typed messages still fence prior epochs.
- **Saved branch calls:** verified predecessor 6.0.0/v7 locks upgrade on fresh turns and their bytes are retained. The existing current-digest-only `reconcileEpoch` logic can leave an unresolved pre-P1 6.0.0 invocation as `needs_followup` even when its old durable receipt exists. This is an inherited amendment limitation, retains the evidence and never replays the call. P1's new decision calls have exact receipt reconciliation; no predecessor-recovery expansion was made.
- **Lead-owned sample film/web parity:** mirror the `decision` field exactly; top-level proposal `requestId` is creation provenance while `decision.requestId` identifies the typed acceptance/decline. For accepted `director_on_user_request`, show the message-origin acceptance and the existing Undo action. Preserve historical views without the field. Mirror `PROPOSAL_DECISION_NOT_AUTHORIZED`, `PROPOSAL_AMBIGUOUS`, `PROPOSAL_STALE`, `PROPOSAL_PREVIEW_CHANGED` (human preview mismatch), `SCOPE_DENIED`, ownership `ACTOR_DENIED`/`NOT_FOUND`, identity `IDEMPOTENCY_CONFLICT` and unknown `TOOL_CALL_UNRESOLVED` boundaries. Use the app-computed current preview; preserve single publication under races, linked-note acceptance (`choiceIndex`, `resultRef`, `elsewhere: true`), competing proposal rejection and ordinary Undo/reopening. Respect the scoped editing human-source guard, reject parity, exact retry identity and unresolved-state reporting. Keep video as a clicked `confirm_video` after opened frames; accepting a proposal starts no media. A separately requested keyframe call may follow using the saved accepted prompts. No web/sample code was changed under this card's ownership rule.
- **Validation boundary:** all validation used disposable local state, fake runtimes/providers, synthetic media and loopback. No browser was launched, no real provider/model or external-network call was made, no credentials or production state were read, and no port 3001 listener was started. Rendered sample-film parity and real conversation quality remain lead-owned validation.
- **Process:** the initial read-only branch/status check confirmed clean `cx/p1` before the common card rules were read. No later Git operation, commit, stash, branch switch or reset was performed. Review used the authored patches, current source and independent code review. All work remains inside the assigned worktree.
