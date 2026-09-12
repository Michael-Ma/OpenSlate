# Native question continuation

September 12, 2026. **One live service-level continuation passed** with Codex **0.153.4**, **gpt-6-astra**, low reasoning effort and Node **24.15.0**. The answer was exactly `Warm`. The native director completed in **8.633 seconds**, called `read_context` once, and replied:

> Warm—friendly and inviting. No project data changed or media generated.

Canonical project state remained byte-equivalent under its canonical digest. There were no plans, prepared changes, holds, candidates, grants, approvals, artifacts or media attempts. This experiment made **zero media API calls**. The question and answer survived closing the application and reopening SQLite read-only. Machine-readable identities and checks are in [the evidence record](codex-question-continuation-evidence.json).

## What was exercised

The starting point was a SQLite backup of the closed positive image/question fixture from [the preceding capability experiment](CODEX-CAPABILITY-VALIDATION.md). Its `Tone` question offered Warm, Neutral and Formal. The original turn was `waiting_user`, its epoch was already revoked, and its request retained read-only authority. The source database was read-only during backup and remained unchanged after the experiment.

The test called the actual `DirectorSupervisor.answerQuestion` service with the original human principal. It then used the unmodified `createDirectorInput` builder, `DirectorSupervisor`, `CodexDirectorRuntime`, and loopback tool routes. No handcrafted answer context, runtime resume identity or additional prompt instruction was injected: the new request text was only `Warm`.

The application saved the answer against the exact question, created a new request and epoch, and reconstructed context containing the original question/options and the answer. Repeating the same answer command returned the same request without another queued turn. The old native turn and epoch were not reused. After completion, the new epoch was revoked as well.

The native protocol clears a pending interactive request when its turn is interrupted; OpenSlate deliberately keeps the durable question in application storage and handles the later answer as a fresh request. This test validates that application-owned continuation strategy. See the [official App Server protocol](https://learn.chatgpt.com/docs/app-server).

## Dispatch and cleanup evidence

An independent allowance ledger was created before dispatch, with a maximum of two starts. A zero-model-turn preflight first checked setup, exact question context, authority, replay and persistence. Its deliberate stop before `turn/start` did not consume a model start.

The live run reserved one start durably before sending `turn/start`, then recorded the native acknowledgment. It completed with a known result; no retry occurred. The ledger was closed with one unused slot. This brings the recorded historical native start count from **16 to 17**.

| Identity | Value |
|---|---|
| Application question | `bfd16b97d272f463cf81539f31033f515abf877e2d35d8df5fef0e9b140846b6` |
| New application request | `021aa153-8611-4821-b85f-5c05efe31462` |
| New authority epoch | `35e46e92-d202-4fbd-bec2-7fae399f0f0e` |
| New native thread | `01a0978e-4d46-7b53-add6-66495f6b8642` |
| New native turn | `01a0978e-4e58-7eb3-bddd-648b96681a02` |
| Start reserved / acknowledged | `2026-09-12T21:38:00.894Z` / `2026-09-12T21:38:00.923Z` |

The native adapter closed its process. A separate zero-turn archive request archived the new thread and its process exited. The application, provider and SQLite handles closed; the ephemeral loopback listener was gone. Native authentication used the installed runtime's existing sign-in; no personal credential file was read or copied by the test. No source implementation changes were needed.

## Limits

- The saved fixture belonged to `capability-human`, while the production HTTP route represents `local-user`. An authenticated HTTP answer from that different principal correctly returned `QUESTION_STALE`. The successful answer used the actual application service under the original principal; **positive HTTP and browser question-answer interaction remain unverified**.
- This was one read-only tone question. It does not establish broad multi-question, stage-selection, editing or generation quality.
- No new image was attached on continuation. The earlier image observation was available as saved conversation context.
- The test used a fresh native thread, not a resumed interrupted turn. Runtime upgrades still need compatibility validation.

The local harness and closed allowance are retained under the development workspace's `work/openslate-live-probe/question-continuation/`; runtime databases and logs are not committed. The sanitized evidence record is sufficient to review this result without credentials or local runtime files.
