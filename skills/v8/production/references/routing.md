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

Use `prepare_change` `{variant:"project", creative:{project:{filmKind:{…}}}}` and apply it; it has no media impact. Write the whole record. `basis` per field: `stated` (the person said it), `asked` (they answered your question), `inferred` (you read it from signals), `default` (from the table above). If they skip the question, save the defaults with `basis: "default"`. Reply with one line naming the kind, format and any inference, so the person can correct it ("Social skit for Reels, 9:16, 20 s — I picked a skit; say if you want a POV instead."). Then read the type package with `read_guidance` and continue in the same turn.

Example, "a 20 s funny social video to post on IG, to make people laugh":

```json
{"kind":"social","subtype":"skit","tones":["comedy"],
 "format":{"platform":"ig_reels","aspect":"9:16","targetSeconds":20},
 "audience":"general","source":"generated",
 "basis":{"kind":"stated","subtype":"inferred","tones":"stated","platform":"inferred","aspect":"default","lengthBand":"stated","audience":"default","source":"default"}}
```

Nothing is missing, so no question: save, read `type-social`, and go to the premise step. Under-specified ("make a funny video"): tones `comedy` is stated, but kind and aspect are not, so save `{"kind":"undecided","tones":["comedy"],"basis":{"tones":"stated"}}` and ask the question above. Changing `filmKind` later re-opens intake; the next turn routes the new type.
