# Revision proposal: social vertical as a native spine

Proposal to revise [social-vertical.md](social-vertical.md) for the `format-social-vertical` package (architecture §3.2, §6.2: modifier, or spine with `filmKind.kind: "social_post"`). It is a draft for review; it does not replace the current file yet. Driver: the owner's acceptance test, "a 20 s funny social video to post on IG, to make people laugh". Evidence and comedy craft: [../craft-comedy/](../craft-comedy/comedy.md); sources: [../craft-comedy/sources.md](../craft-comedy/sources.md).

## Problems with the current draft

1. **Caption-dependent.** It requires captions on every spoken word and a hook text line in frame 1. Film has no caption layer, so a post built to that spec ships broken. The native-spine path must work with no text at all.
2. **Shot pacing assumes trimming.** It asks for 1–3 s shots and 4–8 shots per 15 s. With untrimmed 6 s clips that is impossible; the 2–4 shot fallback is buried in one line.
3. **No content engine.** As a spine it lists formats ("POV skits, reveals") but says nothing about what makes a native post work. Entertainment, and comedy above all, is the main reason people send Reels; the draft has no entertainment method.
4. **Safe zones are vague** ("bottom fifth and right sixth"). Current IG guidance is deeper at the bottom.
5. **Sound** is treated only as captions and trending tracks. Most Reels are watched with sound on; music and one VO line are the cheapest comedy tools OpenSlate has. Clip audio (H3 native SFX) is muted in Film and the draft does not say so.
6. **Ranking signals** are absent: the draft optimises "watch to the end" but not sends, which matter most for reach to non-followers.

## Proposed changes

### Purpose

Replace with: "Stop the scroll, hold to the end, and earn a send or a rewatch. On IG, write for sends per reach (a viewer DMs it to a friend) and watch-through." Cite [short-form-comedy.md § What the platform rewards](../craft-comedy/short-form-comedy.md#what-the-platform-rewards).

### Format

- Keep 9:16, 1080×1920. Default length **15–20 s** for organic posts (was 7–30 s).
- Safe zone (IG Reels, approximate): keep faces, props and the punch out of the **top 14 %** and **bottom 35 %**, and the **right 21 %** below mid-height (action rail). Keep the subject in the middle band. The grid shows a 3:4 crop (centre 1080×1440): the frame-1 subject must sit inside it.
- AI disclosure: realistic synthetic video should be posted with Instagram's AI label; say so once.

### Native spine: choose an engine

Add a section. When the spine is `social_post`, pick one engine and load its craft:

| Goal | Engine | Load |
|---|---|---|
| Make people laugh | Comedy premise + beat map | `craft-comedy` (comedy.md, short-form-comedy.md, premises-and-beats.md, review-checklist.md) |
| Wow / satisfy | Reveal or transformation | `craft-story` hook → promise → payoff |
| Teach a tip | List of three | `type-explainer` tutorial subtype |
| Relate / feel | Mini-story with a turn | `craft-story` Story Spine fragment |

Routing proposal: `craft-comedy` as an `optional` package on `format-social-vertical` and `type-narrative`, with a closed `when: "goal_entertain_humor"` condition set by `brief` intent ("funny", "make people laugh", "skit", "meme", "gag", Chinese 搞笑/段子/好笑). Requires `craft-story`.

### Structure

Replace the hook-only shape with a beat map that works untrimmed:

| Beat | 3 shots × 6 s (default today) | 4 shots × 5 s (when trimming works) |
|---|---|---|
| Hook / setup | Shot 1, 0–6 s | Shot 1, 0–5 s |
| Build | Shot 2, 6–12 s, ends on the beat before | Shots 2–3, 5–15 s, rule of three |
| Punch + button / loop | Shot 3, 12–18 s | Shot 4, 15–20 s |

Rules: frame 1 shows subject + situation + one odd detail and does not show the payoff; the proposition is clear by 3 s; the payoff lands on a cut; the last frame cuts back to the first. See [premises-and-beats.md](../craft-comedy/premises-and-beats.md).

### Scenes and shots

- State the untrimmed rule first: "With untrimmed 6 s clips, plan `duration ÷ 6` shots (20 s → 3) and get energy from in-shot reveals and the cut between states." Keep the 1–3 s shot guidance as the trimmed case.
- Every keyframe holds the beat's frozen state; the payoff image is always a keyframe.

### Narration, text and music

Replace with:

- **Text-free by default.** Film has no captions; plan posts that land with no on-screen text. Reject premises that need a caption ("POV: …", "me when…") or convert the caption into one VO line. Record any caption wish in `story` as a finishing gap.
- **One VO line** (3–8 words) at most for a native post, off-face, in the setup shot.
- **Music carries tone** and supplies the beat before (cut to silence). Use the project soundtrack at −18 dB under VO, louder when there is no VO. No trending or copyrighted track.
- **Clip SFX gap.** H3 generates native audio, but Film mutes clip audio. Do not build a punch on a sound effect; record "clip audio wanted" as a gap.
- Design for sound-on (about 80 % of Reels views, secondary sources) and test muted.

### Must-have shots

Add: the payoff/punch frame as a keyframe; a reaction or deadpan hold of 1–2 s after it; a loop frame matching frame 1.

### Common mistakes

Add: a premise that needs text; the hook frame giving away the punch; two jokes in one post; a joke at a group's expense; real people, brands or logos; a punch timed inside a clip's drift instead of on a cut.

### Generation caveats

Keep the existing items. Add, citing [short-form-comedy.md § What AI video does well and badly](../craft-comedy/short-form-comedy.md#what-ai-video-does-well-and-badly-for-comedy):

- One held expression per clip, generated in the keyframe.
- Timing lives in the cut; a clip delivers a state.
- Animals, toddlers-as-professionals and scale contrast are reliable; multi-step physical gags and precise contact are not.
- Stylized styles (`stylized-3d-feature`, `claymation-stop-motion`) for cartoon physics; `grounded-realism` when the absurd element is the only unreal thing.

### Intake questions

Replace question 3 and add one; keep the three-question cap:

1. Platform and organic or ad? (Default: organic IG Reels, 20 s.)
2. What should viewers feel or do: laugh, learn, want? (Default from the brief; "funny" → comedy engine.)
3. Any subject that must appear (your pet, your product, a place) and anything off-limits? (Default: invented characters, family-friendly.)

Do not ask for the joke. Offer two or three premises as a note with choices instead.

## Gaps to raise with the owner

| Gap | Effect on comedy | Proposal |
|---|---|---|
| No caption / text layer | Kills "POV:" and "when you…" formats; no hook text | Keep text-free method now; captions in finishing later |
| Clip audio muted in Film | H3's native SFX (honk, thud, squeak) cannot carry a beat | Add per-shot "keep clip audio" with gain; default off |
| Untrimmed clips | 3 shots only; slow rule of three | Honour `desiredFrames` in Film; the 4-shot variant needs it |
| One soundtrack, no cue points | A music change at the punch needs a lucky track | Allow two soundtrack cues or a cut-to-silence point |
| No humour eval | "Funny" is untested | Add the acceptance brief as an eval: 3 premises offered, chosen one passes the checklist, a human rates the 20 s result |
