# Local launcher

Run from the repository root:

| Command | Behavior |
|---|---|
| `./start.sh` | Check/install/build/start; reconnect to a verified running studio |
| `./start.sh --restart` | Verify process/installation, gracefully stop, rebuild and load current configuration |
| `./start.sh --status` | Inspect local health/access without install/build/provider calls |
| `./start.sh --doctor` / `--doctor --json` | Explain local prerequisites; redacted, zero provider calls |
| `./start.sh --check` | Local readiness check without starting the app |
| `./start.sh --init-config` | Create private configuration template without overwriting an existing file |
| `./start.sh --no-open` | Print a fresh pairing link without launching a browser |

The wrapper selects Node 24 through an existing nvm installation if needed. It loads `.env.live.local`, preserving keys, switches and saved projects. Exported variables take precedence. A newly started server needs its terminal open; reconnecting exits while the original server continues.

## Ownership and pairing

The production process serves the built UI/API at loopback port 3001. It verifies public build output and acquires a lifetime exclusive transaction in `installation-owner.sqlite` before opening state/workers or reading/creating its private local token. Canonical path aliases share ownership; the file is never deleted to guess whether a PID is stale. Process death releases the operating-system lock.

Normal launch obtains a one-time pairing code valid for 60 seconds; the browser exchanges it for an HttpOnly session and removes the code from the URL. Manual bearer-token entry is a fallback. Provider credentials stay separate and server-only. Host/Origin checks apply to public UI and API requests.

Static assets are a bounded startup snapshot of permitted build files. Symlinks, dotfiles, source maps and unsupported formats are excluded/rejected; missing API/asset routes do not become HTML. Private data cannot overlap this public bundle.

## Troubleshooting

- A verified **already running** studio is success. Reconnect does not rebuild; use `--restart` after changes.
- Wrong credential/data directory: use the same `OPENSLATE_DATA_DIR` and configured local token as the running instance.
- An unrelated/unhealthy port owner is never killed. Stop it in its own terminal.
- Automatic restart requires a verified production Node entrypoint in this checkout and process inspection tools. Stop development/wrapped processes in their original terminal.
- Graceful shutdown waits up to 30 seconds and does not SIGKILL. It stops scheduling/director/events and awaits owned work before closing storage.
- If build/install fails after shutdown, fix the error and rerun. Saved data is retained.
- If the browser did not open, run `pnpm studio` with the same environment or use `--no-open` for a fresh link.

Source: `scripts/start-local.mjs`, `scripts/local-server.mjs`, server `index.ts`, `studio-launcher.ts`, `studio-sessions.ts`, `web-assets.ts` and installation ownership. Script/session/ownership tests and `pnpm probe:launcher` cover real process startup, pairing, exclusion and graceful exit with zero model/media calls. [Fresh-checkout evidence](CLEAN-CHECKOUT-VALIDATION.md) is a dated configured-Mac result, not a bare-OS installer claim.
