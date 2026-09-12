# Local Codex runtime setup

`setupLocalCodex` prepares the accepted single-machine native runtime without starting a model turn. It returns a backend-only `CodexDirectorOptions` and a separate, sanitized readiness summary. The setup component is implemented in `packages/director/src/runtime/setup.ts` and exported from `@openslate/director`.

This is the bootstrap for the existing [local trust decision](RUNTIME-TRUST-DECISION.md), not an independent sandbox certification. It trusts the selected installed Codex runtime and its native account handling. It retains the exact version, permission profile and catalog checks used by `CodexDirectorRuntime`.

## Host API and ownership

```ts
const result = await setupLocalCodex({
  command: { file: settings.binaryPath },
  model: settings.model,
  nativeHome: settings.nativeHome,
  codexHome: settings.codexHome,
  env: { PATH: settings.launchPath, SHELL: "/bin/sh", CI: "1", NO_COLOR: "1" },
  directories: {
    projection: paths.projectWorkspace,
    snapshots: paths.skillSnapshots,
    storage: paths.nativeRuntimeStorage,
  },
}, { signal });

if (result.readiness.status === "ready" && result.runtimeOptions) {
  const runtime = new CodexDirectorRuntime(result.runtimeOptions);
  // The supervisor supplies each request's bridge, immutable skills and context.
}
```

The caller selects an existing absolute binary path, exact model, native home and Codex home. There is no PATH-based binary selection, model substitution, environment inheritance, login flow or configuration import. The supplied environment is complete except that explicit home fields set `HOME` and `CODEX_HOME`. Command arguments support a deliberately selected launcher; they are passed directly without a shell. Only Node 24 on macOS/Linux is supported.

The caller owns the projection, snapshot and storage directories. Setup resolves existing ancestors before creating missing application directories, including symlink aliases. Projection and snapshots may overlap; snapshots normally live under `workspace/.agents/skills`. Native storage must be separate from both. Application directories cannot include the native home itself or overlap the Codex authentication/configuration home. Existing directory modes are preserved; new directories request mode `0700`.

Storage contains `native-state` and `logs`. Neither is granted to sandboxed model tools. Setup creates no application database, epoch, project, turn, tool invocation or skill lock. The application must persist user choices separately, construct current context and immutable skill references, and start the supervisor only after readiness succeeds. A ready result is a point-in-time check; it is not a durable authorization grant or configuration lock.

## Zero-turn protocol

The bounded JSONL transport is restricted during setup to `initialize`, `config/read`, `skills/list`, `account/read` and `model/list`, plus the `initialized` notification. Thread, turn, login, configuration-write and filesystem methods are unavailable. Native interactive requests are rejected. Setup performs:

1. An exact `codex-cli 0.153.4` version check.
2. A short native session to read effective configuration and skill metadata for the application workspace. It extracts only MCP identifiers and skill paths into disabled records. It reads account metadata with `refreshToken: false`, then finds the exact selected model in the paginated catalog and checks the adapter's text/low-effort contract.
3. Process cleanup, followed by a fresh session using those disabled records. Effective permission/configuration values must match, all MCP entries must be disabled, and skill discovery must report no enabled skills or discovery errors.
4. Cleanup before returning any ready result. The subsequent director launch adds only its fixed OpenSlate bridge and selected immutable skills, then checks the actual enabled catalogs again before starting a turn.

The account and model metadata methods are documented by the [official App Server reference](https://learn.chatgpt.com/docs/app-server). `account/read` reports native authentication state; `model/list` exposes model capabilities and pagination. This implementation uses the generated **0.153.4** protocol shapes, rather than assuming newer documentation fields exist in the pinned binary.

The first session does not create a native thread, so it does not connect the inherited MCP catalog as a thread tool set. Native metadata discovery may use native account handling and model-catalog networking. OpenSlate never opens credential files, copies their contents, asks for token refresh, installs plugins, or writes the user's native configuration. Native initialization may maintain its own transient/account state; the host must permit that normal operation.

## Generated configuration

The named `openslate_local` permission profile grants read access only to `:minimal`, the canonical projection and snapshot paths, and the current canonical Node executable. It denies `:root` and disables sandbox network access. Runtime state/logs remain outside those readable roots. The entire selected profile is compared, including rejection of unexpected grants. Normalization admits only the absent/null optional fields observed in the pinned native serializer.

Launch overrides fix the selected model with the first supported `openai` provider path, low reasoning effort and no native approvals. They disable web search, inherited project instructions, analytics/feedback, history persistence, startup update checking and inherited shell environment. Native app/plugin, shell, browser, image, memory, multi-agent and other unrelated feature flags mirror the adapter's pinned reductions. Local code-host support remains enabled for the five-tool MCP path; `code_mode=false` does **not** establish code-host isolation.

Only disabled identifiers/paths are copied from discovery into policy. Inherited MCP commands, arguments, URLs, environment values and credentials, plus skill contents, are excluded. The later director launch removes disabled records matching its explicitly selected active skill paths before adding those active records, avoiding duplicate-path configuration on reopened projects. Unsupported MCP identifiers, oversized catalogs, discovery failures or configuration drift block readiness.

## Readiness and failure handling

`readiness` has status `ready | blocked`, check time, pinned version, selected model, five check states, disabled catalog counts and locally authored issue codes/messages. Checks are `passed | failed | unverified`. It contains no account email, filesystem paths, environment, raw RPC result or native stderr. Only this object is suitable for a UI health response. **Never serialize `runtimeOptions` to the browser or persist it as copied native configuration.**

Account readiness means the native API reports an existing supported account. Model readiness means catalog membership and compatible advertised inputs/effort. Neither proves token freshness, quota, billing availability, model execution, native structured questions, skill adherence, or independent authentication isolation. A later turn can still fail; existing supervisor unknown-outcome and epoch handling continue to apply.

Examples of blocked outcomes are wrong binary version, missing account, absent/incompatible model, invalid directory overlap, discovery errors, unexpected enabled capabilities, timeout and native process failure. OS errors, RPC error bodies and stderr are never returned in readiness. Setup never retries requests automatically. Callers may initiate a new explicit check after correcting the installation or settings.

The complete operation has a 60-second deadline, bounded per-request waits, model pagination (20 pages of at most 100 entries), input/output limits, bounded catalog/launch arguments and process-group cleanup. Optional runtime limits can only tighten the adapter defaults. Cancellation prevents subsequent requests/sessions and closes the current process group. Failed cleanup never produces ready options.

## Verification

Run with Node 24 after building:

```sh
pnpm --filter @openslate/director build
node --test packages/director/test/runtime-setup*.test.mjs
```

Fixtures use a synthetic subprocess, temporary fake homes and no credentials or network. They cover exact policy/catalog generation, metadata redaction, inherited environment exclusion, version/auth/model failures, model pagination, skill/configuration drift, permission expansion, accepted pinned null defaults, symlink/overlap rejection, cancellation, interactive-request rejection, a transport that refuses turn methods, and active-skill replacement without duplicate paths.

On September 12, the installed Codex **0.153.4** returned ready for the unchanged **gpt-6-astra** selection with **five inherited MCP configurations and 21 discovered skills disabled**. Both metadata sessions completed without a thread or model turn. The initial restricted-shell runs failed on native temporary-storage permissions; an authorized native launch outside that outer restriction completed. This evidence establishes bootstrap compatibility on this macOS installation, not a clean-install or cross-platform proof. No model or media call is part of this setup check.
