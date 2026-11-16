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

Normal launch obtains a one-time pairing code valid for 60 seconds; the browser exchanges it for an HttpOnly session and removes the code from the URL. The printed and opened link names the port the server actually bound rather than assuming 3001 (F1). Only 3001 and 5173 are accepted; a studio bound to any other port stops with `Unsupported studio port` before printing a link. The standalone `pnpm studio` launcher asks the studio on 3001 for a fresh link; `pnpm studio --dev` asks through the Vite development page on 5173 instead, and neither falls back to the other port (F9). `pnpm dev` starts the server API-only, without a link, before Vite; open its browser with `pnpm studio --dev`. Vite proxies `/api` to the disposable fixture studio on 3101 unless `OPENSLATE_API_ORIGIN` says otherwise. Manual bearer-token entry is a fallback. Provider credentials stay separate and server-only. Host/Origin checks apply to public UI and API requests.

Static assets are a bounded startup snapshot of permitted build files. Symlinks, dotfiles, source maps and unsupported formats are excluded/rejected; missing API/asset routes do not become HTML. Private data cannot overlap this public bundle.

## Troubleshooting

- A verified **already running** studio is success. Reconnect does not rebuild; use `--restart` after changes.
- Wrong credential/data directory: use the same `OPENSLATE_DATA_DIR` and configured local token as the running instance.
- An unrelated/unhealthy port owner is never killed. Stop it in its own terminal.
- Automatic restart requires a verified production Node entrypoint in this checkout and process inspection tools. Stop development/wrapped processes in their original terminal.
- Graceful shutdown waits up to 30 seconds and does not SIGKILL. It stops scheduling/director/events and awaits owned work before closing storage. A code film's saved run is left as it was: shutdown does not cancel unreached steps or settle choices, and the next start replays it from its journal without duplicate submissions (F9).
- If build/install fails after shutdown, fix the error and rerun. Saved data is retained.
- If the browser did not open, run `pnpm studio` with the same environment or use `--no-open` for a fresh link.

Source: `scripts/start-local.mjs`, `scripts/local-server.mjs`, server `index.ts`, `studio-launcher.ts`, `studio-sessions.ts`, `web-assets.ts` and installation ownership. Script/session/ownership tests and `pnpm probe:launcher` cover real process startup, pairing, exclusion and graceful exit with zero model/media calls. [Fresh-checkout evidence](CLEAN-CHECKOUT-VALIDATION.md) is a dated configured-Mac result, not a bare-OS installer claim.
