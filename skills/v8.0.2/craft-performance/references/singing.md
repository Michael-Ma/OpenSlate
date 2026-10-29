# Performance: singing and lip sync

Read when a shot shows a vocalist singing or rapping. Structure and ratio come from music video.

## Purpose in the edit

Singing shots connect the voice to a face. They carry the hook, the most quoted lines and the emotional peaks. The viewer forgives almost anything except a mouth that is visibly wrong for the words. Use sung shots where the lyric matters and the face can be read; cover the rest with non-sync performance (listening, breathing, moving, looking) and other modes.

## Two kinds of sung shot

- **Sync shot.** The mouth is visible and must match a lyric range. Flag it for lip sync with the lyric range. The image-to-video model alone cannot produce correct mouth shapes for a song; plan it for the lip-sync pass owned by the application.
- **Non-sync shot.** The singer is present but the mouth does not have to match: between lines, a held note seen from behind or in silhouette, eyes closed and mouth closed, a wide where the face is small, hands on the mic stand, head turned away. These are safe to generate directly and are the glue of the edit.

Plan at least as many non-sync as sync shots. Sync shots on every line look like a karaoke video and multiply the risk.

## Coverage and shot list template

Per performance setup (one location and look), plan:

1. **Hero close-up, sync.** Head and shoulders, frontal to three-quarter, for the hook lines.
2. **Medium, sync.** Waist up, with the mic or hands visible, for verses.
3. **Wide or full figure, non-sync.** Singer in the space; establishes the setup and covers cuts.
4. **Profile or three-quarter close, non-sync.** Breath, eyes, held note, a turn of the head.
5. **Detail insert.** Hand on the mic, lips in macro only if flagged sync, earrings, hair, a hand on the chest. Non-sync unless the mouth is in frame.
6. **Moving shot, mostly non-sync.** Walk-and-sing or a slow orbit; flag sync only if the face stays large and steady.

Use 1–2 for the chorus, 2–4 for verses, 3–6 as cut points and transitions. Rappers add a low wide-angle to-camera close and a group shot with the crew behind.

## Framing and lenses

- For sync: face at least about a fifth of the frame height, mouth unobstructed (no mic covering lips, no hand, hair or hood across the mouth), frontal to three-quarter, eyes level or slightly above lens. Avoid extreme profile, heavy backlight on the face, strong motion blur and tiny faces.
- Lens language: 50–85 mm for intimate singing; 85–135 mm for long-lens emotional close-ups with soft background; 24–35 mm close and low for rap energy and to-camera attitude.
- Handheld microphone: put it below the chin or to the side in the keyframe. A mic stand in front of the mouth defeats sync; place it slightly off-axis.
- Eyeline: to camera for direct address (rap, pop hooks); slightly off-lens for ballads and narrative-linked moments.

## Camera movement

- Sync shots: locked, slow push-in, slow drift or a very slow arc. Keep the head steady in frame.
- Non-sync shots: free to orbit, track, crane or whip.
- One dominant move per shot. Time the move's arrival to the line's key word or the downbeat.
- For energy without risk, move the light or the environment (passing lights, rain, smoke) instead of the camera.

## Motion-prompt vocabulary

Write the video prompt as motion, not as a re-description of the keyframe.

- Sync: "sings with an open, relaxed jaw", "mouth forms words naturally", "slight head movement with the phrasing", "breathes in before the line", "eyes close on the held note", "camera slowly pushes in".
- Non-sync: "mouth closed, listening", "exhales and looks down", "turns her head toward camera on the beat", "tilts head back, holding a long note, seen in silhouette", "taps the mic stand", "steps forward into the light".
- Rap: "punches the words with small head nods", "hand gestures toward camera", "leans into the lens".
- Avoid in the same shot: fast camera plus sync, multiple singers syncing at once, the mouth partly hidden.

## What models get wrong and mitigations

| Problem | Mitigation |
|---|---|
| Generic chewing or talking mouth that matches no lyric | Flag sync shots for lip sync; generate non-sync shots with "mouth closed" or with the face turned away. |
| Teeth and tongue artifacts on open mouths | Keyframe the mouth closed or softly parted; let the lip-sync pass open it. |
| Face identity drift during expressive singing | Reference image of the performer on every sung shot; shorter used windows; avoid big head turns in sync shots. |
| Mic merges with the hand or face | Simple mic shape described in the keyframe; mic below chin; avoid tight grip close-ups in motion. |
| Exaggerated, theatrical expression | Ask for restrained expression: "subtle", "controlled", "eyes soft". |
| Several singers syncing in one frame | One sync face per shot; other members non-sync or soft focus. |

## Continuity

- Same performer reference, wardrobe, hair, makeup and mic per setup. Note wardrobe changes by section in `story`.
- Keep the mic hand consistent within a setup (left or right).
- Keep the light direction on the face consistent within a setup; change it only on a section change or as an escalation.
- A line sung across two shots must match head position at the cut, or cut at the breath.
