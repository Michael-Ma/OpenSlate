# Data and persistence

OpenSlate's local database owns production state. Conversation history and browser state are projections. The launcher holds installation ownership before opening the store, director or workers.

## Saved identities

| Record group | Purpose |
|---|---|
| Project/revisions | Brief, story, scenes, shots, narration intent, cues, references, selections and capability lock |
| Requests/epochs/holds | Human scope, ownership, continuations, pause/Stop and current director authority |
| Prepared changes/plans | Exact proposal, source, compiled graph, read-set, bindings and reuse/replace impact |
| Candidates/grants/attempts | Human generation origin, one-use consumption, dispatch identity, leases and uncertainty |
| Reviews/allowances/reservations | Exact input approval, finite usage permission and retained liabilities |
| Artifacts/receipts | Owned content hashes, provenance, measurements, raw/normalized outputs and recovery |
| Director/tool records | Runtime selection, locked instructions, turns, questions, output and idempotent tool receipts |
| Events/commands | Monotonic per-project event cursors and replay-safe command results |

The current relational schema stores project heads, generic versioned entities, command receipts and events; migrations add a ledger and installation recovery records. Domain entity kinds encode the component records rather than one SQL table per proposed type. See [schema](../../apps/server/src/persistence/schema.ts) and [store](../../apps/server/src/persistence/store.ts).

## Transactions and files

`headVersion` is the optimistic creative concurrency token; an event cursor is not a replacement for it. Service commands validate current scope/authority/read-set and save changes, receipts and events atomically. Exact command-key/digest replays return the saved result; a reused key with different input fails.

Immutable bytes are published outside short SQLite transactions. Content hashes, storage identity and completion manifests let the application recover publication after a missing SQL acknowledgement. Paths are derived by trusted services and revalidated, not accepted from a model. A blob is not usable media until the relevant decoder/probe verifies it.

## Installation storage

The root `pnpm start` default is `<repository>/.openslate`; development/filtered server commands can use a different working directory. Use one explicit `OPENSLATE_DATA_DIR` to keep the same installation. Keep it outside the public web bundle.

The installation includes SQLite, owned artifacts, raw execution outputs, normalized media/receipts and locked skill snapshots. Provider keys/configuration and external Codex authentication are separate local setup. Backups can contain protected result locators and private project content.

Current schema version is 3. Recognized older databases receive verified database snapshots before migration. A metadata snapshot excludes referenced media; use [media-inclusive installation backup](../implementation/INSTALLATION-RECOVERY.md) for complete same-root recovery. Restore preserves identities, installs quarantine/fences and leaves projects paused after human release.

## Source and checks

- [Migration/snapshot contract](../implementation/DATABASE-MIGRATIONS.md)
- [Installation owner](../../apps/server/src/persistence/installation-owner.ts)
- [Backup](../../apps/server/src/persistence/installation-backup.ts) and [restore](../../apps/server/src/persistence/installation-restore.ts)
- Tests: `apps/server/test/persistence.test.mjs`, `migrations.test.mjs`, `installation-recovery.test.mjs`, `installation-audio-backup.test.mjs`.

Portable relocation, project-sharing export and multi-host shared databases are not implemented.
