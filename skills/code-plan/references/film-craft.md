# Film craft for the Director

## The idea, before any plan

A brief is a wish, not a shot list. First write what the person fixed (subject, place, tone, length, language, the moments and the ending they named) and what they left open. Keep every fixed point: a named ending keeps its event and its feeling. Moments listed in a brief must appear; how they are seen, in what order and what joins them is your work.

Decide the format first: what the film is and what it is for. Read its part of [formats](formats.md): it sets the length, the picture shape, what the first seconds must do, how the film ends and its unit of structure. Then decide the aim, the response the last picture should leave, with at most one second aim for the build, and read those parts of [aims](aims.md). Write the obvious film in one sentence: the one anybody would make from this brief. Then find three other takes. Each names where its pleasure comes from and its decisive moment; if two takes share both, replace one. A format's structure gives the slots and an aim's shape fills the turn. Both are starting points: use one, bend one, cross two, or leave them when the brief offers something better. At least one take owes nothing to those files. A mood ("cinematic", "whimsical") is not a take.

Choose the take that keeps the fixed points, leaves the viewer something to work out or notice, and fits the ceiling. A calm film needs no twist. Then write the reading: "The viewer first reads this as __. Through __, that becomes __. The image they keep is __." "Through" must be something visible. Check it. What is mismatched in it? In a comedy, what rule is broken, and why is it harmless? Does something from the first seconds come back changed in the kept image? In a film without words, could a stranger watching silently say what happened?

Choose one bold visual rule that expresses the reading and sustain it through framing, light, colour, scale or camera position. Keep the other components alike, so that the one you break at the turn is felt. Compose the kept image as a picture worth pausing on.

Work backwards from the kept image: plant what gives it meaning, withhold what would spoil it, leave out what the viewer can add up from two pictures. Dramatic beats follow by "therefore" or "but", not "and then"; calm beats build by contrast, repetition or absence.

You may enrich a fixed moment while its outcome stays the same. An addition that reverses an outcome, starts a new problem or replaces the requested last image needs the person's agreement first.

Record the idea in the first `ctx.scene`: `format`, `aim`, `fixed` (a list), `takes` (each `{title, basis, chosen?}`), `reading` and `rule`. Open your reply with the chosen take in two lines and the others in one line each, then carry on. Respect the requested length and language.

## Cut list, then shots

Divide the film into two to four blocks. Each has one job: what the viewer believes, expects or notices by its end. Mark the fulcrum, the cut where the reading turns; give it the closest framing or the longest hold and build outward from it. The setup must be believed before the release, and the release is short.

Write what the viewer will see, cut by cut, before deciding what to buy: `cuts: [{ sees, seconds, clip }]` in the same `ctx.scene`, where `clip` is the id of the shot that supplies the cut, or "still" for a held picture that belongs to no shot. One cut shows one plain thing; the cut supplies the meaning. Lengths follow the job: under 1.5 seconds for a glance or an insert, 2–5 for a clear action, 4–8 for a payoff that needs to breathe. Equal lengths need a reason. What matters most now is the biggest thing in frame: go close for a small essential action; keep a whole-body gag wide enough to hold cause and result together. A look is three cuts: the looker, what it sees, the looker. A held picture can change meaning by what came before it.

If every cut is the next action of the same subject, the list is the brief again: cut to a detail of the same moment, to another subject or across time. Wit lives at the cut: an entrance or an exit from the frame; a shape in the last frame matched by the next first picture; a sound for an event you do not show, over the face that hears it; the same framing three times, broken the fourth; an action that starts and is stopped.

Then decide the shots to buy. A shot is one continuous action or state from one setup, and its keyframe shows the moment before the action. The same clip can feed several cuts by range, punch-in, speed or hold. A thing that would not move anyway (an object, a clock, an empty chair) can be a still row: a confirmed keyframe or a shared picture, held for a second or two at no cost. Whatever is alive or in weather, and the kept image, get a clip so that they breathe; a film of held stills is a slideshow. Build in the edit what the video model does badly: looks between two things, fast repeated motions, counts, exact contacts, left and right, readable text. Imply an event you cannot show only when the pictures around it prove it. Give the model what it does well: one simple motion, a slow camera move, light, weather, texture, scale.

Buy from the supported lengths, the range each cut needs and the risk of each action; a one-second insert still costs the shortest clip. Reuse setups: three or four camera positions, not eight unrelated views. Name the one action most likely to fail and what you will do if it does.

The cut list is a hypothesis. After the clips arrive, replace it with what the footage shows.

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

Request `durationSeconds = ceil(targetSeconds + 1.5)`, where `targetSeconds` is the footage this shot's cuts need, clamped to the model's `durationSeconds {min, max}` in `read_film.models`. Use a listed `durationValuesSeconds` value when required. The late-start margin is about 1.5 seconds: the Tofu sample averaged 1.33 seconds late, not a universal guarantee. Viggle accepts 5–15 seconds, so a 3-second beat requests 5 seconds. Video is billed per second: asking for 8 seconds for a 3-second beat pays for about 2.5 times the footage used. Extra time provides handles, not proof of action. Never assume the first planned frames contain the payoff.

## Confirmed keyframes

The person picks the video input on the card. Spread the result: `ctx.video({ ...keyframe.input, shot, prompt: motion, durationSeconds, aspectRatio })`. Never choose the input yourself; you may `suggest` one with a reason: the keyframe as first frame when the framing or a match across a cut must hold, references when the model should find the framing. Retakes reuse the confirmed keyframe with a stable `variant`. When they ask to change a picture, change that shot's `prompt` or `variant` in `ctx.keyframe`; the card asks again. Preserve unchanged saved calls to reuse media.

## Watching and cutting

Finish every clip, then `await ctx.review(id, {clips, note})`.

1. Log each clip with `read_clip_frames`: its moments by frame range, what each proves, and anything good you did not ask for. Motion values locate change, not meaning; look closely around each event.
2. Assemble from the cut list using logged moments. Keep the fixed points and the reading; let the assembly change if the footage offers a better film. Set `startFrame` and `durationFrames` from what you saw, not from the requested clip length; frame numbers are 1/30-second positions.
3. When a moment is missing, take the first step that works: another range; build it from two moments; punch in, change speed or hold; a still; drop the cut; last, a retake that changes the approach (a closer size, one simpler action, the keyframe as first frame). Never buy the same setup again with new words. At most one retake per shot and two per film, each with a stable new variant. Failed or unknown submissions follow SKILL.md's failure and consent rules; never disguise retries as retakes.
4. Rhythm: enter on movement, leave after completion, never on a half-finished pose. Shorten each cut until just before it stops reading. Vary the lengths: quick cuts make a held shot land, and a calm film earns each cut. Put the hit on the frame of contact.
5. Judge each cut in this order: does it land, does it tell, does it move, does it match. For the match, compare the last frame before with the first frame after for position, facing, prop state and eyeline. Repair a mismatch the viewer would notice by reordering, a cutaway or a punch-in; never drop a cut that lands for a flaw nobody will see.
6. Render, read the render's cuts with `read_clip_frames({artifactId, cuts: true})`, and review it once: does the reading happen on screen, and does the kept image land? Report what you observed, including what failed.

Use review, frame-reading, captions and sounds only when exposed by the installed contract. Report missing capabilities; never claim to have watched unseen media.

## Sound and words

Every film has music unless the person says otherwise. Plan mood and changes with the blocks; generate and trim when cut length is known. Put sound effects on the three or four cuts that matter, at observed contacts or reveals; a sound can stand for an event you do not show. Normalized clips are silent; prompts cannot supply their soundtrack. A music pause can strengthen the reversal.

When the format has words, voice-over carries them: about 2.4 words a second, one sentence a picture, each line over the picture it is about. Words give the meaning and pictures the evidence, so never say what the picture already shows. No mouth will match a voice: keep a speaker's face out of the shot, or let a caption or a look carry the line.

Captions use the person's language. Vertical Chinese: at most 8 characters a line and 7 characters a second. Shorten crowded text. Place it on the finished timeline away from action; never ask picture models to draw it. Use `fit: "cover"` for vertical so there are no bars; check faces and story props survive the crop.

## Money

Before shooting, estimate the film and say the number in one line. A 30-second film is about $3 with room for two retakes at baseline rates; recalculate from installed prices, actual lengths, modes and models. Include music, retakes and unknown costs. The default ceiling is $4; stored limits stay unchanged. Report an estimate above the stored limit. This is information, not an approval gate.
