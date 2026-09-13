# Trusted local assembly identity

The compiler accepts an optional trusted `CompileContext.localExecution` selection:

```ts
interface LocalExecutionIdentity {
  readonly adapter: "local-media";
  readonly version: "1";
}
```

`snapshotLocalExecution(value)` is exported from the server-facing core entry point. It accepts exactly the supported plain data object, including an object with a null prototype, and returns a detached frozen copy. Nulls, numbers, unsupported adapters/versions, additional fields, accessor properties and nonplain objects receive `LOCAL_EXECUTION_UNSUPPORTED`. Diagnostics do not echo configuration values. Omission from compiler context, including an undefined optional value, preserves legacy behavior.

Both direct and isolated compilation snapshot this selection on entry. Timeline and render nodes receive their own immutable `args.localExecution` copy before specification digests are calculated. This changes assembly specification, resolved-input and graph identities. Image/video nodes, generated provider configuration and exact human review gates retain their previous identities. No local runtime is selected from a generated model, API key or mutable later context value.

The planning language does not expose this field. `definePlan`, `p.timeline` and `p.render` still reject additional local execution, host path or executable configuration fields. Executable expressions remain forbidden. Canonical source remains the same declaration text; it must be recompiled with the same trusted context to preserve the selected assembly identity. The isolated worker receives the captured selection as separate worker data and applies the same validation. Parent-side return handling restores the identity's freezing after structured cloning.

No field is added to legacy nodes. A deterministic fixture captured before this change verifies the exact serialized plan bytes, canonical source digest and full graph digest with the optional context omitted. Historical source and direct/isolated compilation remain compatible.

This is an identity foundation only. It does not register an executor, change Engine work keys, create authority, pin project locks or enable automatic rendering. Production code must later obtain the context field from an immutable trusted project lock and verify it again at dispatch/reuse/publication. Real assembly still needs complete timeline source/sample identities, toolchain validation, attempt receipts and current-target fences described in [shared timeline capture](TIMELINE-CAPTURE.md).

## Verification

Core build passed. **69 compiler checks passed with zero failures/skips**, including nine new local identity checks. They cover recorded legacy bytes/digests, assembly-only identity changes, unchanged generated nodes and review, strict host value validation, accessor rejection, allocator-time caller mutation, asynchronous caller mutation, direct/worker equivalence, worker protocol validation, canonical source round-trip and rejected DSL configuration/code. No subprocess media rendering or model/media API calls were made.

Source: `packages/core/src/local-execution.ts`, `contracts.ts`, and `planning/index.ts`. Tests: `packages/core/test/local-execution.test.mjs` with a deterministic `local-execution-fixture.mjs`.
