# Short-form comedy (Reels, TikTok, Shorts)

Specializes [comedy.md](comedy.md) for a vertical social post of 10–30 s. Format rules (aspect, safe zones, loop) are owned by `format-social-vertical`; structure by `type-social`.

## What the platform rewards

- Instagram has said its top ranking signals are watch time, likes per reach and **sends per reach** (DM shares); sends matter most for reaching people who do not follow the account. Comedy is the most-sent genre: write for "I have to send this to someone".
- Watch-through and rewatch count. A short piece that is watched twice beats a long one abandoned halfway. Default to 15–20 s.
- Original content ranks above reposts; aggregator-style and watermarked reposts are pushed down. Every post must be made for this account.
- A post that names a recognisable situation earns comments ("this is my mum"). Write premises that invite a tag.

## Choose a format

| Format | Shape | Works with OpenSlate | Notes |
|---|---|---|---|
| Visual reveal | Setup frame, misleading; reveal by cut or camera move | Best | No words needed |
| Escalation of three | Same action three times, third breaks | Best | One shot per beat |
| Mock-epic | Trivial event shot like a trailer or nature doc | Best | Music and framing do the joke |
| Animal or object character | Pet, toddler or object behaves like an adult professional | Best | Stylization forgives artefacts |
| "When you…" / relatable | Viewer's own experience, exaggerated | Good | Needs the situation readable in frame 1; usually relies on a hook caption, so carry it in one VO line instead |
| POV | Camera is the viewer; characters react to "you" | Fair | Direct-to-lens reactions read well; the "POV:" label is text and needs a caption |
| Skit with dialogue | Two characters trading lines | Poor today | Needs lip sync and captions; stage off-face if used |
| Trend / sound remix | Joke on a trending audio | Out of scope | Licensed audio and lip sync |

## The first second

- **Frame 1 is the hook.** It must show a subject, a situation and one odd detail, readable as a thumbnail. Start mid-action; no establishing wide, no fade-in, no title.
- The hook asks a question the viewer wants answered: "why is the goose there?", "how many plants?", "what is the dog guarding?".
- Proposition within 3 s: by then the viewer must know what the game is.
- Do not spend the punch on the hook. Show the odd detail, hide its cause.

## Beat map for 15–20 s

| Beat | Time | Job |
|---|---|---|
| Hook / setup | 0–2 s | One subject, one situation, one odd detail; the expectation forms |
| Build | 2–12 s | Escalate or repeat the pattern; each beat bigger |
| Beat before | about 0.5–1 s before the punch | Stillness, a held look, music drop |
| Punch / reveal | about 12–17 s | The flip, on a cut or a clear end state |
| Button / loop | last 2–3 s | Hold the reaction; end on a frame that cuts back to frame 1 |

Shot counts: Film cuts each clip to its `desiredFrames` (3–15 s per shot). For a 20 s request use **4 shots of 5 s** (150 frames) for a rule-of-three build, or **3 shots** (6 s + 6 s + 8 s) when the joke has one build beat. Put the punch at the start of the last shot or at the end state of the second-to-last, and give the punch shot at least 150 frames so the reaction can breathe.

## Sound

- Most Reels are watched with sound on (secondary sources say about 80%), but design the joke to land muted; sound adds a layer.
- Use the soundtrack for tone mismatch: mock-epic orchestral, tense documentary, elevator music, an abrupt stop before the punch. A music cut to silence is the cheapest beat-before.
- One narration (TTS) line at most for the setup or a deadpan announcement, 3–8 words. Place it in the setup shot; let the punch play without words.
- **Clip sound.** Clips carry their own sound effects and ambience, and social and comedy films keep clip sound by default (about −6 dB, lowered under narration). A squeak, thud or honk can carry a beat: name it in the shot's motion prompt ("the goose honks once") and in `story`. Clip sound is not frame-accurate, so never make the whole punch depend on one sound landing on an exact frame. The person can mute one clip with Film › Keep clip sound.

## What AI video does well and badly for comedy

| Reliable | Unreliable |
|---|---|
| One big held expression (shock, smug, deadpan stare) | Fast sequences of changing expressions |
| Animals and toddlers with human postures | Lip-synced dialogue; mouths moving out of time |
| Scale contrast and impossible-but-still images | Comic timing inside a clip: the model drifts, so a beat lands anywhere in 6 s |
| Reveal by camera move: slow push-in, pull-back, pan to the cause | Multi-step physical gags (trip, spin, land) in one clip |
| Simple physical end states: falls onto a cushion, slides down, freezes | Precise contact: catching, pouring onto a target, slipping on an exact object |
| Props that are large, simple and few | Text: signs, screens, labels, captions |
| Stylized cartoon physics (squash, float, inflate) | Crowds reacting in sync |

Mitigations:
- **Put the timing in the cut, not in the clip.** The edit is the only frame-accurate timing tool. Each clip delivers one state; the cut between states is the joke.
- **Keyframe the punch.** The punch shot's keyframe is the punch image itself: the goose already in the bagging area, the apartment already a jungle. Motion only reveals or holds it.
- **Expression in the keyframe, not the motion.** Generate the reaction face as the keyframe; motion prompt says "holds the stare, blinks once".
- **One action per clip**, with a clear end state that matches the next shot.
- **No readable text.** Every sign, screen and label is blank or illegible; the joke must not need a word on screen. A premise that needs a caption ("POV: …", "me at 3 a.m.") is rejected or converted to one VO line.
- Reuse identical subject wording in every keyframe prompt and condition on a character reference when one exists.

## AI and authenticity

- Instagram labels AI content ("AI info") and asks creators to disclose photorealistic synthetic video. Tell the person once that a realistic piece should be posted with the AI label.
- Mosseri has said 2026 favours raw, human-feeling content. An obviously AI, plastic look reads as "slop"; native comedy reads as phone footage or as a deliberate stylized world. Pick one and commit.
- Stylized worlds (3D, clay) are honest about being made and sidestep the uncanny valley; realistic worlds hit harder when the absurd element is the only unreal thing.

## Pitfalls specific to social

- Do not copy a living creator's recurring bit, character or catchphrase.
- Do not stage fake pranks, fake accidents or fake news that viewers could take as real. A realistic "this really happened" framing of an invented event needs the AI label and must stay obviously absurd.
- Do not use real brands, stores, apps or logos as the setting; use a generic self-checkout, a generic phone, an unbranded box.
- Do not make a challenge viewers could copy dangerously.
