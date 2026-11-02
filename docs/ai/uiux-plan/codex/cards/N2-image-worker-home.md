# Card N2: every Codex keyframe fails since the Director moved to a private Codex home

Read `docs/ai/uiux-plan/codex/RULES.md` and follow it. Do not edit `apps/web/**`. No real Codex turn, no image generation, no network beyond loopback. Never read, copy or print `auth.json` or any token, and never read `~/.codex/config.toml` values (server names only if you must).

## Diagnosis (done by the lead, verified offline)

- Every keyframe since 2026-10-27 ends `LOCAL_NATIVE_UNAVAILABLE`, diagnostic `native_protocol` at `codex_image_prepare`. Running `CodexImageWorkerTransport.checkReadiness()` against the owner's machine returns `code: "CODEX_IMAGE_MCP_UNEXPECTED"`.
- `packages/director/src/media/codex-image.ts` `#check` requires every `config.mcp_servers` entry to be `enabled === false`. The expected config (`ready.options.policy.config`) carries **no** `mcp_servers.*.enabled` keys, while the launched app-server reports the person's own servers enabled (four of five).
- Cause: card D1 (`18a0221`, "run the Director in a private Codex home linked to the sign-in") made `setupLocalCodex` (`packages/director/src/runtime/setup.ts` ~:96-114) run discovery with `CODEX_HOME` = the private `<storage>/director-home`, which has no MCP servers, so setup disables none. The image worker still launches app-server with `CODEX_HOME = input.codexHome` (the person's real `~/.codex`, `codex-image.ts` `environment()` ~:66) and reads generated images from `realpath(codexHome)/generated_images` (~:265). The worker inherits the person's MCP servers, and the check refuses every attempt. A changed ground rule (D1) left the image worker on the old assumption.

## Do

1. Make the image worker use the same private home that setup discovered and verified (the runtime options' env / `privateCodexHome`), for `checkReadiness`, `prepare`, `start`, `lookup`/recovery and the generated-image output path, so discovery, the disabled-server policy, the launched process and the output location all agree. Keep the sign-in link and every existing guard (`--strict-config`, MCP-disabled check, skills disabled, permissions profile, binary digest, configuration digest, no network).
2. Recovery: attempts and receipts saved with the old configuration digest or old output root must still reconcile honestly (late results, `thread/read`, never-dispatched proofs). Do not relabel history; if an old prepared configuration can no longer be resumed, it must end where the person can act, as today.
3. Regression tests with a fake Codex home that has enabled MCP servers and a private home without them: before the fix `checkReadiness`/`prepare` fail with `CODEX_IMAGE_MCP_UNEXPECTED`; after, they pass and the launched env uses the private home; the output path follows it. Cover a person's home whose MCP servers change between setup and prepare.
4. Also audit the other native entry points that launch Codex (Director runtime, image worker, any probe) for the same split between the discovery home and the launch home, and fix or list them.
5. Report to `docs/ai/uiux-plan/codex/reports/N2-report.md`, including the exact commands the lead can run to verify readiness offline (no image generated).
