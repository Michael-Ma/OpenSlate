# Done

Card: `cards/B1-keyframe-blockers.md` (the October 27 diagnose-and-fix card, not the earlier P1 foundation card).

Completed both B1 failures: scoped keyframes use the accepted prompts across preserved multi-scene plans, including their subsequent voice step; unresolved generation work names its exact blocking attempt and the intended human recovery. Proposal acceptance still uses the existing shared `proposalCommand`, so P1's parallel Director-accept path receives the same behavior without a new reauthor action. All required checks pass.

## Diagnosis from the snapshot

The snapshot contains **three scenes and ten shots**. The card's “scenes 3–6” describes sequential shots 3–6, which belong to the second scene. Diagnosis used a task-owned copy under `/private/tmp`, opened with `sqlite3 -readonly 'file:…?mode=ro&immutable=1'`. Plain read-only mode could not open the WAL-mode snapshot without its sidecars. The snapshot was never run as an application database. No snapshot database, original prompts or media is included in the regression fixtures.

All timestamps below are UTC.

| Time | Saved evidence | Meaning |
| --- | --- | --- |
| October 21, 07:45:57.231 | Video attempt `cdfa0d46-3385-4217-909c-94929f0695af`, node `e5b04704-cd62-40fc-a4d5-ee1397639d3d`, shot `5422c0b6-1712-475f-bbbc-aea71c3eff5e` (first scene, second shot) | The only nonterminal attempt in the snapshot. All ten image attempts and the other video attempt succeeded. |
| 07:45:57.262–.556 | Viggle dispatch, submit and execution-evidence records | Submission lost its transport/response (`VIGGLE_H3_TRANSPORT_OR_RESPONSE_LOSS`); no task ID, HTTP status or provider request ID was recovered. The attempt became `submission_unknown`. |
| October 27, 02:01:46.231 | Proposal `c15f064d-9a7a-4893-a9ff-07f2e226c12b`, event 100443, head 10 | Accepted new prompts for shots 1–2. Event 100448 detached the old video candidate as stale; the unknown attempt retained its liability. |
| 02:01:47.687 | Proposal `da95a980-d02b-4d21-9ae8-3b31eb0ca88b`, event 100461, head 11 | Accepted bridge/factory/loading-dock/parking-garage prompts for shots 3–6. |
| 08:18:00.002–08:18:43.919 | Director turn `9d7a17ad-d6be-4fcf-b5f4-41ff1f2328e7` | `make_keyframes` refused the first scene with `ATTEMPT_EXISTS` and the second scene with `STALE_PROMPT_INTENT`; no new work started. |
| 18:27:48.517–18:28:28.772 | Director turn `71b9bed9-c3e7-480b-b5b5-b40e755eab3e` | A second request for the second scene failed with the same prompt error. |
| 18:28:53.789 | Proposal `a7495030-d126-4f9b-a7d1-b785fe36b276`, head 12 | The third scene's proposal was accepted after both failed turns. |
| Through 18:36:16.868 | Unknown attempt reconciliation records | There are 212,084 repeated unknown-state events for this attempt, corroborated by its lease epoch. These are replays of saved evidence, not 212,084 network polls. There are no `attempt.released` events. Observation cannot prove rejection and must never restart the paid submission. |

### Prompt root cause

The suggested missing `promptIntent` reauthoring was **not** the cause: image intent digests match every shot in all 13 stored project revisions. `creative()` already adds `reauthorPrompts: true`, and `publishHumanCreativePatch()` binds current prompt intent. The Director's `make_keyframes` arguments contain IDs, not prompt strings; there is no evidence of stale-prompt guidance in contract 6.0.0 or skills v7.

The active saved plan (`1b64a765-fbad-417c-bba1-442d39d45075`) retained source authored against revision `89bd3c89-2cf5-4fe8-96b0-c1e5d4ac781e` (head 7). Proposal acceptance deliberately preserved that plan and its paid media. `composeScenePlan.verifyBase()` rewound the selected scene's prompts for source verification, but compiled unselected scenes' old source against their newly accepted prompts. A request for the second scene therefore failed first on the first scene's old image prompt. This was an unrelated-branch composition error, not missing human acceptance or generation authority.

### Attempt root cause and recovery

The first scene is blocked by the detached **video** attempt above, not a keyframe attempt. The historical-job guard is correct: it prevents buying another keyframe while unresolved old work could still finish. Without a task ID, the Viggle adapter can only replay its saved unknown outcome. Automatic resubmission or declaring failure would invent certainty.

The existing recovery route and Inspector already implement human release: select the shot in Keyframes, use **Give up** on its unanswered video, acknowledge that both jobs may be charged, then make a fresh generation decision. Release keeps reconciliation and committed liability; a late result stays historical. The Director previously received only a generic refusal and could not name this actionable recovery path. The fix exposes bounded, allowlisted attempt identity and human-only resolution information in that refusal.

# Files

Changed:

- `apps/server/src/scene-generation.ts`: compile selected current shots alongside proved historical unselected picture branches; retain existing freshness, scope, candidate and unknown-job guards.
- `apps/server/src/narration/narration-speech-composition.ts`: permit a standalone voice line after that mixed visual plan while preserving exact source revision, nodes, reviews and current narration authority.
- `apps/server/src/application/director-keyframes.ts`: retain typed recovery in saved refusals, cap detailed identities across the entire response, and accurately say no generation started when every scene was refused.
- `apps/server/src/app.ts`: expose only the typed, allowlisted blocker recovery as HTTP error details.

Added:

- `apps/server/src/scene-plan-context.ts`: pure compilation-only historical shot/cue projection; prove every saved picture prompt/intent, protect selected shots and refuse conflicting cues.
- `apps/server/src/application/generation-blockers.ts`: current/detached attempt projection with phase, shot, kind, and the existing human release action for eligible unknown submissions. Known running/ingesting work offers observation only.
- `apps/server/test/scene-generation-proposals.test.mjs`.
- `apps/server/test/scene-plan-context.test.mjs`.
- `apps/server/test/scene-plan-speech.test.mjs`.
- `apps/server/test/keyframe-blocker-recovery.test.mjs`.
- This report.

Deleted: none. No `apps/web`, `director-proposals.ts`, core compiler, tool catalog, skill or status-document edits. The additional narration module is necessary because keyframes with a voice line otherwise encounter the same stale preserved branches in their next step.

# Tests

All providers used in tests are fake; regression fixtures reproduce the snapshot's structure without copying its contents. Existing money/integrity tests are retained: no double purchase, no blind resubmission, idempotent replay, stale-version refusal, historical-source validation and late-result isolation.

Observed red proofs before the respective fixes:

- Accepted-proposal regression: **0 passed / 2 failed**, both the exact `STALE_PROMPT_INTENT` failure, despite valid accepted prompt intent.
- Recovery regression: **0 passed / 2 failed**, both missing recovery identities on the actual blocked path.
- Mixed-plan speech regression: **1 passed / 2 failed**; stable source failed with stale prompt, versioned source with `UNKNOWN_REFERENCE`, and tampered-recipe refusal remained passing.

Additional read-only real-snapshot verification used project head 11 and the second scene: direct composition reproduced `STALE_PROMPT_INTENT`; the fixed compilation context compiled **four selected keyframes**, preserved **eight unselected nodes** byte-for-byte, kept the input project unchanged, and made **zero provider calls**. No compiled plan was published.

The first related run returned **263 passed / 28 failed / 0 skipped (291 total)**. One matrix case rerun alone returned **0 passed / 1 failed**; the historical backup/rebase files rerun together returned **3 passed / 28 failed (31 total)**. These were real regressions in the initial speech extension: changed source-header identity and bypassed missing/forged original evidence. The correction preserves the exact owned source snapshot and header, checks same-revision picture semantics before any duplicate-history search, and tries the original historical composition path before the mixed-branch fallback. No existing test was weakened or rewritten.

The corrected three-file speech run returned **35 passed / 1 failed (36 total)**: all **31 existing** tests passed, and the sole failure was a new fixture copying an old entity ID into a newly keyed revision. Matching that fixture's entity ID to its new revision key fixed it; its isolated file then passed **5/5**. Final verification results follow below.

Self-review and independent review checked cross-file callers, preserved candidates/approvals/outputs, selected-shot freshness, cue conflicts, missing/forged history, current speech authority, HTTP information boundaries and unknown-job liability. Review found and corrected the speech provenance issues above, versioned-reference handling, aggregate refusal size and inaccurate no-start guidance. Final source review has no outstanding must-fix finding.

**22 tests added**: two accepted-proposal integration cases, twelve historical-context boundaries, five mixed-plan speech cases and three recovery cases. **Zero existing tests rewritten, deleted or disabled.**

| Final check | Observed result |
| --- | --- |
| `pnpm setup:test-media` | Passed without a download; installed tools matched the pinned profile. |
| `pnpm check:toolchain` | Passed: Node 24.15.0, pnpm 10.33.0, FFmpeg/ffprobe 8.1.1 and required encoders. |
| `pnpm build` | All five package/app builds passed. Vite reported its existing large-chunk advisory. |
| `node scripts/run-tests.mjs` with all four added and thirteen related test files | **293 passed, 0 failed, 0 skipped/cancelled/todo**. |
| `pnpm test` | **3,977 passed, 0 failed/cancelled/todo, 1 optional native-probe skip (3,978 total)**. One full-suite run after the corrected implementation. |
| `pnpm -r typecheck` | **5/5 package/app typechecks passed, 0 failures**. |
| Changed-file whitespace inspection | 11 files checked; zero trailing-whitespace issues. |

The related files are `scene-generation`, `director-proposals`, `director-keyframes`, `stop-release`, `takes-undo`, `generation-overview`, `narration-speech-plan-rebase`, `narration-speech-service`, `narration-speech-historical-backup` and `narration-speech-backup` under `apps/server/test`, plus `scene-composition`, `scene-composition-narration-revision` and `speech-composition` under `packages/core/test` (all `.test.mjs`).

Validation used disposable fake-provider state, synthetic media, local compilation and loopback tests. No browser/browser-check, real provider/model call, external-network request, credential-file read, production-state operation, production restart or port-3001 listener was used. No Git mutation was performed; changes remain uncommitted for lead review.

# Contract changes

None to `packages/core/src/studio-api.ts`. No schema migration, frozen tool catalog, skill package or `director-proposals.ts` change is needed.

Additive internal result metadata: `make_keyframes.refused[].recovery` and typed `ATTEMPT_EXISTS` HTTP `error.details` carry the safe recovery projection. Input schemas, catalog identities and pinned digests are unchanged. Detailed identities are limited to twenty across a Director receipt; every refused scene retains its code, count and human-facing inspection instructions.

# Commits

No commits made; the lead owns review and commits. Proposed split:

1. `fix(server): generate accepted scene prompts across preserved plans` — `scene-plan-context.ts`, `scene-generation.ts` (composition import/type/call), `narration/narration-speech-composition.ts`, and the three `scene-generation-proposals` / `scene-plan-context` / `scene-plan-speech` test files.
2. `fix(server): explain unresolved generation jobs and human recovery` — `application/generation-blockers.ts`, `application/director-keyframes.ts`, `app.ts`, `scene-generation.ts` (job-guard hunks), `keyframe-blocker-recovery.test.mjs`, and this report.

Split the shared `scene-generation.ts` hunks when staging; neither change edits the concurrently owned proposal command.

# Open issues

- No unfinished implementation or failing required check remains. Browser/sample-film replay and any operation on the owner's live film remain with the lead under the card's boundaries.
- Decision: preserve the existing human-release recovery design instead of automatically replaying an unknown paid submission. The unknown task cannot be proven failed from this snapshot.
- Decision: leave 6.0.0 guidance and skills v7 unchanged because the recorded keyframe requests carried no prompts and proposal acceptance already authored valid intent.
- Sample-film parity: reproduce accepted prompt changes in more than one scene before generating a single scene; include an unanswered detached video on a shot, with Give up and the double-charge acknowledgement followed by a fresh paid press. No `apps/web` edits are included; browser replay belongs to the lead.
- The owner's live film has not been modified or repaired in place. Deploying this source does not itself release the old unknown job or buy replacements.
