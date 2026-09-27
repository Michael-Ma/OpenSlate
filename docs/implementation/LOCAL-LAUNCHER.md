# Local startup and restart

Run from the repository root:

| Command | Behavior |
|---|---|
| `./start.sh` | Check prerequisites; start/build if stopped, otherwise verify and reopen the existing studio |
| `./start.sh --restart` | Verify installation credential, checkout and Node entrypoint; request graceful shutdown, wait, install/build and start with current settings |
| `./start.sh --status` | Check local health and installation access; no install, build, browser or provider calls |
| `./start.sh --check` | Check local prerequisites without contacting the server or media APIs |
| `./start.sh --no-open` | Start/reconnect without launching a browser; print a short-lived pairing link |

The shell wrapper selects Node 24 through an existing nvm installation. The launcher reads `.env.live.local`; exported shell variables take precedence. It preserves the file, provider choices and saved projects. Keep the startup terminal open for a newly started server. Reconnecting exits the launcher while the original server remains running.

## Troubleshooting

- **“Already running” is success.** It does not rebuild or reload API keys. Use `--restart` after changing code/configuration.
- **Wrong installation credential:** ensure `OPENSLATE_DATA_DIR` and any `OPENSLATE_LOCAL_TOKEN` match the running server. The launcher refuses to restart a server it cannot authenticate.
- **Port occupied/unhealthy:** another app, malformed health response or stalled listener is not treated as OpenSlate. Stop the listener in its original terminal. The launcher never kills an arbitrary port owner.
- **Cannot verify process:** automatic restart uses `lsof` and `ps` on macOS/Linux and requires the production Node entrypoint in this checkout. Other wrappers/development servers must be stopped in their own terminal.
- **Shutdown timeout:** after 30 seconds the script stops without SIGKILL. Wait for existing work to settle, then try again. Graceful restart may interrupt conversation work; saved attempts and recovery identities remain on disk.
- **Build/install failure after shutdown:** correct the reported dependency/build problem and rerun. The saved installation is not deleted or reset.
- **Browser did not open:** a successful OS browser-launch request does not prove a page loaded. Run `pnpm studio` in the same environment or `./start.sh --no-open` while the server is running to obtain a fresh pairing link. Links expire after 60 seconds.

## Server ownership and storage

After installing the pinned dependencies and running `pnpm build`, `pnpm start` serves the built interface and authenticated API at `http://127.0.0.1:3001`. The development command remains available for source changes. This is a source-checkout launcher; an installer, bundled Node/FFmpeg distribution and clean-machine release acceptance are still pending.

The launcher checks the built interface before creating application state, then acquires installation ownership before reading/creating its token or opening project state and workers. It creates or reuses the private local token file and prints its location, never its value. The normal launcher exchanges that credential for a short-lived browser pairing code; manual token entry remains a fallback. `OPENSLATE_DATA_DIR` selects local storage; it cannot overlap the public web bundle, including through symlinked parent directories. The server listens only on loopback.

Ownership uses an exclusive SQLite transaction in a separate `installation-owner.sqlite` file, held for the process lifetime. It does not block transactions in the project database. A second launcher using the same canonical data directory fails immediately with `INSTALLATION_IN_USE`; directory aliases share that lock. The lock file is never deleted or replaced, so different processes cannot silently lock different inodes. The operating system releases ownership after a crash or SIGKILL; no PID guessing or stale-file deletion is required. This protects cooperating launchers on a trusted local filesystem. Direct application-service harnesses do not acquire this launcher guard automatically, and copied data directories remain separate installations; portable restore still needs its own paused ownership handoff.

Static serving snapshots a bounded manifest of permitted built assets at startup. It does not open a request-selected filesystem path. Dotfiles, source maps and unsupported extensions are excluded; symbolic links and excessive size/depth are rejected. The HTML fallback handles browser navigation without masking missing assets or API routes. Existing Host/Origin checks remain in force, and only the explicit static route and health route are public. Project and director bridge routes retain their authentication. The production content policy permits the app's verified media blobs and same-origin requests.

Shutdown stops the scheduler and director, ends open event streams, waits for in-flight execution, then closes storage. A real-process smoke probe created a disposable project, held an event subscription open and observed clean SIGTERM exit in 7 ms. The token had mode `0600` and was absent from captured output. The probe used zero model or media API calls; its timing is one observation, not a shutdown deadline guarantee.

The actual production browser loaded the existing narration fixture after restarting into this launcher. Unsaved script or recording-range changes disabled review and displayed save/revert guidance; reverting restored review eligibility. Its audio and video previews each decoded six seconds, reached ready state 4 and reported no media errors. Browser error/warning collection was empty. File upload in this fixture used the authenticated HTTP harness; browser picker interaction remains unverified as recorded in [narration browser validation](NARRATION-BROWSER-VALIDATION.md).

Seven focused tests cover static route/API separation, navigation fallback, Host/Origin checks, path and build-manifest limits, public/private storage separation and event-stream shutdown. Four ownership tests cover same-directory exclusion, independent installations, alias paths, invalid lock files and process-death recovery. The separate `pnpm probe:launcher` command builds and starts the real process on port 3001, verifies its interface/token/API and shuts it down. A later run also verified a duplicate launch fails before token processing while the first process retains its project/event cursor/token, and that clean shutdown releases the same lock inode for reacquisition. That run closed its event stream and exited in 8 ms. Port 3001 must be free. These checks do not authenticate a native model or generate media.

## September 27 launcher verification

Nine startup regressions cover health identity, malformed/failed responses, closed ports, exact process identity, graceful exit, timeout and permission errors. Together with session and ownership regressions, 20 tests pass. A disposable installation exercised the complete shell startup, restart/rebuild, authenticated reconnect, wrong-installation rejection and Ctrl+C forwarding. The real-process smoke probe separately confirmed token secrecy, duplicate-owner exclusion, SSE shutdown and ownership release. No model/media API call was made. Automatic restart is intentionally limited to a verifiable production Node process from the same checkout.
