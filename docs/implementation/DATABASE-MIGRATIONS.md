# Database migrations

The current application schema is **version 3**. Numbered checksummed migrations preserve existing domain records/JSON; a recognized older on-disk database receives a verified metadata snapshot before upgrade. Unknown/newer schema or modified migration history fails before normal writable startup.

## Versions

| Version | Structure |
|---|---|
| V1 | Historical project/entity/command/event tables and known indexes |
| V2 | Migration ledger and execution-evidence lookup index |
| V3 | Installation recovery state and permanent imported-authority fences |

Shipped migration definitions/checksums are immutable. New changes add a numbered migration; no downgrade/destructive conversion is supported. Recognized historical V1 can lack known indexes, which are created inside the upgrade transaction. Duplicate data that violates a required index causes rollback rather than record deletion.

## Upgrade algorithm

1. The launcher acquires installation ownership. Read-only inspection checks current version, exact schema and ledger.
2. For an eligible upgrade, reserve the SQLite writer with `BEGIN IMMEDIATE` and recheck. If another cooperating process already finished, use that schema without another upgrade.
3. Snapshot an older on-disk database through a separate read-only connection, including committed WAL pages. Verify schema/integrity/foreign keys and sync private snapshot/directory.
4. Apply pending DDL/ledger entries in one transaction; verify and commit, then enable normal WAL use.
5. On failure, rollback and close; retain a completed pre-upgrade snapshot for diagnosis.

Snapshots live under `<database-path>.migration-backups/` with unique source/target-version identities. Fresh databases need no pre-upgrade snapshot. New/adopted baseline ledger modes distinguish actually executed DDL from validated historical structure.

## Backup boundary

`Store.backup` and metadata restore verify consistent SQLite snapshots and refuse overwrite. A database snapshot excludes referenced image/video/audio files and external credentials. Use [installation backup/recovery](INSTALLATION-RECOVERY.md) for media-inclusive recovery; metadata copying alone is not permission to run a second dispatcher.

Source: [schema](../../apps/server/src/persistence/schema.ts), [migrations](../../apps/server/src/persistence/migrations.ts), [snapshot](../../apps/server/src/persistence/database-snapshot.ts), [store](../../apps/server/src/persistence/store.ts). Tests cover fresh/current/legacy state, WAL consistency, exact saved JSON/identities, concurrent upgrades, uniqueness rollback, failed handles, private backups and unknown/checksum rejection. V3 recovery tests cover staged upgrades and imported fences. Power-loss/bare-OS packaging remain separate acceptance.
