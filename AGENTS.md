# Working on OpenSlate

- Read `docs/implementation/STATUS.md` before planning work. Technical designs describe the target; do not claim pending features are implemented.
- Use Node 24 and pnpm 10.33.0. `pnpm check` builds, tests and typechecks; local tests need loopback-listener permission. `pnpm demo:headless` runs the offline integration proof.
- V0 is single-user and single-machine: app, SQLite, media, workers and native Codex run on the same computer. Cloud LLM/media APIs remain supported; multi-host, remote GPU and shared-database deployment are outside v0.
- Native Codex uses the accepted `LocalCodexPolicy` (`mode: "local"`) for an exact pinned version/configuration. Trust the installed runtime/sandbox; keep catalog checks, loopback bridge, epochs and application authorization. Independent code-host/authentication isolation is unverified, not a separate mandatory deployment gate. See `docs/implementation/RUNTIME-TRUST-DECISION.md`.
- Keep application authority, project state and execution in OpenSlate. Models only propose validated data. Never evaluate model-authored JavaScript.
- Preserve immutable review inputs, one-use human generation grants, candidate/attempt separation, persisted submission intent and uncertain-submission reconciliation.
- New user edits fence old director epochs. A prepared change cannot borrow a later request's authority. Holds belong to their request; only explicit human continuation transfers them.
- Keep fake tests and live experiments separate. The user has preapproved further live Codex validation for this task; use bounded runs, record actual calls and outcomes, and never retry an unknown outcome blindly. Defer live H3 tests until its API key is provided. Other real media API calls still need an explicit test allowance. Do not read or copy a contributor's personal credentials into fixtures.
- Browser code imports `@openslate/core/public`, not server/compiler modules. Keep provider implementation details behind adapters.
- Test meaningful behavior and failure boundaries. Record actual results and limitations. Do not commit databases, media, secrets, dependencies or build output.
- The user has authorized local commits whenever a major component or task is complete. Review and verify each component, then commit its source, tests and documentation. Ask before pushing unless separately authorized.
- Continue independently through the development plan while the user is away. Complete work that does not depend on unavailable credentials; pause only at an actual blocker. At every completion or pause, report implemented scope, verification, commits, remaining work and any action needed from the user.
