# Durable output storage and ingestion

`ExecutionOutputStore` retains raw returned bytes or protected result locators for an admitted attempt. It does not dispatch a provider, fetch arbitrary URLs, decode media, select an artifact or grant generation. Provider execution and the ingestion router compose those separate steps.

## Identity and publication

An immutable receipt binds project, attempt, exact admitted request digest, execution identity, output role, optional vendor/diagnostic ID and returned-byte hash or protected locator. Synchronous audio/transcription use returned bytes with no vendor task. A diagnostic request ID is not assumed to be a recoverable paid job.

An owned spool binds receipt, storage identity, attempt/port, hash/length and derived blob key. The immutable winning slot selects one compatible completion for that attempt/port. Conflicting receipts or wrong-storage bytes fail without changing paid liability.

Publication streams into a private exclusive temporary file, checks bounds/hash/cancellation, syncs, publishes content-addressed bytes and immutable manifest/slot, then saves SQL records. Paths come from trusted identities. Symlinks/special files and mismatched size/hash are rejected. Published evidence is never deleted merely because later SQL publication or cancellation failed.

## Recovery

| Durable evidence | Result |
|---|---|
| Receipt only/no bytes | Not ready; no generation/download by the store |
| Exact expected-hash blob without manifest | Verify and finish its owned records |
| Unknown-hash locator with an orphan blob | Do not guess association |
| Manifest/slot without SQL acknowledgement | Verify and recover the same immutable completion |
| Missing/corrupt/conflicting bytes | Explicit failure; retain identity/liability |

Missing synchronous image bytes after an accepted/lost response can remain unresolvable. An expired video locator needs observation of the already accepted job, not another create. Image/video/audio/transcript ingest fully decode/probe/validate before artifact publication; raw spooling alone never establishes usable media.

## Bounds and secrecy

Current spool limits are defined in `packages/providers/src/execution.ts` and `OUTPUT_STORE_LIMITS`: bounded per-kind bytes, 16 KiB metadata, 8 KiB locators, one-MiB chunks, two active writers per root/process and a ten-minute maximum default deadline. Disk headroom is preflight, not reserved capacity. Cancellation does not abandon owned filesystem work or release writer ownership prematurely.

Protected locators remain backend operational evidence and can exist in private backups. Ordinary events/browser/director projections must not expose them. Installation ownership and same-root backup are separate from in-process spool concurrency.

Source: [output store](../../apps/server/src/execution/output-store.ts), [ingestion router](../../apps/server/src/execution/ingestion-router.ts), spool-specific ingesters and provider receipt modules. Tests cover large streaming bytes, exclusive slots, symlinks/corruption, interruption, late cancellation and recovery with no second provider POST. See [providers/artifacts](../technical/PROVIDERS-ARTIFACTS.md), [execution](../technical/EXECUTION-ENGINE.md) and [backup](INSTALLATION-RECOVERY.md).
