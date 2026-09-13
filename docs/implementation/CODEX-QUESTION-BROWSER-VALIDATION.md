# Native question and browser answer validation

September 12, 2026, local time. **A real native question was answered through the built browser after reopening the application and its saved director setup.** The question took **5.556 seconds** and the answer **4.484 seconds**, using commit `e1d2c22`, Codex **0.153.4**, **gpt-6-astra**, low reasoning effort and Node **24.15.0**. The continuation passed **22 harness checks**; an independent audit passed **14 checks**, including another read-only database reopen. There were **two actual native starts**, advancing the recorded historical count from **19 to 21**, and zero media API calls. Identities, checks and limitations are in [the sanitized evidence record](codex-question-browser-evidence.json).

## What happened

The disposable application used the production loopback origin and authentication policy on `http://127.0.0.1:3001`. Its new project belonged to the actual HTTP principal, `local-user`. Native setup checked the installed runtime without a model turn. The reviewer explicitly triggered one authenticated read-only request asking for a structured Tone question with Warm, Neutral and Formal choices.

Codex produced the native question, “Which tone would you prefer for the film?”, with **Warm (Recommended)**, **Neutral** and **Formal**. OpenSlate saved the pending question, ended the original turn in `waiting_user`, and revoked its epoch. The native result was the expected `RUNTIME_INPUT_REQUIRED` interruption used to hand control back to the application.

The first harness then failed its own overly strict label assertion: it expected `Warm` verbatim. This was a **harness validation failure after a successful, acknowledged question**, and remains in the original report. Cleanup archived that native thread and closed the application. The first turn was not repeated and its allowance slot was not reset.

A separate, explicitly requested continuation verified the original report, sole acknowledged dispatch, pending question, exact saved runtime selection, read-only owner, revoked epoch and unchanged project state before reopening the same database. Only recognition of the terminal ` (Recommended)` display suffix changed; the stored question and options were preserved exactly. The continuation report links the original report by its canonical digest and retains the original failure. Rechecking the saved setup started no model.

The reviewer then used the built browser to click **Answer this question**, enter only **Warm**, and submit once. The normal browser request contained the answer and exact question ID. It passed through the authenticated messages route, `LocalDirectorController`, `DirectorSupervisor.answerQuestion`, the unmodified context builder and a **fresh native thread**. The context included the exact saved question/options and answer; it did not resume the interrupted native turn.

Codex replied:

> Warm it is—friendly, inviting, and personal. What’s the film about?

The response was visible and the pending question card disappeared. Both **Refresh project** and a full page reload/reconnection retained the answer. The reviewer disconnected before final cleanup. An exact HTTP replay of the browser answer body and idempotency key returned the same answer request without creating another turn or dispatch.

## Authority, dispatch and cleanup

Both requests retained `local-user` ownership, read-only authority and the original scope. The answer received a fresh request and epoch. Canonical project state, narration, holds, grants, approvals, candidates, plans, prepared changes, artifacts, attempts, reservations and recorded spending authority matched their original state. The model made **zero application tool calls**. Both epochs were revoked; the original turn remained unchanged.

The independent durable allowance permitted at most two starts. Each reservation preceded `turn/start`, and both native acknowledgments were recorded. The continuation consumed only the second slot. The exhausted ledger now rejects another known-question continuation; no unknown outcome or first question was retried.

Both native threads were archived, both archive processes exited, and all observed setup/runtime processes exited with code 0. Application, provider and database handles closed. The disposable token was removed from the ready file, which reports the correct total of two starts. The exact answered question, both turn records, saved director selection, request authority and unchanged canonical state were independently checked through SQLite opened read-only after closure. Native authentication used the installed runtime's existing sign-in; the harness did not read or copy personal credential files.

## Limits and retained evidence

- This is one explicitly requested tone question and read-only answer. It does not establish general stage selection, long-film planning, editing or model quality.
- The model added a follow-up question despite the requested one-sentence acknowledgment. The successful answer transport and persistence do not imply perfect instruction following.
- The focused harness omitted image, media and spending routes, so those unrelated panels showed missing-item/404 states. Warning/error logs were empty in the two inspected post-answer/reload windows; this is not a claim that the entire browser run was free of errors, nor evidence of a production route regression.
- No image was attached and no media provider was called. The reported durations include native thread/catalog setup and each model turn, excluding application setup, the human response interval and archive cleanup.
- The earlier [service-level question continuation](CODEX-QUESTION-CONTINUATION.md) used a different principal and remains separate evidence. This new proof covers the positive browser/HTTP path using its own correctly owned project.

The original failed report (`browser-Du8gVw`), continuation (`continuation-MEcmbv`), exhausted allowance, browser observations and independent audit remain under the development workspace's `work/openslate-live-probe/question-browser-validation/`. Databases, tokens, native projections and logs are not committed. The published record contains selected identities and results without local runtime paths or credentials.
