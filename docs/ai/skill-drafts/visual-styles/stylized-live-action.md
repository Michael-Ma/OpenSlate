# Stylized live-action family

Photographic rendering with a designed, non-naturalistic world. Use the same template slots as in [realism.md](realism.md).

## neon-cyberpunk

**Traits**
- Palette: deep blue and black base; magenta, cyan and acid-green neon.
- Lighting: neon signage as the key, wet reflective streets, volumetric haze.
- Lens: 24–35mm, low angle, often anamorphic-style flares.
- Production design: dense signage, cables, rain, holographic screens.

**Image template**
> `Rain-soaked night street: {subject} {action} in {setting}. Lit by magenta and cyan neon signs, reflections pooling on wet asphalt, light haze catching the beams. 28mm low angle, high contrast, dense layered signage in the background.`

**Negatives**
- No readable real brand names, no daylight, no flat lighting.

**Motion**
- Camera: slow push down a street, a crane rise past signage, an orbit around the subject.
- Feel: 24 fps. Rain and steam give ambient motion.

**Consistency**
- Fix two or three neon colours.
- Ask for invented glyph signage. Readable text breaks.

**Suits**
- Sci-fi shorts, tech launches, electronic music pieces, gaming.

**Failure modes**
- Signage text is gibberish. Ask for abstract glyphs or blurred signs.
- Everything turns purple. Keep a contrasting cool shadow.

## pastel-storybook

**Traits**
- Palette: pastel pink, mint and powder blue.
- Lighting: even and soft.
- Composition: symmetrical, centred framing; flat, front-on staging; planimetric (parallel to the background) compositions.
- Production design: miniature-like sets, tidy props, matching costumes.

**Image template**
> `Perfectly symmetrical front-on frame: {subject} {action} centred in {setting}. Pastel pink, mint and powder-blue palette, even soft light, meticulously arranged props, flat planimetric staging, wide lens at eye height.`

**Negatives**
- No handheld feel, Dutch angle, gritty texture or off-centre framing.

**Motion**
- Camera: locked-off, straight lateral tracks, a whip pan at 90° between set-ups, a straight push-in.
- Subject: deliberate, slightly deadpan.
- Feel: 24 fps.

**Consistency**
- Store the palette as named colour values.
- Keep the camera height and the centred framing rule in `traits.composition`.

**Suits**
- Whimsical ads, quirky narratives, children's content, hospitality.

**Failure modes**
- Models break symmetry in clips.
- Whip pans melt. Use cuts instead.
- Asking for this look by naming a director is not allowed. Use these traits.

## dreamy-soft-focus

**Traits**
- Palette: warm, low-contrast pastels.
- Lighting: backlight, sun flare, golden hour.
- Lens: wide aperture, diffusion-filter softness, heavy bokeh, haze.
- Texture: soft halation, gentle grain.

**Image template**
> `Hazy golden-hour frame: {subject} {action} in {setting}. Strong warm backlight wrapping the edges, soft diffusion and halation, shallow focus with creamy bokeh, low-contrast pastel tones.`

**Negatives**
- No harsh shadows, crisp edge sharpness or cold grade.

**Motion**
- Camera: slow floating drift, slow motion, a gentle rack focus.
- Feel: 24 fps, slowed.

**Consistency**
- Fix the sun direction and the diffusion strength.
- Don't stack haze, bloom and flare in every prompt. Choose two.

**Suits**
- Romance, wellness, memory sequences (as a scene `treatment`), lifestyle ads.

**Failure modes**
- Turns to mush with no readable subject.
- Faces lose identity in the haze. Keep the face in focus.

## surreal-dreamcore

**Traits**
- Palette: unsettling, saturated or washed-out pastels.
- Lighting: flat, liminal fluorescent or overcast light.
- Composition: impossible scale, empty liminal spaces (pools, corridors, fields), floating objects, a familiar thing in the wrong place.
- Texture: slightly low-fidelity.

**Image template**
> `Surreal liminal scene: {subject} {action} in {setting} where {impossible element}. Flat overcast light, washed pastel colour, empty quiet space, slight low-fidelity softness, eerily calm.`

**Negatives**
- No horror gore, crowds or busy detail.

**Motion**
- Camera: slow glide down an empty space, a static frame with one impossible motion (objects drifting up).
- Feel: 24 fps, too smooth, uncanny calm.

**Consistency**
- Define a short list of recurring impossible motifs in `traits.productionDesign`, and reuse them.

**Suits**
- Art films, music pieces (see [../music-video/](../music-video/)), fashion mood films, concept ads.

**Failure modes**
- Models normalise the impossible element. State it plainly and early.
- Too many surreal elements read as random.
