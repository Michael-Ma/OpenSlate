# Director runtime

OpenSlate supports Codex, Claude Code and a scripted fake Director. The adapters own conversation/protocol mechanics; OpenSlate owns canonical state, request authority, tools, media execution and rendering. Claude Code directs code-plan films only.

## Request lifecycle

1. Persist the human request and explicit scope; fence incompatible older epochs.
2. Queue one leased turn per project and open an epoch-bound tool bridge.
3. Capture current project evidence, immutable guidance/catalog identity, attachments and request identity.
4. Check setup and authority, retain dispatch intent, then start the selected runtime.
5. Save public outputs/questions and tool receipts. An answer starts fresh application authority rather than resuming an untrusted in-memory stack.
6. Record a known ending. Lost ownership/unknown dispatch requires reconciliation of saved evidence rather than a blind replacement turn.

Director leases and media-attempt leases are separate. Stop revokes the turn's epoch; late output cannot mutate a newer request. Direct storyboard field edits and proposal decisions can run alongside a turn, with later human field edits protected at publication.

## Codex

The App Server protocol and native image worker pin **0.162.1**. The default Director model is **`gpt-6.1-sol`**; a saved selection such as `gpt-6-astra` stays saved. A bounded read-only `model/list` call supplies the installed account's choices; the app does not invent a static current-model list. Setup starts no model turn. A failed model list retains the current ID with its readiness status.

The effective executable is discovered from explicit `OPENSLATE_CODEX_BINARY`, then `OPENSLATE_CODEX_IMAGE_BINARY`, the supported side-by-side installation, or bounded local application/PATH candidates. A configured old binary can use the verified versioned installation with `DIRECTOR_CODEX_VERSION_MISMATCH` notice; saved configuration and historical receipts keep their identities. Without a supported executable setup refuses. See [installation](../implementation/MANUAL-LIVE-PRODUCTION.md#codex).

Turns use **high** reasoning effort. The exact local policy reduces native features, disables shell/web/built-in image generation for the Director, and exposes only the lock's MCP tools. The separate image worker has its own image-generation policy and account preparation. Studio-owned instruction-free homes, configuration checks, bridge credentials and epochs remain enforced. V0 trusts the installed runtime/sandbox; independent code-host/authentication isolation is unverified, as the [trust decision](../implementation/RUNTIME-TRUST-DECISION.md) explains.

## Claude Code

Code films may select **Opus 5.5** (`claude-opus-5-5`, default) or **Sonnet 5.5** (`claude-sonnet-5-5`) in Settings → Models → Director. The adapter accepts **2.1.312 or a later 2.x** version. It uses `OPENSLATE_CLAUDE_BINARY` or the default local `~/.local/bin/claude`, verifies version and `auth status`, and requires a first-party Claude subscription login (Pro, Max, Team or Enterprise). API-key/billed API fallback is rejected.

Each turn starts a fresh noninteractive process in the studio workspace. An allowlisted environment excludes inherited provider credentials. Restricted mode, empty personal setting sources, disabled hooks/plugins/agents/skills/slash commands and built-in tools, plus explicit strict MCP configuration, constrain the available surface. The adapter verifies the actual init event's tool/MCP/configuration/model inventory before consuming output. The large verified system prompt is written to a private temporary file and passed with `--system-prompt-file`; the human message arrives on stdin, avoiding OS argument-size limits. Bounded stream JSON carries text and tool activity; actual MCP invocation goes through the same epoch bridge and receipts as Codex.

Missing login, exhausted plan usage, unexpected initialization or an unconfirmed exit surfaces a specific failure. There is no silent model/runtime/API fallback. Stop/shutdown terminate and confirm cleanup of the process group. Claude authentication remains local; it is not copied into SQLite or shared with media providers. Codex images still need their own Codex login even when Claude directs the film.

## Storyboard guidance

Storyboard films lock a shipped release of production, plan-authoring and routed craft/type/format packages. The latest registry row is **8.1.0 / tool contract 7.1.0**. Eligible fresh native turns upgrade verified shipped predecessors before binding context; already-bound epochs and historical snapshots preserve their bytes and catalog. Custom, stale, restored or busy state fails safely. See [skills/tools](SKILLS-TOOLS.md).

Owned discussion images and current keyframes enter bounded, hash-bound projections. Their presence is evidence for discussion, not a media-generation grant. Automatic keyframe reviews are optional read-only application turns and do not authorize media.

## Code-plan Director

`planMode: "code"` takes the separate [code-plan input path](../../apps/server/src/code-plan/director.ts), projecting its current source/view rather than graph planning context. Current guidance is `code-plan@2.0.0` on tool contract **0.3.0**, handler **`code-plan-tools@3`**. The tools are `read_film`, `submit_plan`, `set_spend_limit`, `retry_step` and `read_clip_frames`. Archived 0.1.0 and 0.2.0 catalogs/guidance keep their identities and compatibility behavior; the current contract's shipped content may refresh on an eligible fresh turn.

`submit_plan` carries the whole program, base version and durable invocation ID. `CodePlanRuntime` implements the port in production: dry-run validation, diffs, version fencing, publication and same-ID recovery. No native plan-file access is needed. Programs run later in the isolated [QuickJS replay sandbox](EXECUTION-ENGINE.md#code-plans-experimental), not inside the Director process or the graph declaration compiler.

A request-specific hold prevents new positive-price dispatch while the Director edits; zero-price/local work and existing media reconciliation can continue. Terminal turns release only their own holds, including after restart. Limit changes and consent retries require a quote from the originating human message; repair/review/application turns cannot borrow consent. Current reached choices alone appear in `read_film`; `askedAt` and stale history let the UI keep each card in its original reply. A retired choice rejects new answers with `CODE_PLAN_CHOICE_STALE`.

`ctx.review` pauses a pass for bounded Director inspection through free `read_clip_frames`. Videos return frame-numbered contact sheets and motion measures; owned pictures return one bounded JPEG. This does not play sound to the Director. Upload projection keeps pictures discoverable on later turns and makes owned reduced copies for generation-reference bounds.

The controller queues bounded automatic program repairs (two per failed version), and separate durable media-failure notifications. An application turn cannot authorize paid retries or a limit increase. The fake Director submits the locked example for offline tests.

## Source and verification

- [Codex adapter](../../packages/director/src/runtime/codex.ts), [policy](../../packages/director/src/runtime/policy.ts), [setup](../../packages/director/src/runtime/setup.ts), [binary selection](../../apps/server/src/application/codex-binary.ts).
- [Claude adapter](../../packages/director/src/runtime/claude-code.ts), [process/configuration](../../packages/director/src/runtime/claude-code-process.ts), [setup](../../packages/director/src/runtime/claude-code-setup.ts).
- [Supervisor](../../apps/server/src/application/director-supervisor.ts), [local controller](../../apps/server/src/application/local-director.ts), [code-plan input](../../apps/server/src/code-plan/director.ts).
- Tests: runtime/setup/image, Claude runtime/setup, local-director/Claude-director, code-plan Director/review/upload/choice suites. [Current status](../implementation/STATUS.md) and [dated native evidence](../implementation/VALIDATION-EVIDENCE.md) distinguish offline protocol fixtures from real model/media runs.
