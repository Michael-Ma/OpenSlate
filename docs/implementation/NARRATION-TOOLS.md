# Versioned narration drafting tools

September 12, 2026. Implemented application/runtime integration. Under tool contract `2.0.0`, the director can save structured narration drafts. Exact script, recording and timing acceptance remains human-only. Speech synthesis/transcription and connected live media generation are separate work.

## Flow and authority

```mermaid
flowchart LR
  Request[Current human request] --> Epoch[Immutable epoch and skill lock]
  Epoch --> Context[Paged narration evidence]
  Context --> Director[Director proposes draft edits]
  Director --> Tool[Versioned draft tool]
  Tool --> Check[Schema, project scope, epoch and version]
  Check --> Draft[(Atomic section revisions and receipt)]
  Draft --> Review[Human script, recording and timing review]
  Review --> Canonical[Reviewed canonical narration application]
  Canonical --> Plan[Matching shot and execution plan]
```

`revise_narration_draft` writes only section text, maturity, language, meaning and intended source. Its add/update/remove/order operations reuse `NarrationService.reviseSegments`. It accepts no actor, acceptance, recording attachment, timing, placement, canonical project or spending fields. The service verifies the current originating request/epoch inside its transaction and requires project scope; a scene/shot-only request cannot change the narration collection.

Example:

```json
{
  "expectedVersion": 0,
  "patch": {
    "add": [{
      "text": "Built by hand. Ready for the road ahead.",
      "textKind": "draft",
      "language": "en",
      "meaning": "Introduce craftsmanship and everyday use",
      "source": { "kind": "generated", "voice": null, "profileRevisionId": null }
    }]
  }
}
```

Generated source describes intent only. Null voice/profile fields preserve missing choices; a supplied string is not proof of a configured provider or executed synthesis. The command allocates section IDs. Additions append; ordering names every remaining saved section exactly once and cannot accompany additions. Updates supply a saved section ID and complete draft, preserving fields the user did not ask to change.

Changed sections receive immutable script revisions and lose exact script/audio/timing acceptance and selected cues. A source change also detaches the previous recording candidate. Unchanged sections retain their revisions and acceptance; history remains. Draft writes do not modify canonical narration, plans, grants, attempts or execution holds. Existing review controls perform separate human acceptance and canonical preparation/application.

Draft work constructs `NarrationService` without media tools. Recording operations use its checked media accessor. Without FFmpeg/ffprobe, the local app still exposes writing and exact script review, reports recording capabilities as unavailable, and rejects recording import before consuming upload bytes.

## Reading and recovery

V2 adds `read_context({"section":"narration"})`: saved drafts, exact acceptance state, derived text/audio/timing readiness, gaps and a recording inventory. Recording descriptors expose IDs, hashes, measured sample counts/rates and declared origin. They omit host paths and do not claim knowledge of the recording's words. Sections, recordings and gaps share a paginated window. Follow `page.nextOffset` and compare guards, including `dataDigest`. Complete records fit the existing 512-KiB bound or fail explicitly.

Before dispatch, `tool_invocation` stores project/request/epoch/call ID, argument digest, contract version, catalog digest and skill-lock ID. These fields remain immutable while the call runs. Narration uses the server-derived command key `director-tool:<invocation ID>` within the request-scoped narration command store. The command and narration revision commit atomically.

Responses contain narration version/revision, ordered section IDs/revisions and readiness/gap counts. Long scripts and physical media descriptors stay in domain storage and paged context. Completed calls replay exact receipts after restart. Different input under the same call ID conflicts; a different call ID with an obsolete narration version cannot append duplicate sections.

If a draft commits but its tool response is lost, the invocation remains unresolved. After fencing that epoch, the supervisor checks the exact saved command scope/key/digest and records a compact reconciliation receipt. It never repeats the draft handler to discover the outcome. Missing evidence remains unresolved.

## Catalogs, locks and upgrades

The `1.0.0` catalog retains its exact five descriptors and digest. Original packages remain unchanged at `skills/production` and `skills/plan-authoring`. V2 packages live at `skills/v2/production` and `skills/v2/plan-authoring`; package versions and tool compatibility are `2.0.0`, while planning/workflow contracts remain `1.0.0`.

V2 has six tools. It adds narration draft writes and a narration read section, and removes `creative.narrationScript` and `creative.narrationSource` from `prepare_change`. Those legacy fields directly rewrite canonical narration. A major version makes the changed contract explicit.

The input builder first honors an existing epoch lock, otherwise the latest saved project lock, otherwise its trusted new-project default (`2.0.0`). It verifies the selected environment, snapshots and implementation bindings. Source changes and new-project defaults never upgrade an existing lock. Missing/corrupted snapshots and unknown versions fail closed.

The bridge captures `OPENSLATE_BRIDGE_TOOL_CONTRACT` at launch; absent configuration retains V1. MCP discovery, argument validation, native launch configuration and native catalog checks use that version. Server dispatch independently reads the credential's immutable epoch lock; model-supplied versions/headers cannot expand authority. Older unbound tool epochs retain V1 only. Native dispatch identity preserves the legacy digest formula and explicitly binds V2's version/catalog digest.

Existing users can open project director settings and select **Enable narration drafting**. The authenticated upgrade takes the displayed predecessor lock ID/digest, target `2.0.0` and stable command key. It verifies shipped packages, then atomically rechecks the predecessor, runtime configuration and absence of queued/running turns or live epochs before installing one successor lock and receipt. It creates no creative request, model turn, hold, approval or media work. Existing holds and old lock/epoch records remain. Exact retries recover the original receipt; browser uncertain updates survive project remounts within one API session.

No database table/schema migration is needed: JSON invocation fields, existing command receipts and immutable skill-lock records supply the new identities/history. Old invocations with absent metadata are interpreted only as V1. There is no automatic conversion of old narration text into accepted sections and no media regeneration on instruction upgrade.

## Verification and source

The focused catalog/runtime/narration run passed **71 tests**, including 15 new tests for draft behavior, old-lock preservation, human-only acceptance, authority fences, compact large-script receipts, restart/reconciliation, path-free pagination, immutable catalog identity, actual stdio discovery and synthetic native catalog mismatch. Seven separate upgrade tests passed. Core/director/server builds passed. These fixtures make no real model/media API calls. Actual native V2 drafting and browser evidence are recorded separately when exercised; fake protocol tests do not establish model behavior.

- Catalog/schema: [core tools](../../packages/core/src/tools.ts).
- Locks/input: [capability helpers](../../apps/server/src/application/director-capabilities.ts), [input builder](../../apps/server/src/application/director-input.ts).
- Authority/receipts/context: [tool invocations](../../apps/server/src/application/tool-invocations.ts), [context projection](../../apps/server/src/application/context-projection.ts).
- Draft invariants: [narration service](../../apps/server/src/narration/service.ts); review/canonical details: [narration integration](NARRATION-INTEGRATION.md).
- Upgrade: [settings service](../../apps/server/src/application/director-tools-upgrade.ts), [browser controls](../../apps/web/src/DirectorToolsSettings.tsx).
- Transport: [MCP entrypoint](../../packages/director/src/tools/mcp.ts), [native adapter](../../packages/director/src/runtime/codex.ts).
