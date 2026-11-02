# Realism family

Photographic looks. Choose one of these when the film shows real products, real places or a real person's supplied photographs. Selection rules and the saved look are in craft-visual-style.

Template slots: `{subject}`, `{action}`, `{setting}`, `{framing}`, `{shot light}`.

## grounded-realism

The usual default when the brief says nothing about look and the person accepts it.

**Traits**
- Palette: natural, slightly desaturated neutrals. Skin tones stay true. Allow one motivated warm or cool accent.
- Lighting: motivated sources only (window, practical lamps, overheads), soft side key, shadows allowed to fall off.
- Lens: 35–50mm spherical lens, moderate depth of field, eye-level camera.
- Texture: fine grain, visible pores, fabric folds, wear on walls and floors.
- Production design: lived-in, specific, slightly untidy.

**Image template**
> `{framing} of {subject} {action} in {setting}. Light from {practical source} falls from the side; shadows stay soft and deep. Natural skin tones, visible skin and fabric texture, worn surfaces. 35mm lens at eye level, moderate depth of field, fine film grain.`

**Negatives**
- No teal-orange grade, heavy haze, bloom or beauty smoothing.
- No plastic skin, HDR halos or symmetrical studio lighting.

**Motion**
- Camera: slow dolly, gentle push-in or handheld-steady. One move per clip.
- Feel: 24 fps cinematic, natural motion blur, subtle subject motion (breathing, glances, hands).

**Consistency**
- Fix the palette and the key light direction per scene in `styleVariation`.
- Reuse the same lens phrase in every prompt.
- Keep a style frame for each location and a character sheet for each person.

**Suits**
- Drama, narrative short, brand story, testimonial re-creation, explainer with people.

**Failure modes**
- Models drift back to the glossy "AI look": smoothed skin, teal-orange grade, a glow on every edge. Restate texture positively.
- Hands and text break in close-ups.
- Image-to-video adds unmotivated light flicker and face morphing in fast moves. Keep moves slow.

## documentary-handheld

**Traits**
- Palette: available-light colour, mixed colour temperatures left uncorrected.
- Lighting: whatever exists in the location; slight under- or over-exposure is fine.
- Lens: 24–35mm, deep focus, shot from shoulder height. Zooms can be imperfect.
- Texture: digital noise in the shadows, an occasional focus miss.
- Composition: observational, subjects off-centre, foreground obstructions.

**Image template**
> `Observational documentary frame: {subject} {action} in {setting}, caught mid-moment. Available light only, mixed colour temperatures, slight noise in the shadows. 28mm lens at shoulder height, deep focus, partly blocked foreground, imperfect framing.`

**Negatives**
- No posed subjects, studio lighting, perfect symmetry or cinematic colour grade.

**Motion**
- Camera: handheld with natural sway, small reframes and an occasional slow zoom-in. Write "slight handheld drift", never "shaky", which models exaggerate.
- Feel: 25/30 fps video, real-time pace.

**Consistency**
- Keep one camera height and one lens family.
- Keep mixed-light colours consistent per location.
- Avoid a grade in one scene that other scenes lack.

**Suits**
- Social-impact films, behind-the-scenes, testimonials, travel, founder stories.

**Failure modes**
- "Handheld" produces nausea-level shake or jelly warping. Ask for subtle drift.
- Subjects look staged and stare into the lens. Specify "unaware of camera".

## glossy-commercial

**Traits**
- Palette: clean, saturated brand colours on neutral or gradient backgrounds.
- Lighting: large soft key, rim light, controlled specular highlights, product hero light.
- Lens: 85–100mm macro or tabletop lens, shallow depth of field.
- Texture: immaculate surfaces, droplets, crisp reflections.
- Composition: centred hero, generous negative space for type.

**Image template**
> `Studio product shot of {product} on {surface/background}. Large soft key from {side}, crisp rim light tracing the edges, controlled reflections. 100mm macro, shallow depth of field, immaculate surfaces, {brand colours} accents, negative space at {side} for text.`

**Negatives**
- No warped logos, invented labels, dust, clutter or harsh clipped highlights.

**Motion**
- Camera: slow orbit, a slider move across the product, a push-in to a detail, or a turntable rotation.
- Feel: smooth 30–60 fps feel, motion-control precision. Liquid splashes and reveals in slow motion.

**Consistency**
- Always attach the real product photo as a subject reference.
- Lock the background colour and the light direction across the film.
- Never let the model redraw labels. Plan for text in post.

**Suits**
- Product ads, launches, e-commerce loops, app or device showcases.

**Failure modes**
- Logos and label text get garbled.
- Product geometry changes during an orbit. Keep orbits under 45°, or use first and last frames.
- Over-glossy CG plastic look. Ask for real material texture.

## fashion-editorial

**Traits**
- Palette: bold, curated, often monochrome sets or one strong complementary pair.
- Lighting: hard flash or a beauty dish, graphic shadows, or daylight on a seamless backdrop.
- Lens: 50–85mm, posed full-length or three-quarter framing, low angles.
- Texture: high-fidelity fabric, deliberate styling.
- Composition: graphic, poses with strong negative space.

**Image template**
> `Editorial fashion photograph: {model description} wearing {garment}, {pose}, against {seamless/location}. Hard direct flash casting a crisp shadow, {palette} colour story. 85mm lens, slightly low angle, full-length, fabric texture rendered precisely.`

**Negatives**
- No candid snapshot feel, cluttered background, distorted limbs or extra fingers.

**Motion**
- Camera: locked-off with a slow push-in, or a slow lateral track past the model.
- Subject: deliberate pose-to-pose shifts, a fabric swish, a turn. Slow motion suits fabric.

**Consistency**
- Use a wardrobe reference for each look.
- Fix the backdrop and the flash direction.
- Describe the same model the same way every time, and use a character sheet.

**Suits**
- Fashion and beauty ads, lookbooks, brand mood films.

**Failure modes**
- Anatomy breaks in dynamic poses.
- Garments change between shots unless a reference is attached.
- Hard flash gets softened into generic beauty light. Restate "crisp shadow".
