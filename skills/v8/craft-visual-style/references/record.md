# The visualStyle record

`propose_visual_style` options and `creative.project.visualStyle` take the same complete record. The application issues `revisionId`; never send it.

| Field | Content |
|---|---|
| `styleId`, `label`, `libraryVersion` | From the library table; `libraryVersion: "8.0.0"` |
| `traits.palette` | "Desaturated cool neutrals, one red accent" |
| `traits.lighting` | "Motivated practicals, soft side key, deep shadows" |
| `traits.lensFormat` | "35–50mm spherical, eye level" or "flat 2D, no lens" |
| `traits.texture` | "Fine grain, natural skin texture" |
| `traits.composition` | "Subject centred in the middle band, negative space above" |
| `traits.productionDesign` | "Lived-in, generic, unbranded" |
| `imageBlock` | The look as one keyframe sentence, at most 60 words, built from the family's image template |
| `motionBlock` | The short clip reminder, at most 20 words: medium plus frame-rate feel |
| `motion` | `cameraGrammar` (allowed moves), `frameRateFeel` (`24fps-cinematic`, `30fps-video`, `12fps-on-twos`, `8-12fps-stop-motion`, `60fps-smooth`), `motionScale` (`still`, `subtle`, `moderate`, `energetic`) |
| `negatives` | Short positive constraints ("clean blank screens", "natural skin texture"), up to 24 |
| `anchors` | `referenceArtifactIds` (style frames the film owns, separate from subject references) and `characterSheets`; both usually `[]` |
| `variationAxes` | Which of `timeOfDay`, `paletteShift`, `lightingKey`, `weather`, `treatment` scenes may vary |
| `overrides` | Optional person-approved departures per trait |
| `rationale` | One line: why this look fits this brief |

Example option for a 9:16 supermarket skit:

```json
{
  "tier": "safe",
  "fits": "A real-looking supermarket makes the one absurd element hit harder.",
  "risk": "Models drift to a glossy look and garble screen text; keep screens blank.",
  "style": {
    "styleId": "grounded-realism", "libraryVersion": "8.0.0", "label": "Grounded realism",
    "traits": {
      "palette": "Natural, slightly desaturated neutrals; true skin tones",
      "lighting": "Flat overhead fluorescent store light, soft shadows",
      "lensFormat": "28–35mm phone-like lens at eye level, moderate depth of field",
      "texture": "Fine digital noise, visible skin and fabric texture",
      "composition": "Vertical 9:16, subject centred in the middle band, top and bottom kept clear",
      "productionDesign": "Generic unbranded supermarket, blank screens and labels"
    },
    "imageBlock": "Natural slightly desaturated colour, flat overhead fluorescent light, 28mm phone-like lens at eye level, visible skin and fabric texture, generic unbranded store with blank screens.",
    "motionBlock": "Live action, 30 fps phone-video feel, natural motion.",
    "motion": { "cameraGrammar": "Locked-off or one slow push or pull; no whip pans", "frameRateFeel": "30fps-video", "motionScale": "subtle" },
    "negatives": ["natural skin texture", "blank screens and labels", "no teal-orange grade"],
    "anchors": { "referenceArtifactIds": [], "characterSheets": [] },
    "variationAxes": ["timeOfDay", "lightingKey"],
    "rationale": "Relatable everyday realism so the goose is the only unreal thing."
  }
}
```
