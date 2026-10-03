# Installation backup and recovery

OpenSlate supports a **private offline backup and restore to the same original data path on the same computer**. It is not portable project sharing, relocation or installation merging. Stop the server before exporting/restoring and preserve any existing destination separately; restore refuses overwrite.

## Commands

Build the app, stop its server, then use a new backup directory outside the installation:

```sh
pnpm installation export --data-dir /absolute/path/to/openslate-data --output /absolute/path/to/backups/openslate-backup
pnpm installation inspect --backup /absolute/path/to/backups/openslate-backup
```

Inspection verifies bytes and database/reference closure without contacting providers. Keep the bundle private: it includes project/conversation/media records and may include protected provider result locators. API keys, local browser token and external Codex auth are excluded.

Restore only to the now-empty original canonical data path:

```sh
pnpm installation restore --backup /absolute/path/to/backups/openslate-backup --data-dir /absolute/path/to/openslate-data
OPENSLATE_DATA_DIR=/absolute/path/to/openslate-data pnpm start
```

If restore is interrupted, repeat the exact command with the same bundle. Normal launch refuses incomplete publication. Do not delete an ownership lock or manually repair records to bypass that check.

## Bundle and ownership

The exporter acquires installation ownership, snapshots the application/fixture databases and copies bounded published artifacts, raw outputs, normalized media, completion receipts and exact skill/discussion-image snapshots. Historical and filesystem-only completions are included so missing SQL acknowledgement remains recoverable. It excludes temporary uploads/staging, native runtime logs/auth and arbitrary workspace files.

Manifest paths are derived bundle-relative paths. Regular-file/no-symlink checks, hashes, source/reference closure, schema/integrity verification and sync precede final manifest publication. Bounds are 256 GiB total, 100,000 files, 8 GiB/file, 32 MiB manifest and depth 16, with bounded streaming/copy concurrency. Those are supported limits, not measured performance guarantees. Hashes detect byte corruption; they do not authenticate who created a bundle.

Restore must match `originalDataRoot` because retained receipts/descriptors include immutable absolute identities. It stages on the destination filesystem under retained ownership, verifies all files/databases, applies supported staged migrations and installs recovery quarantine/fences before publication. Existing/changed published content, different retry bundles and path escapes fail safely. The filesystem progress marker blocks partial launch; SQL owns quarantine/release authority.

## Human recovery review

After startup, inspect saved projects/media and choose **Review release → Finish recovery review**. Release is bound to the exact restore/backup receipt and replay-safe human command. It keeps projects paused. Existing known-job/output recovery may continue after release, while old unused imported requests/grants/reviews/allowances cannot authorize a first new provider submission. Start a fresh conversation and exact current review for new paid work.

The backup excludes changes made after its snapshot. Unknown provider submissions stay attached to their original attempt/liability. A missing/expired output is not permission to regenerate. Consumed accounting, candidate identity, old media and immutable authority fences remain retained through re-export/recovery.

## Source and verification

- [Backup](../../apps/server/src/persistence/installation-backup.ts), reference-closure verifiers and [restore](../../apps/server/src/persistence/installation-restore.ts)
- [Recovery application](../../apps/server/src/application/installation-recovery.ts), [routes](../../apps/server/src/application/recovery-routes.ts), web `RecoveryPanel.tsx`
- [Dated campaign](INSTALLATION-RECOVERY-VALIDATION.md) and [audit JSON](INSTALLATION-RECOVERY-VALIDATION.json)

Automated and disposable browser checks cover interrupted copy/publication, same-bundle retry, hash/path rejection, staged migration, unchanged historical IDs, quarantine/release/replay and zero imported first POST. They do not prove relocation, online backup, arbitrary independent file writers, physical power loss or performance at maximum capacity.
