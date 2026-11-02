# Motion-graphics family

## minimal-motion-graphics

**Traits**
- Palette: two or three brand colours on a solid or subtle gradient ground.
- Shapes: geometric (circles, bars, lines) with icons.
- Composition: grid-based, large negative space.
- Lighting: none, or soft shadows only.
- Typography: added in the edit, never generated.

**Image template**
> `Minimal motion-graphics frame: {concept} shown with simple geometric shapes and icons on a {colour} background. {Brand colours} only, clean grid layout, flat shapes with subtle soft shadows, generous empty space at {side} for a title.`

**Negatives**
- No generated text or numbers, photographic elements, clutter or texture.

**Motion**
- Camera: locked, or a slow push-in.
- Elements: shapes scale, slide, rotate and morph with ease-in/ease-out timing; staggered entrances.
- Feel: smooth 30–60 fps, precise and graphic.

**Consistency**
- Store exact colour values and the corner radius or stroke weight in `traits`.
- Reuse a single style frame as reference.

**Suits**
- Data explainers, app features, title sequences, corporate updates (see [../video-types/](../video-types/)).

**Failure modes**
- Generative video models are poor at exact easing, alignment and text. Shapes wobble or melt.
- When precision matters, use keyframes as design boards and animate in the edit or render stage, not with image-to-video.
- Say this trade-off when proposing this style.
