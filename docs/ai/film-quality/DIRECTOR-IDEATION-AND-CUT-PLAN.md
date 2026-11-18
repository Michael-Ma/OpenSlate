# The Director's ideas and its cut: where they come from today, and a plan

Written 2026-11-16 after the owner's reply to [the pigeon analysis](PIGEON-ANALYSIS-AND-PLAN.md): the cut guidance is wanted, the input suggestion and the two tools are fine but secondary, and the main problem is the idea itself. "It feels filmed word by word from the brief, with no creative ingenuity. I think the initial ideation is too simple."

Sources for this document: the skill as it is (`skills/code-plan/SKILL.md`, `references/film-craft.md`), the saved pigeon plan, three research surveys, two rounds of open discussion with Codex (gpt-6-astra, xhigh), and a paper test in which the Director's own model planned four briefs. Working files are in `data/test-runs/20261116-ideation-discussion/` (not in git). Section 11 and Appendix B were added on 2026-11-17 from three further surveys of story and screenwriting methods; they are not yet tested.

## 1. How the Director gets its idea today

The Director's only instructions are the skill: its base prompt is one sentence. Of about 5,600 words it reads every turn (the skill, the craft file, the API and the example plan), about 200 are about the story (`film-craft.md`, "Story before any plan"):

- a one-line premise: who wants what, and what is in the way;
- a beat sheet with setup, turn and payoff; for each beat one thing a viewer can see, its resulting state and a target length;
- "write the punch image first, then the shortest setup"; comedy needs visible contrast; characters take the absurdity seriously;
- a silent test: could a stranger say what happened?

Then `SKILL.md` fixes the shape of everything that follows: "Make one clip per shot" and "exactly one keyframe per shot".

What this produces:

1. **A restated brief passes every check.** The checks are about structure (is there a premise, are there three parts, is each beat visible), not about whether there is an idea. The pigeon film's premise was its brief in other words.
2. **One idea, taken at once.** Nothing asks for a second idea, or asks whether the first is the one anybody would have.
3. **The brief's sentences become the film's structure.** One sentence becomes one beat, one shot, one keyframe and one clip. The Director never decides what the viewer sees separately from what happens.
4. **The idea competes with the program.** It is decided in the same turn as a 150-line TypeScript plan with model ids, prices and failure branches, and nothing in the plan records it. The person meets the idea only as four pictures.
5. **The shot guidance is defensive.** Three or four setups, one axis, a steady camera, hard cuts: all of it prevents mistakes, none of it asks what a shot is for. There is no working vocabulary of point of view, insert, reaction, reveal, withholding or callback.
6. **The examples have become a template.** The craft file's only comedy examples come from one film ("tiny effort, enormous collapse, sudden energy for food"). In the paper test below, the Director turned "a cat that hates Mondays" into exactly that shape: a limp cat, a burst of effort, a collapse.
7. **The review rewards correctness.** Four of its five scores are about readability, continuity, rhythm and picture integrity. Nothing scores whether the film had an idea and whether it landed.

### Paper sample: today's skill on four briefs

The Director's model (gpt-6.1-sol) planned four briefs on paper with today's skill (`arm-a-output.md`):

| Brief | Beats, shots, clips | The idea it found |
|---|---|---|
| Pigeon and croissant (detailed) | 4, 4, 4 | "Like a meticulously planned heist", in the premise only; the four shots are the brief's four sentences |
| Night platform (detailed) | 3, 3, 3 | The brief's three shots, in the brief's order |
| "A cat that hates Mondays" (one line) | 3, 3, 3 | Limp cat, furious shove of the laptop lid, collapse: the craft file's own example shape |
| "雨夜的便利店，20 秒，安静一点" (one line) | 3, 3, 3 | A traveller warms their hands on a hot can and watches the rain: the first idea anyone would have |

Every film is three or four shots of 4 to 11 seconds, each a clip of its own.

## 2. How the Director cuts today

1. Every clip finishes, then `ctx.review` stops the run and the Director gets a review turn.
2. It reads a contact sheet of each clip (`read_clip_frames`, up to 36 frames, with motion values) and finds where the action starts and ends.
3. It scores each shot on five items, 0 to 2.
4. It sets one range per clip (`startFrame`, `durationFrames`, sometimes `speed`) to fit the beat's target length, and puts the clips in order.
5. Music is requested once the length is known, trimmed and faded; three or four built-in sounds go on the joke points.
6. It renders, reviews the render once and reports.
7. Repairs: "a better range or cut first"; retakes are limited to one per shot and two per film.

So the cut today is trimming: one row per clip, in plan order. The timeline can already do more (the same clip in many rows, a punch-in, a speed change, a hold), but the skill names those only as row syntax, never as ways to tell the story. Nothing compares the two sides of a cut, so the pigeon film's landing error scored 2 of 2 for continuity.

## 3. What research says

Three surveys, with the pages opened; items marked "second-hand" were read through summaries.

### Where an idea comes from (comedy, advertising, short form)

- **The game of the scene** (UCB improv): a normal world, one unusual thing, then "if this is true, what else is true?", heightened and played straight. [Hoopla's guide](https://www.hooplaimpro.com/quick-guide-game-of-scene)
- **Throw away the first ideas**: "discount the first thing that comes to mind, and the second, third, fourth, fifth". [Pixar's rules, no. 12](https://nofilmschool.com/2012/06/22-rules-storytelling-pixar)
- **Another register, played straight**: a plain event filmed in another genre's grammar, with no winks. [Chuck Jones's Road Runner rules](https://www.mentalfloss.com/entertainment/tv/chuck-jones-rules-writing-road-runner-cartoons) also show that a few fixed rules for a world create invention.
- **Assumption and reveal**: name what the viewer assumes and plan a last image that reinterprets what came before; the same shots must fit both readings.
- **One idea only**, sayable in a sentence with no "and"; the first image raises a question; choose the last image first.
- **Calm films**: one observed detail that could belong only to this place, an unexpected vantage, two images where the second changes the first, a small change at the end, and deliberate empty time. [Miyazaki on ma](https://nofilmschool.com/2013/09/master-of-ma-director-hayao-miyazaki-set-to-retire)

### From idea to beats to shots (film craft)

- **"Therefore" or "but" between beats, never "and then".** [Parker and Stone's rule](https://perell.com/note/but-therefore-rule/). The pigeon plan is "and then" four times.
- **"Don't give them four, give them two plus two"** ([Andrew Stanton](https://singjupost.com/the-clues-to-a-great-story-by-andrew-stanton-at-ted-full-transcript/)), with the [Kuleshov effect](https://en.wikipedia.org/wiki/Kuleshov_effect) behind it: show the parts and let the viewer conclude.
- **One shot shows one plain thing; the cut supplies the meaning** (Mamet, second-hand). Test: the shot line has no "and" and no emotion adjective.
- **Whose eyes, and who knows what**: tell the viewer before the character for suspense; withhold only for the final turn. [Bordwell on Hitchcock's bomb](https://www.davidbordwell.net/blog/2013/11/29/hitchcock-lessing-and-the-bomb-under-the-table/)
- **Size in frame equals importance now** (Hitchcock's rule), but **hold the wide for a whole-body gag** so body, cause and result share one frame (Keaton, Jackie Chan, Tati); go close for a small contact.
- **Look, see, react**: three cuts, and the third carries the feeling.
- Plant, then pay off; three, then a button; enter late, leave early; anticipation before each key action; let the frame or the cut deliver a surprise (an entrance, a reveal, a smash cut).

### Getting a language model to be less generic

- **Several candidates in one context, each forced to differ from the earlier ones, then choose** is the best-supported method. In [NoveltyBench](https://arxiv.org/html/2504.05228v4) it was the only strategy that reached about human diversity.
- **Name the expected version and set it aside, once.** In [Echoes in AI](https://arxiv.org/html/2501.00273v2) half of 100 continuations made the same plot choice. Stacking bans breaks coherence ([denial prompting](https://arxiv.org/html/2407.09007v2)).
- **Mark the turn before writing beats, and put it late**: model stories are mostly one arc with the climax too early; marking turning points raised human preference from 13.5% to 43.8% ([Tian et al.](https://arxiv.org/html/2407.13248)).
- **Yes-or-no taste tests, not scores**, and do not trust the model's own judgement of creativity: no model judge agreed with experts in [Art or Artifice](https://arxiv.org/abs/2309.14556v3). The person must be the judge.
- **What does not work**: "be creative", a higher temperature, re-running, more roles or stages alone, longer prompts.
- **Film-agent systems** (FilmAgent, MovieAgent, MAViS, AniMaker, FilMaster, ViMax) all take the story as given; none measures originality. Their gains come from a review loop on the script and from choosing among candidates.

### What the video model does well and badly

- One action and one camera move per clip; if the line needs "and then", split it ([Sora 2 guide](https://developers.openai.com/cookbook/examples/sora/sora2_prompting_guide)). In [StoryEval](https://arxiv.org/html/2412.16211v1) the best model completed 40% of stories with two to four events.
- The keyframe should be the moment before the action; motion that contradicts the picture is dropped.
- Left and right, counts, small contacts, hard physics and readable text are unreliable ([T2V-CompBench](https://arxiv.org/html/2407.14505v2)); cut to a reaction, an impact frame or an insert.
- Reliable: slow push-ins, wide establishing shots, atmosphere, small natural motion, slow motion, and images no camera could get.

## 4. The proposal: five decisions before any shot

The order changes from "premise, beats, shots, clips" to "what the viewer should come to understand, then what they see, then what to buy". Appendix A has the skill text.

1. **Read the brief as a wish.** Write what the person fixed (subject, place, tone, length, the moments and the ending they named) and what is open. Fixed points are kept. A detailed brief leaves emphasis, staging, rhythm and what joins the moments; a one-line brief leaves the situation itself.
2. **Audition takes.** Write the obvious film in one sentence, then three other takes. Each names where its pleasure comes from and its decisive moment; two takes that share both count as one. Places to look: a relationship (a thing becomes a character, a rival, a witness); what the viewer knows and the character does not; another kind of film played straight; one detail that belongs only to this place; a picture whose meaning changes the second time. A mood word is not a take.
3. **Choose, and write the reading.** "The viewer first reads this as __. Through __, that becomes __. The image they keep is __." "Through" must be visible. This one sentence is the idea, and it serves a calm film as well as a comedy: a calm film needs no twist, only a change in what the viewer notices.
4. **One bold visual rule** that expresses the reading, sustained through the film, and one picture worth pausing on.
5. **Work backwards from the kept image, then write the cut list, then decide what to buy.** Plant what gives the image meaning, withhold what would spoil it, leave out what the viewer can add up. The cut list says what the viewer sees, cut by cut. Only then come the shots to buy: each one continuous action, feeding one or several cuts.

The first reply opens with the chosen take in two lines and the others in one line each, then carries on. There is no extra wait for the person.

**Adding to a brief.** The Director may enrich a fixed moment while its outcome stays the same. An addition that reverses an outcome, starts a new problem or replaces the requested last image needs the person's agreement first.

**What is recorded in the plan** (`ctx.scene` already accepts these as data): `fixed`, `takes` with the chosen one marked, `reading`, and a flat `cuts: [{ sees, seconds, clip }]`. The application notes gaps at dry run (a clip that feeds no cut, cut seconds that do not add up to the length) and never refuses a plan for them.

## 5. The cut, after the change

Before any video is bought:

1. **Cut list.** What the viewer sees, in order, with seconds and source. One cut shows one plain thing. What matters most is the biggest thing in frame: close for a small essential action, wide enough for a whole-body gag to hold cause and result. A look is three cuts: the looker, what it sees, the looker.
2. **Shots to buy, derived from the cut list.** One continuous action from one setup, its keyframe showing the moment before. What the model does badly (looks between two things, fast repeated motions, counts, exact contacts, left and right, text) is built in the edit. Name the action most likely to fail and the fallback.

After the clips arrive (the review turn):

3. **Log.** For each clip, its moments by frame range, what each proves, and anything good that was not asked for.
4. **Assemble** from the cut list using logged moments. The cut list was a hypothesis: keep the fixed points and the reading, and let the assembly change if the footage offers a better film.
5. **Repair ladder**, first step that works: another range; build the moment from two others; punch in, change speed or hold; drop the cut; last, a retake that changes the approach. Never the same setup with new words.
6. **Rhythm.** Enter on movement, leave after completion. Shorten each cut until just before it stops reading; vary lengths so a held shot lands; put the hit on the frame of contact.
7. **Check every cut.** What is visibly proven, and what changes across it? Compare the last frame before with the first frame after for position, facing, prop state and eyeline.
8. **Render and review once.** Does the reading happen on screen, and does the kept image land? Report what was observed, including what failed.

The five-score table goes; the two questions in step 7 and the one in step 8 replace it.

## 6. The discussion with Codex (gpt-6-astra)

Round 1 asked for its own view before it saw mine; round 2 put my merged proposal to it and asked it to argue. Full texts: `astra-round1.md`, `astra-round2.md`.

| Point | What changed |
|---|---|
| Diagnosis | Its line is better than mine: "production is organised before a point of view exists". More cuts alone would not fix that. |
| Takes | Mine named a lever for each take. Its objection: a model can relabel one idea three times. Each take must name its source of pleasure and its decisive moment, and duplicates are replaced. Adopted. |
| The idea in one sentence | My "hook, turn, button" fits comedy only. Its reading sentence serves calm films too. Adopted, and it is the one field it would keep if it could keep one. |
| Overcorrection | It rejected four of my requirements: a surprise in every film, a last image "stronger" than the first, "therefore or but" for every transition, and "three, turn, payoff, button". They stay as tools. "The kept image has acquired meaning" replaces "stronger". Adopted. |
| Adding to a brief | I ended my pigeon with a second pigeon landing beside the thief. Its verdict: a good gag and the wrong ending, because it changes the requested final feeling. The rule in section 4 is its wording. Adopted. |
| Visual ambition | "Choose one bold visual rule that expresses the idea; sustain it, and compose one image worth pausing on." A steady camera can stay the default. "An image only this medium can make" stays optional. Adopted. |
| Buying footage | It rejected my 1.2–1.4× ratio: with a 5-second minimum, a one-second insert costs five. Buy by value, minimum length and risk. Adopted. |
| Still pictures as cuts | I proposed it; it ranks it first among the tools, ahead of the wider punch-in: its own pigeon plan bought a 5-second clip of an empty chair that a still would give for $0. It also corrected me: changing the take is not free, because confirming one card can already start paid video. |
| World rules | Useful only when breaking one would change what the film is; one to three at most, optional. Agreed. |
| Plan fields | It cut my list to `fixed`, `takes`, `reading` and flat `cuts`. Adopted. |
| The cut list | It must stay a hypothesis: "otherwise we replace literal obedience to the brief with literal obedience to our own paperwork". Adopted in step 4 of the cut. |
| Where I kept my view | Its skill text is abstract ("relationship or causality, information or viewpoint"); the version in Appendix A keeps its structure with plainer words and clause-length examples. Research supports forcing difference among candidates in one context and setting the expected version aside once, both of which the text does. |

## 7. Paper test: the same Director model, today's skill against the revised text

Free: no media was made. The Director's model (gpt-6.1-sol, high) planned the same four briefs on paper, twice with today's skill (A) and twice with Appendix A in place of the three sections (B). Each run was a fresh session that read only the skill files. Outputs: `arm-a-output.md`, `arm-a2-output.md`, `arm-b1-output.md`, `arm-b2-output.md`.

| Brief | Today's skill, two runs | Revised text, two runs |
|---|---|---|
| Pigeon (detailed) | 4 and 5 shots, one clip each. "Like a heist" appears in the premise and nowhere in the shots. | Both: "the empty chair is the guard". 10 and 12 cuts from 5 and 6 clips; the glances are built in the edit. Visual rule: furniture towers over the pigeon until the last picture puts it above everything. Every fixed point kept. |
| Night platform (detailed) | The brief's three shots, both runs. | Both: "borrowed light". The same three shots, as the brief fixed them; the train supplies every warm patch of light and the station stays blue, so the last shot reads as staying behind. |
| "A cat that hates Mondays" | A limp cat, a burst of effort, a collapse, both runs; one premise echoes the craft file's own example ("the tiny effort of getting up produces a spectacular collapse"). | "The shortest commute": tight framing makes a heroic journey, then one wide shot shows the bed is beside the keyboard. And "the cat requisitions the office as a bedroom": a stern, symmetrical desk with the cat as the one horizontal thing. |
| "雨夜的便利店，20 秒，安静一点" | A traveller warms their hands on a hot drink, both runs. | "伞先下班了": the camera never crosses the threshold; a wet folded umbrella is the only trace of a person; the same wide shot is seen twice and means more the second time. And "便利店替雨夜留着一盏灯": it opens on a warm rectangle broken by rain in a puddle and shows the shop last. |

What this shows, and what it does not:

- The revised text changes the output in the intended way on all four briefs: a stated idea, a visual rule, a cut list that differs from the clip list, and nothing the person fixed was dropped.
- Costs stay close: $1.52–2.48 for B against $1.64–2.24 for A. The pigeon costs a little more (37 and 40 seconds against 33 and 36) because each insert is a 5-second clip; a still picture as a cut would remove about $0.30 of that.
- **Runs converge.** Three independent sessions (Astra and both B runs) chose the same pigeon idea and the same platform idea. The text moves the Director one step past the obvious, and that step is the same step each time. One person making one film will not see this, but variety across films of the same brief is limited.
- **I am not a blind judge, and a model is not a good one**: research finds no model judge agrees with experts on creativity. The owner's reading of these plans is the judgement that counts, and only finished films show whether a better plan becomes a better film.

## 8. Plan

### Phase 0: paper test (done, $0)

Section 7. The four output files can be shuffled and anonymised for a blind read by the owner if wanted.

### Phase 1: build, three streams in parallel

| Stream | Who | Work | Files |
|---|---|---|---|
| S1 skill 2.1.0 | Lead writes; Codex applies and releases | Appendix A replaces three sections of the craft file. `SKILL.md`: "one clip per declared shot; a clip may feed several cuts". Remove the single-film comedy examples. Trim the duplicated "Confirmed keyframes" section so the file stays near 1,650 words. The example plan shows `fixed`, `takes`, `reading`, `cuts` and one clip in two rows. | `skills/code-plan/**` |
| S2 server | Codex | 1. A picture the film owns as a timeline row, held for a set time (static inserts for $0). 2. Punch-in to 2× with a dry-run note when the result is soft. 3. Cut pairs from `read_clip_frames` on a render: the frame before and after each cut. 4. Dry-run notes for `cuts`: a clip that feeds nothing, seconds that do not add up. Notes, never refusals. 5. `suggest` for the clip input. | `apps/server/src/code-plan/**`, `apps/server/src/media/**` |
| S3 UI | Lead | The idea on the storyboard: the chosen take and the reading above the shots, the other takes folded below. Keyframe card: the suggestion, the order, hints that say the outcome. | `apps/web/**` |

Order inside S2 follows the discussion: still rows first, then cut pairs, the punch-in, the notes and the suggestion.

Tests: unit tests per stream; the skill release tests; a fixture scenario for the idea strip and the card; the full check through Codex; browser scenarios by the lead.

### Phase 2: two paid films, judged by the owner

The pigeon brief and the night platform with skill 2.1.0, each about $2–2.50, each asked for before it runs. Questions, in this order: can a stranger watching silently retell it; does the reading happen on screen; is every fixed point there; are there continuity errors at cuts; cost and retakes. The number of cuts is watched, not targeted.

### Phase 3, optional

- An animatic from the keyframes before any video is bought (builds on still rows), and a slow push on stills and holds.
- "Sparks": the application supplies two or three unrelated words on the first turn. One study found +28% originality from an outside stimulus, and a third of its stories misused it, so this needs its own paper test.
- Skill sections by turn: the idea text only on a first turn or a change of direction, the cutting text only on a review turn.
- Sound the Director can read (loudness and onsets).

## 9. Risks

- **Better paperwork, same films.** The paper test shows better plans only. Phase 2 is the proof.
- **Convergence** (section 7). The person can ask for the takes that were passed on; sparks are the next step if it matters.
- **Cost of inserts.** More short clips at a 5-second minimum cost more; still rows are first in S2 for that reason, and the ceiling does not move.
- **Calm films over-worked.** The text says a calm film needs no twist, and both platform runs kept the brief's three shots.
- **Fidelity.** The addition rule: enrich a fixed moment, never reverse its outcome or replace the requested last image without asking.
- **Length.** About 250 words more than today before trimming; the duplicated section pays for most of it.

## 10. Decisions for the owner

1. Phase 1 as scoped, or the skill text alone first.
2. The addition rule as written in section 4.
3. "Choose and proceed": the Director states its take and the two it passed on, then carries on, with no pitch card and no extra wait.
4. Still rows ahead of the 2× punch-in.

## 11. Addendum, 2026-11-17: what the story and screenwriting books add

The owner asked for a look at the books and methods on writing films and stories. Three more surveys followed: the screenwriting canon; short, wordless and comic forms; directing, editing and East Asian forms. Their reports are `survey-4-screenwriting-canon.md`, `survey-5-short-visual-comic-forms.md` and `survey-6-scene-to-shot-and-east-asian-forms.md` in the working folder. About half of the specifics were read on the page; the rest came through summaries and are marked "via a summary" below.

### The short answer

The famous screenwriting books mostly teach how to sustain 100 minutes and how to change a character. Shrunk to 20 seconds they give back what the skill already has: setup, turn, payoff. What transfers from them is a few tests on the premise and on the single beat. The richer sources are the forms that are our size: advertising, silent comedy, comics and editing.

### Six things worth taking

1. **Wit is a mechanism, and the mechanisms are a short known list.**
   - Goldenberg, Mazursky and Solomon, "The Fundamental Templates of Quality Ads" (Marketing Science, 1999; paper read). Six templates explained 89% of 200 highly rated ads; in a second sample they explained half of the award winners and 2.5% of the others. Twenty people trained on templates for under two hours produced ideas rated above a free-association group in every comparison, and free association did no better than no training. The templates that fit a wordless film: replacement (one thing stands in for another), the absurd alternative (the problem solved the wrong way, in full seriousness), the extreme consequence, and a change of time or number (the same frame at three times; one thing multiplied).
   - Noël Carroll's types of sight gag (via a summary): the switch image (a later framing shows the first reading was wrong), the switch movement, the object analog (a thing used as another thing), the mimed metaphor, mutual interference (the viewer understands and the character does not), the solution gag.
   - Each of these implies a shot plan. "A relationship" or "a detail", the places Appendix A names, do not.
   - This agrees with the earlier finding that "be creative" does nothing for a model. It is also the direct answer to convergence (section 7): a longer and more concrete list, of which the application offers a different few each run. That last part is my proposal, not something a source says.
2. **A missing middle level: blocks and a fulcrum.** No directing book goes from sentence to shot.
   - Proferes (via summaries): a dramatic block is "like a paragraph" with one job; the fulcrum is the scene's key moment, and staging works outward from it.
   - McKee (via summaries): the unit of story is a gap between what a character expects an action to do and what happens.
   - 相声's 铺平垫稳 (common usage): the setup must be fully believed before the release.
   - For us the order becomes: reading, then two to four blocks, each with one job stated as a change in the viewer, then the cuts inside each block, then the shots to buy. The fulcrum gets the closest framing or the longest hold.
3. **A structure for films without conflict.** 起承转合 and kishōtenketsu ([read](https://en.wikipedia.org/wiki/Kish%C5%8Dtenketsu)): the third part sets something apparently unrelated beside the story, and the close shows the link. It gives a calm film a turn without a problem. The haiku cutting word says the same at the smallest size: two images, and one cut that carries the weight.
4. **Wit at the cut, with tools the timeline already has.**
   - A match of shape across a cut (Satoshi Kon, via [Tony Zhou's essay](https://cartoonbrew.com/anime/learn-how-satoshi-kon-edited-space-and-time-102014.html)): the next shot's first picture is ours to compose, so a cup's rim can become the moon. Limit: keyframes are confirmed before any video exists, so the match must be on something that stays put in the outgoing shot, and the incoming shot must use its keyframe as first frame or be a still row.
   - The same framing three times, broken the fourth (三翻四抖, common usage): reusing a clip makes the repeats free.
   - A sound in place of a picture (Bresson, [excerpts read](https://piermarton.info/bressons-notes-on-the-cinematographer/)): the fall is a thud over the face that hears it. The model is bad at falls and exact contact, so this is cheaper as well as funnier.
   - Entrances and exits from the frame, and a hit on the music (Edgar Wright, via a summary of Tony Zhou's essay).
   - To show something not happening, show it start and be stopped (Mackendrick's "Slogans for the Screenwriter's Wall", read on [thestickingplace.com](https://thestickingplace.com)).
5. **Why a cut list is stiff: every cut is "the next action".** McCloud's six transitions ([read](https://salgoodsam.com/mc/transitions/)): literal work is almost all action-to-action. A cut to a detail of the same moment, to another subject or across time is what makes a sequence feel composed. Block, "The Visual Story" (via a review): hold the visual components alike and break one where the story peaks, which is what the best paper-test plans already did with light and with scale.
6. **Judge a cut by feeling first.** Murch's order (via a summary of the book): emotion, story, rhythm, eye-trace, then continuity of the flat picture and of space. Dmytryk agrees: cut "for proper values rather than proper matches". Section 5's check leads with proof and continuity. The order should be: does it land, does it tell, does it move, and only then does it match. A mismatch the viewer would notice is still repaired when the repair is cheap.

**Endings.** Three traditions give the same advice. Johnstone, "Impro" (read): a story ends when earlier material comes back. Li Yu's 密针线 (via papers): everything later is planted earlier, and everything earlier echoes later. Raskin on the short film ([read](https://pov.imv.au.dk)): one charged object carries a short film, and closure can be a return to the start. Arndt (via a summary): the last move is surprising and logical. Appendix A already says "plant what gives it meaning"; this adds a test: does something from the first seconds come back changed? Lubitsch's "superjoke", one more turn after the gag, is allowed only inside the ending the person named, by the addition rule.

**Three yes-or-no tests for a chosen take.** Is something mismatched between who acts and what they do (Snyder's irony test, [read](https://savethecat.com))? In a comedy, what rule is broken and why is it harmless (benign violation, McGraw and Warren, 2010, paper read)? If nothing is broken the idea is pleasant, not funny. Is the last picture both surprising and prepared?

### What does not transfer

- The hero's journey, the story circle, three acts and the Save the Cat beat sheet: they need time for a character to change, and 20 seconds holds one turn.
- Character misbelief and inner arcs (Cron), and scenes of deliberation (Swain's sequel): without words there is nothing to see.
- Egri's premise as a thesis: it pushes toward a moral, which makes films more literal.
- Kaplan's and Vorhaus's comedy tools: built on behaviour over time and on dialogue.
- Intellectual montage, coverage patterns for dialogue, and Keaton's "never fake it".
- Not found in a usable form: Katz, Glebas, 芦苇《电影编剧的秘密》, Field, Vogler.

### Cautions

- A list of moves is a new template, and the skill's one comedy example already became one (section 1, finding 6). Moves stay places to look and never requirements; calm films have their own (the unrelated third image, one charged object, a cut to a detail); the application should vary which are offered.
- The template study's critics say it measures conformity to what juries like, and its authors tested only three of the sixteen versions.
- None of this has been through the paper test. Appendix B is a draft.

### Next step

A paper test of Appendix B against Appendix A, free: the same four briefs, two runs each, with a different three moves offered to each B run. Three questions: do two runs of one brief now find different ideas; are the fixed points still kept; do the calm briefs stay calm. In Phase 3, offered moves would replace "sparks": they stay on the subject, where a third of the outside words were misused.

## 12. Decision and build, 2026-11-17: templates by kind, and skill 2.1.0

The owner's answer: build it. Templates should be sorted by kind of video, each kind researched, and the Director must stay free to use a template, change one or invent.

### The design

- **Kinds are sorted by what the viewer comes for**, not by subject: a laugh, tension, feeling, calm, wonder, desire, satisfaction, energy. A short list of formats (advert, social post, trailer or pastiche) adds the rules a format brings. A check against how makers sort short video found three things outside the eight: the rousing anthem spot (left out; close to Energy), pastiche (made a move that works in any kind) and loops (not possible: the timeline only cuts).
- **Four more surveys** found five to seven documented shapes for each kind, with a known example, the stale version and one way to bend it (`templates-1` to `templates-4` in the working folder). About 45 survived as one line each in `skills/code-plan/references/templates.md`: blocks in order, the turn marked, and a note where the edit must build what the video model does badly. Shapes that need a dissolve, a split screen or a reversed clip were dropped or rewritten for cuts.
- **Freedom is written into the method.** Each take records its `basis`: "template: <name>", "bent: <name>" or "own". At least one of the three takes must owe nothing to the library. The file says that every template used straight is somebody's cliché, and what bending means: change who does it, where the turn falls or what the last picture is.
- **Earlier work is reused.** `skills/v8.1.0` already held a premise method and per-type rules for the older Director (`craft-story`, `craft-comedy`, `type-*`); its comedy mechanisms and format rules are folded into the new file.
- Section 11's additions (blocks and a fulcrum, wit at the cut, the order for judging a cut, the checks on a take) are in `film-craft.md`.

### Paper test of the 2.1.0 text (free)

The Director's model planned eight briefs, three times, with the new files (`arm-c1`, `arm-c2`, `arm-c3`): the four earlier briefs and four new ones (a flask advert, a creepy lift, a birthday film for a mother who grows flowers, "something amazing with a whale"). Today's skill planned the four new briefs once (`arm-a3`).

| Brief | Today's skill | 2.1.0, three runs |
|---|---|---|
| Flask advert | Someone comes in from the rain and opens the flask | One band of light describes the metal, then warmth at the rim, no person; a crave sequence; hero in light |
| Creepy lift | A chair that changes places | The doors open on another copy of the landing (twice); a mirror that shows the doors still open after they close |
| Birthday film | A child gives a plant | The gardener's ritual, with one new pot where the first picture showed a gap (twice); the flower keeps her company |
| Whale | A whale returns a fallen star | The whale lifts the sea like a blanket under a buoy; a whale's shade crosses a picnic in a desert (twice) |

- **How the takes were chosen** (24 films): one straight from a template, about thirteen bent, about ten the Director's own. It uses the library as asked.
- **Variety across runs** is better than in section 7 and still partial: the lift, the whale and the cat each repeated one idea in two of three runs, and the three platform films share one reading.
- **A fault found and fixed.** In the first two runs the Director held still pictures for most of some films, because a still costs nothing: an eight-second still as the pigeon's final portrait, sixteen of twenty seconds in the lift. The craft text now limits a still to a thing that would not move anyway, for a second or two, and gives whatever is alive, and the kept image, a clip. The third run followed it.
- **Cost** stays under the earlier plans: about $0.75–1.50 a film before retakes, against $1.50–2.50, because stills replace bought inserts.
- The limits of section 7 stand: these are plans, I am not a blind judge, and only films show whether a better plan is a better film.

### The build

| Card | Who | What |
|---|---|---|
| [H1](cards/H1-skill-idea-and-cut.md) | Lead writes the text; Codex releases | Skill 2.1.0: `SKILL.md`, `film-craft.md`, new `templates.md`, the example plan, `studio.d.ts` |
| [H2](cards/H2-edit-tools.md) | Codex | Still rows, punch-in to 2×, cut pairs on a render, advisory findings for the cut list, a suggested video input on the keyframe card |
| H3 | Lead | The idea above the storyboard (chosen take, reading, rule; other takes, fixed points and the cut list folded), the suggestion on the keyframe card, words for the new findings |

Order: H2 merges first, then H1 (its example uses H2's shapes), then H3. Two paid films follow, each asked for first.

### Built and verified, 2026-11-17

All three cards are merged into local `main` (not pushed). Reports: [H1](reports/H1-report.md), [H2](reports/H2-report.md).

- Codex ran `pnpm check` on the merged state: 5,366 tests passed, none failed, one optional probe skipped; five workspace typechecks passed.
- The lead ran all 217 browser scenarios against a disposable fixture studio. One older scenario failed because the new suggestion line shared an attribute with the option buttons; after the fix the affected scenarios pass. Two scenarios are new: the idea above the storyboard on a desktop and on a phone, with the suggestion on the keyframe card.
- New Director turns get skill 2.1.0 and the new tool schema. A turn already under way when the studio is updated keeps its old lock and fails closed; the next turn works.
- Known limits: a still that belongs to no shot comes from `ctx.image` and has no confirmation card; the templates reach the Director on every turn (about 2,200 words of the 9,055); variety across runs is partial.
- Not done: no film has been made with 2.1.0. The plans are better on paper; whether the films are better is still to be seen.

## 13. Two layers, 2026-11-17: format first, then aim

The owner asked why the library was sorted by what the viewer comes for and not by kinds of video such as social, ads, film, micro drama, music video and explainer. Both matter, and they decide different things. The owner's decision: format first, then aim, with both classifications researched again and templates found for each.

### What each layer decides

| Layer | Decides |
|---|---|
| Format: what the film is and what it is for | Length, picture shape, what the first three seconds must do, whether there is a product, speech or text, how it ends, the unit of structure |
| Aim: the response the last picture should leave | Which family of shapes, where the turn falls, what the last picture is |

A format's structure gives the slots; an aim's shape fills the turn. An advert (format) built as problem and solution can have a crave sequence (aim) as its solution.

### How the two lists were made

Seven more surveys (`layers-1` to `layers-7` in the working folder).

- **Formats.** Evidence from advertising awards and platform ad formats, social platform categories, short-drama platforms and the Chinese regulator's definition, one-minute festivals, music-video and explainer practice, corporate video, and the template galleries of CapCut, InVideo, Synthesia, HeyGen, Kling and Runway. Findings: the industry treats "social" as a placement and a length band, not a format, and every other format appears there; "ads" covers three things with different rules (a direct advert, a brand film, a showcase); "film" covers a short story, a trailer and a documentary piece; occasion videos (birthday, wedding, invitation, tribute) and narrated stories are among the largest demands on template tools and were in neither earlier list.
- **Aims.** Evidence from Cowen and Keltner's 27 emotions evoked by short videos, Unruly's 18 responses to adverts, System1, Kantar and the IPA on emotional advertising, Berger and Milkman on what spreads, film theory on suspense and surprise, and research on being moved, elevation and awe. Findings: two of the eight were weak. "Tension" joined two mechanisms that manage information in opposite ways (suspense: the viewer knows more; twist: the viewer knows less). "Feel" joined two directions (closeness restored; something lost). Three responses had no home: pride and resolve, understanding, and concern for an issue. The micro-drama survey added a fourth: 爽, the relish of seeing someone wronged proved right.

### The lists

**Thirteen formats:** Short film, Micro drama, Narrated story, Advert, Brand film, Showcase, Social post, Music video, Explainer, Mini documentary, Trailer, Occasion, Visual piece. Where the film runs (a vertical feed, or widescreen) is a separate setting that applies to every format.

**Fourteen aims:** Laugh, Suspense, Twist, Moved, Bittersweet, Inspire, Payback, Wonder, Calm, Crave, Satisfying, Thrill, Understand, Concern. One main aim owns the last picture; at most one second aim carries the build.

Mapping from the eight: Laugh, Wonder and Calm kept; Tension split into Suspense and Twist; Feel split into Moved and Bittersweet; Desire renamed Crave, Satisfaction renamed Satisfying, Energy renamed Thrill; Inspire, Payback, Understand and Concern added.

Each format has its constraints and four to eight structures (about 75 in all); each aim has its definition, what separates good from generic and four to eight shapes (about 80). They are in `skills/code-plan/references/formats.md` and `aims.md`. The freedom rules are unchanged: use, bend or leave; at least one take owes nothing to the files.

### What the tool cannot do, written into each format

No lip-synced speech (voice-over and captions carry words); no readable text inside pictures; music is generated and cannot be cut to its beat, and the person cannot supply a song; no real person's face, voice or words unless supplied. So a micro drama here carries its lines as captions and one inner voice; a music video is planned by time at a tempo that was asked for, never on the beat; an explainer uses concrete pictures and no labelled diagram; a mini documentary keeps an illustrated look and says so.

### Paper test (free)

The Director's model planned the eight earlier briefs once and eight new briefs twice with the two files (`arm-d1`, `arm-d2`, `arm-d3`), and skill 2.1.0 planned the new briefs once (`arm-c4`). The new briefs: a 40-second 短剧 about a courier who is the heir, why the sky is blue, a teaser for a novel, a lo-fi music video, a bedtime story, an oat-milk advert, a piece about a grandfather's noodle shop, a Reels POV.

- **Reading the brief.** Format and aim were read correctly in all 24 films, the same in both runs: the 短剧 as Micro drama and Payback, the bedtime story as Narrated story and Calm with Moved, the Reels brief as a vertical Social post and Laugh.
- **What the format layer changed.** Mostly constraints, not ideas. With 2.1.0 the explainer planned labelled diagrams, which the tool cannot make; with the two files it planned illustrations without labels or numbers. The noodle-shop piece gained an illustrated look, a disclosure caption and a request for a real photo, and declined to imply a bereavement the brief did not state. The novel teaser stated that it invents no quote and no tagline.
- **What it did not change.** Idea quality on these briefs is close between 2.1.0 and the two files: 2.1.0 already knew what a short drama or a Reels post is. One 2.1.0 idea was wittier than either two-layer run (the office motion-sensor light that decides you have left).
- **No regression** on the eight earlier briefs. All eight chosen takes there were the Director's own; on the new briefs seven of eight were bent from a structure.
- **Variety** across the two runs is still partial: the music video, the bedtime story, the advert and the noodle shop found the same idea twice.

### The build

| Card | Who | What |
|---|---|---|
| [H4](cards/H4-formats-and-aims.md) | Lead writes the text; Codex releases | Skill 2.2.0: `formats.md`, `aims.md`, the craft and skill sentences, the example; the two idea files are supplied only on turns the person starts |
| H5 | Lead | The idea panel shows the format and the aim first |

The two files are about 6,800 words. Supplying them only on person-started turns keeps review and repair turns at about 7,000 words.

### Built and verified, 2026-11-17

Both cards are merged into local `main` (not pushed). Report: [H4](reports/H4-report.md).

- Codex ran `pnpm check` on the merged state: 5,379 tests passed, none failed, one optional probe skipped; five workspace typechecks passed.
- The lead ran all 217 browser scenarios against a disposable fixture studio; all passed, including the idea panel showing the format and the aim.
- The manifest gained an optional field, `personTurnFiles`. Review, repair and media-failure turns get four files; turns the person starts get six. The lock and the digest still cover every file.
- Known limits: on a person-started turn the Director reads about 13,800 words of skill; variety across runs is partial; a micro drama or a music video here is the version this tool can make (captions for lines, a generated song, no cutting on the beat), not the full form.
- Not done: no film has been made with 2.1.0 or 2.2.0.

## Appendix A: the proposed skill text

### The idea, before any plan

A brief is a wish, not a shot list. First write what the person fixed (subject, place, tone, length, the moments and the ending they named) and what they left open. Keep every fixed point: a named ending keeps its event and its feeling. Moments listed in a brief must appear; how they are seen, in what order and what joins them is your work.

Write the obvious film in one sentence: the one anybody would make from this brief. Then find three other takes. Each names where its pleasure comes from and its decisive moment; if two takes share both, replace one. Look in different places: a relationship (a thing becomes a character, a rival, a witness); what the viewer knows and the character does not, or whose eyes we see through; another kind of film played completely straight; one detail that belongs only to this place; a picture or a pattern whose meaning changes the second time. A mood ("cinematic", "whimsical") is not a take.

Choose the take that keeps the fixed points, leaves the viewer something to work out or notice, and fits the ceiling. A calm film needs no twist. Then write the reading: "The viewer first reads this as __. Through __, that becomes __. The image they keep is __." "Through" must be something visible.

Choose one bold visual rule that expresses the reading, sustain it through framing, light, colour, scale or camera position, and compose the kept image as a picture worth pausing on.

Work backwards from the kept image: plant what gives it meaning, withhold what would spoil it, leave out what the viewer can add up from two pictures. Each beat changes what happens, what the viewer understands or what they attend to. Dramatic beats follow by "therefore" or "but", not "and then"; calm beats build by contrast, repetition or absence. Escalation by three, a late turn and a closing button are tools: use them when they belong.

You may enrich a fixed moment while its outcome stays the same. An addition that reverses an outcome, starts a new problem or replaces the requested last image needs the person's agreement first.

Record `fixed`, `takes` (the chosen one marked) and `reading` in `ctx.scene`. Open your reply with the chosen take in two lines and the others in one line each, then carry on.

### Cut list, then shots

Write what the viewer will see, cut by cut, before deciding what to buy: `cuts: [{ sees, seconds, clip }]` in `ctx.scene`. One cut shows one plain thing; the cut supplies the meaning. What matters most now is the biggest thing in frame: go close for a small essential action; keep a whole-body gag wide enough to hold cause and result together. A look is three cuts: the looker, what it sees, the looker. A held picture can change meaning by what came before it.

Then decide the shots to buy. A shot is one continuous action or state from one setup, and its keyframe shows the moment before the action. The same clip can feed several cuts by range, punch-in, speed or hold. Build in the edit what the video model does badly: looks between two things, fast repeated motions, counts, exact contacts, left and right, readable text. Imply an event you cannot show only when the pictures around it prove it. Give the model what it does well: one simple motion, a slow camera move, light, weather, texture, scale.

Buy from the supported lengths, the range each cut needs and the risk of each action; a one-second insert still costs the shortest clip. Name the one action most likely to fail and what you will do if it does.

The cut list is a hypothesis. After the clips arrive, replace it with what the footage shows.

### Watching and cutting

Finish every clip, then `await ctx.review(id, {clips, note})`.

1. Log each clip with `read_clip_frames`: its moments by frame range, what each proves, and anything good you did not ask for.
2. Assemble from the cut list using logged moments. Keep the fixed points and the reading; let the assembly change if the footage offers a better film.
3. When a moment is missing, take the first step that works: another range; build it from two moments; punch in, change speed or hold; drop the cut; last, a retake that changes the approach (a closer size, one simpler action, the keyframe as first frame). Never buy the same setup again with new words. At most one retake per shot and two per film.
4. Rhythm: enter on movement, leave after completion, never on a half-finished pose. Shorten each cut until just before it stops reading. Vary the lengths: quick cuts make a held shot land, and a calm film earns each cut. Put the hit on the frame of contact.
5. Check every cut: what is visibly proven, and what changes across it? Compare the last frame before with the first frame after for position, facing, prop state and eyeline. Fix a mismatch by reordering, a cutaway or a punch-in.
6. Render and review the render once: does the reading happen on screen, and does the kept image land? Report what you observed, including what failed.

## Appendix B: candidate additions to the skill text (not yet tested)

From section 11. Each replaces or follows a sentence in Appendix A; together they add about 260 words.

**In "The idea, before any plan", replacing the sentence that begins "Look in different places":**

> Look for a move, not a mood. Moves that work without words: a thing used or treated as another thing; a framing that lets the viewer assume one thing until a wider or later picture shows another; the problem solved the wrong way in complete seriousness; a consequence taken to its extreme; the last character you would expect to do this; the same frame at another time, or one thing multiplied; one object that carries the film and comes back changed; an image that seems unrelated until the ending links it; the viewer knowing what the character does not; another kind of film played straight. Each take uses a different move.

**After the reading sentence:**

> Check the chosen take. What is mismatched in it? In a comedy, what rule is broken, and why is it harmless? Does something from the first seconds come back changed in the kept image?

**At the end of the visual rule sentence:**

> Keep the other components alike, so that the one you break at the turn is felt.

**In "Cut list, then shots", before the cut list:**

> Divide the film into two to four blocks. Each has one job: what the viewer believes, expects or notices by its end. Mark the fulcrum, the cut where the reading turns; give it the closest framing or the longest hold and build outward from it. The setup must be believed before the release, and the release is short.

**After "A held picture can change meaning by what came before it.":**

> If every cut is the next action of the same subject, the list is the brief again: cut to a detail of the same moment, to another subject or across time. Wit lives at the cut: an entrance or an exit from the frame; a shape in the last frame matched by the next first picture; a sound for an event you do not show, over the face that hears it; the same framing three times, broken the fourth; an action that starts and is stopped.

**In "Watching and cutting", at the start of step 5:**

> Judge each cut in this order: does it land, does it tell, does it move, does it match. Repair a mismatch the viewer would notice when a reorder, a cutaway or a punch-in does it; never drop a cut that lands for a flaw nobody will see.
