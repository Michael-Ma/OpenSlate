# Film-stock and period family

Photographic looks defined by a recording medium or a decade. Use the same template slots as in [realism.md](realism.md). Describe a period by its production design and its medium, never by naming a film or a director.

## noir-bw

**Traits**
- Palette: black and white, deep blacks, bright specular whites.
- Lighting: hard low-key light from one source; venetian-blind and window shadows; silhouettes; wet streets.
- Lens: 25–40mm, often wide and low; Dutch angles used sparingly.
- Texture: silver grain.
- Production design: smoke, rain and neon reflections rendered in grey.

**Image template**
> `High-contrast black-and-white frame: {subject} {action} in {setting}. One hard key from {source} carving deep shadows, slatted light across the wall, wet reflective surfaces. 35mm lens from a low angle, crisp silver grain, inky blacks.`

**Negatives**
- No colour tint, sepia, flat grey midtones or even lighting.

**Motion**
- Camera: slow dolly through shadow, a static frame with a figure moving through a pool of light, a slow tilt.
- Feel: 24 fps, measured pace, smoke drifting.

**Consistency**
- State "black and white" first in every image prompt.
- Image-to-video models can reintroduce colour. Repeat "monochrome" in the clip prompt.

**Suits**
- Mystery, crime, moody brand films, flashbacks (as a scene `treatment`).

**Failure modes**
- Video models add colour back, or lift the blacks to grey.
- Too many hard-light cues produce theatrical cartoon shadows.

## vintage-film-16mm

**Traits**
- Palette: warm, slightly faded colour; lifted blacks; a cyan or magenta shift in the shadows.
- Texture: heavy, visible grain, soft resolution, halation around highlights, light gate weave.
- Format: 4:3 or 1.66:1 crop, zoom lenses.
- Composition: intimate and casual.

**Image template**
> `16mm colour film frame: {subject} {action} in {setting}. Warm faded colour, lifted blacks, coarse organic grain, soft halation around bright areas, slightly soft focus. 4:3 framing, natural daylight.`

**Negatives**
- No digital sharpness, clean noise-free shadows, HDR or modern colour grade.

**Motion**
- Camera: handheld or a slow zoom.
- Feel: 18–24 fps film cadence, slight gate weave. Write "gentle frame jitter" and keep it light.

**Consistency**
- Keep the same grain and halation words in every prompt.
- Add grain in the edit as well: generated grain flickers between clips.

**Suits**
- Memoir, home-movie nostalgia, travel diary, indie music pieces (see [../music-video/](../music-video/)).

**Failure modes**
- Grain is generated per frame and boils or shimmers.
- Dust and scratches get overdone and look like a filter.

## vintage-film-35mm

**Traits**
- Palette: rich but gentle colour, warm skin tones, film-stock rolloff in the highlights.
- Texture: fine grain, subtle halation.
- Lens: 35–50mm, anamorphic-style oval bokeh optional, 2.39:1 or 1.85:1.

**Image template**
> `35mm motion-picture film still: {subject} {action} in {setting}. Gentle highlight rolloff, warm natural skin, fine grain, subtle halation. 40mm lens, {aspect} framing, {shot light}.`

**Negatives**
- No digital clipping, oversharpening or teal-orange grade.

**Motion**
- Camera: dolly, crane-style rise, slow pan.
- Feel: 24 fps with natural motion blur.

**Consistency**
- Fix the aspect ratio and the stock description. The stock description must not drift between "Kodak-like" and "Fuji-like" traits from shot to shot.

**Suits**
- Narrative drama, premium brand stories, romance.

**Failure modes**
- Collapses into generic "cinematic" digital.
- Letterbox bars get drawn inconsistently. Set the aspect ratio at render time rather than drawing bars.

## period-70s

**Traits**
- Palette: earthy browns, mustard, orange and olive, warm tungsten light.
- Lighting: soft, diffused, hazy daylight.
- Lens: long telephoto zooms, crash zooms.
- Production design: wood panelling, shag, wide collars, analogue tech.

**Image template**
> `1970s-era scene: {subject} {action} in {setting} with wood panelling and period props. Earthy mustard-and-brown palette, warm tungsten light, soft diffusion, visible film grain. Long-lens zoom framing.`

**Negatives**
- No modern phones, LED light or flat-screen devices.

**Motion**
- Camera: slow zoom-in, a lazy pan.
- Feel: 24 fps.

**Consistency**
- Keep a prop and wardrobe list in `traits.productionDesign`. Anachronisms creep in otherwise.

**Suits**
- Retro ads, nostalgia pieces, period fiction.

**Failure modes**
- Modern objects leak in.
- Costumes turn into parody.

## period-80s

**Traits**
- Palette: saturated magenta, cyan and electric blue, neon accents.
- Lighting: hard light, coloured gels, backlit smoke, light through blinds.
- Texture: light bloom.
- Production design: chrome, early computers, big shoulders.

**Image template**
> `1980s-era scene: {subject} {action} in {setting}. Coloured gel lighting in magenta and cyan, backlit haze, chrome and early-electronics props, light bloom on highlights, 35mm grain.`

**Negatives**
- No modern devices, no muted palette.

**Motion**
- Camera: slow push through smoke, a lateral track.
- Feel: 24 fps. Slow-motion hair and fabric suits it.

**Consistency**
- Fix two gel colours for the whole film.

**Suits**
- Synth-driven music pieces, retro tech ads, action pastiche.

**Failure modes**
- Turns into neon-cyberpunk (see [stylized-live-action.md](stylized-live-action.md)). Keep the production design analogue.

## period-90s

**Traits**
- Palette: slightly green-cast fluorescent interiors, or bright primaries.
- Lighting: on-camera flash snapshots, or film with mixed light.
- Texture: low-contrast film or early digital.
- Production design: baggy clothing, CRT screens, landlines.

**Image template**
> `1990s-era scene: {subject} {action} in {setting}. Fluorescent-tinted interior, on-camera flash look, mild film grain, CRT and landline props, casual framing.`

**Negatives**
- No smartphones, flat screens or modern logos.

**Motion**
- Camera: handheld, fisheye skate-video moves, quick whip pans used sparingly.
- Feel: 24/30 fps.

**Consistency**
- Choose either a film or an early-digital texture, and keep it.

**Suits**
- Youth culture, nostalgia ads, skate and street pieces.

**Failure modes**
- Anachronistic devices.
- Fisheye geometry warps faces.

## vhs-camcorder

**Traits**
- Palette: smeared colour, chroma bleed, crushed blacks.
- Lighting: on-camera light.
- Texture: scanlines, tracking noise, soft 480-line resolution.
- Format: 4:3, an optional date stamp (add it in post).
- Composition: amateur, auto-exposure pumping.

**Image template**
> `Home camcorder video frame from the 1990s: {subject} {action} in {setting}. Soft low resolution, colour bleeding at edges, faint scanlines, crushed shadows, harsh on-camera light, 4:3 amateur framing.`

**Negatives**
- No crisp detail, cinematic depth of field or film grain (this is tape, not film).

**Motion**
- Camera: handheld amateur moves, a sudden zoom, auto-focus hunting.
- Feel: 30 fps interlaced video.

**Consistency**
- Add tracking glitches and the date stamp in the edit, not in the generation.
- Generate clean-ish frames, then degrade them uniformly.

**Suits**
- Found footage, horror, nostalgia, parody, music-video inserts.

**Failure modes**
- Models render pristine HD with a fake scanline overlay.
- Generated text (date stamps) is garbled.
