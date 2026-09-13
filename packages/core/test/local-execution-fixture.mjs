import { DEFAULT_PROFILES, shotIntentDigest } from "../dist/index.js";

export const localPlanSource = `definePlan({baseRevision:"revision-1"},p=>{
  const shot=p.shot("shot-1");
  const image=p.image("image",{intent:shot,profile:"fake-image-v1",prompt:"A brown boot"});
  const review=p.humanReview("review",{shots:[{intent:shot,keyframe:image,videoProfile:"fake-video-v1",motionPrompt:"Slow push",seconds:6}]});
  const video=p.video("video",{intent:shot,profile:"fake-video-v1",firstFrame:p.approvedImage(image,review),prompt:"Slow push",seconds:6});
  const timeline=p.timeline("timeline",{takes:[video]});
  return p.render("render",{timeline,width:1280,height:720});
});`;
export function localPlanContext() {
  const shot = { id: "shot-1", revisionId: "shot-revision-1", sceneId: "scene-1", purpose: "Product", action: "Boot on a bench", framing: "Close", motion: "Slow push", desiredFrames: 180,
    imagePrompt: "A brown boot", videoPrompt: "Slow push", referenceArtifactIds: [], cueId: null, promptIntent: { image: "", video: "" } };
  shot.promptIntent = { image: shotIntentDigest(shot, "image"), video: shotIntentDigest(shot, "video") };
  return { project: { id: "project-1", revisionId: "revision-1", headVersion: 1, name: "Boots", brief: "A commercial", story: "A working day",
    scenes: [{ id: "scene-1", revisionId: "scene-revision-1", purpose: "Product" }], narration: { script: "", source: "undecided" }, maxFrames: 10800,
    capabilityLockId: "lock-1", shots: [shot], cues: [], artifacts: [], activePlanId: null }, profiles: structuredClone(DEFAULT_PROFILES),
    logicalIds: { image: "image-node", review: "review-gate", video: "video-node", timeline: "timeline-node", render: "render-node" },
    allocateId: () => { throw Error("This fixture preassigns every alias"); } };
}
