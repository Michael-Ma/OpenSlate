# Native skills, scoped edits and isolation validation

Observed September 11, 2026 PDT (September 12 UTC), using Codex **0.153.4**, Node **24.15.0** and **GPT-6 Astra**, low reasoning effort. This consumed all three starts in the then-approved validation experiment: nine starts across the three experiments. No image/video APIs or real production projects were used.

**Result: two application-backed creative edits passed; command sandbox enforcement passed; code-host isolation remains inconclusive.** The final model turn declined the canary script before execution. That refusal is not evidence of an enforced host boundary.

## What the live turns did

The fixture used the repository's actual production service, SQLite store, context/skill loader, compiler, five-tool MCP bridge and authenticated HTTP handlers. Its two-shot boot project had synthetic narration metadata and four initial fake candidate slots. No executor timer ran, and no audio/image/video files were generated.

| Start | Requested work | Observed outcome |
|---|---|---|
| 1 | Change only shot 1 to an extreme close-up of the stitching; apply a matching plan | Passed. Native skill inputs were accepted; five context reads, one preparation and one application succeeded. Only the requested framing/image-prompt fields and their derived identities changed. |
| 2 | After confirmed process exit and replacement, include the stitching's upper edge in shot 1 | Passed. Four context reads, one preparation and one application succeeded. A fresh request/epoch/context/activation retained the same skill lock and package digests. The old credential was rejected by the actual application. |
| 3 | Attempt a bounded synthetic file/network canary check through the native code host | Inconclusive. The model reported `executed:false`; native events contained no tool execution. No write or connection occurred, but the host's access restrictions were not exercised. |

Independent review matched all **13 MCP call IDs and canonical result digests** to successful persisted invocation records. Apply receipts advanced project head **2 → 3 → 4**. Both calls used `variant: "plan"` with a scoped creative patch and replacement source; this does not establish explicit model-authored workflow-stage proposal behavior.

Shot 2, narration, cues, story, brief, aliases and all untouched shot-1 fields were preserved. The model-created plans retained exact keyframe review gates. Eight synthetic grants backed eight candidates after both edits; there were **zero media attempts, provider accepts, generated artifact records or human approvals**. The isolation epoch was downgraded to read-only before native dispatch, its mutation attempt was rejected, and the full project/plan/candidate/grant snapshot stayed unchanged during that turn.

All three native app-server processes exited with code 0, the synthetic native thread was archived, and application/provider databases were closed. These are observed process and fixture cleanup results, not a blanket claim about every possible native descendant.

## Skill loading evidence

```mermaid
sequenceDiagram
    participant App as OpenSlate application
    participant Files as Immutable skill snapshots
    participant Native as Codex process
    participant Service as Validated tools and SQLite
    App->>Files: Verify lock and selected entry hashes
    App->>Service: Save fresh context and activation
    App->>Files: Read five focused references
    App->>Service: Save exact reference-read evidence
    App->>Native: Text + explicit skill name/path inputs + focused context
    Native-->>App: Native user-message events retain exact skill selections
    Native->>Service: Read, prepare, apply scoped edit
    Service-->>Native: Durable receipts and current revision
    App->>Native: Close and await exit
    App->>Service: New request and epoch, same skill lock
    App->>Native: Replacement process, reconstructed context, reinjected skills
```

Both creative turns emitted native user-message items containing the exact `production` and `plan-authoring` names and immutable entry paths supplied by the application. The path/hash selection and resulting validated behavior were observed. The runtime's internal expansion of every SKILL.md byte was not independently observed, and selection is not proof of universal instruction adherence.

OpenSlate supplied five required references per request through its verified read helper: the current contract, shot-plan guidance, continuity/review, planning grammar and compiled example. Ten read-evidence records were saved. Native entry injection alone does not load or audit all linked references. This explicit loading avoids depending on unrestricted file tools. The native input shape follows the [App Server skill interface](https://learn.chatgpt.com/docs/app-server).

Later `thread/read` projection showed skill names but omitted entry paths retained in the live native events. Continue using application locks, captures and receipts for audit/recovery; native history remains an incomplete projection.

## Enforced command permissions and their limits

No-turn checks used a named `openslate_isolation` permission profile. They required an allowed profile in `permissionProfile/list`, the same active profile in thread start/resume responses, the exact two enabled skills with no discovery errors, one connected MCP server and its exact five tools. Authentication remained available to trusted native code; no credential file was inspected or copied by the fixture.

The command-sandbox checks observed:

- A positive read of an allowed synthetic file.
- `EPERM` for an outside synthetic credential-shaped file and a narrower denied subdirectory.
- `EPERM` for overwriting an existing file or creating a new one; original bytes remained unchanged.
- `EPERM` for direct TCP to an owned loopback endpoint independently verified as reachable.

The profile denies root access, allows the platform minimum and exact instruction/workspace reads, and disables command networking. Use `permissions` on thread start/resume/turn and `permissionProfile` on `command/exec`; do not combine them with legacy sandbox selectors. These controls are described in the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Two setup failures were resolved before spending model turns. Pinned CLI dotted overrides misparsed quoted filesystem paths; passing the entire permissions table as one structured TOML value succeeded. The canary Node command then tried to load an unnecessary system OpenSSL configuration; `--openssl-config=/dev/null` removed that test-only dependency without broadening file access. Neither startup failure was counted as a successful denial.

**Command isolation does not prove code-host isolation.** The first creative turn produced four generic native `exec` calls and matching outputs even with `features.code_mode=false` and `features.code_mode_host=true`. That flag combination does not remove the JavaScript execution surface. The third process deliberately set `code_mode=true` for the diagnostic while preserving other restrictions, but the model declined execution. No conclusion about code-host filesystem, network or authentication-memory access follows from that turn.

The app-server remains trusted code that carries model authentication. A separate state directory and disabled native shell features do not establish whole-process confinement. Production media keys, database authority and bridge credentials still require a verified boundary against every model-facing execution surface.

## Timing and next implementation work

The two creative starts took approximately **23.8 seconds** and **29.5 seconds** from dispatch to terminal completion. This tiny synthetic fixture does not predict six-minute production performance. Native token totals include repeated input over several tool steps and cached input; they are not single-context sizes or a dollar-cost estimate.

The fixture deliberately supplied canonical context and then requested fresh tool reads, duplicating some data. Before optimizing the runtime, measure a focused context bundle and stable cached instruction prefix, refresh only missing/stale sections, and retain commit-time revision checks. Compare useful output, calls, input/cache use and latency while preserving the same edit/review tests. Do not optimize by dropping required source branches or authority checks.

Next, design a deterministic host-boundary check or an independently enforced execution boundary; do not count another model refusal as validation. Complete the supervisor/dispatch/reconciliation implementation using offline fixtures while keeping real generation authority disconnected. Pending-input replies, vision, complete production prompt wiring and real media remain separate gates. Further live starts require another allowance; this experiment makes no request for automatic retries.

See the [sanitized evidence summary](codex-skill-validation-evidence.json) and [current implementation status](STATUS.md). The earlier **195-test** checkout baseline is unchanged; this follow-up added a separate offline fixture smoke test and native experiments, not a new full-suite result.
