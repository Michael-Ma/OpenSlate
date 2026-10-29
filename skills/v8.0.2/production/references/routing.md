# Routing and intake: what is being made

Read at the start of a new film, or when the brief changes what is being made. The saved `project.filmKind` decides which type package the next turn loads; you decide it once, at intake, and say it in one line.

## 1. Read the signals; do not interview for them

1. **Explicit label.** If the person names a type ("a 30-second ad", "trailer", "lookbook", "Reel", "段子"), take it and map synonyms below.
2. **Four signals** from the brief, attachments and saved project:
   - Goal: sell, persuade, inform, teach, document, honour, entertain, make people laugh, promote something upcoming.
   - Subject: a product, an app, a person, a place, an event, garments, an idea, an invented story, a song.
   - Destination: platform, aspect, length. Platform names imply format, not content.
   - Assets: product photos, logos, screenshots, portraits, a recording, a script, a song.
3. **Choose the kind from the goal and subject; the format from the destination.**

| Goal + subject | `kind` / `subtype` |
|---|---|
| Entertain, laugh, share in a feed (skit, POV, meme, trend, day in the life) | `social` / `skit`, `pov`, `meme`, `trend`, `day_in_the_life`, `storytime`, `tips`, `before_after` |
| Sell with an offer or call to action | `commercial` / `ad`, `ugc_ad` |
| Sell an app or website | `commercial` / `app_promo` |
| Company values, no offer | `commercial` / `brand_film` |
| Make an idea, service or process understood | `explainer` / `concept`; staff training `training` |
| Teach a task the viewer will do | `explainer` / `tutorial` |
| Invented characters and a story | `narrative` / `short`; vertical drama `micro_drama`; under about 8 `kids_story`; mood piece `visual_poem` |
| A song drives the cut | `music_video` / `performance`, `narrative`, `concept`, `lyric`, `dance` |
| A real person, place, event or milestone | `documentary` / `mini_doc`, `testimonial`, `event_recap`, `tribute` |
| Show one real subject beautifully | `showcase` / `product`, `fashion`, `place`, `food` |
| Promote something not out yet | `trailer` / `trailer`, `teaser` |
| Voice-led facts, history, legends, top-N | `narrated_story` / `history`, `list`, `legend` |
| None fits | `other` with `labels.kind` |

`social` vs `commercial`: if success is measured by a sale or a click, it is `commercial` even on TikTok; if it is a laugh, a send or a follow, it is `social`. A "funny ad" is `commercial` with `tones: ["comedy"]`.

**Tones** (0–3, first is primary): `comedy`, `drama`, `horror`, `thriller`, `romance`, `action`, `sci_fi`, `fantasy`, `mystery`, `wholesome`, `inspirational`, `heartfelt`, `nostalgic`, `epic`, `calm`, `energetic`, `luxurious`, `playful`, `serious`, `satirical`, `dark`, `other`. "Funny", "make people laugh", 搞笑, 好笑 → `comedy`. Look (palette, lens) is not a tone; it belongs to `visualStyle`.

**Format.** `platform`: `tiktok`, `ig_reels`, `ig_stories`, `ig_feed`, `yt_shorts`, `youtube`, `facebook`, `linkedin`, `x`, `douyin`, `xiaohongshu`, `wechat_channels`, `bilibili`, `web`, `tv`, `cinema`, `presentation`, `other`. Platform default aspect: TikTok, Reels, Stories, Shorts, Douyin, Xiaohongshu, Channels → `9:16`; IG feed and Facebook → `4:5` (made as 1:1); LinkedIn → `1:1`; YouTube, Bilibili, web, TV, presentation, X → `16:9`; cinema → `21:9` (made as 16:9). A video posted on Instagram defaults to `ig_reels`. `lengthBand`: `up_to_6s`, `up_to_15s`, `up_to_30s`, `up_to_60s`, `up_to_3min`, `up_to_10min`, `over_10min`; a stated length goes in `targetSeconds` and the application fills the band.

Synonyms: spot, promo, pre-roll, bumper → commercial; packshot, PDP video, unboxing → showcase/product; manifesto, about-us → brand_film; whiteboard, how it works → explainer; walkthrough, recipe, DIY, onboarding → tutorial; profile, founder story, behind the scenes → mini_doc; case study, customer story → testimonial; sizzle, coming soon → trailer; aftermovie, highlight reel → event_recap; listing video, hotel film → showcase/place; faceless video, top-10 → narrated_story; memorial, anniversary → tribute; 段子, 小品 → social/skit; 短剧 → narrative/micro_drama; MV → music_video.

## 2. Hybrids

Pick one kind: the goal the person would measure success by. Borrow sections, not structures; read the other type's reference with `read_guidance` instead of changing `filmKind`. A "TikTok ad for our serum" is `commercial` with `platform: tiktok`; the vertical format package loads automatically. When several deliverables are asked for (60 s plus 15 s, or 16:9 plus 9:16), plan the master first and note in `story` which shots survive each cut.

## 3. What must be settled before planning

`read_context` `project.filmKindIntake.ask` lists it: `kind` (not `undecided`), and `aspect` (given directly, or through a platform that has a default). A clear inference counts as settled for kind. Everything else defaults:

| Field | Default |
|---|---|
| `subtype` | Inferred from the brief; ask only when two subtypes differ in structure and both fit |
| `tones` | Inferred from the brief |
| `lengthBand` | Stories `up_to_15s`; other vertical platforms `up_to_30s`; commercial, social, showcase `up_to_30s`; trailer `up_to_60s`; others `up_to_3min`; a music video follows its song |
| `audience` | `general` |
| `source` | `generated`; `mixed` when the person attached their own photos or footage |

## 4. One compact question

When `ask` is not empty, or the kind is genuinely unclear, ask once, in one message, before planning: only the missing fields, plus a truly ambiguous subtype or length. Each question gives 2–4 options and names the default you will use if they skip it. While waiting, save `kind: "undecided"` with whatever is known (platform, length), and draft nothing that depends on the answer. Adjust the options to the brief: never ask what it already says.

English, for "make a funny video":

> Two quick things before I start (I'll use the defaults if you skip them):
> 1. What kind of funny video? A. A social skit for a feed B. A funny ad for a product C. A short comic story — default A
> 2. Where will it go? A. TikTok / Reels / Shorts, vertical 9:16 B. YouTube, horizontal 16:9 C. A square feed post — default A

Chinese:

> 开始之前确认两点（不回复我就按默认做）：
> 1. 想做哪种视频？A. 社媒短视频（段子 / POV / 日常）B. 广告或产品推广 C. 讲解或教程 D. 故事短片 —— 默认 A
> 2. 发在哪里、什么画幅？A. 抖音 / Reels / Shorts 竖屏 9:16 B. YouTube / B 站横屏 16:9 C. 朋友圈 / 小红书方形 —— 默认 A

Add "About how long? A. up to 15 s B. up to 30 s C. up to 1 min — default B" only when length matters and is unclear. Never ask for the joke, the look or the story here; those are offered as choices later.

## 5. Saving it

Use `prepare_change` `{variant:"project", creative:{project:{filmKind:{…}}}}` and apply it; it has no media impact. Write the whole record. `basis` per field: `stated` (the person said it), `asked` (they answered your question), `inferred` (you read it from signals), `default` (from the table above). If they skip the question, save the defaults with `basis: "default"`. Reply with one line naming the kind, format and any inference, so the person can correct it ("Social skit for Reels, 9:16, 20 s — I picked a skit; say if you want a POV instead."). Then read the type package with `read_guidance` and continue in the same turn. Its `SKILL.md` names the one or two references the next step needs; read those, not every file, and read each file once (a repeat in the same turn is free but adds nothing).

Example, "a 20 s funny social video to post on IG, to make people laugh":

```json
{"kind":"social","subtype":"skit","tones":["comedy"],
 "format":{"platform":"ig_reels","aspect":"9:16","targetSeconds":20},
 "audience":"general","source":"generated",
 "basis":{"kind":"stated","subtype":"inferred","tones":"stated","platform":"inferred","aspect":"default","lengthBand":"stated","audience":"default","source":"default"}}
```

Nothing is missing, so no question: save, read `type-social`, and go to the premise step. Under-specified ("make a funny video"): tones `comedy` is stated, but kind and aspect are not, so save `{"kind":"undecided","tones":["comedy"],"basis":{"tones":"stated"}}` and ask the question above. Changing `filmKind` later re-opens intake; the next turn routes the new type.

## Shared planning rules

These apply to every type. Type packages add their own structure and risks; they never relax these.

### Where decisions go in the plan

- `brief`: the type line (kind, format, length), audience, required facts and supplied assets. `project.filmKind` holds the structured version.
- `story`: the beats, timing assumptions, narration coverage, the recurring visual idea, and any text or caption needs that finishing must supply.
- Scenes: `title` is the short name; `purpose` is the scene's job in the type's structure ("Hook: the spill nobody can clean").
- Shots: `framing` is a 1–3-word label; put the beat, composition and safe space in `purpose`, `action` and `imagePrompt`; one action and one camera move in `motion`/`videoPrompt`; the used length in `desiredFrames` (30 fps).

### Shot budget

Each shot costs one keyframe and one clip. A clip is 3–15 s (90–450 frames); Film uses the first `desiredFrames` of it, so a shot's planned length is its cut length.

- Plan the used length per shot from the type's pacing, then derive the count. Short cuts (3–4 s) suit ads, social and trailers; 5–8 s suits story, explainer and showcase.
- Rough counts: 15 s → 3–4 shots; 20 s → 3–4; 30 s → 5–8; 60 s → 10–15; 90 s → 15–22; 3 min → 30–45.
- Spend the count on must-have shots first; cut decorative coverage before a must-have.
- Clips shorter than 3 s are not available. For faster rhythm, put the change inside the clip (a reveal, a cut-on-action at its end) rather than adding shots.

### Aspect

Keyframes, clips and the export follow the film's aspect from `filmKind.format`: 9:16 portrait, 16:9 landscape or 1:1. Compose every keyframe for that frame from the start; changing the aspect later outdates every keyframe. Portrait frames are tall: stack subject and context vertically, keep the subject in the middle band, and avoid wide two-shots that need horizontal room.

### Narration

- Budget about 2.5 words per second for adult narration and about 2 for children's or instructional narration (Chinese: about 4 characters per second). One 6 s shot holds 12–15 adult words.
- Write narration to cover the planned duration; cut words rather than stretch shots.
- Words and picture say different things: narration gives meaning, the frame gives evidence.

### On-screen text, logos and captions

Film assembles clips in storyboard order with narration, music and clip sound; overlays, captions and transitions are not available yet. Image and video models render text unreliably.

- Never rely on generated pixels for copy that must be correct: prices, URLs, legal lines, product names, step numbers, captions.
- Plan such text as a finishing requirement in `story`, and leave clean space where it will sit.
- When a frame must show a brand mark, condition on the supplied logo or product image, keep it large, flat-on and still, and inspect the result.
- Prompt signs, screens, packaging and books as blank or illegible when the words do not matter.

### Supplied media

Testimonials, mini-docs, event recaps, real listings, app promos and tributes depend on the person's own photos, footage and recordings. Use supplied images as registered references and animate them with restrained camera motion. Where a type needs footage or screen recordings placed as-is and Film cannot do that, record it as a gap in `story` and plan generated shots around it rather than inventing replacements.

### Generation risks and default mitigations

- **Product fidelity.** Condition every product shot on a supplied image; keep silhouette, colour and label facing camera; prefer camera, light or environment motion over handling. Never invent features, variants or claims.
- **Real people.** Never generate an identifiable real person, public figure, testimony or endorsement. Use invented characters, backs, silhouettes, hands, or the person's own supplied footage. Realistic synthetic people and events need the platform's AI label; mention it once.
- **Hands.** Keep hands out of the critical moment or make the action simple (hold, rest, single press, pour). Avoid typing, tying, instrument fingering and small-object manipulation.
- **Speech on camera.** Lip sync from image-to-video is unreliable. Stage dialogue off-face (backs, wides, over-shoulder) or carry words in voiceover. Visible singing uses the shot's Singing switch (see `craft-performance`).
- **One action per clip.** A clip carries one action with one start and end state. Split multi-step action across shots.
- **Identity and continuity.** Reuse the same character, product, wardrobe and location wording and references across shots. Cut between angles rather than long reveals of unplanned geometry.
- **Physics.** Liquids, fabric in motion, crowds, turning vehicles and contact are fragile; prefer slow, single-direction motion and environmental motion (light, steam, wind, parallax).
- **Claims.** Generated visuals are depictions, not evidence of real results, customers, events or places.
- **Copyright and likeness.** Never name a living artist, studio or franchise in prompts; translate a requested look into traits. No real brands or logos the person did not supply.

### Sound

- Music: the film's soundtrack (`set_soundtrack`), −18 dB under narration by default, 0 dB for a music video.
- Clip sound: clips can carry their own sound effects and ambience. Social and comedy films keep clip sound by default (about −6 dB, lowered under narration); music videos mute it. The person changes one clip with Film › Keep clip sound. When a sound effect carries a beat, say so in `story` and in the shot's motion prompt ("the goose honks once").
- Narration and clip sound share the mix; keep voice lines away from a clip whose sound is the punch.
