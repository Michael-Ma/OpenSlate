# Model catalog and saved choices

The installed catalog describes supported image, video, speech and transcription profiles. The project's capability lock preserves the exact selected definitions. Catalog installation, model choice, local readiness and generation authority are different steps.

## Configuration

`OPENSLATE_PROVIDER_CONFIG` selects a bounded local JSON file with `{version: 1, profiles: [{label, profile}]}`. Without it, built-in demo profiles are used. Start from [the examples](../../examples/provider-profiles.example.json) or [live profiles](../../examples/live-provider-profiles.example.json).

Each real profile pins ID/revision/kind, adapter/execution version, model/settings, concurrency/retry limits, applicable duration limits and `unitCostMicros`. Compiled-in validation permits exact supported contracts; it rejects arbitrary endpoints/code, credential fields and redefined reserved demo IDs. Keys remain separate. Prices/labels in examples are host-entered estimates, not verified vendor billing.

The full catalog digest covers complete definitions, including labels, estimates and limits. An execution digest separately binds adapter/creative configuration. A stale catalog selection cannot reuse yesterday's estimate.

## Readiness and selection

Authenticated catalog/project views report installed definitions, saved provenance, registration, host enablement, local tools, credential presence and project compatibility. A credential-present row is not an API access/quota check. Removed installation profiles do not overwrite saved project definitions.

New-project selection is paired with an exact catalog digest and one profile per chosen kind; omitted kinds remain demo. The server creates a trusted selection inside the replay-safe command. A completed replay returns its original project even if the current catalog changed.

Existing projects use revision-bound model preview/apply. The preview names changes and preserved work; apply creates a successor lock and compatible pending graph. Completed outputs, in-flight work, dependencies protecting that work and separately reviewed audio plans remain pinned. A redefined saved profile ID must be installed under a distinct identity. Saving choices creates no generation grant or allowance and starts no director turn.

The compact settings UI shows model-per-job choices first and selected-account setup only on demand. An explicit Save automatically applies a current zero-impact server preview; actual pending changes receive an exact impact review. Separate Director/media saves and unknown-result checks retain their command identities. Backend preview/protection rules remain the authority. See [settings](PROJECT-SETTINGS-AND-UPDATES.md).

## Source and checks

- [Installed catalog](../../apps/server/src/application/provider-catalog.ts)
- [Existing model settings](../../apps/server/src/application/project-model-settings.ts), [trusted composition](../../packages/core/src/planning/model-profile-composition.ts)
- [Profile validation](../../packages/core/src/provider-profile.ts), provider execution registry and app routes.
- Tests: `provider-catalog.test.mjs`, `project-model-settings.test.mjs`, core composition and web settings/model suites.

See [activation](MEDIA-EXECUTION-LAUNCHER.md), [settings](PROJECT-SETTINGS-AND-UPDATES.md) and [spending review](SPENDING-REVIEW.md).
