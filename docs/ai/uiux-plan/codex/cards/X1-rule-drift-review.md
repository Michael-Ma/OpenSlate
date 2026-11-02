# Card X1: find the bugs left behind by changed ground rules (server and core)

Read `docs/ai/uiux-plan/codex/RULES.md` and `_review-common.md` and follow them. Do not edit `apps/web/**`; the lead reviews the web and the web/server contract in parallel and will cross-check your findings.

## Why

Most real failures on this branch were not new code being wrong on its own. A ground rule changed, and older code kept the old assumption. The ones seen so far (read the named cards and reports in this folder and `../reports/` for detail):

| Seen | Rule that changed | Old assumption left behind |
|---|---|---|
| O1 | The Director may spend for a person's request (K1, P1), and that request's scope may be the whole film | `allows(actor, shot)` (request scope) was used as "this decision's selected work", so one scene's publication promoted other scenes' failures and demanded grants nobody gave |
| B1 (keyframe blockers) | Accepting a proposal (any path, incl. P1's typed accept) changes `imagePrompt` | Scene composition compiled unselected preserved branches against the new prompts; derived prompt intent went stale (`STALE_PROMPT_INTENT`) |
| B1 / L1 / event spam | A vendor reply without a task id can never be found again; every unknown outcome must end where a person can act | `lookup(attemptId)` was expected to discover work; a stuck `submission_unknown` attempt blocked its shot (`ATTEMPT_EXISTS`) and the reconciler appended 212,127 identical events |
| R3 / B25 / O1 | A Codex keyframe that never started is "not dispatched", not "no answer", and says why | Eight keyframes ended `LOCAL_NATIVE_UNAVAILABLE` with diagnostic category `native_unknown`: the reason was still lost |
| V1 | Voice lines and transcriptions follow the same failure rules as keyframes and clips | Their failures were not exposed at all |
| P1 / R6 | Contract 6.0.0 and skills v7 were amended in place with pinned identities | (audit) any lock, digest or epoch check that existing conversations could now fail |

## Do

Audit the server and core for **other places with the same shape**, one family at a time. For each family, list every candidate site with file:line, then classify it with evidence:

1. **Request scope used as selection.** Every use of `allows(`, `scopeIds`, `request.scopeIds`, `assertActor(…, true)` and request-derived target sets in planning, impact assessment, grants, candidates, holds, stops, releases, notes settlement, quotes and video confirmation. Where does a whole-film Director request (or a human request with project scope) let one decision touch, price, start, hold, settle or refuse work outside what it selected?
2. **Whole-film recompilation reaching unselected work.** Every entry that composes or publishes a plan (keyframes, regenerate, scene video confirm, voice runs, narration fit, storyboard edits, proposal accept/undo, takes/undo, script approval, export). Can it change, outdate, retire, re-grant or block another scene's or shot's nodes?
3. **Writers of creative fields that leave derived state stale.** Every path that writes shot fields (`imagePrompt`, `motion`, `narration`, duration, order, scene membership): human edit, Director edit, proposal accept (human and on the person's word), undo, takes, script approval, fixtures in `demo.ts`. Do derived fields (`promptIntent`, spec digests, reviewed holds, notes, quotes) stay consistent so the next generation is not refused?
4. **Unknown or stuck outcomes without an exit.** For every attempt kind (image via each provider incl. Codex native, video, speech, transcription, local work, render/export): list each non-terminal phase and prove it reaches either a terminal state or a state the person can resolve (Give up), without blind resubmission and without unbounded event or record growth. Include restart and shutdown.
5. **Codex native start reasons.** Why can a native start end as `LOCAL_NATIVE_UNAVAILABLE` / `native_unknown` after B25? Trace from `codex-image-execution.ts` and the native start path to what would be needed to keep a safe, allowlisted reason. No real Codex run.
6. **In-place contract amendments.** Any check (lock digests, catalog digest, handler ids, epoch bindings, frozen history) that a conversation or record created before the P1/T1/T2/K1/V1 amendments could now fail, or that would silently accept a mismatched lock.

For each confirmed bug: a regression test that fails before the fix, then the smallest fix in server/core that keeps the existing safety rules (exact grants, no paid work without the person, no resubmission). For anything that needs a product decision or a larger redesign, do not change it: describe the failure scenario, the options and your recommendation under Open issues. Mark each finding Confirmed (test or data), Plausible (reasoned, not reproduced) or Cleared (looked, fine, with the reason).

Use the snapshot at `/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad/diag-o1/openslate.sqlite` (read-only, or your own copy) where real data helps. Never touch `~/openslate-branch-test`, port 3001, `.openslate/` or `.env*`. No real provider.

Report to `docs/ai/uiux-plan/codex/reports/X1-report.md`: a findings table (family, site, verdict, severity, fix or recommendation, test), then the Open issues, then what the sample film must mirror.
