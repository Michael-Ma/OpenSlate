# Visual styles: selection guide

Draft guidance for a v8 `production` reference. It gives the Director a library of looks, describes how to propose one, and specifies how the chosen look is stored once and applied to every keyframe prompt (image model) and clip prompt (image-to-video, about 6 s).

Video-type structure (explainer, ad, short film and so on) is in [../video-types/](../video-types/). Music-video timing and performance are in [../music-video/](../music-video/). This library covers only how the film looks and moves. Where this mentions a video type, it is only a fit hint.

## Library

| Family file | Style IDs |
|---|---|
| [realism.md](realism.md) | `grounded-realism`, `documentary-handheld`, `glossy-commercial`, `fashion-editorial` |
| [film-and-period.md](film-and-period.md) | `noir-bw`, `vintage-film-16mm`, `vintage-film-35mm`, `period-70s`, `period-80s`, `period-90s`, `vhs-camcorder` |
| [stylized-live-action.md](stylized-live-action.md) | `neon-cyberpunk`, `pastel-storybook`, `dreamy-soft-focus`, `surreal-dreamcore` |
| [2d-illustrated.md](2d-illustrated.md) | `anime-2d`, `cel-flat`, `watercolor-ink`, `paper-cutout`, `pixel-art`, `comic-graphic-novel` |
| [3d-and-tactile.md](3d-and-tactile.md) | `stylized-3d-feature`, `claymation-stop-motion` |
| [motion-graphics.md](motion-graphics.md) | `minimal-motion-graphics` |

Every style entry has the same sections:
- Traits
- Image template
- Negatives
- Motion
- Consistency
- Suits
- Failure modes

Where the baked-in look lives today: [current-house-style.md](current-house-style.md). Sources: [sources.md](sources.md).

## Rules for every style

- Describe a style by its traits: palette, light, lens or medium, texture, composition and production design. Never name a living artist, a studio or a copyrighted franchise, and never write "in the style of" a person. If the person names one, turn it into traits and say so in one line.
- The keyframe carries the style. In the clip prompt, describe motion first: subject action, camera move, pace. Then add one short style reminder (medium plus frame-rate feel) and nothing more. Image-to-video models take their look from the first frame, and long appearance text in a clip prompt causes drift.
- Use at most 2–3 style descriptors per prompt. Conflicting descriptors, such as "photoreal" with "cel-shaded", average into mush.
- Write negatives as positive constraints wherever the model ignores negation, which most video models do. Write "camera holds still", not "no camera movement"; "clean flat colour", not "no gradients". Keep a literal negative list only for an image model that supports it.
- One camera move per 6 s clip. One main subject action per clip.
- Write prompts in the project's working language. Technical terms (35mm, f/2, 12 fps, cel-shaded) may stay in English.

## How the Director proposes styles

1. Read the brief, story, supplied references and the video type (from `../video-types/`). Note any hard constraints: brand colours, real product photographs (these need a photographic style), a real person's likeness, length, delivery platform.
2. Shortlist 2–3 styles from the library:
   - one that is the safest fit for the brief;
   - one that is a distinct alternative;
   - optionally, one bolder option.
   Drop any style whose failure modes collide with the brief, for example readable text with `pixel-art`, or a recognisable product with `watercolor-ink`.
3. For each style, write:
   - its name;
   - one line on why it fits;
   - one line on its main risk with current models;
   - a cost note if it needs more takes. Animation and stop-motion styles usually need more regeneration.
4. Offer the shortlist as a note with choices. Do not apply a style until the person picks one. If the person already named a look, map it to the nearest style ID plus overrides, and confirm it in one line.
5. Save the choice with a creative patch. If keyframes already exist, use `propose_change`, because the style is a media input.
6. When the person changes style mid-project, propose re-making the affected scenes. Keep earlier takes in history.

## Plan-field spec

This is a spec only. The application owns the schema, validation and compilation.

```ts
interface VisualStyle {
  styleId: string;            // library ID, e.g. "noir-bw", or "custom"
  libraryVersion: string;     // e.g. "8.0.0", which pins the style text that was used
  label: string;              // shown in Plan, e.g. "Grounded realism"
  revisionId: Id;             // app-issued; changes when any field changes
  traits: {
    palette: string;          // "desaturated warm neutrals, one red accent"
    lighting: string;         // "motivated practicals, soft side key, deep shadows"
    lensFormat: string;       // "35–50mm spherical, f/2.8, 2.39:1 crop" or "flat 2D, no lens"
    texture: string;          // "fine 35mm grain, natural skin texture"
    composition: string;      // "eye-level, off-centre subjects, negative space"
    productionDesign: string; // "lived-in, worn surfaces, period-correct props"
  };
  imageBlock: string;         // compiled style sentence for keyframes (≤ 60 words)
  motionBlock: string;        // style reminder for clips (≤ 20 words)
  motion: {
    cameraGrammar: string;    // "locked-off or slow dolly; no whip pans"
    frameRateFeel: "24fps-cinematic" | "30fps-video" | "12fps-on-twos" | "8-12fps-stop-motion" | "60fps-smooth";
    motionScale: "still" | "subtle" | "moderate" | "energetic";
  };
  negatives: string[];        // short cues; compiled positively for video models
  anchors: {
    referenceArtifactIds: Id[];  // style frames or palette boards, separate from subject references
    characterSheets: Id[];       // optional, per recurring character
  };
  variationAxes: Array<"timeOfDay" | "paletteShift" | "lightingKey" | "weather" | "treatment">;
  overrides?: Partial<VisualStyle["traits"]>; // person-approved departures from the library entry
  rationale: string;          // one line: why this style fits the brief
}

// Scene level: optional and bounded by variationAxes
interface SceneStyleVariation {
  timeOfDay?: string;         // "night", "golden hour"
  paletteShift?: string;      // "cooler, bluer"
  lightingKey?: "high" | "low";
  weather?: string;
  treatment?: string;         // "flashback: monochrome", "dream: soft halation"
}

// Shot level: rare, needs a reason
interface ShotStyleOverride { field: keyof VisualStyle["traits"]; value: string; reason: string }
```

Storage:
- `project.visualStyle`, exactly one per film.
- `scene.styleVariation`, optional.
- `shot.styleOverride`, optional and rare.

## How the application applies it

- Image prompt = shot direction (purpose, action, framing, shot light) + scene variation + `imageBlock` + negatives.
- Video prompt = shot action + camera move + pace + `motionBlock`, followed by `negatives`, written as positive constraints.
- Compile at generation time. Never write the style into `shot.imagePrompt`/`videoPrompt`, so that changing the style is one edit.
- Put `visualStyle.revisionId` and the scene variation into the shot and scene intent digests. A style change then marks keyframes stale and needs a proposal and new takes.
- Pass `anchors.referenceArtifactIds` as style references only when the model accepts them. Keep them separate from subject references, so that the model does not copy a person's identity from a style board.

## Variation between scenes

- A scene may vary only along `variationAxes`. Medium, lens family, texture and frame-rate feel stay fixed across the film. Cel animation that turns photoreal in scene 4 is a different style, not a variation.
- Allowed by default: time of day, weather, a warmer or cooler palette, high or low lighting key.
- Needs the person to choose it: a `treatment`, such as a flashback in monochrome or a dream sequence. Record the treatment as a scene variation, not a second style.
- A shot override needs a one-line reason. If more than one shot in a scene needs an override, the scene variation is the wrong one.
- In continuity review, check each keyframe against the style traits and anchors before checking neighbours. Name the drift ("grain missing", "palette went teal") and offer a remake choice. Never regenerate on your own.
