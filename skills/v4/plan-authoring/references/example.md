# Offline compiled example

This is an executable-language example, not a generation request. Its [context fixture](example-context.json) contains synthetic saved IDs, fake profiles, and placeholder artifact hashes for offline compilation only. It does not contain usable assets, human approval, grants, or a live provider. Read actual context and preserve its identities when adapting the structure.

The saved shot is six seconds (180 frames), with matching accepted fixture cue timing. Its prompts are already bound to that intent. The reference product image and narration are registered in the compile fixture; real execution must verify actual project-owned bytes.

```typescript
definePlan({ baseRevision: "10000000-0000-4000-8000-000000000002" }, (p) => {
  const shot = p.shot("10000000-0000-4000-8000-000000000004");
  const product = p.asset("10000000-0000-4000-8000-000000000005");
  const narration = p.asset("10000000-0000-4000-8000-000000000006");
  const frame = p.image("shot-1/keyframe", {
    intent: shot,
    profile: "fake-image-v1",
    prompt: "Brown leather boot on a workshop bench, close-up of stitching",
    references: [product],
    width: 1280,
    height: 720
  });
  const review = p.humanReview("shot-1/review", {
    shots: [{
      intent: shot,
      keyframe: frame,
      videoProfile: "fake-video-v1",
      motionPrompt: "Slow camera push toward the boot stitching; the boot remains still",
      seconds: 6
    }]
  });
  const take = p.video("shot-1/take", {
    intent: shot,
    profile: "fake-video-v1",
    firstFrame: p.approvedImage(frame, review),
    prompt: "Slow camera push toward the boot stitching; the boot remains still",
    seconds: 6
  });
  const edit = p.timeline("film/edit", {
    takes: [take],
    narration: narration,
    transition: "cut",
    cueRange: "10000000-0000-4000-8000-000000000003"
  });
  return p.render("film/preview", { timeline: edit, width: 1280, height: 720, format: "mp4" });
});
```

Expected compile result: four operation nodes in dependency order (`image`, `video`, `timeline`, `render`), one review gate, a `firstFrame` input with role `first_frame`, and stable logical aliases. Canonical source should compile to the same graph digest. No video is approved by this source.

For a close-up revision, update the saved shot intent and deliberately reauthor/reconfirm prompts, then prepare a replacement source with the same aliases and matching review/video settings. For an explicit same-setup additional take, retain source semantics and use the existing video node ID in the change proposal's `requestNewTakes`, backed by the human request's allowance. Do not change the alias or use the example's IDs in a real project.
