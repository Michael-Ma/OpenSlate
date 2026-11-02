# Video types

Draft guidance for the Director. Identify what kind of video the person wants, then plan scenes, shots, keyframe prompts and motion prompts the way that kind of video is actually made. Each type file is a lazy reference: load the index first, then only the one or two type files the brief needs.

Draft status: written against `skills/v7/production` for assembly into v8, suggested location `references/video-types/*.md`. Visual style (look, palette, lens, grade, rendering medium) is owned by [visual styles](../visual-styles/); these files decide structure, coverage and pacing, not look. Music video is owned by [music video](../music-video/music-video.md); its beat-cutting and clip-window rules also apply when any type here is cut to music.

## Where decisions go in the plan

- `brief`: the type line (see step 5), audience, duration, aspect, delivery cut-downs, required facts and supplied assets.
- `story`: the type's structure as beats, timing assumptions, narration coverage, the recurring visual idea, and text/caption needs that finishing must supply.
- Scenes: `title` is the short name (at most about 6 words); `purpose` is the scene's job in the type's structure ("Hook: the spill nobody can clean").
- Shots: `framing` is a 1–3-word label (Close-up, Medium, Wide); put the must-have role, composition and text-safe space in `purpose`, `action` and `imagePrompt`; one action and one camera move in `motion`/`videoPrompt`; used length in `desiredFrames` (30 fps).
- Intake questions go in one compact message with defaults, after inferring everything the brief, attachments and saved project already answer.

## Types

| Type | File | The brief is mainly about |
|---|---|---|
| Narrative short film | [narrative-short.md](narrative-short.md) | Characters, a story, an ending |
| Commercial / ad | [commercial-ad.md](commercial-ad.md) | Selling something, with a call to action |
| Product showcase / demo | [product-showcase.md](product-showcase.md) | What one product looks like and does |
| Brand film | [brand-film.md](brand-film.md) | What a company believes; feeling over offer |
| Explainer | [explainer.md](explainer.md) | Making an idea, service or process understood |
| Tutorial / how-to | [tutorial.md](tutorial.md) | Teaching the viewer to do something step by step |
| Mini-doc | [mini-doc.md](mini-doc.md) | A real subject, person or place, told truthfully |
| Testimonial / interview-style | [testimonial.md](testimonial.md) | A person vouching for an experience |
| Social vertical short | [social-vertical.md](social-vertical.md) | A Reels/TikTok/Shorts post; format, hook, loop |
| Trailer / teaser | [trailer-teaser.md](trailer-teaser.md) | Promoting a longer work, launch or event to come |
| Event recap | [event-recap.md](event-recap.md) | What happened at an event and how it felt |
| Fashion / lookbook film | [fashion-lookbook.md](fashion-lookbook.md) | Garments, looks, a collection |
| Place film (real estate / travel / venue) | [place-film.md](place-film.md) | A property, destination, hotel or venue |
| Animated kids' story | [kids-animated-story.md](kids-animated-story.md) | A story for young children |
| App / software promo | [app-promo.md](app-promo.md) | A digital product whose value lives on a screen |
| Narrated story / faceless channel | [narrated-story.md](narrated-story.md) | History, facts, legends or a list told over visuals |
| Tribute / celebration | [tribute.md](tribute.md) | A person, couple, team or milestone being honoured |
| Music video | [../music-video/music-video.md](../music-video/music-video.md) | A song is the spine (owned by another draft) |

## Identify the type

1. **Use an explicit label.** If the person names a type ("a 30-second ad", "trailer", "lookbook", "Reel"), take it, map synonyms with the table below, and skip to step 4.
2. **Read four signals from the brief and attachments; do not interview for them.**
   - Goal: sell, persuade, inform, teach, document, honour, entertain, promote something upcoming.
   - Subject: a product, a digital product, a person, a place, an event, garments, an idea, an invented story.
   - Destination: platform, placement, aspect, length. Platform names imply format, not content.
   - Assets: product photos, logos, screenshots, portraits, a recording, a script, a song.
3. **Choose the spine from the goal, the must-have shots from the subject, and the format from the destination.**

   | Goal + subject | Spine type |
   |---|---|
   | Sell + physical product | Commercial if there is an offer/CTA; product showcase if the job is to show the product itself (product page, launch loop) |
   | Sell + app/website/SaaS | App promo |
   | Persuade + company values, no offer | Brand film |
   | Inform + idea/service/process | Explainer |
   | Teach + a task the viewer will perform | Tutorial |
   | Document + real person/place/issue | Mini-doc |
   | Vouch + a person's experience | Testimonial |
   | Promote + something not yet available | Trailer / teaser |
   | Remember + an event that happened | Event recap |
   | Show + clothing/accessories | Fashion / lookbook |
   | Show + property, destination, venue | Place film |
   | Entertain + invented characters | Narrative short; kids' story if the audience is under about 8 |
   | Inform/entertain + facts, history, lists, voice-led | Narrated story |
   | Honour + person or milestone | Tribute |
   | Song supplied and it drives the cut | Music video (other draft) |

4. **Apply format modifiers.** Social vertical and trailer/teaser cut-downs are often modifiers on another spine: "TikTok ad for our serum" is a commercial spine in social-vertical format. Load both files; the spine file sets structure, the modifier file sets hook timing, aspect, safe zones, captions and loop.
5. **Record the decision in the brief** as one line: `Type: <spine> [+ <modifier>]; <duration>; <aspect>; assumptions: ...`. State assumptions instead of asking about them when they are cheap to change later.

### Synonyms

- Commercial: spot, ad, promo, campaign video, UGC ad, pre-roll, bumper.
- Product showcase: product video, hero video, PDP video, packshot, 360, unboxing, demo (physical).
- Brand film: manifesto, brand story, about-us film, mission video, anthem.
- Explainer: animated explainer, "how it works", concept video, whiteboard.
- Tutorial: how-to, walkthrough, recipe, DIY, training, onboarding (task-based).
- Mini-doc: documentary, profile, portrait film, founder story, behind the scenes, impact story.
- Testimonial: case study video, customer story, review video, interview video.
- Trailer: teaser, sizzle, coming soon, launch tease, book trailer, game trailer.
- Event recap: highlight reel, aftermovie, sizzle (past event), conference recap.
- Place film: listing video, property tour, destination film, hotel film, venue tour.
- Narrated story: faceless video, history video, top-10, story time, myth/legend.
- Tribute: memorial, anniversary, birthday/wedding montage, retirement, team thank-you.

### Hybrids

- Pick one spine. Two spines produce a video with two middles. The spine is the goal the person would measure success by.
- Borrow sections, not structures: a commercial can contain a 2-shot testimonial beat; a brand film can end on a product shot; a mini-doc can carry a soft CTA card.
- Common pairings: product launch = trailer spine + product showcase must-haves; founder story = mini-doc spine + brand film ending; case study = testimonial spine + explainer middle; recipe = tutorial spine + product showcase lighting; hotel ad = commercial spine + place film coverage; kids' lesson = kids' story spine + explainer clarity.
- When a person asks for several deliverables (a 60 s film plus 15 s and 6 s cut-downs, or 16:9 plus 9:16), plan the longest master first, mark which shots survive each cut-down, and compose keyframes so the vertical crop holds the subject (centre-weighted, headroom for UI). Generate a separate vertical keyframe only for shots whose subject cannot survive the crop.

### When to ask

Ask only when the answer changes the spine, the duration or aspect, or a fidelity risk. Bundle at most three questions, each with a default you will use if they skip it. Proceed with independent drafting meanwhile.

- Ask when two spines fit and differ in structure: ad vs brand film (is there an offer or CTA?), explainer vs tutorial (will the viewer do it themselves?), showcase vs ad (where will it run?), mini-doc vs testimonial (one voice vouching, or a subject explored?).
- Ask when the destination is unknown and the brief implies a platform-sensitive type (ad, social, trailer, place film). Default: 16:9 for film/web, 9:16 for anything social.
- Ask when a real product, logo, person, place or event must look like itself and no reference asset is attached.
- Do not ask about things the brief, attachments or saved project already settle, or about aesthetics the visual-style draft covers.
- Do not ask to confirm the type when the signal is clear; state it in the brief and let the person correct it.

## Shared planning rules

### Shot budget

Each clip is generated at about 6 s (180 frames at 30 fps). Plan the used length per shot, then derive the count.

- Where the edit can use part of a clip, set `desiredFrames` to the used length from the type's pacing (often 1.5–4 s, 45–120 frames) and choose motion whose peak lands inside that window. One clip can supply two or three cuts when its action loops or holds cleanly (see the clip-window rules in [music video](../music-video/music-video.md)).
- Where it cannot, every shot runs its generated length. Plan `duration ÷ 6` shots and get energy from in-shot motion, not cut rate. Tell the person once when a type's normal pacing (ads, social, trailers) needs shorter cuts than the current edit supports.
- Rough counts at about 4 s used per shot: 15 s → 4–5 shots; 30 s → 7–10; 60 s → 12–18; 90 s → 18–25; 3 min → 30–45. At 6 s untrimmed: 15 s → 3; 30 s → 5; 60 s → 10.
- Each shot costs a keyframe and a video generation. Spend the count on must-have shots first; cut decorative coverage before cutting a must-have.

### Narration

- Budget about 2.5 words per second for adult narration (130–160 wpm) and about 2 words per second for children's or instructional narration. One 6 s shot holds 12–15 adult words.
- Write narration to cover the planned visual duration; do not stretch shots to fit long copy. Cut words instead.
- Words and picture must say different things: narration gives meaning, the frame gives evidence. Do not narrate what the shot already shows.

### On-screen text, logos and captions

Film assembles clips in storyboard order with narration and soundtrack; overlays, captions and transitions are future work. Image and video models render text unreliably and it degrades further in motion.

- Never rely on generated pixels for copy that must be correct: prices, URLs, legal lines, product names, step numbers, supers, captions.
- Plan such text as a finishing requirement (a gap in the brief), and compose the keyframe with clean negative space where it will sit.
- When a frame must show a brand mark, condition on the supplied logo/product image, keep the mark large, flat-on and still, and keep motion away from it. Inspect the returned frames and clip for warping before relying on them.
- Prompt signage, screens, packaging and books as blank or illegible-by-distance when the words do not matter.

### Supplied media

Testimonials, mini-docs, event recaps, real listings, app promos and tributes depend on the person's own photos, footage, screenshots and recordings. Use supplied images as registered references or imported keyframes and animate them with restrained camera motion. Where a type needs supplied footage or screen recordings placed as-is and the current Film cannot do that, record it as a gap in `story` and plan the generated shots around it rather than replacing the real material with invented imagery.

### Generation risks and default mitigations

Type files list their specific risks; these defaults apply everywhere.

- **Product fidelity.** Condition every product shot on a supplied product image. Keep the product's silhouette, colour and label facing camera; prefer slow orbit, push-in, or light/environment motion over the product rotating or being handled. Do not invent features, variants, colours or claims.
- **Real people.** Do not generate an identifiable real person without the person's evident consent and a reference supplied for that purpose; never for public figures, testimony, or endorsements. Use invented characters, backs, silhouettes, hands, or the person's own supplied footage. Platforms require labels for realistic synthetic people and events; note that as a delivery requirement.
- **Hands.** Keep hands out of the critical moment or make the action simple and continuous (hold, rest, single press, pour). Avoid finger counts, typing, tying, instrument fingering, and small-object manipulation. Crop to the result instead of the manipulation.
- **Speech on camera.** Lip sync from image-to-video is unreliable. Stage dialogue and presenters off-face (backs, wides, over-shoulder, cutaways) or carry words in voiceover. When visible singing or speech is essential, follow the framing rules in the music-video [singing guide](../music-video/performance-singing.md).
- **Long continuous action.** A 6 s clip carries one action with one clear start and end state. Split multi-step action across shots, each with its own keyframe showing the start state. Do not ask one motion prompt for walk-then-sit-then-turn.
- **Identity and continuity.** Reuse the same character, product, wardrobe and location references across shots. Describe the recurring subject with the same words in every keyframe prompt. Prefer cutting between angles over long camera moves that reveal unplanned geometry.
- **Physics.** Liquids, fabric under sustained motion, crowds, vehicles turning, and object contact are fragile. Prefer slow, simple, single-direction motion and environmental motion (light, steam, wind, parallax).
- **Claims.** Generated visuals are depictions, not evidence. Never present them as real results, real customers, real events or real places as they actually are without saying so.

### Motion prompts

- One subject action and one camera move per shot, stated in that order, with speed and direction ("slow push-in; she lowers the cup").
- Describe the end state when it matters for the next cut.
- Match motion energy to the type's pacing; neighbouring shots should vary scale (wide, medium, close) and direction.
