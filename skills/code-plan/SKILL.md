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
`image({model?, prompt, variant?, ...parameters})` returns a media result. `video({model?, firstFrame, prompt, durationSeconds?, aspectRatio?, variant?, ...parameters})` does the same for clips.
`speech({model?, text, voice?, instructions?, variant?})` returns a media result for a spoken line; real speech defaults to the stock voice coral and empty instructions.
`music({model?, prompt, durationSeconds, instrumental?, variant?})` returns owned 48 kHz audio with measured `leadInSamples` and `durationSamples`. Lyria costs $0.08 per call and requires billing on the Gemini key’s Google project.
`render(timeline)` or `render({model?: "local-render", timeline, audio?, width?, height?})` returns local assembly.
For real projects, timeline contains video artifacts or `{artifact, startFrame?, durationFrames?, fit?: "contain" | "cover"}` rows; audio contains `{artifact, startSample?, durationSamples?, atSample?, gainMilliDb?, fadeOutSamples?}` placements.
Only cuts, 30 fps, 48 kHz, up to 64 clips, 65 audio placements, eight simultaneous audio lanes and 360 seconds are supported. Frames/samples are integers. An audio placement must fit inside the picture; trim it explicitly when needed.
Real assembly uses measured owned media and returns a probed MP4. Demo projects retain the labeled fixture renderer.
A media result is `{ok:true, artifact, artifacts}` or `{ok:false, error:{code,message,retry,mayHaveCharged}}`. Branch on ok before using an artifact. Provider failure is data; programming errors throw.
`choose(id, {question, options})` accepts a nonempty array of JSON options and returns the chosen option exactly; execution waits until answered.
Give each shot its own pipeline (frames, choose, clip) and start all shots together with `Promise.all(shots.map(...))`, as the example does. A choice then appears as soon as its own shot's frames exist, and that shot's clip runs while the person is still choosing for the next one. Never make every shot's frames before the first choice, and never make clips one after another. Codex images are made one at a time in the order requested, so list shots in film order.
`log(text)` returns null and records a bounded run-log line.
Use the exact ids in `read_film.models`: they come from the film's saved profiles and installed catalog. Explicit model names are recommended; never invent availability.
Each row gives kind, defaults, unitCostMicros, priceUnit and priceUnknown. Every price is per call, clips included, the same basis as the storyboard quotes. These are host estimates, not verified vendor bills. Unknown prices stay unknown and contribute zero known dollars; they still consume the 200-step limit. Codex images use the ChatGPT subscription and count as $0; native authentication is checked before starting a turn.
Disabled, missing or uncredentialed models cannot dispatch. A real profile never falls back to a fake or a different vendor. Inputs must match the installed settings; video takes a whole number of seconds within minFrames/maxFrames.
The supplied two-shot example is an offline demo using fake-image, fake-video, fake-music and local-render. Adapt its model ids and durations from read_film before using a real installation. Fake models remain available on demo projects.

Replay starts at the top and reuses media by normalized input content, independent of code location.
Use variant for deliberate duplicates of one prompt; otherwise identical inputs reuse the same step.
Keep choice IDs stable, including across refactors. A changed options digest asks the person again.
Leave prompts byte-identical when not changing them: every byte change is a new paid step.
Keep input objects JSON-only. Never put secrets or file paths in code. No imports, files, environment, network, shell or process access is available.
The native Director workspace is read-only: author source in the tool argument, never by writing files.
New paid work pauses during human turns; in-flight work continues. The $1 ceiling and 200-step bound are circuit breakers, not approval requests.
For repair turns, use the supplied failed version, message and stack, read the current film again, and submit only against its current version.

Failures and consent:
- Explain failures in plain words, never bare codes. Say which shot/step failed, its estimated price, and whether money may already have been spent. An unknown submission may charge twice on retry. Offer retry or skip and wait for the person.
- Safe failures (the request never reached the vendor) automatically retry at most twice with short backoff. Do not manufacture variants to bypass that bound. `retry: "none"` means fix invalid input/content or the program instead.
- On the person's yes, call `retry_step({stepKey, quote})` using their own words from the message that started this turn. It opens another attempt for the same step; the rest stays reused. Earlier possible charges remain counted. Application failure/repair turns cannot supply consent.
- When the person asks to change the spend limit, call `set_spend_limit({ceilingMicros, quote})`, quoting their request. Micros are integer USD millionths ($3 = "3000000"). Higher and lower limits are allowed, with no chat-specific cap; the application refuses a limit below charged, unknown and in-flight work. Both tools return a receipt; report only the observed change.
- Programs cannot call retry_step. For an in-program retry after a result with retry other than "none", ask `ctx.choose("<shot>-retry", {question, options:["retry","skip"]})` with an honest cost line, then repeat ctx.video with a new variant only if the person chose retry. Include whether the earlier attempt may have charged, plus the new call's price from read_film.models. Keep this choice and variant stable on replay; never retry endlessly or silently.

Vertical films: pass `aspectRatio: "9:16"` to ctx.video. Viggle also supports 16:9, 1:1, 4:3, 3:4 and 21:9. Without an override, the measured first frame selects the nearest supported Viggle ratio, and both crop and request use it. The ratio is part of step identity. MiniMax follows its first frame's aspect without a separate wire ratio; any explicit ratio must match that frame. Render vertical output with width:1080,height:1920.

Background music:
- Generate it once the cut’s length is known. Describe mood, instruments and tempo in words; instrumental defaults to true (no vocals).
- Lyria length is approximate: a 20-second request returned 68 seconds. Always trim and fade at the cut. Place at `atSample: 0`, skip the measured `leadInSamples` using `startSample`, set `durationSamples` to the film’s samples and `fadeOutSamples: Math.min(96000, filmSamples)` for the last two seconds (five seconds maximum).
- First check `music.durationSamples - music.leadInSamples >= filmSamples`. If shorter, tell the person and generate another track with an explicit stable `variant`; do not stretch or silently reuse an unusable track. Use a variant for any deliberate regeneration.
- Mix at about `gainMilliDb: -14000` under speech or `-6000` when the film has no speech. Tell the person the generated file carries an inaudible SynthID audio watermark.
