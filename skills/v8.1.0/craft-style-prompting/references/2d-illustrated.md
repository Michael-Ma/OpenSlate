# 2D and illustrated family

Drawn or printed looks. These need stronger anchors than photographic styles: generate a style frame and a character sheet first, and attach them to every keyframe. Never name a studio, a franchise or a living illustrator. Use the traits below.

Shared rules:
- Open every image prompt with the medium ("2D cel-shaded illustration", "watercolour painting").
- In clips, write "{medium} animation" plus the frame-rate feel. Image-to-video models trained mostly on live action slide toward 3D or photoreal motion unless reminded.
- Keep camera moves 2D: pan, truck, push-in (zoom), parallax layers. Avoid orbits. They force a 3D rotation the drawing cannot hold.

## anime-2d

**Traits**
- Palette: clean saturated colour, painted skies, gradient lighting on backgrounds.
- Line: crisp ink outlines on characters, two-tone cel shading (shadow plus highlight).
- Characters: large expressive eyes.
- Backgrounds: detailed painterly scenery behind flat-shaded characters.
- Composition: dramatic angles, sky-heavy wides.

**Image template**
> `2D anime-style illustration: {character description} {action} in {setting}. Crisp clean line art, two-tone cel shading, expressive eyes, detailed painted background with soft sky gradients, {time-of-day} light.`

**Negatives**
- No 3D render, photoreal skin, painterly characters, or line weight changing between shots.

**Motion**
- Camera: pans across painted backgrounds, a slow push-in, parallax between layers.
- Subject: hair and cloth in the wind, held poses with small movements.
- Feel: animated on twos (12 fps feel) for characters, smooth background pans.

**Consistency**
- Use a character turnaround sheet as reference on every shot.
- Fix eye style, hair colour and outfit in a written character line.
- Store line weight and shading in `traits.texture`.

**Suits**
- Story shorts, music pieces, youth-brand ads, game trailers.

**Failure modes**
- Faces turn semi-realistic in video.
- Motion is too smooth (60 fps interpolation), which reads as "AI anime".
- Eye and hand shapes drift.

## cel-flat

**Traits**
- Palette: limited flat fills (4–6 colours), no gradients.
- Shapes: geometric, bold or no outlines.
- Composition: graphic, readable silhouettes, generous negative space.

**Image template**
> `Flat vector-style illustration: {subject} {action} in {setting}. Solid flat colour fills in a {n}-colour palette ({colours}), simple geometric shapes, clean silhouettes, no texture, plenty of negative space.`

**Negatives**
- No gradients, 3D shading, photographic detail, or noise or texture.

**Motion**
- Camera: simple pans and push-ins.
- Subject: shape morphs, squash and stretch, pose-to-pose moves.
- Feel: on twos (12 fps) or smooth 24 fps tweening. Choose one.

**Consistency**
- Store exact colour values in `traits.palette`.
- Keep shapes simple, so the model does not invent detail.

**Suits**
- Explainers, app onboarding, corporate ads, educational content.

**Failure modes**
- Video models add shading and gradients.
- Shapes wobble and boil. For precise motion, consider [motion-graphics.md](motion-graphics.md) or post animation.

## watercolor-ink

**Traits**
- Palette: soft translucent washes, white paper showing through.
- Line: loose ink lines that vary in weight.
- Texture: pigment bleeding, granulation, paper grain, wet edges.
- Composition: vignetted, unfinished edges.

**Image template**
> `Watercolour and ink illustration: {subject} {action} in {setting}. Loose expressive ink linework, translucent colour washes bleeding at the edges, visible cold-press paper grain, white paper left unpainted around the vignette.`

**Negatives**
- No digital-clean edges, solid opaque fills or photoreal detail.

**Motion**
- Camera: slow pans, gentle push-ins.
- Subject: minimal movement, washes blooming or spreading as a transition.
- Feel: low frame rate (8–12 fps) with a boiling texture, or near-still with camera-only motion.

**Consistency**
- Fix the paper texture and the ink colour.
- Keep subject detail low. Watercolour cannot hold product accuracy.

**Suits**
- Poetry, memoir, cultural pieces, gentle brand stories, children's stories.

**Failure modes**
- Turns into digital painting.
- Texture flickers between frames.
- Faces lose identity.

## paper-cutout

**Traits**
- Palette: matte coloured paper.
- Construction: layered cut shapes with deckled or scissor-cut edges, small drop shadows between layers.
- Depth: shallow, diorama-like, sometimes visible paper fibre.

**Image template**
> `Layered paper cut-out diorama: {subject} {action} in {setting}. Matte coloured paper layers with slightly rough cut edges, soft drop shadows between layers, visible paper fibre, shallow depth like a shadow box.`

**Negatives**
- No glossy surfaces, photoreal elements or smooth digital gradients.

**Motion**
- Camera: parallax push-in through the layers, a lateral truck.
- Subject: pieces hinge and slide like puppets.
- Feel: 12 fps stepped motion.

**Consistency**
- Define the paper colours.
- Keep the number of layers similar across shots.

**Suits**
- Explainers, children's content, folk tales, craft brands.

**Failure modes**
- Characters bend like rubber instead of hinging.
- Layers merge into one flat image.

## pixel-art

**Traits**
- Resolution: low effective resolution with a visible pixel grid.
- Palette: limited (16–32 colours), with dithering.
- Edges: hard, no anti-aliasing.
- Views: side-on or three-quarter top-down game-like views.

**Image template**
> `Pixel art scene at low resolution: {subject} {action} in {setting}. Crisp hard-edged pixels, limited {n}-colour palette, ordered dithering on gradients, side-view game composition, no anti-aliasing.`

**Negatives**
- No smooth gradients, blur, photoreal detail or mixed pixel sizes.

**Motion**
- Camera: side-scrolling pans, a static screen.
- Subject: sprite-like loops (walk cycles, idle bob).
- Feel: low, stepped frame rate (8–12 fps).

**Consistency**
- Generate at a size where one pixel is large and stable.
- Keep the palette as exact values.

**Suits**
- Games, retro tech, playful ads, short loops.

**Failure modes**
- Mixed pixel sizes, and blur when video interpolation smears the pixels.
- Text breaks.
- Clips often look better if you animate the keyframe in post.

## comic-graphic-novel

**Traits**
- Line: bold inks, heavy blacks.
- Shading: halftone dots or crosshatching.
- Palette: limited flat colour, or black and white with one spot colour.
- Composition: dramatic angles and foreshortening, panel-like framing.

**Image template**
> `Graphic novel panel: {subject} {action} in {setting}. Bold black ink lines, heavy spot blacks, halftone dot shading, limited {palette} flat colours, dramatic low-angle composition.`

**Negatives**
- No speech-bubble text, photoreal render or soft painterly shading.

**Motion**
- Camera: push-in on a panel, a pan across the frame as if reading.
- Subject: limited motion, held poses with effect lines.
- Feel: on twos or threes (8–12 fps).

**Consistency**
- Fix the ink weight and the halftone scale.
- Use a character sheet.

**Suits**
- Action shorts, gaming, editorial explainers, superhero-adjacent original stories.

**Failure modes**
- Asking for a known publisher's look is not allowed. Use the traits.
- Generated lettering is unreadable. Add text in post.
