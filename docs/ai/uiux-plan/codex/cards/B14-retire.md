# Card B14 (phase P6): retire what only the classic UI used, and bring the docs up to date

Read `docs/ai/uiux-plan/codex/RULES.md` first and follow it. The lead has deleted the classic web UI (apps/web/src/legacy) on this branch; the next UI (apps/web/src/next) is the only UI. Every route the next UI calls is visible in apps/web/src/next (grep for "/api/").

## Items
1. **Find dead server surface.** List every HTTP route in apps/server/src and whether apps/web/src/next, scripts/, the CLI (studio-cli, installation-cli), the launcher, the Director tool bridge (/internal/...) or the server's own runners still call it. Write the list into your report.
2. **GR-19**: make `GET /api/projects/:projectId/review` read-only (no review_snapshot rows written by a GET) or remove it if nothing calls it; remove `POST /api/projects/:projectId/approvals` and the generation-permission routes if nothing calls them (keep `engine.approve` for the scene confirm). Remove other routes that only the classic UI called (for example browser-saga narration session endpoints) ONLY when no remaining caller exists, including the server's own confirm runner and tests that exercise behaviour still reachable another way. Keep `/media/renders` for old plans. Delete or rewrite the tests of removed routes. Never weaken money or integrity checks.
3. **Docs**: update `docs/implementation/STATUS.md` (what this branch delivers per phase P0 to P6, by card and by UI area), `README.md` (the studio's UI, the commands `pnpm studio:fixture`, `pnpm check:browser`, the fixture film), `AGENTS.md` (mention the codex cards workflow only if useful for future contributors; keep it short), and the technical docs under docs/technical and docs/design that describe the classic UI or removed routes (point them at the next UI and the new routes: overview, frame views, confirm, narration fit, takes, notes, proposals, exports, assets, installation status, recording). Keep the existing writing style: short, factual, no marketing.

## Out of scope
apps/web (already done by the lead).

## Tests
Full `pnpm test` and typecheck pass; a test proves GET /review (if kept) writes nothing.
