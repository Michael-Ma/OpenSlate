import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import { compilePlan, compilePlanIsolated, diffPlans, effectiveNodeDigest,
  snapshotCompileTranscriptionInputs, snapshotTranscriptionInputs, TRANSCRIPTION_INPUT_LIMITS } from "../dist/planning/index.js";
import { digest } from "../dist/common.js";
import { localPlanContext, localPlanSource } from "./local-execution-fixture.mjs";

const hash = letter => letter.repeat(64);
const binding = (overrides = {}) => ({ id: "draft-binding", digest: hash("a"), consumerAlias: "words",
  artifact: { artifactId: "draft-audio", sha256: hash("b"), kind: "audio" }, ...overrides });
function context(inputs = [binding()]) {
  const result = localPlanContext();
  result.logicalIds.words = "words-node";
  result.project.artifacts.push({ artifactId: "supplied-video", sha256: hash("c"), kind: "video" });
  return { ...result, transcriptionInputs: inputs };
}
const wrap = body => `definePlan({baseRevision:"revision-1"},p=>{${body}});`;
const source = (id = "draft-binding", alias = "words") => wrap(`return p.transcription(${JSON.stringify(alias)},
  {profile:"fake-transcription-v1",audio:p.transcriptionInput(${JSON.stringify(id)}),timing:"word"});`);
const resolved = node => node.inputs.map(({ destinationPort, role, order, source }) => ({ destinationPort, role, order, sha256: source.artifact.sha256 }));
const rejected = value => assert.throws(() => snapshotTranscriptionInputs(value), { code: "TRANSCRIPTION_INPUT_INVALID" });

test("owned input lowers only into its exact transcription with a separate immutable application link", () => {
  const original = context(), before = structuredClone(original.project), inputsBefore = structuredClone(original.transcriptionInputs);
  const plan = compilePlan(source(), original), node = plan.nodes[0];
  assert.equal(node.kind, "transcription");
  assert.deepEqual(node.applicationInput, { kind: "owned_transcription", id: "draft-binding", digest: hash("a") });
  assert.deepEqual(node.inputs, [{ destinationPort: "audio", role: "audio", order: 0, source: { kind: "artifact", artifact: inputsBefore[0].artifact } }]);
  assert.deepEqual(node.args, { profileRevision: "1", profileIdentity: "fake-transcription-v1", adapter: "fake", language: "auto", timing: "word", settings: {} });
  assert.ok(Object.isFrozen(node.applicationInput));
  assert.throws(() => { node.applicationInput.digest = hash("f"); }, TypeError);
  assert.deepEqual(original.project, before);
  assert.deepEqual(original.transcriptionInputs, inputsBefore);
  assert.equal(original.project.artifacts.some(item => item.artifactId === "draft-audio"), false);
  assert.equal(plan.gates.length, 0); // Pure compilation is neither source verification nor human approval.
});

test("ordinary project asset access stays canonical even when the trusted catalog contains that audio", () => {
  assert.throws(() => compilePlan(source().replace('p.transcriptionInput("draft-binding")', 'p.asset("draft-audio")'), context()), { code: "UNKNOWN_REFERENCE" });
  assert.throws(() => compilePlan(source(), { ...context(), transcriptionInputs: [] }), { code: "UNKNOWN_REFERENCE" });
  const omitted = context(); delete omitted.transcriptionInputs;
  assert.throws(() => compilePlan(source(), omitted), { code: "UNKNOWN_REFERENCE" });
});

test("a catalog entry belongs to one exact consumer even through an ordinary symbol alias", () => {
  const body = wrap('const owned=p.transcriptionInput("draft-binding");const alias=owned;return p.transcription("other",{profile:"fake-transcription-v1",audio:alias});');
  assert.throws(() => compilePlan(body, context()), { code: "TRANSCRIPTION_INPUT_CONSUMER" });
  const exact = body.replace('"other"', '"words"');
  assert.equal(compilePlan(exact, context()).nodes[0].applicationInput.id, "draft-binding");
});

test("planning syntax cannot supply its own catalog, application link or artifact descriptor", () => {
  for (const text of [
    source().replace('timing:"word"', 'timing:"word",applicationInput:{kind:"owned_transcription",id:"forged",digest:"x"}'),
    source().replace('baseRevision:"revision-1"', 'baseRevision:"revision-1",transcriptionInputs:[]'),
    source().replace('p.transcriptionInput("draft-binding")', 'p.transcriptionInput("draft-binding",{artifactId:"forged"})'),
    source().replace('p.transcriptionInput("draft-binding")', '{artifactId:"draft-audio",kind:"audio"}'),
  ]) assert.throws(() => compilePlan(text, context()));
});

for (const [label, body, code] of [
  ["timeline narration", 'return p.timeline("edit",{takes:[p.asset("supplied-video")],narration:owned});', "OUTPUT_TYPE_MISMATCH"],
  ["timeline takes", 'return p.timeline("edit",{takes:[owned]});', "OUTPUT_TYPE_MISMATCH"],
  ["image references", 'return p.image("frame",{profile:"fake-image-v1",prompt:"Boot",references:[owned]});', "OUTPUT_TYPE_MISMATCH"],
  ["approved image", 'return p.approvedImage(owned,owned);', "OUTPUT_TYPE_MISMATCH"],
  ["render timeline", 'return p.render("render",{timeline:owned});', "OUTPUT_TYPE_MISMATCH"],
  ["nested settings", 'return p.speech("voice",{profile:"fake-speech-v1",voice:"demo",text:"Boot",settings:{wrapped:[owned]}});', "VALIDATION_ERROR"],
  ["object container", 'return p.transcription("words",{profile:"fake-transcription-v1",audio:{audio:owned}});', "OUTPUT_TYPE_MISMATCH"],
  ["array container", 'return p.transcription("words",{profile:"fake-transcription-v1",audio:[owned]});', "OUTPUT_TYPE_MISMATCH"],
  ["member extraction", 'const container={audio:owned};return p.transcription("words",{profile:"fake-transcription-v1",audio:container.audio});', "SYNTAX_NOT_ALLOWED"],
  ["return raw input", 'return owned;', "VALIDATION_ERROR"],
]) test(`owned input cannot escape through ${label}`, () => {
  assert.throws(() => compilePlan(wrap(`const owned=p.transcriptionInput("draft-binding");${body}`), context()), { code });
});

test("owned input cannot enter first-frame review, video or transcription-output narration", () => {
  const declarations = 'const owned=p.transcriptionInput("draft-binding");';
  const videoPlan = localPlanSource.replace('const shot=', `${declarations}const shot=`);
  assert.throws(() => compilePlan(videoPlan.replace("keyframe:image", "keyframe:owned"), context()), { code: "OUTPUT_TYPE_MISMATCH" });
  assert.throws(() => compilePlan(videoPlan.replace("firstFrame:p.approvedImage(image,review)", "firstFrame:owned"), context()), { code: "REVIEW_REQUIRED" });
  const output = wrap('const words=p.transcription("words",{profile:"fake-transcription-v1",audio:p.transcriptionInput("draft-binding")});return p.timeline("edit",{takes:[p.asset("supplied-video")],narration:words});');
  assert.throws(() => compilePlan(output, context()), { code: "OUTPUT_TYPE_MISMATCH" });
});

test("binding identity participates in symbolic, effective and graph identity even for identical audio bytes", () => {
  const first = compilePlan(source(), context()), node = first.nodes[0], effective = effectiveNodeDigest(node, resolved(node));
  for (const changed of [binding({ digest: hash("d") }), binding({ id: "replacement-binding" })]) {
    const next = compilePlan(source(changed.id), context([changed])), nextNode = next.nodes[0];
    assert.deepEqual(nextNode.inputs, node.inputs);
    assert.notEqual(nextNode.specDigest, node.specDigest);
    assert.notEqual(effectiveNodeDigest(nextNode, resolved(nextNode)), effective);
    assert.notEqual(next.graphDigest, first.graphDigest);
    assert.deepEqual(diffPlans(first, next).map(item => item.kind), ["replace"]);
  }
  const canonical = context(); canonical.project.artifacts.push(binding().artifact);
  const ordinary = compilePlan(source().replace('p.transcriptionInput("draft-binding")', 'p.asset("draft-audio")'), canonical).nodes[0];
  assert.deepEqual(ordinary.args, node.args); assert.deepEqual(ordinary.inputs, node.inputs);
  assert.equal(Object.hasOwn(ordinary, "applicationInput"), false);
  assert.notEqual(ordinary.specDigest, node.specDigest);
  assert.notEqual(effectiveNodeDigest(ordinary, resolved(ordinary)), effective);
});

test("canonical printing retains the opaque helper and recompiles with the same exact catalog", () => {
  const original = context(), plan = compilePlan(source(), original), repeated = compilePlan(plan.canonicalSource, original);
  assert.equal(repeated.canonicalSource, plan.canonicalSource);
  assert.deepEqual(repeated.nodes, plan.nodes); assert.equal(repeated.graphDigest, plan.graphDigest);
  assert.match(plan.canonicalSource, /p\.transcriptionInput\("draft-binding"\)/);
  assert.equal(plan.canonicalSource.includes(hash("a")), false);
  assert.equal(plan.canonicalSource.includes("draft-audio"), false);
  assert.throws(() => compilePlan(plan.canonicalSource, context([])), { code: "UNKNOWN_REFERENCE" });
});

test("legacy bytes and fingerprints are exact when the new context field is omitted, empty or undefined", async () => {
  for (const input of [{}, { transcriptionInputs: [] }, { transcriptionInputs: undefined }]) {
    const original = { ...localPlanContext(), ...input }, plan = compilePlan(localPlanSource, original);
    assert.equal(createHash("sha256").update(JSON.stringify(plan)).digest("hex"), "66ddaa339d83d7c0c1d6971a0b6b349797c7b703f01597329b6682145e704795");
    assert.equal(digest(plan), "b32f9af5046e3845ab3610c9c7e6c19187f3aad10c74169b4867897563fbd359");
    assert.equal(plan.graphDigest, "f6bc2365ef270ab2924a0e20fc2a1adf0334a1b1b542e97f0dc4b0bf4bbcc0eb");
    assert.equal(digest(plan.canonicalSource), "48bcc713ebcccfb45807b5fa75d95b45a7f9aabd7c486c2a61d4ebb6377bb3ef");
    for (const node of plan.nodes) assert.equal(Object.hasOwn(node, "applicationInput"), false);
    assert.deepEqual(await compilePlanIsolated(localPlanSource, original), plan);
  }
});

test("catalog snapshot rejects malformed identities, shapes, unsupported kinds and duplicate binding IDs", () => {
  for (const value of [undefined, null, {}, "catalog", new Map(), [null], [{}], [binding({ extra: true })],
    [binding({ id: "" })], [binding({ digest: "A".repeat(64) })], [binding({ digest: "a".repeat(63) })],
    [binding({ consumerAlias: "" })], [binding({ id: "é".repeat(81) })], [binding({ consumerAlias: "é".repeat(81) })],
    [binding({ artifact: { ...binding().artifact, artifactId: "é".repeat(81) } })],
    [binding({ artifact: { ...binding().artifact, sha256: "b".repeat(65) } })],
    [binding({ artifact: { ...binding().artifact, kind: "video" } })], [binding({ artifact: { ...binding().artifact, path: "/private/source.wav" } })],
    [binding(), binding()], Array.from({ length: 65 }, (_, index) => binding({ id: `id-${index}` })),
  ]) rejected(value);
});

test("snapshots accept bounded Unicode opaque IDs and distinct historical bindings for one consumer", () => {
  const entries = Array.from({ length: TRANSCRIPTION_INPUT_LIMITS.bindings }, (_, index) => binding({ id: index === 0 ? "é".repeat(80) : `old-${index}` }));
  const result = snapshotTranscriptionInputs(entries);
  assert.equal(result.length, 64); assert.ok(Buffer.byteLength(JSON.stringify(result)) <= TRANSCRIPTION_INPUT_LIMITS.canonicalBytes);
  assert.ok(Object.isFrozen(result) && result.every(item => Object.isFrozen(item) && Object.isFrozen(item.artifact)));
  const key = binding({ id: "__proto__", consumerAlias: "识别" });
  const original = context([key]); original.logicalIds["识别"] = "unicode-node";
  assert.equal(compilePlan(source(key.id, key.consumerAlias), original).nodes[0].applicationInput.id, key.id);
  const plain = Object.assign(Object.create(null), binding()); plain.artifact = Object.assign(Object.create(null), plain.artifact);
  assert.deepEqual(snapshotTranscriptionInputs([plain]), [binding()]);
});

test("snapshot rejects accessors without calling them, including the catalog context and array entries", () => {
  let reads = 0; const getter = () => { reads++; return binding(); };
  const cases = [];
  const item = binding(); Object.defineProperty(item, "id", { enumerable: true, get: getter }); cases.push([item]);
  const artifact = binding(); Object.defineProperty(artifact.artifact, "sha256", { enumerable: true, get: getter }); cases.push([artifact]);
  const array = [binding()]; Object.defineProperty(array, "0", { enumerable: true, get: getter }); cases.push(array);
  for (const value of cases) rejected(value);
  const supplied = context(); Object.defineProperty(supplied, "transcriptionInputs", { enumerable: true, get: getter });
  assert.throws(() => compilePlan(source(), supplied), { code: "TRANSCRIPTION_INPUT_INVALID" });
  assert.throws(() => snapshotCompileTranscriptionInputs(supplied), { code: "TRANSCRIPTION_INPUT_INVALID" });
  assert.equal(reads, 0);
});

test("snapshot rejects hidden or symbolic metadata, sparse arrays, exotic prototypes and proxies", () => {
  const hidden = binding(); Object.defineProperty(hidden, "digest", { value: hash("a"), enumerable: false });
  const symbol = binding(); symbol[Symbol("secret")] = true;
  const extra = [binding()]; extra.extra = "ignored";
  const nonEnumerable = [binding()]; Object.defineProperty(nonEnumerable, "0", { enumerable: false });
  const exotic = Object.assign(Object.create({ inherited: true }), binding());
  let traps = 0; const proxy = value => new Proxy(value, { ownKeys() { traps++; throw Error("must not run"); } });
  const revoked = Proxy.revocable([binding()], {}); revoked.revoke();
  class Catalog extends Array {}
  for (const value of [[hidden], [symbol], extra, nonEnumerable, new Array(1), new Catalog(binding()), [exotic],
    proxy([binding()]), revoked.proxy, [proxy(binding())], [binding({ artifact: proxy(binding().artifact) })]]) rejected(value);
  assert.equal(traps, 0);
  const inherited = Object.assign(Object.create({ transcriptionInputs: [binding()] }), localPlanContext());
  assert.throws(() => snapshotCompileTranscriptionInputs(inherited), { code: "TRANSCRIPTION_INPUT_INVALID" });
});

test("sync compilation captures the entire catalog before identity allocation callbacks can mutate it", () => {
  const original = context(); delete original.logicalIds.words;
  original.allocateId = () => { original.transcriptionInputs[0].digest = hash("e"); original.transcriptionInputs[0].artifact.sha256 = hash("f"); return "allocated-words"; };
  const node = compilePlan(source(), original).nodes[0];
  assert.equal(node.id, "allocated-words"); assert.equal(node.applicationInput.digest, hash("a"));
  assert.equal(node.inputs[0].source.artifact.sha256, hash("b"));
});

test("isolated compilation uses the captured catalog and restores immutable links after worker cloning", async () => {
  const original = context(), expected = compilePlan(source(), context()), pending = compilePlanIsolated(source(), original);
  original.transcriptionInputs[0].id = "changed"; original.transcriptionInputs[0].digest = hash("f");
  original.transcriptionInputs[0].artifact.sha256 = hash("e"); original.transcriptionInputs = [];
  const plan = await pending;
  assert.deepEqual(plan, expected); assert.ok(Object.isFrozen(plan.nodes[0].applicationInput));
  assert.throws(() => { plan.nodes[0].applicationInput.id = "changed"; }, TypeError);
  const invalid = context([binding({ artifact: { ...binding().artifact, kind: "image" } })]);
  await assert.rejects(compilePlanIsolated(source(), invalid), { code: "TRANSCRIPTION_INPUT_INVALID" });
});

test("the worker independently rejects malformed catalog data", { timeout: 10000 }, async () => {
  const original = context([binding({ unknown: true })]), { allocateId, ...data } = original;
  const worker = new Worker(new URL("../dist/planning/worker.js", import.meta.url), { workerData: { ...data, source: source() } });
  try {
    const message = await new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); });
    assert.equal(message.ok, false); assert.equal(message.error.code, "TRANSCRIPTION_INPUT_INVALID");
  } finally { await worker.terminate(); }
});

test("effective identity rejects malformed or misplaced application links rather than treating them as legacy", () => {
  const node = compilePlan(source(), context()).nodes[0];
  for (const value of [null, undefined, {}, { ...node.applicationInput, unknown: true }, { ...node.applicationInput, digest: "wrong" }])
    assert.throws(() => effectiveNodeDigest({ ...node, applicationInput: value }, resolved(node)), { code: "TRANSCRIPTION_INPUT_INVALID" });
  assert.throws(() => effectiveNodeDigest({ ...node, kind: "speech" }, resolved(node)), { code: "TRANSCRIPTION_INPUT_INVALID" });
  let reads = 0; const accessor = { ...node }; Object.defineProperty(accessor, "applicationInput", { enumerable: true, get() { reads++; return node.applicationInput; } });
  assert.throws(() => effectiveNodeDigest(accessor, resolved(node)), { code: "TRANSCRIPTION_INPUT_INVALID" });
  assert.equal(reads, 0);
  const inherited = { ...node }; delete inherited.applicationInput; Object.setPrototypeOf(inherited, { applicationInput: node.applicationInput });
  assert.throws(() => effectiveNodeDigest(inherited, resolved(node)), { code: "TRANSCRIPTION_INPUT_INVALID" });
});
