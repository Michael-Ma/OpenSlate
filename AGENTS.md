# Working on OpenSlate

- Read `docs/implementation/STATUS.md` before planning work. Technical designs describe the target; do not claim pending features are implemented.
- Use Node 24 and pnpm 10.33.0. `pnpm check` builds, tests and typechecks; local tests need loopback-listener permission. `pnpm demo:headless` runs the offline integration proof.
- Keep application authority, project state and execution in OpenSlate. Models only propose validated data. Never evaluate model-authored JavaScript.
- Preserve immutable review inputs, one-use human generation grants, candidate/attempt separation, persisted submission intent and uncertain-submission reconciliation.
- New user edits fence old director epochs. A prepared change cannot borrow a later request's authority. Holds belong to their request; only explicit human continuation transfers them.
- Keep fake tests and live experiments separate. No real model/media calls without an explicit test allowance. Do not read or copy a contributor's personal credentials into fixtures.
- Browser code imports `@openslate/core/public`, not server/compiler modules. Keep provider implementation details behind adapters.
- Test meaningful behavior and failure boundaries. Record actual results and limitations. Do not commit databases, media, secrets, dependencies or build output.
- Ask the user before creating commits or pushing, unless their current request explicitly authorizes that exact action.
