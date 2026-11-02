# Premises and beats: from brief to a 20 s funny post

Method for generating, choosing and beat-mapping a comedy premise, plus three worked 20 s examples. Shared craft: [comedy.md](comedy.md). Social rules: [short-form-comedy.md](short-form.md). Gate before keyframes: [review-checklist.md](review-checklist.md).

## 1. Collect the fixed points

From the brief and the saved project, without asking: audience (default: general adult IG audience), language, length (default 20 s → 4 shots of 5 s, or 3 shots of 6 + 6 + 8 s), platform (default Reels 9:16), any required subject (a pet, a product, a place, the person's character), and tone limits (family-friendly by default).

## 2. Generate 8–12 premises fast

Write each as one line: **target + violation** ("Self-checkout complains about an unexpected item; the item is a goose"). Pull from several generators, at least three different mechanisms:

- **Annoyance list.** List 5 small shared frustrations of the audience (self-checkout, plant addiction, the one sock, Monday alarm, phone at 1 %, reply-all). Exaggerate one to its logical extreme.
- **What if X were Y.** A pet with a human job, an object with feelings, a toddler with a manager's seriousness.
- **Status swap.** Give power to the one who should not have it: the cat interviews the dog, the vacuum herds the family.
- **Tone mismatch.** Shoot a trivial moment as a trailer, nature documentary, heist or cooking show.
- **Scale shift.** Tiny thing doing something huge, huge thing treated as tiny.
- **Literalize a phrase.** Show an idiom happening for real, wordlessly ("the elephant in the room").
- **Misdirection.** Frame a scene that reads as one thing, then widen to reveal another.

Discard any premise that needs on-screen text, lip-synced dialogue, a real person, a real brand, or a joke at a group's expense.

## 3. Score and pick

Score each surviving premise 0–2 on each line; keep the top two and pick one. When the brief is open, offer the top two or three in the reply as lettered options (A, B, C) with one line each, recommend one, and draft the beat map for the recommended one in the same turn: it is text only and cheap to change when the person picks another. Once a scene exists you may instead record them as one scene-anchored note with an accept choice per premise. Skip the choice when the brief already fixes the joke.

| Criterion | Question |
|---|---|
| Recognition | Will the viewer think "that is me / my mum / my dog"? |
| Surprise | Is the punch impossible to guess from frame 1, yet obvious in hindsight? |
| Wordless | Does it land with sound off and no captions? |
| Send-ability | Can you name who a viewer would DM it to? |
| Feasibility | Is every beat one simple action and one held expression? Is the punch a still-readable image? |
| Fit | Does it fit 3 shots? Is there a loop back to frame 1? |
| Safety | Is the butt of the joke a situation, a flaw or an object, never a group or a real person? |

A premise that scores 0 on Surprise, Wordless or Safety is out whatever its total.

## 4. Beat-map it

1. Write the **punch image** first, as a keyframe description.
2. Write the **setup** that makes the viewer expect something else. Check it does not show the punch.
3. Write the **build**: one beat that escalates or repeats the pattern.
4. Place the **beat before**: a held look or a music cut, at the end of the build shot.
5. Write the **button**: the reaction held for 1–2 s and a final frame that cuts back to frame 1.
6. Assign beats to shots. For 20 s: 4 shots × 5 s (150 frames each), splitting the build into two escalating beats (rule of three); or 3 shots of 180, 180 and 240 frames when there is one build beat. The punch shot gets at least 150 frames.
7. Choose the sound: music mood and its change point; at most one VO line (3–8 words) in the setup.
8. Run the [review checklist](review-checklist.md).

Plan fields: scene `purpose` names the beat ("Punch: the cause is a goose"); shot `purpose` names the beat and the safe-zone composition; `imagePrompt` is the frozen state of the beat; `videoPrompt` is one action, one camera move and the end state. Style text comes from `craft-style-prompting`; the prompts below are shot content only. Every keyframe: 9:16 vertical, subject centred in the middle band, top 15 % and bottom third kept free of faces and props, right edge clear.

---

## Example A: "Unexpected item"

**Premise.** A self-checkout keeps complaining about an unexpected item in the bagging area; the item is a goose. **Mechanism:** misdirection + reveal, deadpan. **Why it is safe:** everyone has fought this machine; nobody is hurt; the goose is calm. **Send-to:** "anyone who has used a self-checkout". **Style:** `grounded-realism`, flat supermarket fluorescent light.

| # | Time | Beat | Framing | Action |
|---|---|---|---|---|
| 1 | 0–6 s | Hook / setup | Close-up | A tired man scans one banana; the machine light flashes red. Device VO. |
| 2 | 6–12 s | Build + beat before | Medium close-up | He lifts his empty bag, shows empty hands, then holds a long deadpan stare at the lens. Music stops. |
| 3 | 12–18 s | Punch + button | Medium wide | Camera pulls back: a large white goose stands on the bagging shelf beside him, staring at him. He slowly turns to look at it. |

**Narration (TTS, shot 1, device voice, flat):** "Unexpected item in the bagging area."

**Music:** bland supermarket muzak at −18 dB from 0 s; hard cut to silence at about 11.5 s; silence through the reveal.

**Keyframe prompts**
1. Close-up of a tired man in his thirties in a grey hoodie holding a single yellow banana over a generic self-checkout scanner, the scanner's indicator light glowing bright red, his eyebrows raised in mild disbelief, supermarket aisles soft in the background, blank unlit screen with no text, framed from chest up, centred.
2. Medium close-up of the same tired man in his thirties in a grey hoodie, holding an empty plastic bag upside down in one hand and showing his empty other palm, looking straight into the lens with a flat, exhausted deadpan face, red light glowing at frame edge, centred.
3. Medium-wide shot at a generic self-checkout: the same tired man in his thirties in a grey hoodie stands on the left, and on the bagging shelf to his right stands a large white domestic goose, perfectly calm, neck upright, staring at him; fluorescent supermarket light; both fully in frame, centred band.

**Motion prompts**
1. He lowers the banana and glances down at the bagging area off frame; the red light pulses; camera holds still.
2. He shakes the empty bag once, then freezes and stares into the lens; slow push-in; ends on his still face.
3. Slow pull-back revealing the goose; the man turns his head slowly toward the goose; the goose tilts its head once; ends with both staring at each other.

**Loop:** shot 3 ends on the stand-off; cut to shot 1's red light reads as "and again". **Risks:** the goose must not appear in shots 1–2 (keep framing tight); keep the screen blank.

---

## Example B: "Just one"

**Premise.** She promises herself she is buying just one plant; we cut to her flat, now a jungle. **Mechanism:** escalation in three (one → armful → jungle), deadpan. **Why it is safe:** plant people laugh at themselves; the only casualty is floor space. **Send-to:** "your plant-obsessed friend". **Style:** `grounded-realism`, warm daylight; or `stylized-3d-feature` for a softer, cartoon jungle.

| # | Time | Beat | Framing | Action |
|---|---|---|---|---|
| 1 | 0–6 s | Hook / setup | Close-up | At a plant-shop counter she holds one tiny succulent with total sincerity. VO line. |
| 2 | 6–12 s | Build + beat before | Medium | At a bus stop, arms full of large potted plants, a monstera leaf hiding most of her face; only her eyes look at the lens. |
| 3 | 12–18 s | Punch + button | Wide | Her living room is a dense jungle; she sits barely visible in an armchair, watering the same tiny succulent with a tiny watering can; a cat peers out of the leaves. |

**Narration (TTS, shot 1, her inner voice, earnest):** "Just one. I'm only getting one."

**Music:** light ukulele at −18 dB; at the cut to shot 3, switch to a lush jungle-documentary swell with birdsong (Film has one soundtrack: pick a track whose swell falls near 12 s, or set its start with `set_soundtrack` so it does).

**Keyframe prompts**
1. Close-up of a young woman in her twenties with curly dark hair and a mustard cardigan, standing at a small plant-shop counter, holding one tiny succulent in a terracotta pot up near her face with both hands, sincere solemn expression, shelves of green plants softly blurred behind, warm daylight, centred.
2. Medium shot of the same young woman with curly dark hair and a mustard cardigan standing at a city bus stop, both arms wrapped around five large potted plants, a huge monstera leaf covering her face except her eyes, which look flatly into the lens; overcast daylight; centred.
3. Wide shot of a small living room overgrown like a rainforest: plants on every surface, vines hanging from the ceiling, leaves filling the frame; in the middle, the same young woman with curly dark hair and a mustard cardigan sits deep in an armchair, nearly hidden, calmly watering a tiny succulent with a tiny brass watering can; a ginger cat peers out between leaves; warm light through leaves.

**Motion prompts**
1. She lifts the succulent slightly and nods once, solemn; slow push-in; ends on her earnest face.
2. A gust moves the leaves; her eyes blink once and stay on the lens; camera holds still.
3. Leaves sway gently; she tips the tiny watering can; the cat blinks; very slow push-in toward her; ends with her looking up at the lens, deadpan.

**Loop:** shot 3 ends on the tiny succulent and her deadpan look; cut back to shot 1's same succulent closes the circle. **Risks:** keep the plants still in her arms (no walking); repeat the wardrobe words exactly.

---

## Example C: "Head of security"

**Premise.** A tiny chihuahua guards the front door like an action hero; the threat is a single leaf; he hides behind the sleeping cat. **Mechanism:** tone mismatch (mock-epic) + role reversal. **Why it is safe:** dog owners know this dog; the dog is safe and the cat never wakes. **Send-to:** "anyone with a small brave dog". **Style:** `stylized-3d-feature` (cartoon expressions read big) or `grounded-realism` with dramatic trailer light.

| # | Time | Beat | Framing | Action |
|---|---|---|---|---|
| 1 | 0–6 s | Hook / setup | Low-angle medium | A chihuahua stands in the open doorway at dusk, chest out, wind in his fur, heroic. VO trailer line. |
| 2 | 6–12 s | Build + beat before | Medium close-up | One dry autumn leaf skids onto the doormat in front of him; his eyes go huge. Music cuts out. |
| 3 | 12–18 s | Punch + button | Medium wide | Living-room sofa: a large fluffy cat sleeps; the chihuahua peeks out from behind the cat, trembling, eyes on the lens. |

**Narration (TTS, shot 1, deep movie-trailer voice):** "Every home needs a guardian."

**Music:** epic trailer strings and drums from 0 s at −12 dB; hard stop at about 11.5 s; from 12 s a single soft, sheepish tuba note or silence.

**Keyframe prompts**
1. Low-angle medium shot of a small fawn chihuahua with a red collar standing in an open front doorway at dusk, chest puffed out, head high, ears back in the wind, golden backlight around his outline, dramatic heroic composition, centred.
2. Medium close-up of the same small fawn chihuahua with a red collar at the doorway, a single curled brown autumn leaf lying on the doormat just in front of his paws, his eyes wide open in pure shock, ears flat, low angle, dusk light, centred.
3. Medium-wide shot of a cosy living-room sofa: a large fluffy grey cat sleeps curled up in the middle; the same small fawn chihuahua with a red collar peeks out from behind the cat's back, only his head and wide eyes visible, looking into the lens; warm lamp light; centred.

**Motion prompts**
1. Wind ruffles his fur; he lifts his chin a little higher; slow push-in from low angle; ends heroic.
2. The leaf rocks slightly in the breeze; the chihuahua leans back and freezes; camera holds still; ends on his frozen wide eyes.
3. The chihuahua trembles; the cat breathes slowly and keeps sleeping; camera holds still; ends on his eyes.

**Loop:** cut from his trembling eyes back to the heroic shot 1 reads as "he will try again". **Risks:** a moving leaf is fragile; keep it nearly still and let the dog's face carry the beat; do not show distress beyond comic fright.

---

## Four-shot variant

For the 4-shot plan, split each build into two beats for a true rule of three: A: banana (red) → bag empty (red) → hands up (red) → goose; B: one plant → armful → bus full of her plants → jungle; C: hero → leaf → backing away → behind the cat. Set `desiredFrames` to 150 per shot (5 s) for 20 s, keeping the punch shot at least 150 frames so the reaction can breathe.
