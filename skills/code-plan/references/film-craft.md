# Film craft for the Director

## Story before any plan

Before writing a program, state a one-line premise: who wants what, and what obstacle gets in the way. Write a beat sheet with setup, turn and payoff. For each beat name the one thing a viewer can see and its resulting state. Remove shots that neither set up nor pay off. Respect the requested length and language.

Write the punch image first, then the shortest setup. Comedy needs visible contrast: tiny effort, enormous collapse, sudden energy for food. Exaggerate; "normal speed, not exaggerated" erases the joke. Characters take the absurdity seriously. Keep it harmless and let the result register.

Test pictures without prompts or titles: can a stranger watching silently say what happened and why it is funny? A happy dog beside a bowl proves neither exhaustion nor refusal. Show sprawled legs beside the weight, or a back turned to a full bowl. Captions add context; action carries the reversal.

## Shots

Plan 3–4 camera setups, not eight unrelated views. Reuse setups. Neighbouring shots differ by at least one shot size: wide to medium, medium to close. Choose size for the evidence: full body for a collapse, close-up for a reaction. Change angle to reveal something.

Keep one screen direction and one side of the action axis. Record travel and eyelines. In vertical, prefer movement in depth, toward or away from camera, with cause and reaction stacked clearly. Make action readable on a phone. Default to a steady camera and hard cuts; dissolves cannot repair unfinished actions or changed sets.

## Continuity

Make a character sheet first: consistent front, side and face views, markings and wardrobe under plain light. Then make one empty set plate per camera setup. Place props in the plate with count, relative positions and light fixed. Derive other views from the established set reference.

Generate every keyframe from those references: `ctx.image({references: [character, plate], prompt: frame, ...})`. Name each reference's role. Finish shared assets before independent shot pipelines; await frame dependencies. Pictures carry identity and look; "same room" carries no memory between calls.

Track prop states: a pushed weight stays displaced; a bowl empties only after eating. Check returned keyframes for pose, facing, expression, set and props before buying motion. Fix wrong pictures here.

## Prompts

Write image and video prompts in English, whatever language the person uses. Titles, questions, captions and conversation keep their language. Give each shot separate `frame` and `motion` strings, passed directly to their calls. Never concatenate frame text or a shared template into motion. References carry the look.

Frame describes a still: references, framing, pose, expression and relative prop placement. Motion is 60–90 words: subject, starting state, action in order, camera and final pose. At most two visible beats per five seconds: main action and reaction. A beat changes body state; an eye movement only reads in close-up.

Write order, not seconds: "nudges the weight, then flops onto his side." Describe states as states, not steps to animate. Use relative placement and body language; specify gaze and mouth so a default grin cannot undo the emotion. Omit timestamps, physical sizes, margins and lists of what to avoid. Write positively. Most words belong to this shot.

## Clip length

Models spread action across the whole clip and run late: 1.33 seconds on average in the Tofu sample, not a universal guarantee. Request a clip longer than the retained beat, within advertised durations, then cut it down after watching. Extra time provides handles, not proof of action. Never assume the first planned frames contain the payoff.

## References or frames

References stay the video default; describe camera and action because they do not fix the opening. Only where the exact pose is the joke, use `firstFrame`, with `lastFrame` if the landing pose matters, without asking. Honour explicit frame requests too. Use advertised modes; references cannot combine with first/last frames. Preserve unchanged saved calls to reuse media.

## Watching and cutting

Finish every clip, then `await ctx.review(id, {clips, note})`. Use `read_clip_frames` to find each action's actual start and end. Inspect uncertain events closely; motion scores locate change, not meaning. Record usable ranges and visible proof. Set `startFrame` and `durationFrames` from observed source frames at 30 fps. Cut after completion, enter on movement, never end on a half-finished pose. Let the punch settle.

Score each shot and the assembled sequence on five items, 0–2 each: 0 missing/broken, 1 readable but weak, 2 clear and effective.

| Item | Evidence to check |
|---|---|
| Readable action | The intended cause, action and end state are visible. |
| The joke's contrast | Setup and reversal look different enough to land silently. |
| Character and prop continuity | Identity, wardrobe, set, facing and prop states agree. |
| Cut and rhythm | Movement welcomes the cut; the payoff completes and breathes. |
| Picture integrity | Anatomy, composition and image stability support the beat. |

Repair with a better range or cut first. Retake only for missing action, character drift or no usable range: at most one per shot and two per film. A low score alone does not license generation. Use a stable new variant for quality retakes of completed clips. Failed or unknown submissions follow SKILL.md's failure/consent rules; never disguise retries as retakes. Then render and review the render once for story, cuts, sound and words. Report observed flaws.

Use review, frame-reading, captions and sounds only when exposed by the installed contract. Report missing capabilities; never claim to have watched unseen media.

## Sound and words

Every film has music unless the person says otherwise. Plan mood and changes with the beats; generate and trim when cut length is known. Put sound effects on 3–4 joke points at observed contacts or reveals. Normalized clips are silent; prompts cannot supply their soundtrack. A music pause can strengthen the reversal.

Captions use the person's language. Vertical Chinese: at most 8 characters a line and 7 characters a second. Shorten crowded text. Place it on the finished timeline away from action; never ask picture models to draw it. Use `fit: "cover"` for vertical so there are no bars; check faces and story props survive the crop.

## Money

Before shooting, estimate the film and say the number in one line. A 30-second film is about $3 with room for two retakes at baseline rates; recalculate from installed prices, actual lengths, modes and models. Include music, retakes and unknown costs. The default ceiling is $4; stored limits stay unchanged. Report an estimate above the stored limit. This is information, not an approval gate.
