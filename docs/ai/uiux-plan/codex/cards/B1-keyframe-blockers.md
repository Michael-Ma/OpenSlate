# Card B1: why the Director could not start new keyframes after the location proposals were accepted

Read `_review-common.md` in this folder first. This is a diagnose-then-fix card on real data.

**Data:** a read-only snapshot of the owner's test studio is at
`/private/tmp/claude-501/-Users-michael-SideProject-OpenSlate/b3c22663-40b8-4c47-8821-cc9f357b9b78/scratchpad/diag/openslate.sqlite`
(project `22661e3e-8bc3-4abf-96ad-10738e28b87d`; tables `entities(kind,id,project_id,body,version)`, `events`, `commands`). Open it only with `sqlite3 -readonly "file:...?mode=ro"` or copy it into your own temp dir before running the app against it. Never touch `~/openslate-branch-test`, port 3001, `.openslate/live-validation` or any `.env*` file. Do not start any real provider; no media may be bought.

**What happened** (Director turns `9d7a17ad-…` and `71b9bed9-…`, see `director_output`, `tool_invocation`, `director_proposal`, `attempt`, `hold`, `epoch` entities):
- The person accepted Director proposals that rewrote `imagePrompt` for shots in scenes 3–6 (locations moved to bridge, factory door, loading dock, parking garage). Asking for new keyframes for those shots then failed with `STALE_PROMPT_INTENT` ("prompt differs from the accepted shot prompt" / "not authored for the current shot intent"). Likely lead: accepting a proposal changes `imagePrompt` without re-authoring `promptIntent` (see `packages/core/src/planning/index.ts:194`, `apps/server/src/execution/engine.ts:936`, `director-proposals.ts` `proposalCommand`), or the Director's request carried an old prompt. Find the real cause in the data, do not assume.
- Shots in scenes 1–2 failed with `ATTEMPT_EXISTS` ("existing task pending, cannot resubmit"; the Director said the old job's outcome was unclear). Find which attempt blocks them, what phase it is in, and why it never reached a terminal state or a state the person can resolve. `scene-generation.ts:373,414`, `engine.ts:1021`, `shot-takes.ts:37`.

**Do:**
1. Write the diagnosis (timeline from the data, root cause for each) in your report.
2. Fix the root causes in the server/core so that: an accepted proposal (from any path, including a Director accept on the person's word, which track P1 is adding in parallel through the same `proposalCommand`) leaves its shots ready to generate with the accepted prompts, without a separate re-author step the person never sees; and a keyframe attempt whose outcome is unknown or stuck is either reconciled automatically or surfaced with a clear way to resolve it (whichever the existing recovery design intends; read `apps/server/src/application/recovery-routes.ts` and the recovery records). Never resubmit paid work blindly.
3. If the Director's guidance made it send stale prompts, fix the 6.0.0 guidance / skills v7 in place (same exception as N1: never released; keep identities pinned).
4. Regression tests that reproduce each failure from a minimal fixture shaped like the snapshot (do not commit the snapshot), failing before the fix.
5. Do not edit `apps/web`. List anything the sample film must mirror.

Track P1 runs in parallel and edits `director-proposals.ts` for new Director tools. Keep your edits there minimal and focused so the merge is easy.
