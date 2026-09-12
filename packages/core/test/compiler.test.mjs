import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { compilePlan, compilePlanIsolated, diffPlans, effectiveNodeDigest, shotIntentDigest, PLAN_LIMITS } from "../dist/planning/index.js";
import { DEFAULT_PROFILES } from "../dist/contracts.js";

const hash = character => character.repeat(64);
function fixture() {
  const image = { artifactId: "product", sha256: hash("a"), kind: "image" };
  const audio = { artifactId: "narration", sha256: hash("b"), kind: "audio" };
  const cue = { id: "cue-a", meaning: "Leather texture", durationFrames: 180, placementFrames: 0, audio, accepted: true, measured: true };
  const shot = { id: "shot-a", revisionId: "shot-a-r1", sceneId: "scene-a", purpose: "Show the leather", action: "Boot rests on a bench", framing: "Close-up", motion: "Slow push", desiredFrames: 180, imagePrompt: "Brown boot close-up", videoPrompt: "Slow push toward the boot", referenceArtifactIds: [image.artifactId], cueId: cue.id, promptIntent: { image: "", video: "" } };
  shot.promptIntent.image = shotIntentDigest(shot, "image", cue);
  shot.promptIntent.video = shotIntentDigest(shot, "video", cue);
  const project = { id: "project", revisionId: "r1", headVersion: 1, name: "Boots", brief: "Make a commercial", story: "A boot's day", scenes: [{ id: "scene-a", revisionId: "scene-r1", purpose: "Texture" }], narration: { script: cue.meaning, source: "uploaded" }, maxFrames: 10800, capabilityLockId: "lock", shots: [shot], cues: [cue], artifacts: [image, audio], activePlanId: null };
  return { project, profiles: structuredClone(DEFAULT_PROFILES), logicalIds: {}, allocateId: randomUUID };
}
function plan(context, { image = "frame", reviewOverrides = "", videoOverrides = "", imageOverrides = "", extra = "", returnExpression = "p.render(\"preview\", { timeline: edit })" } = {}) {
  return `definePlan({ baseRevision: ${JSON.stringify(context.project.revisionId)} }, (p) => {
    const shot = p.shot("shot-a");
    const product = p.asset("product");
    const audio = p.asset("narration");
    const frame = p.image("frame", { intent: shot, profile: "fake-image-v1", references: [product], prompt: "Brown boot close-up" ${imageOverrides} });
    const review = p.humanReview("review", { shots: [{ intent: shot, keyframe: ${image}, videoProfile: "fake-video-v1", motionPrompt: "Slow push toward the boot", seconds: 6 ${reviewOverrides} }] });
    const take = p.video("take", { intent: shot, profile: "fake-video-v1", firstFrame: p.approvedImage(${image}, review), prompt: "Slow push toward the boot", seconds: 6 ${videoOverrides} });
    ${extra}
    const edit = p.timeline("edit", { takes: [take], narration: audio, cueRange: "scene-a", transition: "cut" });
    return ${returnExpression};
  });`;
}
function reject(source, context, code) {
  assert.throws(() => compilePlan(source, context), error => error.code === code, `expected ${code}`);
}

test("legacy profile arguments stay exact while explicit adapter configuration changes review and cache identity", () => {
  const context = fixture(), source = plan(context), legacy = compilePlan(source, context);
  assert.deepEqual(legacy.nodes[0].args, { profileRevision: "1", profileIdentity: "fake-image-v1", adapter: "fake",
    prompt: "Brown boot close-up", width: 1024, height: 1024, settings: {} });
  const legacyDigest = legacy.graphDigest;
  assert.equal(compilePlan(source, context).graphDigest, legacyDigest);
  const video = context.profiles.find(profile => profile.kind === "video");
  Object.assign(video, { adapter: "minimax-h3", executionVersion: "1", revision: "2026-09-12", configuration: { model: "MiniMax-H3", settings: { resolution: "768P" } } });
  const changed = compilePlan(source, context);
  assert.equal(changed.nodes[0].specDigest, legacy.nodes[0].specDigest);
  assert.notEqual(changed.nodes[1].specDigest, legacy.nodes[1].specDigest);
  assert.equal(changed.nodes[1].args.executionVersion, "1"); assert.equal(changed.nodes[1].args.profileRevision, "2026-09-12");
  assert.equal(changed.gates[0].members[0].recipeDigest, changed.nodes[1].specDigest);
  video.configuration.model = "MiniMax-H3-Max";
  assert.equal(changed.nodes[1].args.profileConfiguration.model, "MiniMax-H3");
  assert.notEqual(compilePlan(source, context).nodes[1].specDigest, changed.nodes[1].specDigest);
  const invalid = fixture(); invalid.profiles[0] = { ...invalid.profiles[0], adapter: "external" };
  reject(plan(invalid), invalid, "PROFILE_INCOMPATIBLE");
});

test("lowers a reviewed shot into typed dependency inputs and an unresolved human gate", () => {
  const context = fixture(); const result = compilePlan(plan(context), context);
  assert.deepEqual(result.nodes.map(node => node.kind), ["image", "video", "timeline", "render"]);
  const video = result.nodes[1]; const gate = result.gates[0];
  assert.equal(gate.members[0].videoNodeId, video.id);
  assert.deepEqual(gate.members[0].frameSource, { kind: "output", nodeId: result.nodes[0].id, port: "image" });
  assert.deepEqual(video.requires, [gate.id]);
  assert.equal(video.args.durationFrames, 180);
  assert.equal(result.nodes[2].inputs[0].source.port, "video");
  assert.equal(result.nodes[3].inputs[0].source.port, "timeline");
  assert.equal("approved" in gate, false);
  assert.equal(Object.keys(context.logicalIds).length, 5);
});

test("canonical source round-trips without changing IDs or normalized graph", () => {
  const context = fixture(); const result = compilePlan(plan(context), context);
  const roundtrip = compilePlan(result.canonicalSource, context);
  assert.equal(roundtrip.graphDigest, result.graphDigest);
  assert.equal(roundtrip.canonicalSource, result.canonicalSource);
  assert.deepEqual(roundtrip.nodes, result.nodes);
  assert.deepEqual(diffPlans(result, roundtrip).map(impact => impact.kind), ["reuse", "reuse", "reuse", "reuse"]);
});

test("isolated compiler returns allocated IDs and preserves them on subsequent compiles", async () => {
  const context = fixture(); const result = await compilePlanIsolated(plan(context), context);
  assert.equal(Object.keys(context.logicalIds).length, 5);
  for (const id of Object.values(context.logicalIds)) assert.match(id, /^[0-9a-f-]{36}$/);
  const repeated = await compilePlanIsolated(result.canonicalSource, context);
  assert.equal(repeated.graphDigest, result.graphDigest);
});

test("imported keyframes receive the same mandatory review binding", () => {
  const context = fixture(); const result = compilePlan(plan(context, { image: "product" }), context);
  assert.deepEqual(result.gates[0].members[0].frameSource, { kind: "artifact", artifact: context.project.artifacts[0] });
  assert.equal(result.nodes[1].inputs[0].source.artifact.sha256, hash("a"));
});

test("video admission digest resolves exact role-labelled bytes independently of IDs", () => {
  const context = fixture(); const result = compilePlan(plan(context), context); const video = result.nodes[1];
  const input = { destinationPort: "firstFrame", role: "first_frame", order: 0, sha256: hash("c") };
  const original = effectiveNodeDigest(video, [input]);
  assert.notEqual(original, effectiveNodeDigest(video, [{ ...input, sha256: hash("d") }]));
  assert.equal(original, effectiveNodeDigest({ ...video, id: "new", shotRevisionId: "new-revision", requires: ["different-gate"] }, [input]));
  assert.throws(() => effectiveNodeDigest(video, [{ ...input, role: "reference" }]), { code: "INPUT_BINDING_MISMATCH" });
  assert.throws(() => effectiveNodeDigest(video, [input, input]), { code: "INPUT_BINDING_MISMATCH" });
  assert.throws(() => effectiveNodeDigest(video, []), { code: "INPUT_BINDING_MISMATCH" });
  const imported = compilePlan(plan(context, { image: "product" }), context).nodes[1];
  assert.throws(() => effectiveNodeDigest(imported, [input]), { code: "INPUT_BINDING_MISMATCH" });
});

test("ordered reference identities participate in both recipe and resolved input digests", () => {
  const context = fixture(); const second = { artifactId: "second", kind: "image", sha256: hash("e") }; context.project.artifacts.push(second);
  const first = `definePlan({baseRevision:"r1"},p=>{const a=p.asset("product");const b=p.asset("second");return p.image("two",{profile:"fake-image-v1",prompt:"Two references",references:[a,b]});});`;
  const a = compilePlan(first, context).nodes[0]; const b = compilePlan(first.replace("references:[a,b]", "references:[b,a]"), context).nodes[0];
  assert.notEqual(a.specDigest, b.specDigest);
  const binding = (order, sha256) => ({ destinationPort: "references", role: "reference", order, sha256 });
  assert.notEqual(effectiveNodeDigest(a, [binding(0, hash("a")), binding(1, hash("e"))]), effectiveNodeDigest(b, [binding(0, hash("e")), binding(1, hash("a"))]));
});

test("cue placement and waveform replacement preserve video but invalidate assembly", () => {
  const context = fixture(); const first = compilePlan(plan(context), context);
  context.project.revisionId = "r2"; context.project.headVersion++;
  context.project.shots[0].revisionId = "shot-a-r2";
  context.project.cues[0].placementFrames = 120;
  context.project.cues[0].audio = { ...context.project.cues[0].audio, sha256: hash("d") };
  context.project.cues[0].id = "cue-b"; context.project.shots[0].cueId = "cue-b";
  const second = compilePlan(plan(context), context);
  assert.equal(first.nodes[0].specDigest, second.nodes[0].specDigest);
  assert.equal(first.nodes[1].specDigest, second.nodes[1].specDigest);
  assert.notEqual(first.nodes[2].specDigest, second.nodes[2].specDigest);
  assert.deepEqual(diffPlans(first, second).map(impact => impact.kind), ["reuse", "reuse", "replace", "replace"]);
});

test("changed narration meaning requires prompt reconfirmation", () => {
  const context = fixture(); context.project.cues[0].meaning = "Show waterproof construction";
  reject(plan(context), context, "STALE_PROMPT_INTENT");
  context.project.shots[0].promptIntent.video = shotIntentDigest(context.project.shots[0], "video", context.project.cues[0]);
  assert.doesNotThrow(() => compilePlan(plan(context), context));
});

test("shot framing changes cannot retain stale prompt provenance", () => {
  const context = fixture(); context.project.shots[0].framing = "Wide shot";
  reject(plan(context), context, "STALE_PROMPT_INTENT");
});

test("preparation compiles without accepted/measured narration; readiness is not forged", () => {
  const context = fixture(); context.project.cues[0].accepted = false; context.project.cues[0].measured = false;
  const result = compilePlan(plan(context), context);
  assert.equal(result.nodes[1].requires.length, 1);
  assert.equal(context.project.cues[0].accepted, false);
});

test("speech/transcription preparation is independent of video timing and review", () => {
  const context = fixture();
  const result = compilePlan(`definePlan({baseRevision:"r1"},p=>{
    const speech = p.speech("voice", {profile:"fake-speech-v1",text:"Leather boots",voice:"demo"});
    const transcript = p.transcription("words", {profile:"fake-transcription-v1",audio:speech,timing:"segment"});
    return [speech,transcript];
  });`, context);
  assert.deepEqual(result.nodes.map(node => node.kind), ["speech", "transcription"]);
  assert.equal(result.nodes[1].inputs[0].source.port, "audio");
  assert.deepEqual(result.gates, []);
});

test("missing approval and mismatched review settings are rejected", () => {
  const context = fixture();
  reject(plan(context).replace("firstFrame: p.approvedImage(frame, review)", "firstFrame: frame"), context, "REVIEW_REQUIRED");
  reject(plan(context, { reviewOverrides: ', settings: {seed:1}', videoOverrides: ', settings: {seed:2}' }), context, "REVIEW_SPEC_MISMATCH");
  reject(plan(context).replace('motionPrompt: "Slow push toward the boot", seconds: 6', 'motionPrompt: "Slow push toward the boot", seconds: 7'), context, "REVIEW_SPEC_MISMATCH");
});

test("review cannot approve an unseen image or use a frame for a different shot", () => {
  const context = fixture();
  reject(plan(context).replace("p.approvedImage(frame, review)", "p.approvedImage(product, review)"), context, "REVIEW_SPEC_MISMATCH");
  reject(plan(context).replace("keyframe: frame", "keyframe: audio"), context, "OUTPUT_TYPE_MISMATCH");
});

test("unknown refs/profiles, mismatched prompt and unsupported durations fail before execution", () => {
  const context = fixture();
  reject(plan(context).replace('p.asset("product")', 'p.asset("other-project-artifact")'), context, "UNKNOWN_REFERENCE");
  reject(plan(context).replace('profile: "fake-image-v1"', 'profile: "fake-video-v1"'), context, "PROFILE_INCOMPATIBLE");
  reject(plan(context).replace('prompt: "Brown boot close-up"', 'prompt: "Different concept"'), context, "STALE_PROMPT_INTENT");
  reject(plan(context).replaceAll("seconds: 6", "seconds: 3"), context, "PROFILE_INCOMPATIBLE");
  reject(plan(context).replaceAll("seconds: 6", "seconds: 6.5"), context, "PROFILE_INCOMPATIBLE");
  reject(plan(context).replace('baseRevision: "r1"', 'baseRevision: "old"'), context, "REVISION_CONFLICT");
  reject(plan(context).replace('transition: "cut"', 'transition: "crossfade"'), context, "CAPABILITY_UNSUPPORTED");
});

test("project export duration is bounded", () => {
  const context = fixture(); context.project.maxFrames = 179;
  reject(plan(context), context, "DURATION_LIMIT");
});

test("whitespace and unrelated global revisions do not change operation semantics", () => {
  const context = fixture(); const first = compilePlan(plan(context), context);
  context.project.revisionId = "r3"; context.project.headVersion += 2; context.project.name = "New display title";
  const second = compilePlan(`/* a comment */\n${plan(context)}`, context);
  assert.deepEqual(first.nodes.map(node => node.specDigest), second.nodes.map(node => node.specDigest));
  assert.equal(first.graphDigest, second.graphDigest);
});

test("a different scene's narration does not invalidate this scene's assembly", () => {
  const context = fixture(); const first = compilePlan(plan(context), context);
  context.project.scenes.push({ id: "other-scene", revisionId: "other-r1", purpose: "Another scene" });
  context.project.cues.push({ ...context.project.cues[0], id: "other-cue", meaning: "Unrelated narration", placementFrames: 900 });
  context.project.shots.push({ ...context.project.shots[0], id: "other-shot", revisionId: "other-shot-r1", sceneId: "other-scene", cueId: "other-cue" });
  const second = compilePlan(plan(context), context);
  assert.deepEqual(first.nodes.map(node => node.specDigest), second.nodes.map(node => node.specDigest));
});

test("scene revision references normalize away revision-only changes", () => {
  const context = fixture();
  const first = compilePlan(plan(context).replace('cueRange: "scene-a"', 'cueRange: "scene-a@scene-r1"'), context);
  context.project.scenes[0].revisionId = "scene-r2";
  const second = compilePlan(plan(context).replace('cueRange: "scene-a"', 'cueRange: "scene-a@scene-r2"'), context);
  assert.deepEqual(first.nodes.map(node => node.specDigest), second.nodes.map(node => node.specDigest));
});

test("new and removed logical operations have distinct impact identities", () => {
  const context = fixture(); const first = compilePlan(plan(context), context);
  const second = compilePlan(plan(context).replace('p.render("preview"', 'p.render("new-preview"'), context);
  assert.deepEqual(diffPlans(first, second).map(impact => impact.kind), ["reuse", "reuse", "reuse", "new", "retire"]);
  assert.ok(diffPlans(null, second).every(impact => impact.kind === "new"));
});

for (const expression of [
  "(()=>{globalThis.executed=true;return 'x'})()", "globalThis.process.env", "new String('x')", "p['asset']('product')", "p.asset?.('product')", "p.asset.call(null,'product')", "p.asset<string>('product')", "('x' as string)", "'x' satisfies string", "`x${1}`", "/x/", "1n", "NaN", "Infinity", "1e999", "{...{}}", "{get x(){return 1}}", "{['x']:1}", "{x:1,x:2}", "{'__proto__':{}}", "{'constructor':{}}", "[,,]", "missing", "await p.asset('product')",
]) {
  test(`rejects nested non-DSL syntax: ${expression}`, () => {
    const context = fixture(); const source = `definePlan({baseRevision:"r1"},p=>{const bad=${expression}; return p.image("i",{profile:"fake-image-v1",prompt:"ok"});});`;
    assert.throws(() => compilePlan(source, context));
    assert.equal(globalThis.executed, undefined);
  });
}

for (const body of [
  'let x=1;return p.asset("product");', 'const x:string="hello";return p.asset("product");', 'const {x}={x:1};return x;', 'if(true){return p.asset("product")}', 'while(true){}', 'for(;;){}', 'const x=()=>1;return x;', 'return p.asset("product"); const x=1;', '"use strict"; return p.asset("product");', 'const p=1;return p;', 'const x=1,x=2;return x;',
]) test(`rejects unsupported statement form: ${body}`, () => assert.throws(() => compilePlan(`definePlan({baseRevision:"r1"},p=>{${body}});`, fixture())));

test("top-level imports, multiple plans, async arrows and header evaluation are rejected", () => {
  const context = fixture();
  for (const source of [
    `import fs from 'node:fs';${plan(context)}`, `${plan(context)}${plan(context)}`,
    plan(context).replace("(p) =>", "async (p) =>"),
    plan(context).replace('{ baseRevision: "r1" }', 'getHeader()'),
    plan(context).replace('(p) =>', '(p: unknown) =>'),
  ]) assert.throws(() => compilePlan(source, context));
});

test("cycles/forward refs and alias collisions cannot enter the graph", () => {
  const context = fixture();
  reject(plan(context).replace("references: [product]", "references: [take]"), context, "UNKNOWN_REFERENCE");
  reject(plan(context).replace('p.video("take"', 'p.video("frame"'), context, "DUPLICATE_NODE");
  context.logicalIds = { frame: "same", take: "same" };
  reject(plan(context), context, "DUPLICATE_NODE");
});

test("source, AST nesting and operation limits are bounded", () => {
  const context = fixture();
  reject(" ".repeat(PLAN_LIMITS.sourceBytes + 1), context, "PLAN_LIMIT");
  reject(`definePlan({baseRevision:"r1"},p=>{const x=${"[".repeat(65)}0${"]".repeat(65)};return x;});`, context, "PLAN_LIMIT");
  const many = Array.from({length: 5001}, (_, i) => `const i${i}=p.image("i${i}",{profile:"fake-image-v1",prompt:"x"});`).join("\n");
  reject(`definePlan({baseRevision:"r1"},p=>{${many}return i5000;});`, context, "PLAN_LIMIT");
});

test("worker errors return structured diagnostics without leaking partial alias allocations", async () => {
  const context = fixture();
  await assert.rejects(compilePlanIsolated(plan(context).replace("p.render(\"preview\"", "p.unknown(\"preview\""), context), { code: "UNKNOWN_OPERATION" });
  assert.deepEqual(context.logicalIds, {});
});

test("concurrent compilers cannot silently overwrite a logical identity mapping", async () => {
  const context = fixture();
  const outcomes = await Promise.allSettled([compilePlanIsolated(plan(context), context), compilePlanIsolated(plan(context), context)]);
  assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.find(result => result.status === "rejected").reason.code, "REVISION_CONFLICT");
  assert.equal(Object.keys(context.logicalIds).length, 5);
});
