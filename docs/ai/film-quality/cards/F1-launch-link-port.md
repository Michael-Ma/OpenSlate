# F1 · The launch link names the port the studio really listens on

Read `docs/ai/uiux-plan/codex/RULES.md` first; its hard rules apply in full. F2 and F3 run at the same time: stay out of `apps/server/src/code-plan/**`, `apps/server/src/application/provider-catalog.ts` and `apps/web/**`. You own `apps/server/src/studio-launcher.ts`, `apps/server/src/index.ts`, `apps/server/src/studio-cli.ts`, `scripts/start-local.mjs`, `scripts/local-server.mjs` and their tests.

## Problem

`studioUrl` in `apps/server/src/studio-launcher.ts` builds `http://127.0.0.1:${development ? 5173 : 3001}/#connect=...` from a flag, not from the socket. A side instance whose listener was moved (the test preload moves 3001 to 5173) printed a 3001 link, which points at the owner's studio.

## Change

Build the printed and opened URL from the port the server actually bound (`server.address()`), keeping the loopback host and the existing URL validation. Keep accepting only 3001 and 5173 unless the code already allows more; if the bound port is anything else, print the link for that port only if the validator is widened deliberately and safely, otherwise fail with a clear message. Nothing else about pairing changes.

## Tests

A server started on 5173 prints and opens a 5173 link; the default prints 3001; the validator still refuses non-loopback hosts.

## Finish

Run the server tests that cover launching and pairing, `pnpm typecheck`. Write `docs/ai/film-quality/reports/F1-report.md`.
