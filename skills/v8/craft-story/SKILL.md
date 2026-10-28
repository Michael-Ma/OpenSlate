---
name: craft-story
description: Story and concept development for any film kind. Finds the core (one sentence and one image), offers directions when the brief is open, and turns the chosen one into beats with a job each.
---

# Story and concept

Use at the story stage of every film. The type package says what its story unit and preferred structure are; this package is the method. Authority and tools are in core.

1. **List the fixed points.** Goal, subject, audience, length, aspect, facts and assets that must appear, decisions already made. Take them from the brief, attachments and saved project; do not ask again.
2. **Write the core.** The one sentence the viewer should remember, and one image that carries it (the core image). An ad calls it the single-minded proposition, a story its theme, a music video its rule, comedy its premise.
3. **Diverge when the brief is open.** Write two or three directions that differ in kind (literal, metaphorical, character-led, form-led). Each gets a one-line logline (who, what, where), its core image and its main risk. Offer them as lettered options in the reply, recommend one, and draft the recommended one in the same turn; writing is cheap to change. Skip this when the brief already fixes the idea.
4. **Converge.** Keep the direction that fits the length and shot budget, avoids high generation risk (hands, text, real people, long actions), is supported by the supplied assets, and has a motif that can return.
5. **Structure.** Pick the type's framework (see [frameworks](references/frameworks.md)) and write the beats into `story`, each with its job. Each beat becomes a scene `purpose` or a shot `purpose`.
6. **Character arc** (only with characters): want and need; show the change with a mirrored first and last image; one change per short film.
7. **Self-check.** Can the core be said in one sentence? Which shot holds the core image? Does every beat have a visible action? Does it read with the sound off? Does it invent product features or facts? Fix before planning shots.

Save the core, the chosen direction and the beats in `story` with `prepare_change`; when the person picks another option, rewrite it (no media yet, so it applies directly).

## Per type

| Type | Story unit | Core is called | First framework | Avoid |
|---|---|---|---|---|
| social | beat | premise or promise | hook → build → payoff → loop | two ideas in one post |
| music video | song section | rule or image | mode ratio + escalation | illustrating every lyric line |
| commercial | claim and proof | single-minded proposition | problem → solution → proof → CTA | two claims; invented results |
| explainer | concept step | one-line explanation | ABT | narration repeating the picture |
| narrative | scene (cause and effect) | theme | Story Spine, three-act micro | two turns in 60 s |
| narrated story | section or list item | the question or mystery | ABT, countdown list | pictures as decoration |
| showcase | facet of the subject | one feeling word | hero → detail → context → hero | plot burying the subject |
| documentary | a real voice | a true sentence | ABT, kishōtenketsu | synthetic testimony |
| trailer | escalating hint | the question | hook → escalation → title | spoiling the ending |

Comedy in any type: read `craft-comedy` with `read_guidance`; its premise method replaces steps 2–4.
