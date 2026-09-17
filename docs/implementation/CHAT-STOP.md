# Stop work from the conversation

September 17, 2026.

The chat composer shows **Stop** while the director is running or production work remains. The separate workspace Pause/Resume button is removed. Send stays available for conversational steering; Stop does not discard the draft.

Stop records a durable human command, blocks new execution, supersedes queued conversation requests (including read-only discussions), and revokes existing director epochs. The supervisor interrupts the active runtime. A late response cannot apply changes under the revoked authority. If a runtime cannot confirm interruption, its result remains uncertain rather than being silently retried.

Already-submitted provider jobs may finish and incur their existing charges. Stop does not claim remote cancellation or reverse completed changes. Accepted and uncertain jobs retain their attempt IDs, reservations and recovery evidence. SSE stays connected to show their progress and saved results.

## Continue from saved work

After Stop, type a new direction and send it. The browser includes the identity of the stopped state it displayed. The server accepts that continuation only while the same stop is current. An old retry cannot undo a newer Stop, and retrying a previously accepted Stop cannot stop newer work.

The follow-up takes a project-wide edit hold before clearing the execution pause, transferring earlier human-owned edit holds with recorded continuation links. This lets the director review all unfinished work while applying the user's requested scope. Generation remains held until the corresponding plan is safely applied; existing review, spending, and provider requirements still apply. The follow-up does not itself grant paid generation. Real conversational replanning requires the native Codex director; the offline director remains a scripted demonstration.

Stopped state survives restart. A released backup restoration can also continue through a fresh chat message, but the recovery review must be completed first and imported authority remains fenced. The legacy pause/resume API remains compatible; it is no longer a workspace button.

## Verification

- Production build and all package type checks passed.
- 200 targeted tests passed across browser models, service/API, director supervision, execution, and installation recovery.
- Added cases cover rapid Stop/follow-up before the supervisor ticks; read-only queued and pre-dispatch turns; exact retries and stale stop identities; project-wide hold transfer; restored installation continuation; and an uncertain accepted provider job recovered across restart without duplicate submission.
- Browser check used a separate port 5173 fixture with a deliberately waiting fake director: send → Stop → stopped state → new direction → saved response. The chat layout was visually checked. Optional media panels were unconfigured in this fixture.
- No real Codex or media requests were made for this change. The user's running server and projects were left untouched.

## Manual check

1. Restart OpenSlate using the usual launcher, then refresh the browser to load the new server and UI.
2. Send a planning request. While the director is working, click **Stop** at the bottom-right of the chat box.
3. Confirm the activity says **Stopped** and the conversation remains visible. Refresh: the stopped state should remain.
4. Send a revised direction. Confirm a new response begins from the saved project without a Resume button.
5. If you stop while a provider job is already submitted, expect that job to finish or reconcile; verify that no additional generation starts while stopped. Use only an already-authorized live run for this optional check.
