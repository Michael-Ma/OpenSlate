# Cancellation-aware local recovery

Local completion discovery, exact completion reads, source verification, manifest freezing and managed video installation accept an optional cancellation signal. They retain the original signal before asynchronous work; changing the caller's options cannot replace it. Existing calls without options remain compatible, and no source or manifest identity fields change.

Owned source, manifest and completion JSON are read through non-following, nonblocking regular-file handles in bounded chunks, capped at the same 1 MiB limit used by installation. Recovery hashes output bytes in chunks, checks cancellation during reads and after handle closure, and validates exact stored identities. Discovery checks cancellation during directory traversal and after the final recovered result. It still limits matching outputs to eight; the directory inventory itself is not indexed.

Managed video installation captures source data, checks the signal during copy/readback and after temporary-file cleanup, and preserves any already installed immutable output. Cancellation must not delete a shared deduplicated blob or report successful publication. Render similarly captures its manifest, signal and callbacks before work and checks cancellation after subprocess and temporary cleanup. The optional publication callback retains its existing synchronous semantics; cancellation after that callback cannot undo a transaction the caller already committed. Automatic Engine composition obtains the completion first and owns its later SQL publication separately.

These operations recover existing files; they do not silently run a new renderer. File completion receipts still precede application publication. A late cancellation may leave verified reusable bytes on disk without a successful return. No stronger power-loss or detached-subprocess guarantee is introduced.

## Verification

Server build and **32 focused checks passed, zero failures/skips**, including seven new cancellation/bounded-read checks and existing actual FFmpeg rendering, exact audio placement, SQL-failure/reopen recovery and two-connection ownership checks. Independent review identified the adjacent render-options/final-cleanup gap; it was fixed and its two regressions passed.

The new cases cover original-signal retention after caller mutation, cancellation after final byte verification, cancellation after discovery and temporary cleanup, bounded JSON rejection, pre-aborted preparation, no subprocess launch after cancellation, preserved immutable output, and recovery without another render. One initial assertion was corrected to compare macOS's canonical `/private/var` path; the cancellation behavior itself passed.

Sources: `apps/server/src/media/local-media.ts`, `managed-video.ts`, `apps/server/test/media-rendering.test.mjs` and `managed-video-cancellation.test.mjs`.
