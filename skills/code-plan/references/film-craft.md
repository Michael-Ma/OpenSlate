# Film craft for the Director

## Story before any plan

Before writing a program, state a one-line premise: who wants what, and what obstacle gets in the way. Write a beat sheet with setup, turn and payoff. For each beat name the one thing a viewer can see, its resulting state and the shot's target on-screen length: about 2–3 seconds for a quick reaction or insert, 4–6 for a clear action, 5–8 for a payoff that needs to breathe. Let lengths differ with the story; equal lengths need a reason. Remove shots that neither set up nor pay off. Respect the requested length and language.

Write the punch image first, then the shortest setup. Comedy needs visible contrast: tiny effort, enormous collapse, sudden energy for food. Exaggerate; "normal speed, not exaggerated" erases the joke. Characters take the absurdity seriously. Keep it harmless and let the result register.

Test pictures without prompts or titles: can a stranger watching silently say what happened and why it is funny? A happy dog beside a bowl proves neither exhaustion nor refusal. Show sprawled legs beside the weight, or a back turned to a full bowl. Captions add context; action carries the reversal.

## Shots

Plan 3–4 camera setups, not eight unrelated views. Reuse setups. Neighbouring shots differ by at least one shot size: wide to medium, medium to close. Choose size for the evidence: full body for a collapse, close-up for a reaction. Change angle to reveal something.

Keep one screen direction and one side of the action axis. Record travel and eyelines. In vertical, prefer movement in depth, toward or away from camera, with cause and reaction stacked clearly. Make action readable on a phone. Default to a steady camera and hard cuts; dissolves cannot repair unfinished actions or changed sets.

## Continuity

Make a character sheet first: consistent front, side and face views, markings and wardrobe under plain light. Then make one empty set plate per camera setup. Place props in the plate with count, relative positions and light fixed. Derive other views from the established set reference.

Use `ctx.image` only for shared references, with no `shot`. Every shot makes exactly one keyframe from those references and its `frame` prompt: `ctx.keyframe(shot, {references: [character, plate], prompt: frame, video: {model, durationSeconds, aspectRatio}})`. Do not use `ctx.choose` for keyframes or make alternatives unless the person asks. Name each reference's role. Finish shared assets first, then start shot pipelines together with `Promise.all(shots.map(...))`; each card appears as soon as its frame exists. Pictures carry identity and look; "same room" carries no memory between calls.

Track prop states: a pushed weight stays displaced; a bowl empties only after eating. Write each frame so its keyframe shows pose, facing, expression, set and props: the person judges this picture before motion is bought.

## Prompts

Write image and video prompts in English, whatever language the person uses. Titles, questions, captions and conversation keep their language. Give each shot separate `frame` and `motion` strings, passed directly to their calls. Never concatenate frame text or a shared template into motion. References carry the look.

Frame describes a still: references, framing, pose, expression and relative prop placement. Motion is 60–90 words: subject, starting state, action in order, camera and final pose. At most two visible beats per five seconds: main action and reaction. A beat changes body state; an eye movement only reads in close-up.

Write order, not seconds: "nudges the weight, then flops onto his side." Describe states as states, not steps to animate. Use relative placement and body language; specify gaze and mouth so a default grin cannot undo the emotion. Omit timestamps, physical sizes, margins and lists of what to avoid. Write positively. Most words belong to this shot.

## Clip length

Request `durationSeconds = ceil(targetSeconds + 1.5)`, clamped to the model's `durationSeconds {min, max}` in `read_film.models`. Use a listed `durationValuesSeconds` value when required. The late-start margin is about 1.5 seconds: the Tofu sample averaged 1.33 seconds late, not a universal guarantee. Viggle accepts 5–15 seconds, so a 3-second beat requests 5 seconds. Video is billed per second: asking for 8 seconds for a 3-second beat pays for about 2.5 times the footage used. Extra time provides handles, not proof of action. Never assume the first planned frames contain the payoff.

## Confirmed keyframes

The person picks the video input on the card. Spread the result: `ctx.video({ ...keyframe.input, shot, prompt: motion, durationSeconds, aspectRatio })`. Never choose the input yourself. References can re-frame a shot; mention this only if asked. Retakes reuse the confirmed keyframe with a stable `variant`. When a subject was cut off and the person allowed the keyframe as input, use `firstFrame: keyframe.frame` for the retake. If they chose references only, keep their chosen input. When they ask to change a picture, change that shot's `prompt` or `variant` in `ctx.keyframe`; the card asks again. Preserve unchanged saved calls to reuse media. Tell the person nothing about step IDs or modes in chat; the card says it.

## Watching and cutting

Finish every clip, then `await ctx.review(id, {clips, note})`. Use `read_clip_frames` to find each action's actual start and end. Inspect uncertain events closely; motion scores locate change, not meaning. Record usable ranges and visible proof. Set `startFrame` and `durationFrames` from the observed action and the beat's target, not the requested clip length; frame numbers are 1/30-second positions. Cut after completion, enter on movement, never end on a half-finished pose. Let the punch settle.

Score each shot and the assembled sequence on five items, 0–2 each: 0 missing/broken, 1 readable but weak, 2 clear and effective.

| Item | Evidence to check |
|---|---|
| Readable action | The intended cause, action and end state are visible. |
| The joke's contrast | Setup and reversal look different enough to land silently. |
| Character and prop continuity | Identity, wardrobe, set, facing and prop states agree. |
| Cut and rhythm | Movement welcomes the cut; the payoff completes and breathes. |
| Picture integrity | Anatomy, composition and image stability support the beat. |

Repair with a better range or cut first. Retake only for missing action, character drift, a subject cut off by the framing, or no usable range: at most one per shot and two per film. A low score alone does not license generation. Use a stable new variant for quality retakes of completed clips. Failed or unknown submissions follow SKILL.md's failure/consent rules; never disguise retries as retakes. Then render and review the render once for story, cuts, sound and words. Report observed flaws.

Use review, frame-reading, captions and sounds only when exposed by the installed contract. Report missing capabilities; never claim to have watched unseen media.

## Sound and words

Every film has music unless the person says otherwise. Plan mood and changes with the beats; generate and trim when cut length is known. Put sound effects on 3–4 joke points at observed contacts or reveals. Normalized clips are silent; prompts cannot supply their soundtrack. A music pause can strengthen the reversal.

Captions use the person's language. Vertical Chinese: at most 8 characters a line and 7 characters a second. Shorten crowded text. Place it on the finished timeline away from action; never ask picture models to draw it. Use `fit: "cover"` for vertical so there are no bars; check faces and story props survive the crop.

## Money

Before shooting, estimate the film and say the number in one line. A 30-second film is about $3 with room for two retakes at baseline rates; recalculate from installed prices, actual lengths, modes and models. Include music, retakes and unknown costs. The default ceiling is $4; stored limits stay unchanged. Report an estimate above the stored limit. This is information, not an approval gate.
