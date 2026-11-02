# Comedy craft

Draft for a future `craft-comedy` package (role `craft`, loaded when the brief's goal is "make people laugh" or the person asks for funny, a skit, a meme, a gag, or a parody of a format). Shared by any type: social post, ad, narrative short, kids' story. The social specialization is [short-form-comedy.md](short-form-comedy.md); the ideation method and worked examples are [premises-and-beats.md](premises-and-beats.md); the gate before keyframes is [review-checklist.md](review-checklist.md). Sources: [sources.md](sources.md).

This file decides what the joke is and how it is built. Look comes from `craft-visual-style`; prompt wording from `craft-shot-prompting`; tool use and authority from core.

## What makes something funny

- **A violation that is safe.** People laugh when something is wrong (breaks a rule of physics, manners, logic or expectation) and, at the same time, harmless. Too safe is boring; too real is upsetting. Aim for the overlap. (Benign violation theory, McGraw and Warren.)
- **A gap between expectation and outcome.** Set up an expectation the viewer forms on their own, then deliver a different outcome that, in hindsight, was the only logical one. Surprise without hindsight logic is random, not funny.
- **Recognition.** The strongest laughs come from "that is exactly me". Ground absurdity in a situation the viewer has lived: queues, self-checkouts, group chats, pets, plants, mornings, parents, gyms.
- **Commitment.** Characters must treat the absurd situation as completely real. The camera, light and music must commit too. Winking kills the joke.

## The core tools

Use one primary mechanism per piece; add at most one secondary.

| Mechanism | How it works | Shape on screen |
|---|---|---|
| Setup / punchline | The setup builds one clear expectation; the punch flips it | Last shot reveals the flip |
| Misdirection | Frame the setup so the viewer reads it one way; the reveal shows the other reading | Reveal by camera move, cut to wider, or cut to the cause |
| Escalation | Same situation, each beat bigger than the last, until it breaks | Beats grow in scale, number or stakes |
| Rule of three | Two beats establish a pattern; the third breaks it | Shot 1 and 2 match; shot 3 deviates |
| Game of the scene | Find the first unusual thing, then ask "if this is true, what else is true?" and heighten | One odd premise played straight, then pushed |
| Mismatch of tone | Treat a trivial thing with epic seriousness, or a huge thing with boredom | Mock-heroic framing, deadpan reaction |
| Role reversal | Swap who has power or competence: the pet is the manager, the toddler is the bouncer | Status shown by framing and posture |
| Scale contrast | Tiny thing behaving big, or big thing treated as tiny | Wide frames that show both sizes |
| Character comedy | One clear flaw or obsession, played without self-awareness | A face and posture that read in one frame |
| Physical comedy | A body or object fails, falls, sticks or overreacts | One simple action with a clear end state |
| Callback / loop | The end returns to the start, now meaning something else | Final frame matches the first |

## Building a joke

1. **Name the target in one sentence**: what the viewer recognises ("Nobody buys just one plant").
2. **Name the violation**: what goes wrong ("She buys an entire jungle").
3. **Name why it is safe**: who is not hurt ("Only her wallet and her floor space").
4. **Write the punch first.** Decide the final image, then build backwards the shortest setup that makes it land. If you cannot picture the punch, there is no joke yet.
5. **Hide the punch.** The setup must not telegraph it. Remove any shot, prop or line that gives it away early.
6. **Cut every beat that does not set up or pay off.** Comedy is economy.

## Timing

- **The beat before the punch.** Hold a short pause (about 0.5–1 s) of stillness or a held look before the reveal. It lets the viewer form the wrong expectation and makes the reveal hit.
- **Land the punch on a cut or a clear change.** A punch inside a slow drift dies. Put it at the start of a new shot or at the end state of a fast move.
- **Let the reaction breathe after.** Hold the reaction or the absurd result for 1–2 s; that is where the laugh happens. Do not cut away mid-laugh.
- **Shorter is funnier.** Lose words, frames and shots until removing one more would break the joke.
- **Rhythm of three.** Beat, beat, break. Keep the first two equal in length so the third feels sudden.

## Deadpan and reaction

- Deadpan (no reaction to the absurd) and the take (a clear, held reaction) are the two most reliable faces. Choose one per character and keep it.
- The reaction is often the punch. A cut to a bystander, a pet or the protagonist staring into the lens tells the viewer how to feel.
- Prefer one large, readable expression held still over a sequence of changing expressions.

## Wordless and one-line comedy

- Tell the joke through action and composition first. If the joke survives with sound off, it travels.
- Sound comedy: an incongruous music choice (opera for a cat stand-off, nature-documentary hush for a toddler) adds a second layer and costs no generation.
- One line of voice is enough. Use it for the setup ("I'm only getting one"), for a deadpan announcement, or for an inner thought. Never use voice to explain the joke.
- Put the line off-face (voiceover, an off-screen voice, a device voice) unless lip sync is verified.

## Comedy that fails

- **Random is not funny.** An absurd image with no expectation broken is a curiosity. Give the absurdity a rule.
- **Explaining the joke.** Narration that says what the picture shows, or a reaction that tells the audience it was funny.
- **Two jokes fighting.** Two premises in one piece halve both.
- **Telegraphing.** A setup shot that already shows the punch.
- **Mean or punching down.** See below.

## Pitfalls: who the joke hurts

- **Punch up or sideways, not down.** The butt of the joke is the protagonist's own flaw, a shared annoyance, an institution, a situation or a machine. Never a group defined by race, ethnicity, religion, disability, body, gender, sexuality, age, class or accent.
- **No stereotype as punchline.** A character may belong to any group; the joke must not depend on that membership.
- **Cultural sensitivity.** Check gestures, foods, religious objects, festivals and dress for the audience's culture. When the audience spans cultures, prefer universal situations (pets, queues, mornings, technology). Do not use sacred figures or rituals as a gag.
- **No harm played as funny.** Avoid real injury, medical emergencies, self-harm, violence against people or animals, drunk driving, and dangerous challenges a viewer could copy. Cartoonish, consequence-free falls are fine when clearly unreal.
- **Real people and brands.** Do not depict an identifiable real person, celebrity or politician; do not imitate a real voice. Do not mock or show real brands, logos, store names or products; use generic, unbranded equivalents. Parody of a real person or brand requires the person's explicit legal confirmation and is out of scope for generated likeness.
- **Kids and animals.** Children and animals may be the heroes, never the victims. Show no distress.
- **Self-check:** would the person who is the butt of the joke laugh too? If not, change the target.

## Story specialization (for `craft-story`)

| Field | Comedy value |
|---|---|
| Story unit | Beat (setup, build, beat-before, punch, button) |
| Core is called | The premise: target + violation in one sentence |
| Preferred frames | Setup/punchline; rule of three; escalation; game of the scene |
| Do not | Explain the joke; stack premises; let the setup reveal the punch |

## Style tendency (for `craft-visual-style`)

- Prefer `grounded-realism` or `documentary-handheld` for relatable, native-feeling comedy: the absurdity reads harder against a real-looking world.
- Prefer `stylized-3d-feature` or `claymation-stop-motion` for animal, object and cartoon-physics gags; stylization hides model artefacts and licenses exaggeration.
- `glossy-commercial` for mock-epic parodies of ads or trailers.
- Avoid styles whose failure modes blur faces at small size (`watercolor-ink`, `surreal-dreamcore`) when the punch is an expression.
