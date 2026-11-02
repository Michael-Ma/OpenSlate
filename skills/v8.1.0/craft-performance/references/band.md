# Performance: full band

Read when two or more musicians perform together. Use with [singing](singing.md) for the vocalist and [instruments](instruments.md) for each player.

## Purpose in the edit

The band shot says "this is the group". It establishes lineup, space and energy and gives the edit a home to return to after singles and narrative. The lead singer carries most screen time; each member gets at least one featured moment, ideally on their instrument's prominent part.

## Stage plot first

Before prompts, fix a simple stage plot in `story`: who stands where, facing which way, with what instrument and handedness, and where the light comes from. Example: "Singer center front; guitarist stage left (screen right), right-handed; bassist stage right; drummer center back on a riser; key light from behind the drummer." Every keyframe follows it. Changing the plot is an escalation decision, not drift.

## Coverage and shot list template

Per setup:

1. **Band master wide.** Whole lineup, front, slightly high or low; locked or slow push. The return-to shot.
2. **Behind-the-band wide.** From behind the drummer toward the room or crowd; shapes in backlight.
3. **Singer singles.** Per [singing](singing.md); sync for the hook.
4. **Member singles.** One per member, featured on their part.
5. **Two-shots.** Singer with guitarist, bassist with drummer; one sharp, one soft.
6. **Instrument inserts.** One or two per song, short (see instruments).
7. **Crowd or audience.** Only if the setting has one; from behind or backlit.
8. **Atmosphere.** Lights, haze, amps, cables, the space without people; safe cutaways.

Chorus: 1, 3, 2 alternating. Verse: 3, 4, 5. Solos and fills: 4 and 6 for that member. Section changes: 2 or 8.

## Framing and lenses

- 18–28 mm for full-band wides in small rooms; 35 mm for stage wides from the floor; 85–135 mm singles from the front edge.
- Keep three to five people in a single keyframe. Larger lineups: split into sub-groups, or show the full group only in backlit wides.
- Sharp focus on one member per shot; others soft.

## Camera movement

- Master: locked, slow push or slow lateral track. A slow dolly across the front of the band reveals members one by one.
- Singles: follow [instruments](instruments.md) and [singing](singing.md).
- Energy shots: crane up from the floor on the chorus, push through the band toward the crowd on the final chorus.

## Motion-prompt vocabulary

"The band plays together, the singer leans into the mic", "guitarist steps forward for the solo, others behind", "all members jump on the downbeat", "lights pulse behind the band", "camera slowly tracks across the front of the stage", "the crowd raises hands in silhouette".

## What models get wrong and mitigations

| Problem | Mitigation |
|---|---|
| Members swap faces, wardrobe or instruments between shots | Per-member reference sheet (face, wardrobe, instrument); name the member and the instrument in every prompt; keep members in fixed positions. |
| Duplicated or merged members in wides | Three to five people in frame; clear spacing on the stage plot; backlight to separate shapes. |
| Instruments drift (guitar becomes bass, kit changes) | State each instrument and its color per prompt; one hero instrument sharp per shot. |
| Everyone moves at once and limbs tangle | One primary action per wide ("the singer leans in"); others steady. |
| Crowd duplication: cloned faces, repeated heads, melted hands | Crowd from behind, backlit, in haze, in soft focus; phone lights and raised hands as shapes; small crowds (front rows) for any sharp faces. |
| Text on drum heads, amps, banners becomes gibberish | No readable text in prompts; add logos in the edit only if supplied. |

## Continuity

- Stage plot, instruments, handedness and wardrobe are fixed per setup and written in `story`.
- Screen direction: if the guitarist is screen right in the master, keep them screen right in singles and two-shots unless crossing the line is intentional.
- Light state per section: same rig look within a chorus; change it as an escalation between choruses.
- When cutting from a single back to the master, keep the featured member doing the same action in both.
