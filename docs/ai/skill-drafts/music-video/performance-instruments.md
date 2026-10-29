# Performance: instruments

Read when a shot shows someone playing an instrument. Structure comes from [music video](music-video.md); bands add [full band](performance-band.md).

## Shared rules

**Purpose.** Instrument shots prove the music is being made. They feature riffs, fills, solos and the instrumental parts the vocal does not cover. Feature an instrument when it is audible and prominent in that bar; do not cut to a guitar during a piano passage.

**The accuracy problem.** Image and video models do not know how instruments are played. They draw wrong string, fret and key counts, fingers that merge or bend backward, sticks that float or multiply, bows that pass through strings, and instruments whose shape changes mid-clip. Plan around it:

- **Decide what must be accurate.** Most instrument shots only need to read as playing. Reserve hand-and-instrument close-ups for one or two moments per song, keep them short, and make the motion simple.
- **Show the player, not the mechanism.** Face, shoulders, posture and the instrument's silhouette sell performance. Use angles where the playing hand is partly hidden, soft or in motion blur.
- **Use static shapes.** Keyframe the hand in a clear position (one chord, fingers on keys, stick raised). In motion, ask for one repeated small action rather than changing positions.
- **Use light.** Backlight, silhouette, haze and shallow depth of field reduce the detail a model can get wrong.
- **Plan the cutaway.** Every risky hand shot has a planned alternative in the same section: the player's face, a wide, the singer, a narrative beat.
- **Fix the instrument.** Name make-neutral type, body shape, color, finish, and string or key count in every prompt for that instrument; use a reference image when one exists. Do not use brand names unless the person supplies them.
- **Fix handedness.** State right- or left-handed and keep it in every shot; mirrored instruments break continuity.
- **Negatives, when the model accepts them:** extra fingers, fused fingers, distorted hands, extra strings, warped neck, floating sticks, extra drumsticks, deformed drums, bow passing through strings, warped keyboard, flicker, outfit change.

**Motion prompts.** One action, one camera move, one quality. Prefer "steady", "relaxed", "repeated", "in slow motion". Avoid asking for specific notes, chords or tempo; the model cannot render them.

**Continuity.** Same instrument, strap, finish, amp or kit, and handedness across the video unless a change is an escalation. Keep the player's position in the space in `story`. Light direction stays per setup.

## Guitar and bass

- **Coverage:** player waist-up with the guitar; wide with amps; strum or pick-hand insert; headstock and face in one long-lens shot; low angle hero for solos; back or silhouette against stage light.
- **Framing and lenses:** 35–50 mm waist-up; 85–135 mm across the neck toward the face; low and wide for solos. Keep the neck diagonal and fully in frame or clearly cropped; half-visible necks warp.
- **Movement:** slow push to the face on a solo, slow arc around the player, locked on the strum hand. The player can move more than the camera: head nod, step to the mic, guitar raised on the last chord.
- **Vocabulary:** "strums steadily with the right hand, left hand holds one chord shape", "picks single notes, small wrist motion", "bends a string, face tenses", "raises the guitar neck on the final chord", "bassist plucks with two fingers, steady groove, head nods".
- **Failures and fixes:** fret hand changes shape and fingers melt → hold one chord shape or crop the fret hand out; string count varies → state "six-string" or "four-string bass" and keep strings soft; neck bends → straight neck, mid shot, little rotation; pick hand merges with strings → motion blur on the strum or a wider frame.

## Drums

- **Coverage:** wide from front showing the whole kit; behind-the-drummer wide toward the room or crowd; overhead; single on the drummer's face and shoulders; insert on one piece (snare, crash, kick pedal); slow-motion cymbal hit.
- **Framing and lenses:** 24–35 mm for kit wides and behind-kit; 85 mm on the face through the cymbals; low on the kick.
- **Movement:** locked or slow push. Let the drummer's arms provide energy; fast camera plus fast arms breaks.
- **Vocabulary:** "strikes the crash cymbal once on the downbeat, in slow motion", "steady groove, sticks rise and fall evenly", "sticks raised, then one hit on the snare", "cymbal shakes after the hit", "foot presses the kick pedal".
- **Failures and fixes:** floating or extra sticks → keyframe exactly two sticks in two hands, stick at contact or raised; strokes that never land → one hit per shot, slow motion, short window; kit morphs (drum count changes) → state the kit ("four-piece kit, one crash, one ride, hi-hat") and keep it in every prompt; fast fills become chaos → motion blur, backlight, cut to the face on the fill and to a hit on the crash after it.

## Piano and keys

- **Coverage:** profile of player and instrument; over-the-shoulder high angle on the keys (soft focus); player's face across the open lid or over a synth; wide with the instrument in the room; synth knob or pad insert; reflection in a grand's lid.
- **Framing and lenses:** 50–85 mm profile; 35 mm wide; macro only for a single hand pressing one chord. Let the keyboard run out of frame at an angle rather than showing a full frontal row.
- **Movement:** slow lateral track along the keyboard, slow push to the face, locked profile.
- **Vocabulary:** "hands move gently over the keys, slow phrasing", "presses one chord and holds", "sways slightly with the music, eyes closed", "turns a filter knob slowly", "taps a pad on the beat".
- **Failures and fixes:** wrong black-key pattern → keys in soft focus or seen from an angle; fingers fuse or bend → back of the hands from behind, slow motion, one chord; hands pass through keys → hands resting on the keys in the keyframe, small motion only; keyboard length or key count changes → crop the keys, keep the instrument in one position.

## Strings (violin, viola, cello, double bass)

- **Coverage:** three-quarter from the bow side with face; profile showing the bow across the strings; wide with the instrument in the space; scroll and face close; slow-motion bow stroke detail; ensemble wide for sections.
- **Framing and lenses:** 50–85 mm three-quarter; long lens for close bow detail at a distance; 35 mm for ensemble wides.
- **Movement:** slow push or slow arc matching long bow strokes.
- **Vocabulary:** "long slow bow stroke across the strings", "bow stays on the strings", "sways with the phrase", "left hand still, gentle vibrato", "cellist leans into the stroke".
- **Failures and fixes:** bow passes through the instrument or floats → keyframe the bow in contact, ask for long slow strokes, use profile; left hand fingers melt → keep the left hand soft or out of frame, no fast passages; chin rest and posture wrong on violin → three-quarter from the bow side; four strings become more → keep strings soft, name "four strings".

## Brass and woodwind (trumpet, trombone, saxophone, flute, clarinet)

- **Coverage:** profile or three-quarter on the player; bell toward a backlight (flare); wide with the section; keys or valves insert with fingers held; face and cheeks on a held note; slow sway with the horn raised on the climax.
- **Framing and lenses:** 50–85 mm profile; long lens into the bell for flare; 35 mm wides. Avoid frontal close-ups where the instrument covers the face and confuses the mouth.
- **Movement:** slow arc, slow push, low hero angle on a solo.
- **Vocabulary:** "plays a held note, horn raised", "sways slowly with the phrase", "fingers press the valves in a steady pattern", "breathes in, then plays", "light flares off the bell".
- **Failures and fixes:** mouth and mouthpiece merge or mouth opens → mouthpiece at the lips in the keyframe, lips sealed, no lip-sync flag; valve and key counts wrong → fingers held still or out of focus; saxophone keys become noise → body in soft focus or silhouette; slide trombone slide bends → short slide motion, profile.

## DJ and electronic

- **Coverage:** DJ waist-up behind decks with crowd or lights behind; low angle with hands raised; hands on jog wheel, fader or knob insert; wide from behind the booth toward the crowd; screen or LED wall abstract; producer at a desk with controller in a studio.
- **Framing and lenses:** 24–35 mm behind the booth; 50 mm singles; macro on a single knob.
- **Movement:** slow push on the build, hold or crane up on the drop, handheld feel only with care. Time the push to arrive at the drop.
- **Vocabulary:** "one hand turns a knob slowly", "slides a fader up as the build rises", "raises one hand on the drop", "nods to the beat, headphones on one ear", "crowd hands rise, backlit by stage lights".
- **Failures and fixes:** gear becomes unreadable clutter → a simple controller with few, large controls; screens and labels show gibberish text → no readable screens or labels, use light only; crowd faces duplicate → crowd from behind, backlit, in haze, out of focus (see [full band](performance-band.md)); hands blur into the gear → one hand on one control.
