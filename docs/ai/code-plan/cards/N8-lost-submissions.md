# N8 · Settle lost Viggle submissions by asking Viggle

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full: no real provider call, no network beyond loopback, never read `.env*`, never start anything on port 3001. N6 and N7 are merged; build on them.

## Problem

2 of 11 real Viggle submissions ended `SUBMISSION_RESPONSE_LOST`: the owner's Tofu film on October 30 and a test film on November 1. Both failed about 200 ms after dispatch with no HTTP status (`VIGGLE_H3_TRANSPORT_OR_RESPONSE_LOSS`). Every such failure stops the film, counts the clip as possibly charged and needs the person's consent, although **Viggle had created no task in either case**. `GET /v1/videos` proves it.

The cause is unknown: `call()` drops the error, and 20 free test requests did not reproduce it. Viggle has no idempotency key, and its docs say not to retry a create "unless your integration can safely determine that no resource was created". The list endpoint lets us determine that.

Live evidence for the endpoints:

- `GET https://apis.viggle.ai/v1/videos?limit=12` returns `{has_more, items: [{id, status, created_at, completed_at, progress, stage}]}`, newest first, across every task of the account. `created_at` is ISO 8601 UTC with second precision.
- `GET https://apis.viggle.ai/v1/credits` returns `{balance}` in credits.

## Change

1. **Keep the evidence.** When `call()` fails with no HTTP status, record the error's name, and its cause's `code`, `name` and `syscall`, in the diagnostic. Only these allow-listed strings: never a message, URL, header or body. Show them nowhere new; they are for the receipts and logs, so that the real cause can be found next time.
2. **Adapter.** Add `listVideos(limit)` to `packages/providers/src/viggle-h3.ts`, using the same `call()` path and the same strict parsing. Unknown fields are ignored. A malformed answer is an error, never an empty list.
3. **Settle a lost submission.** When a code-plan Viggle submit ends unknown with no HTTP status, do not finish it yet. Check the list twice, about 10 s and 30 s after dispatch, with the timing injectable. Durable across a restart: a settlement in progress must resume, not be forgotten.
   - A task *belongs to us* if its id is in any `viggle_h3_execution_submit` row of this installation.
   - A *stranger* is any listed task created at or after `dispatchedAt − 60 s` (clock skew) that does not belong to us.
   - **No stranger in both checks:** record positive evidence that nothing was created. The attempt ends as not submitted, exactly like a `CONNECT_` failure: no liability, `retry: "safe"`, and the existing automatic retries apply.
   - **A stranger, or the list cannot be read, or `has_more` means the window was not fully seen:** keep today's `SUBMISSION_RESPONSE_LOST`, with `retry: "consent"` and the charge counted as possible. Page through `has_more` while the window is not exhausted, at most 3 pages.
   - Never adopt a stranger as our task: another studio can share the key.
4. **Scope.** Code-plan Viggle only. Graph films keep their behaviour. An attempt that ended before this change stays as it is.
5. **Prices the Director reads.** Viggle's `priceBasis` lists every resolution, and on November 1 the Director took that as an option, passed `resolution` and had its first plan refused. Give only the profile's resolution and its credits per 5 s, for each mode.
6. **Tests**, offline, through the fake Viggle transport:
   - lost submit, empty window: released, retried automatically, no liability, and the retry makes one task;
   - lost submit, stranger in the first check, and in the second check only: stays consent;
   - our own sibling task in the window is not a stranger;
   - list error, malformed list and an unexhausted page limit: stay consent;
   - a restart during settlement resumes and reaches the same result;
   - the diagnostic holds the cause's code and no message;
   - a submit with an HTTP status never enters settlement;
   - `priceBasis` lists one resolution.
7. **Docs:** `docs/technical/EXECUTION-ENGINE.md` and a `docs/implementation/STATUS.md` entry.

## Files you own

`packages/providers/src/viggle-h3.ts`, the Viggle execution, receipt and recovery files, `apps/server/src/code-plan/**`, tests and the docs above. Do not touch `apps/web/**` or `packages/core/src/studio-api.ts`; if the contract must change, list it in your report.

## Report

Write `docs/ai/code-plan/reports/N8-report.md`: what changed, the checks you ran with their results, anything you could not do, and any contract change you need.
