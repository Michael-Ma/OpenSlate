---
name: code-plan
description: Author and revise replayable TypeScript films through the OpenSlate code-plan tools.
---

Write the complete program as `export default async function film(ctx: Studio): Promise<void>`.
Read [the Studio API](references/studio.d.ts) and [the two-shot example](references/example-plan.ts), both supplied in context.
Call `read_film` first: it contains the current source, version, run state, media results, choices, cost, logs and installed models.
Send the whole program in `submit_plan({source, basedOnVersion, summary})`; use null only before the first plan.
The application validates and dry-runs it. There is no separate approval gate in code mode.
Read the returned diff before replying: report reused and new steps, certain cost, and whether later cost depends on choices or pending results.
A refusal includes its code and diff; fix the program using that evidence. Refresh after REVISION_CONFLICT.
If no edit is needed, reply without submitting. The turn's terminal state releases its paid-dispatch hold.

All effects go through ctx. Await every ctx call, including declarations and logging; await Promise.all when running media concurrently.
`scene(declaration)` and `shot(declaration)` accept bounded JSON objects, return those objects, and declare storyboard rows for this pass.
`image({model?, prompt, variant?, ...parameters})` returns a media result. `video({model?, firstFrame, prompt, durationSeconds?, variant?, ...parameters})` does the same for clips.
`speech({model?, text, voice?, instructions?, variant?})` returns a media result for a spoken line; real speech defaults to the stock voice coral and empty instructions.
`render(timeline)` or `render({model?: "local-render", timeline, audio?, width?, height?})` returns local assembly.
For real projects, timeline contains video artifacts or `{artifact, startFrame?, durationFrames?, fit?: "contain" | "cover"}` rows; audio contains `{artifact, startSample?, durationSamples?, atSample?, gainMilliDb?}` placements.
Only cuts, 30 fps, 48 kHz, up to 64 clips, 65 audio placements, eight simultaneous audio lanes and 360 seconds are supported. Frames/samples are integers. An audio placement must fit inside the picture; trim it explicitly when needed.
Real assembly uses measured owned media and returns a probed MP4. Demo projects retain the labeled fixture renderer.
A media result is `{ok:true, artifact, artifacts}` or `{ok:false, error:{code,message}}`. Branch on ok before using an artifact. Provider failure is data; programming errors throw.
`choose(id, {question, options})` accepts a nonempty array of JSON options and returns the chosen option exactly; execution waits until answered.
`log(text)` returns null and records a bounded run-log line.
Use the exact ids in `read_film.models`: they come from the film's saved profiles and installed catalog. Explicit model names are recommended; never invent availability.
Each row gives kind, defaults, unitCostMicros, priceUnit and priceUnknown. Every price is per call, clips included, the same basis as the storyboard quotes. These are host estimates, not verified vendor bills. Unknown prices stay unknown and contribute zero known dollars; they still consume the 200-step limit. Codex images use the ChatGPT subscription and count as $0; native authentication is checked before starting a turn.
Disabled, missing or uncredentialed models cannot dispatch. A real profile never falls back to a fake or a different vendor. Inputs must match the installed settings; video takes a whole number of seconds within minFrames/maxFrames.
The supplied two-shot example is an offline demo using fake-image, fake-video and local-render. Adapt its model ids and durations from read_film before using a real installation. Fake models remain available on demo projects.

Replay starts at the top and reuses media by normalized input content, independent of code location.
Use variant for deliberate duplicates of one prompt; otherwise identical inputs reuse the same step.
Keep choice IDs stable, including across refactors. A changed options digest asks the person again.
Leave prompts byte-identical when not changing them: every byte change is a new paid step.
Keep input objects JSON-only. Never put secrets or file paths in code. No imports, files, environment, network, shell or process access is available.
The native Director workspace is read-only: author source in the tool argument, never by writing files.
New paid work pauses during human turns; in-flight work continues. The $1 ceiling and 200-step bound are circuit breakers, not approval requests.
For repair turns, use the supplied failed version, message and stack, read the current film again, and submit only against its current version.
