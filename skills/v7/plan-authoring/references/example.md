# Offline creative-patch example

This replaces the previous executable generation example. The [context fixture](example-context.json) contains a synthetic empty film and expected values for an offline parser/application test. It contains no usable assets, grants or provider. In a real turn read the current head and IDs instead of copying fixture values.

For a new film with no media, prepare a creative-only draft:

```json
{
  "variant": "project",
  "expectedHeadVersion": 1,
  "creative": {
    "brief": "A six-second craftsmanship study",
    "story": "Craftsmanship covers the stitching detail in one six-second shot; no narration passage is used.",
    "createScenes": [{
      "key": "craftsmanship",
      "title": "Craftsmanship",
      "purpose": "Reveal the care in the boot stitching"
    }],
    "createShots": [{
      "key": "stitching",
      "sceneId": "craftsmanship",
      "purpose": "Show the boot craftsmanship",
      "action": "The boot rests on a workshop bench",
      "framing": "Close-up",
      "motion": "Slow push toward the stitching",
      "desiredFrames": 180,
      "imagePrompt": "Brown leather boot on a workshop bench, close-up of stitching",
      "videoPrompt": "Slow camera push toward the boot stitching; the boot remains still",
      "referenceArtifactIds": [],
      "cueId": null,
      "narration": { "mode": "none", "text": "", "voice": "stock" }
    }]
  }
}
```

The regression test validates this payload with contract 6.0.0, applies the creative patch offline, and verifies the separate scene title and direction, short framing, narration choice and application-issued shot/scene link. There is no source, generation declaration or extra-take request. Preparation alone saves nothing: inspect its compact result, apply the returned preparedId and refresh context for the saved IDs.

For a close-up revision on a shot with media, use `propose_change` with coherent `framing`, `purpose`, `action` and prompt edits instead of this direct create example. Link its proposalId in a typed note; the person accepts the exact app-computed preview. Do not apply a framing change separately or combine creative writing with source.

If the person also requested keyframes in this fresh editing conversation, read the saved IDs and call `make_keyframes` only for that scope, reporting actual work and price. Otherwise the person can next use "Make keyframes" in Keyframes, reviews returned frames, motion, narration and actual video recipe, then press "Confirm frames & generate video" once. Scene confirmation saves exact narration/script/timing together; listening and recording edits are optional. Plan contains writing, Film contains clips/export and Assets contains saved media. The example supplies no visual evidence or generation authority.
