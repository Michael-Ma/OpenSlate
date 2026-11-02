# Model catalog and saved choices

The installed catalog describes supported image, video, speech, transcription and music profiles. The project's capability lock preserves the exact selected definitions. Catalog installation, model choice, local readiness and generation authority are different steps.

## Configuration

`OPENSLATE_PROVIDER_CONFIG` selects a bounded local JSON file with `{version: 1, profiles: [{label, profile}]}`. Without it, demo profiles remain available and enabled routes can add built-in real profiles (for example Viggle H3 and Lyria music). A catalog file is not mandatory for those built-ins. Start from [the examples](../../examples/provider-profiles.example.json) or [live profiles](../../examples/live-provider-profiles.example.json).

Each real profile pins ID/revision/kind, adapter/execution version, model/settings, concurrency/retry limits, applicable duration limits and `unitCostMicros`. Compiled-in validation permits exact supported contracts; it rejects arbitrary endpoints/code, credential fields and redefined reserved demo IDs. Keys remain separate. Prices/labels in examples are host-entered estimates, not verified vendor billing.

The full catalog digest covers complete definitions, including labels, estimates and limits. An execution digest separately binds adapter/creative configuration. A stale catalog selection cannot reuse yesterday's estimate.

## Readiness and selection

Authenticated catalog/project views report installed definitions, saved provenance, registration, host enablement, local tools, credential presence and project compatibility. A credential-present row is not an API access/quota check. Removed installation profiles do not overwrite saved project definitions.

Storyboard new-project selection is paired with an exact catalog digest and one profile per chosen kind; omitted kinds remain demo. The server creates a trusted selection inside the replay-safe command. A completed replay returns its original project even if the current catalog changed.

Existing storyboard projects use revision-bound model preview/apply. The preview names changes and preserved work; apply creates a successor lock and compatible pending graph. Completed outputs, in-flight work, dependencies protecting that work and separately reviewed audio plans remain pinned. A redefined saved profile ID must be installed under a distinct identity. Saving choices creates no generation grant and starts no director turn.

The compact settings UI shows model-per-job choices first and selected-account setup only on demand. An explicit Save automatically applies a current zero-impact server preview; actual pending changes receive an exact impact review. Separate Director/media saves and unknown-result checks retain their command identities. Backend preview/protection rules remain the authority. See [settings](PROJECT-SETTINGS-AND-UPDATES.md).

## Code-film locks

New code films pin ready image/video/speech/music definitions, including additional ready video/music profiles. Their selected video remains the default. Enabled Viggle uses the built-in `viggle-h3` profile (MiniMax-H3, low, 768p, 5–15 seconds) for new code films; configured historical profiles stay available for saved locks/storyboard films. A saved code-film model list is not silently extended after catalog changes. Director runtime/model choice is separate. `read_film` reports actual locked capabilities, input-based prices and measured outputs; these are not vendor access or billing proofs. See [providers/artifacts](../technical/PROVIDERS-ARTIFACTS.md).

## Source and checks

- [Installed catalog](../../apps/server/src/application/provider-catalog.ts)
- [Existing model settings](../../apps/server/src/application/project-model-settings.ts), [trusted composition](../../packages/core/src/planning/model-profile-composition.ts)
- [Profile validation](../../packages/core/src/provider-profile.ts), provider execution registry and app routes.
- Tests: `provider-catalog.test.mjs`, `project-model-settings.test.mjs`, core composition and web settings/model suites.

See [activation](MEDIA-EXECUTION-LAUNCHER.md), [settings](PROJECT-SETTINGS-AND-UPDATES.md) and [configured admission](../technical/EXECUTION-ENGINE.md).
