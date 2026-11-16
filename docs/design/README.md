# OpenSlate architecture

OpenSlate is a single-user studio running on one computer: React browser UI, Fastify server, SQLite, owned media, workers and native Director processes. Cloud model/media APIs remain supported. The local rendering boundary is up to six minutes; that limit is not evidence of six-minute real-provider quality.

## Two film modes

| Mode | Planning and execution | Human decisions |
|---|---|---|
| Storyboard (`graph`, default) | Canonical brief/scenes/shots, film kind (`film-kind@1`), cast and soundtrack; restricted declarations compiled to an immutable operation graph; graph workers use candidates, grants, attempts and bindings | Make keyframes/voice, inspect returned frames and actual video recipe, then confirm scene video. Notes, proposals and confirmation cards are separate typed decisions |
| Code plan (`code`, experimental) | Director submits a full TypeScript program; disposable QuickJS/WASM passes call bounded host methods and reuse content-addressed journal results | Program choices, each declared shot's keyframe/video-input confirmation and a per-film liability ceiling (new default $4) |

Models propose validated changes; application authority stays in OpenSlate. Storyboard declaration compilation never executes generated JavaScript. Code films do evaluate stripped TypeScript, only inside an isolated guest without Node/filesystem/network/secrets. New user direction fences incompatible old epochs, and neither mode can reuse a later request's authority for an earlier preparation.

## Components

```mermaid
flowchart TB
  UI[React studio] <--> App[Fastify application authority]
  App <--> Store[(SQLite heads / JSON entities / commands / events)]
  App --> Director[Codex / Claude Code / fake Director]
  Director --> MCP[Locked epoch-bound MCP tools]
  MCP --> App
  App --> Graph[Storyboard compiler and graph engine]
  App --> Code[Code-plan replay and journal]
  Graph --> Execution[Registered execution adapters]
  Code --> Execution
  Execution --> Providers[Cloud media providers]
  Execution --> Local[Owned media / FFmpeg]
  Local --> UI
```

| Path | Owns |
|---|---|
| `packages/core` | Data/public browser contracts, workflows, graph/compiler predicates and tool catalogs |
| `packages/director` | Codex/Claude/fake conversation adapters, locked instructions, bridge and separate native image worker |
| `packages/providers` | Fixed registered media contracts/transports |
| `apps/server` | Requests/authority, supervision, SQLite, graph/code execution, media validation/rendering and recovery |
| `apps/web/src/next` | The only UI, normalized server projections and authenticated human commands |
| `skills`, `scripts` | Immutable runtime guidance; launch/test/demo/toolchain/release operations |

## Turn and execution flow

1. Save a human message, its explicit scope and request-owned holds; lease a Director turn with an exact tool/guidance lock.
2. Supply canonical evidence/attachments and current source or storyboard context. Codex 0.162.1 defaults to `gpt-6.1-sol` at high effort; actual alternative models come from the local account/runtime. Claude Code supports Opus 5.5/Sonnet 5.5 for code films on the user's Claude plan. The fake Director supports offline fixtures.
3. Validate every MCP call under its original epoch. Storyboard changes prepare/apply atomically against revisions; code submissions dry-run and publish only against the matching base version.
4. Graph workers or code-plan execution admit current work under provider readiness, scope/Stop/holds, exact saved inputs and the mode's review/ceiling rules. Persist submission intent before irreversible effects.
5. Retain raw observations, normalized owned bytes, measurements and immutable receipts. Unknown submission requires lookup/reconciliation rather than a blind new POST. A late result can remain historical without replacing a new selection.
6. Events invalidate browser projections. Code passes replay after media/choice changes; identical inputs reuse results. A changed prompt/reference retires only the choices the latest completed pass no longer reaches, leaving cards/answers in their original reply history.

The code runtime and graph engine share registered provider adapters, output spooling, ingestion and local media infrastructure; code execution does not fabricate graph grants/candidates. Local render capture freezes owned sources and ranges before FFmpeg. Storyboard exports follow scene/shot order; code films use `ctx.render` rows, optional audio/captions and measured mastering.

## Persistence and local trust

SQLite stores canonical heads plus versioned JSON entities, command replay receipts and event cursors (schema 4). One fixed absolute `OPENSLATE_DATA_DIR` also holds artifacts, execution output, normalized media and instruction snapshots. Other schema versions are rejected; backup/recovery is same-root and installs quarantine. Credentials and Codex/Claude authentication remain separate local setup.

Codex uses the accepted exact local policy and trusted installed sandbox. Claude uses fresh restricted processes, explicit MCP configuration, a bounded stream and verified init inventory. The code-plan QuickJS worker is a separate guest boundary. Hash/catalog/configuration checks do not establish independent native code-host/authentication isolation. [Runtime trust decision](../implementation/RUNTIME-TRUST-DECISION.md).

## UI and remaining boundaries

The [Last Ferry design](../ai/prototypes/last-ferry/DESIGN.md) supplies the dark English/Chinese studio: Plan, Keyframes, Assets, Film, Start and Settings. Code films have no separate Keyframes tab; Plan holds references/keyframe/clip progress, Assets holds owned results, and Developer mode reveals Code. Choice cards stay with their originating reply and retire in place. [UI reference](../technical/REVIEW-UI.md).

Storyboard films (v8 guidance, contract 7.1.0) also carry:

- **Film kind:** a structured `film-kind@1` record (kind, subtype, tones, format) that routes the Director's craft/type/format guidance; the Director asks when it is undecided.
- **Cast:** recurring characters with per-scene wardrobe and four-view character sheets, reviewed in Plan › Cast and bound into their shots' keyframes.
- **Music videos:** an imported song with local tempo/beat/section analysis and a suggested shot-length fit; an optional paid Gemini listen, started only by the person, adds section labels and timed lyrics. Shots marked Singing are made by MiniMax H3 Max lip sync on fal from the keyframe and the shot's stretch of the song.
- **Clip sound:** a shot can keep its clip's own sound, ducked under narration; social and comedy films keep it by default.
- **Director cards:** the Director offers two or three visual styles to choose from, and confirmation cards for using an earlier take, deleting shots or a scene, resuming after Stop or remaking one to four saved clips. Each card states what changes and what it may cost; only the person's press applies it.

Local assembly uses 48 kHz audio and 1/30-second plan ticks; storyboard exports render at 30 fps and new code films at 24 fps, with clips keeping their native constant frame rate. Limits are 360 seconds/64 clips/65 audio placements/eight audio lanes. Code-plan trims, speed/holds/zoom, captions, sound effects and fades are implemented; a general multitrack editor, transitions, waveforms and streaming remain pending. Existing eligible custom voice IDs are supported; in-app voice-clone enrollment, installers, portable relocation, multi-host deployment and local H3 inference remain outside delivered scope.

[Component references](../technical/README.md), [status/evidence](../implementation/STATUS.md), [studio guide](STORYBOARD-STUDIO.md) and [remaining acceptance](IMPLEMENTATION-PLAN.md) provide current details. Dated designs/reports describe only their own checkpoints.
