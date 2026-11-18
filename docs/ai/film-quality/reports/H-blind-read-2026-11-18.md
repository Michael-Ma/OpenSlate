# Blind read: can a stranger see the take? Skill 2.2.0 against 2.3.0

2026-11-18. The owner watched the two real films made with skill 2.2.0 and said the chosen take could not be seen in them. Skill 2.3.0 changes the text so the take has to be acted on screen. This is the test of that text before it was released. It cost nothing: no picture or video was made. Run folder: `data/test-runs/20261118-take-on-screen/` (not in git).

## Method

The earlier paper tests judged a plan by its words, which is how a take that never reached the screen passed three rounds. This test hides the words.

1. **Director.** `gpt-6.2-sol` (the studio's Director model since M3) read the skill from a folder that held nothing else and did the work of a first turn for eight briefs: its decisions, and then everything the plan would put on screen and in the sound, with every picture, frame and motion prompt word for word. Once with skill 2.2.0, once with the 2.3.0 text. Sixteen films.
2. **Plain-sight sheet.** A fresh `gpt-6.2-astra` got only the screen part of each film (no take, no reading, no titles) and wrote what a camera and a microphone would record, cut by cut. It was told that a generator renders bodies, objects and light and not intentions, and to say when two cuts are the identical footage.
3. **Two strangers.** A fresh `gpt-6.2-astra` and a fresh Claude Opus each read the sheets, eight films at a time with the two versions of a brief never in the same sitting, and answered: what happens, is there any idea beyond that, what picture would you remember. Labels hid which skill a film came from.
4. **Two judges.** A fresh `gpt-6.2-astra` and a fresh Claude Opus compared each stranger's words with the plan: TAKE (the stranger describes the chosen take unprompted), PARTLY (notices something that belongs to the take alone, without arriving at it) or OBVIOUS (describes the obvious film or the brief).

Each film therefore has four verdicts. Points: TAKE 2, PARTLY 1, OBVIOUS 0, so 8 is the most a film can get.

## Result

| Brief | 2.2.0 take | Points | 2.3.0 take | Points |
|---|---|---:|---|---:|
| 1. Pigeon and croissant (every moment named) | The chair has eyes | 2 | Table for one: the pigeon bows to the empty chair before it steals | 7 |
| 2. Night platform (every moment named) | The light that leaves | 1 | The second train: the train leaves again in a trackside puddle | 6 |
| 3. A cat that hates Mondays | Present, technically: the cat collapses on the laptop | 6 | Put Monday back to bed: the cat tucks the alarm clock in | 6 |
| 4. 雨夜的便利店 | 屋檐下的一小块干地 | 8 | 伞尖上的雨 | 7 |
| 5. 保温杯广告 | 一圈光，两种温度 | 7 | 杯口里的日出 | 4 |
| 6. Old elevator, creepy | The same landing | 8 | The same landing | 8 |
| 7. 给妈妈的生日短片 | 系在花盆上的生日礼物 | 8 | 花盆上的蜡烛 | 6 |
| 8. Something amazing with a whale | The ocean over the road | 8 | The ocean in the puddle | 8 |
| **Total of 64** | | **48** | | **52** |

Verdict counts over 32 each: 2.2.0 had 21 TAKE, 6 PARTLY and 5 OBVIOUS; 2.3.0 had 20 TAKE, 12 PARTLY and no OBVIOUS.

## What it shows

- **The fault the owner saw is reproduced, and 2.3.0 repairs it.** Briefs 1 and 2 name every moment of the film. With 2.2.0 the Director filmed those moments as anybody would and the take stayed in its notes: the strangers called the pigeon film "a tiny heist" with a bird "checking that no one is around", which is the plan's own obvious film. This is the same failure as the real pigeon film. With 2.3.0 the pigeon bows to the chair, a service bell answers, the chair has a clip of its own and no range is used twice; one stranger wrote that the pigeon "looks comically polite about stealing breakfast", the other read the bow as "a polite 'may I?'". Nothing a stranger said about a 2.3.0 film was only the obvious film.
- **On open briefs 2.2.0 was already visible on paper with GPT 6.2.** Six of the eight briefs leave the Director free, and there its takes reached the strangers in both versions. The gain is where the brief fixes the moments.
- **Two 2.3.0 films lost points, for reasons worth knowing.**
  - *The flask advert.* Both strangers saw exactly what the proof describes ("broken orange arcs joining into a circle") and neither called it a sunrise. The picture is on screen; its name is not. That is a metaphor the cut does not complete, not a hidden take.
  - *The birthday film.* One stranger read a candle planted beside a flower, with the single word 妈妈, as "a quiet remembrance of a mother who has died". The take is visible and can be misread. Nothing in the 2.3.0 draft made the Director read its own cut list as a stranger before submitting it.
- **The cat film shows what the change is for.** 2.2.0: a cat falls asleep on a laptop under a MONDAY caption. 2.3.0: the cat pulls the quilt up over the alarm clock, leaves its bells out like a head and lies down beside it. Both score 6; only one of them is a picture the obvious film does not have.

## What changed in the text because of it

One sentence was added to "Cut list, then shots" after this round: read the `sees` lines alone as a stranger with no brief and say what the film is; if that is the obvious film, or a film the person did not ask for, the cut list is not finished. Round 2 below ran with it.

## Round 2: the released text

The Director ran once more on the same eight briefs with the final text, and the same sheet, two strangers and two judges followed. The strangers had not seen round 1.

| Brief | Take | Points of 8 |
|---|---|---:|
| 1. Pigeon and croissant | The chair on watch: the empty chair rocks, the pigeon ducks, and the last picture puts the bird above the chair | 7 |
| 2. Night platform | The light that stays: the train's amber reflection slides off a wet bench and leaves the platform's own pale light | 6 |
| 3. A cat that hates Mondays | Bury Monday: the cat swats the alarm clock into its litter tray and buries it | 8 |
| 4. 雨夜的便利店 | 门里只剩一滴雨 | 8 |
| 5. 保温杯广告 | 杯里有一扇窗: the broken gold reflection in the tea settles into a whole window | 6 |
| 6. Old elevator, creepy | The landing inside | 8 |
| 7. 给妈妈的生日短片 | 把花端上来: a watered pot is carried to a cake stand beside a candle, with the caption 给妈妈 | 8 |
| 8. Something amazing with a whale | A wake full of night | 8 |
| **Total of 64** | | **59** |

27 TAKE, 5 PARTLY, no OBVIOUS, against 48 points for 2.2.0 and 52 for the first draft.

- **The pigeon.** A stranger wrote: "a comic standoff in which the pigeon treats an empty chair as if it were a person guarding the croissant." That is, almost word for word, the take of the real film made on 2026-11-17, which no viewer could see. In this plan the chair has a clip of its own in which it rocks and its loose foot taps the tile, the pigeon pulls its head down between its shoulders, the three looks use three different ranges, and the last picture has the empty chair below the bird.
- **The birthday film** was read as a celebration by both strangers ("as if a humble plant stood in for a birthday or celebration cake"). The Director's notes now include the stranger's sentence it wrote for itself before submitting.
- **Still partial:** the flask advert (one stranger of two named the window) and the platform (both saw the light leave the bench; one judge wanted more).

## A real Director turn on the released build

After the release a side studio ran the pigeon brief with the real Director (Codex 0.170.0, `gpt-6.2-sol`, skill 2.3.0), up to the keyframes. No video was bought; spend $0. The owner's studio was not used. Files: `data/test-runs/20261118-take-on-screen/live/` (the plan in `plans/pigeon-v1.ts`, screenshots and the recording in `raw/`).

- **The mechanism works end to end.** The first turn took about three minutes. The plan records `obvious` and three proofs, marks the cuts that show them (11.1 of 25 seconds), and the dry run returned no finding. The idea panel shows them as "Seen on screen". The reply opens with the take and what the viewer will see of it.
- **The take has pictures of its own.** Take: "Permission from Nobody", a pigeon takes a napkin fluttering on an empty chair as permission and bows back. The chair has its own reference picture and its own clip, framed level at the pigeon's height, used in two different ranges; the pigeon's clip is used in three different ranges at three sizes. Nothing is shown twice. The lamp-post keyframe has the croissant across the beak like a moustache.
- **A blind read of this plan was only partial.** Both strangers saw the napkin corner flick and the pigeon lower itself, and both remembered the moustache. Neither read a bow or a permission: one wrote that the pigeon "seems to check for witnesses, and all that moves is a napkin corner", the other took the napkin for "a false alarm" and the lowering for "the bird gathering its nerve". So the proof is on screen and its meaning is not yet certain. A gesture that can be read two ways (a bow or a crouch) needs something that settles it, and the Director's own stranger's read did not catch this: it knows what it meant.

What this suggests next: an independent cold read inside the studio (a second model that sees only the cut list and prompts, reported to the Director as advice at dry run), and one real film to see what the footage does with the bow.

## Limits

- Paper is not footage. The video model may not deliver a bow or a quilt pulled over a clock; the review step and its cold read are for that, and only a real film tests them.
- One sample per brief and version. Takes vary from run to run.
- A mild take is easier to see than a bold one, so this measure cannot rank ideas. It answers one question: is what the plan calls its take on the screen.
- The strangers and judges are models. Two of each, from two families, agreed on the direction for briefs 1 and 2 and differed by one step on several others.
