import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  canonical,
  compilePlan,
  composeScenePlan,
  composeScenePlanIsolated,
  DEFAULT_PROFILES,
  sceneVideoDurationFrames,
  shotIntentDigest,
} from "../dist/index.js";

const frame = {
  artifactId: "actual-frame",
  kind: "image",
  sha256: "a".repeat(64),
};
function context() {
  const project = {
    id: "project",
    revisionId: "revision-1",
    headVersion: 1,
    name: "Film",
    brief: "A short product film.",
    story: "",
    scenes: [
      { id: "scene", revisionId: "scene-v1", purpose: "The product" },
      { id: "other-scene", revisionId: "scene-v2", purpose: "Other scene" },
    ],
    narration: { script: "", source: "undecided" },
    maxFrames: 10800,
    capabilityLockId: "lock",
    shots: [],
    cues: [],
    artifacts: [],
    activePlanId: null,
  };
  for (let index = 0; index < 3; index++) {
    const shot = {
      id: "shot-" + index,
      revisionId: "shot-v" + index,
      sceneId: index === 2 ? "other-scene" : "scene",
      purpose: "Purpose " + index,
      action: "Show the product",
      framing: "Medium shot",
      motion: "Slow move",
      desiredFrames: 180,
      imagePrompt: "Frame " + index,
      videoPrompt: "Move " + index,
      referenceArtifactIds: [],
      cueId: null,
      narration: { mode: "none", text: "", voice: "stock" },
      promptIntent: {},
    };
    shot.promptIntent = {
      image: shotIntentDigest(shot, "image"),
      video: shotIntentDigest(shot, "video"),
    };
    project.shots.push(shot);
  }
  return {
    project,
    profiles: structuredClone(DEFAULT_PROFILES),
    logicalIds: {},
    allocateId: randomUUID,
  };
}
function fixture(videoMaximum) {
  const ctx = context(),
    declarations = [],
    reviews = [];
  if (videoMaximum !== undefined)
    ctx.profiles.find((profile) => profile.id === "fake-video-v1").maxFrames =
      videoMaximum;
  for (let index = 0; index < 3; index++)
    declarations.push(
      "const s" +
        index +
        '=p.shot("shot-' +
        index +
        '");const i' +
        index +
        '=p.image("image-' +
        index +
        '",{intent:s' +
        index +
        ',profile:"fake-image-v1",prompt:"Frame ' +
        index +
        '",width:256,height:256});',
    );
  for (let index = 0; index < 2; index++)
    reviews.push(
      "{intent:s" +
        index +
        ",keyframe:i" +
        index +
        ',videoProfile:"fake-video-v1",motionPrompt:"Move ' +
        index +
        '",seconds:6,settings:{quality:"kept"}}',
    );
  const source =
    'definePlan({baseRevision:"revision-1"},p=>{' +
    declarations.join("") +
    'const gate=p.humanReview("shared-review",{shots:[' +
    reviews.join(",") +
    "]});" +
    'const gate2=p.humanReview("other-review",{shots:[{intent:s2,keyframe:i2,videoProfile:"fake-video-v1",motionPrompt:"Move 2",seconds:6}]});' +
    'const settings={quality:"kept"};const v0=p.video("video-0",{intent:s0,profile:"fake-video-v1",firstFrame:p.approvedImage(i0,gate),prompt:"Move 0",seconds:6,settings});' +
    'const v1=p.video("video-1",{intent:s1,profile:"fake-video-v1",firstFrame:p.approvedImage(i1,gate),prompt:"Move 1",seconds:6,settings});' +
    'const v2=p.video("video-2",{intent:s2,profile:"fake-video-v1",firstFrame:p.approvedImage(i2,gate2),prompt:"Move 2",seconds:6});' +
    'const edit=p.timeline("timeline",{takes:[v0,v1,v2]});return p.render("render",{timeline:edit});});';
  return { ctx, base: compilePlan(source, ctx) };
}
function edit(ctx, patch) {
  Object.assign(ctx.project.shots[0], patch, { revisionId: "changed-shot" });
  const shot = ctx.project.shots[0];
  shot.promptIntent = {
    image: shotIntentDigest(shot, "image"),
    video: shotIntentDigest(shot, "video"),
  };
  ctx.project.revisionId = "revision-2";
  ctx.project.headVersion++;
}
const node = (plan, alias) => plan.nodes.find((node) => node.alias === alias);
const videoRequest = (base) => ({
  shotId: "shot-0",
  kind: "video",
  profileId: "fake-video-v1",
  nodeId: node(base, "video-0").id,
  frameNodeId: node(base, "image-0").id,
  frame,
});

test("an edited video reuses its gate identity, updates one member and keeps other scenes and settings exact", () => {
  const { ctx, base } = fixture(),
    saved = canonical(base);
  edit(ctx, {
    motion: "Gentle pullback",
    videoPrompt: "New pullback",
    desiredFrames: 165,
  });
  const result = composeScenePlan(base, [videoRequest(base)], ctx),
    changed = node(result, "video-0");
  assert.equal(changed.id, node(base, "video-0").id);
  assert.equal(changed.args.prompt, "New pullback");
  assert.equal(changed.args.durationFrames, 180);
  assert.deepEqual(changed.args.settings, { quality: "kept" });
  assert.deepEqual(changed.requires, node(base, "video-0").requires);
  assert.equal(result.gates.length, base.gates.length);
  assert.equal(result.gates[0].id, base.gates[0].id);
  assert.deepEqual(result.gates[0].members[1], base.gates[0].members[1]);
  assert.deepEqual(result.gates[1], base.gates[1]);
  for (const alias of ["image-1", "video-1", "image-2", "video-2"])
    assert.deepEqual(node(result, alias), node(base, alias));
  assert.equal(
    node(result, "image-0").specDigest,
    node(base, "image-0").specDigest,
  );
  assert.equal(canonical(base), saved);
  assert.doesNotThrow(
    () => compilePlan(result.canonicalSource, ctx),
    "No obsolete unused review gate survives the edit",
  );
});

test("video duration covers fractional planned frames and model minimums, retaining compatible old duration", () => {
  assert.equal(
    sceneVideoDurationFrames(
      { desiredFrames: 165 },
      { minFrames: 1, maxFrames: 300 },
    ),
    180,
  );
  assert.equal(
    sceneVideoDurationFrames(
      { desiredFrames: 90 },
      { minFrames: 180, maxFrames: 180 },
    ),
    180,
  );
  assert.equal(
    sceneVideoDurationFrames(
      { desiredFrames: 165 },
      { minFrames: 90, maxFrames: 300 },
      { args: { durationFrames: 240 } },
    ),
    240,
  );
  assert.throws(
    () =>
      sceneVideoDurationFrames(
        { desiredFrames: 181 },
        { minFrames: 180, maxFrames: 180 },
      ),
    { code: "PROFILE_INCOMPATIBLE" },
  );
});

test("keyframe edits retain an unsupported deferred video recipe while actual video requests still fail", () => {
  const { ctx, base } = fixture(180);
  edit(ctx, {
    desiredFrames: 240,
    imagePrompt: "Frame for the longer shot",
    videoPrompt: "Move through the longer shot",
  });
  const beforeProject = canonical(ctx.project);
  const result = composeScenePlan(
    base,
    [
      {
        shotId: "shot-0",
        kind: "image",
        profileId: "fake-image-v1",
        nodeId: node(base, "image-0").id,
      },
    ],
    ctx,
  );
  assert.equal(
    node(result, "image-0").args.prompt,
    "Frame for the longer shot",
  );
  assert.equal(node(result, "video-0").args.durationFrames, 180);
  assert.equal(
    node(result, "video-0").args.prompt,
    "Move through the longer shot",
  );
  assert.notEqual(
    node(result, "video-0").specDigest,
    node(base, "video-0").specDigest,
  );
  assert.equal(canonical(ctx.project), beforeProject);
  assert.deepEqual(node(result, "video-1"), node(base, "video-1"));
  assert.deepEqual(result.gates[0].members[1], base.gates[0].members[1]);
  assert.doesNotThrow(
    () => compilePlan(result.canonicalSource, ctx),
    "The saved deferred plan remains compilable for model changes",
  );
  assert.throws(() => composeScenePlan(result, [videoRequest(result)], ctx), {
    code: "PROFILE_INCOMPATIBLE",
  });
  assert.throws(
    () =>
      sceneVideoDurationFrames(
        ctx.project.shots[0],
        ctx.profiles.find((profile) => profile.id === "fake-video-v1"),
        node(result, "video-0"),
      ),
    { code: "PROFILE_INCOMPATIBLE" },
  );
});

test("a model change updates the matching shared-gate member and clears old per-operation settings", () => {
  const { ctx, base } = fixture();
  ctx.profiles.push({
    ...structuredClone(
      ctx.profiles.find((profile) => profile.id === "fake-video-v1"),
    ),
    id: "another-video",
    minFrames: 240,
    maxFrames: 300,
  });
  const result = composeScenePlan(
      base,
      [{ ...videoRequest(base), profileId: "another-video" }],
      ctx,
    ),
    changed = node(result, "video-0");
  assert.equal(changed.profileId, "another-video");
  assert.equal(changed.args.durationFrames, 240);
  assert.deepEqual(changed.args.settings, {});
  assert.deepEqual(result.gates[0].members[1], base.gates[0].members[1]);
  assert.deepEqual(node(result, "video-1"), node(base, "video-1"));
});

test("editing an existing keyframe invalidates only its same-shot video and keeps unrelated media exact", () => {
  const { ctx, base } = fixture();
  edit(ctx, {
    framing: "Low close-up",
    imagePrompt: "New close-up frame",
    videoPrompt: "New close-up move",
  });
  const result = composeScenePlan(
    base,
    [
      {
        shotId: "shot-0",
        kind: "image",
        profileId: "fake-image-v1",
        nodeId: node(base, "image-0").id,
      },
    ],
    ctx,
  );
  assert.equal(node(result, "image-0").id, node(base, "image-0").id);
  assert.equal(node(result, "image-0").args.width, 256);
  assert.notEqual(
    node(result, "video-0").specDigest,
    node(base, "video-0").specDigest,
  );
  assert.equal(node(result, "video-0").args.prompt, "New close-up move");
  for (const alias of ["image-1", "video-1", "image-2", "video-2"])
    assert.deepEqual(node(result, alias), node(base, alias));
  assert.deepEqual(result.gates[0].members[1], base.gates[0].members[1]);
  assert.equal(result.gates.length, base.gates.length);
});

test("an inline saved image is lifted once with collision-free names when adding its first video", () => {
  const ctx = context(),
    base = compilePlan(
      'definePlan({baseRevision:"revision-1"},p=>{const __scene_frame_2="reserved";return p.image("inline-image",{intent:p.shot("shot-0"),profile:"fake-image-v1",prompt:"Frame 0",width:256,height:256});});',
      ctx,
    );
  const result = composeScenePlan(
    base,
    [
      {
        shotId: "shot-0",
        kind: "video",
        profileId: "fake-video-v1",
        frameNodeId: node(base, "inline-image").id,
        frame,
      },
    ],
    ctx,
  );
  assert.equal(result.nodes.filter((node) => node.kind === "image").length, 1);
  assert.equal(result.nodes.filter((node) => node.kind === "video").length, 1);
  assert.deepEqual(node(result, "inline-image"), node(base, "inline-image"));
  assert.equal(result.gates.length, 1);
  assert.match(result.canonicalSource, /const __scene_frame_3 =/);
});

for (const conditioning of ["owned", "shared"]) {
  test(`a new shot keyframe replaces ${conditioning} conditioning in its exact video and review member while preserving siblings`, async () => {
    const ctx = context();
    ctx.project.artifacts.push(frame);
    const shared =
      conditioning === "owned"
        ? 'const f=p.asset("actual-frame");'
        : 'const f=p.image("shared-frame",{profile:"fake-image-v1",prompt:"One shared reference frame",width:256,height:256});';
    const source =
      'definePlan({baseRevision:"revision-1"},p=>{' +
      shared +
      'const s0=p.shot("shot-0");const s1=p.shot("shot-1");' +
      'const gate=p.humanReview("shared-review",{shots:[' +
      '{intent:s0,keyframe:f,videoProfile:"fake-video-v1",motionPrompt:"Move 0",seconds:6},' +
      '{intent:s1,keyframe:f,videoProfile:"fake-video-v1",motionPrompt:"Move 1",seconds:6}]});' +
      'const v0=p.video("video-0",{intent:s0,profile:"fake-video-v1",firstFrame:p.approvedImage(f,gate),prompt:"Move 0",seconds:6});' +
      'const v1=p.video("video-1",{intent:s1,profile:"fake-video-v1",firstFrame:p.approvedImage(f,gate),prompt:"Move 1",seconds:6});return [v0,v1];});';
    const base = compilePlan(source, ctx),
      saved = canonical(base);
    const result = await composeScenePlanIsolated(
      base,
      [{ shotId: "shot-0", kind: "image", profileId: "fake-image-v1" }],
      ctx,
    );
    const generated = result.nodes.find(
        (item) => item.kind === "image" && item.shotId === "shot-0",
      ),
      video = node(result, "video-0"),
      firstFrame = video.inputs.find((input) => input.role === "first_frame");
    assert.ok(generated);
    assert.equal(firstFrame.source.kind, "output");
    assert.equal(firstFrame.source.nodeId, generated.id);
    assert.notEqual(video.specDigest, node(base, "video-0").specDigest);
    assert.equal(result.gates[0].members[0].frameSource.nodeId, generated.id);
    assert.deepEqual(node(result, "video-1"), node(base, "video-1"));
    assert.deepEqual(result.gates[0].members[1], base.gates[0].members[1]);
    if (conditioning === "shared")
      assert.deepEqual(
        node(result, "shared-frame"),
        node(base, "shared-frame"),
      );
    assert.equal(canonical(base), saved);
  });
}

test("a new owned reference changes the selected image branch without making the old source unverifiable", () => {
  const { ctx, base } = fixture();
  ctx.project.artifacts.push({
    artifactId: "new-reference",
    kind: "image",
    sha256: "c".repeat(64),
  });
  edit(ctx, {
    referenceArtifactIds: ["new-reference"],
    imagePrompt: "Use the new supplied reference",
    videoPrompt: "Keep the supplied subject",
  });
  const result = composeScenePlan(
    base,
    [
      {
        shotId: "shot-0",
        kind: "image",
        profileId: "fake-image-v1",
        nodeId: node(base, "image-0").id,
      },
    ],
    ctx,
  );
  assert.equal(
    node(result, "image-0").inputs[0].source.artifact.artifactId,
    "new-reference",
  );
  for (const alias of ["image-1", "video-1", "image-2", "video-2"])
    assert.deepEqual(node(result, alias), node(base, alias));
  assert.deepEqual(result.gates[0].members[1], base.gates[0].members[1]);
});

test("pure and isolated transformations agree and reconstruct retained IDs without mutating project data", async () => {
  const { ctx, base } = fixture();
  edit(ctx, { motion: "New move", videoPrompt: "Updated move" });
  const oldProject = canonical(ctx.project),
    request = [videoRequest(base)],
    pureContext = {
      ...structuredClone({
        project: ctx.project,
        profiles: ctx.profiles,
        logicalIds: ctx.logicalIds,
      }),
      allocateId: randomUUID,
    };
  const pure = composeScenePlan(base, request, pureContext);
  ctx.logicalIds = {};
  const isolated = await composeScenePlanIsolated(base, request, ctx);
  assert.deepEqual(isolated, pure);
  assert.equal(canonical(ctx.project), oldProject);
  for (const saved of [...base.nodes, ...base.gates])
    assert.equal(ctx.logicalIds[saved.alias], saved.id);
});

test("bad aliases, forged cache, wrong target and unrelated edits fail without publishing identities", async () => {
  for (const mutate of [
    ({ base }) => {
      base.graphDigest = "b".repeat(64);
    },
    ({ base }) => {
      base.nodes.find((node) => node.alias === "video-1").args.prompt =
        "forged";
    },
    ({ ctx, base }) => {
      ctx.logicalIds["video-0"] = "another-id";
    },
    ({ request }) => {
      request.nodeId = "missing";
    },
    ({ request }) => {
      request.frameNodeId = "missing";
    },
    ({ ctx }) => {
      ctx.project.shots[2].framing = "Unrelated changed intent";
    },
  ]) {
    const f = fixture(),
      request = videoRequest(f.base);
    mutate({ ...f, request });
    const before = canonical(f.ctx.logicalIds);
    assert.throws(() => composeScenePlan(f.base, [request], f.ctx));
    assert.equal(canonical(f.ctx.logicalIds), before);
    await assert.rejects(composeScenePlanIsolated(f.base, [request], f.ctx));
    assert.equal(canonical(f.ctx.logicalIds), before);
  }
});

test("a changed or replaced caller identity map cannot receive a partial isolated result", async () => {
  for (const replace of [false, true]) {
    const ctx = context(),
      original = ctx.logicalIds,
      request = [
        { shotId: "shot-0", kind: "image", profileId: "fake-image-v1" },
      ];
    const pending = composeScenePlanIsolated(null, request, ctx);
    if (replace) ctx.logicalIds = {};
    else original.concurrent = "another-id";
    await assert.rejects(pending, { code: "REVISION_CONFLICT" });
    assert.equal(Object.hasOwn(original, "shot-shot-0/keyframe"), false);
  }
});
