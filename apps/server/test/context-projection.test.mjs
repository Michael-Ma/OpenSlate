import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_PROFILES, canonical, digest, newId, shotIntentDigest } from "@openslate/core";
import { FakeProvider } from "@openslate/providers";
import { Store } from "../dist/persistence/store.js";
import { Engine } from "../dist/execution/engine.js";
import { ProductionService } from "../dist/application/service.js";
import { ToolInvocationService } from "../dist/application/tool-invocations.js";
import { NarrationService } from "../dist/narration/service.js";
import { DIRECTOR_PROJECTION_LIMITS, projectDirectorContext } from "../dist/application/context-projection.js";
import { projectFixture, sourceFor } from "./execution-fixture.mjs";

function setup(t, count = 2, profiles = DEFAULT_PROFILES) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-context-projection-"));
  const store = new Store(join(directory, "state.sqlite"));
  const provider = new FakeProvider(join(directory, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts") });
  const service = new ProductionService(store, engine, profiles);
  const empty = service.createProject("Context projection fixture");
  // Trusted fixture seeding; production reads and plan application use real services.
  const project = store.saveProject({ ...projectFixture(empty.id, count), capabilityLockId: empty.capabilityLockId }, empty.headVersion);
  const human = service.beginRequest(project.id, "local-human", "Continue this project and preserve existing work.");
  const actor = service.openEpoch(project.id, human).actor;
  const read = input => projectDirectorContext(service, project.id, actor, input);
  t.after(() => { store.close(); provider.close(); rmSync(directory, { recursive: true, force: true }); });
  return { directory, store, provider, engine, service, project, human, actor, read };
}
async function install(f) {
  const project = f.store.getProject(f.project.id);
  f.service.authorize(project.id, f.human, project.shots.map(shot => ({ scopeId: shot.id, kind: "image" })), "initial-images", "initial_slot");
  const prepared = await f.service.prepare(project.id, f.actor, { variant: "plan", expectedHeadVersion: project.headVersion, source: sourceFor(project, true) });
  const receipt = f.service.apply(project.id, f.actor, prepared.id);
  return { prepared, receipt };
}

test('overview exposes owned assets and canonical cues without host storage paths',t=>{
  const f=setup(t),before=f.store.getProject(f.project.id),asset={artifactId:newId(),sha256:'a'.repeat(64),kind:'audio'};
  const p=f.store.saveProject({...before,artifacts:[asset]},before.headVersion);
  f.store.insert('artifact',asset.artifactId,p.id,{id:asset.artifactId,projectId:p.id,artifact:asset,path:'/private/host-only/recording.wav',mimeType:'audio/wav',fixture:true,attemptId:null,physicalDurationSeconds:12});
  const view=f.read({});
  assert.equal(view.assets.length,p.artifacts.length);assert.deepEqual(view.cues,p.cues);
  assert.equal(view.assets[0].metadata.physicalDurationSeconds,12);
  assert.ok(!JSON.stringify(view).includes('/private/host-only'));
  assert.ok(!JSON.stringify(f.service.inspectArtifact(p.id,f.actor,asset.artifactId)).includes('/private/host-only'));
  assert.equal(view.coverage.overview.assets.total,p.artifacts.length);
  assert.equal(view.narrationDraft.version,0);
});
function collect(f, section, field = "items") {
  let offset = 0; const values = []; let count = 0; let identity;
  do {
    const response = f.read({ section, offset });
    assert.ok(Buffer.byteLength(canonical(response)) <= DIRECTOR_PROJECTION_LIMITS.bytes);
    assert.ok(response.page.returned <= DIRECTOR_PROJECTION_LIMITS.records);
    assert.equal(response.applicationCapabilities.narration.speechSynthesis.available, false);
    assert.equal(response.guard.applicationCapabilitiesDigest, digest(response.applicationCapabilities));
    if (identity) assert.deepEqual(response.guard, identity); else identity = response.guard;
    values.push(...response[field]); offset = response.page.nextOffset;
    assert.ok(++count < 1000, "pagination must make progress");
  } while (offset !== null);
  return values;
}

test("overview reconstructs saved plan, aliases, locked profiles and unused grant provenance without mutating state", async t => {
  const f = setup(t); const { prepared, receipt } = await install(f);
  const unused = f.service.authorize(f.project.id, f.human, [{ scopeId: f.project.shots[0].id, kind: "video" }], "unused-video")[0];
  const beforeChanges = f.store.db.prepare("SELECT total_changes() AS count").get().count;
  const beforeCursor = f.store.cursor(f.project.id);
  const overview = f.read();
  assert.equal(overview.project.id, f.project.id); assert.equal(overview.project.headVersion, receipt.headVersion);
  assert.equal(overview.project.activePlanId, receipt.activePlanId);
  assert.equal(overview.project.shots.length, 2);
  assert.deepEqual(Object.keys(overview.project.shots[0]).sort(), ["desiredFrames", "id", "revisionId", "sceneId"]);
  assert.equal(overview.messages[0].text, "Continue this project and preserve existing work.");
  assert.deepEqual(overview.profiles, DEFAULT_PROFILES);
  assert.equal(overview.plan.graphDigest, prepared.compiled.graphDigest);
  assert.equal(overview.plan.sourceLength, prepared.compiled.canonicalSource.length);
  assert.deepEqual(Object.fromEntries(collect(f, "aliases").map(item => [item.alias, item.nodeId])), prepared.logicalIds);
  const grants = collect(f, "grants");
  assert.equal(grants.length, 1); assert.equal(grants[0].id, unused.id); assert.equal(grants[0].authorityId, f.human.requestId);
  assert.equal(grants[0].authorityRelation, "current_or_explicitly_continued_request");
  assert.match(grants[0].authorization, /informational_only/);
  assert.equal(f.store.db.prepare("SELECT total_changes() AS count").get().count, beforeChanges);
  assert.equal(f.store.cursor(f.project.id), beforeCursor);
  assert.equal(f.provider.acceptedCount(), 0);
  const alternateService = new ProductionService(f.store, f.engine, []);
  assert.deepEqual(projectDirectorContext(alternateService, f.project.id, f.actor).profiles, DEFAULT_PROFILES, "profiles come from saved capability lock, not mutable defaults");
});

test("every section and page carries host-authored narration facts without changing data guards or stored state", async t => {
  const f = setup(t, 25); await install(f);
  new NarrationService(f.service).reviseSegments(f.project.id, f.actor, 0, "narration-pages", { add: Array.from({ length: 25 }, (_, i) => ({
    text: `Narration section ${i}`, textKind: "draft", language: "en", meaning: `Section ${i}`, source: { kind: "uploaded" },
  })) });
  const beforeProject = canonical(f.store.getProject(f.project.id));
  const beforeEntities = canonical(f.store.db.prepare("SELECT * FROM entities ORDER BY rowid").all());
  const beforeChanges = f.store.db.prepare("SELECT total_changes() AS count").get().count;
  const beforeCursor = f.store.cursor(f.project.id);
  let expected;
  for (const section of ["overview", "shots", "scenes", "plan", "aliases", "grants", "receipts", "narration"]) {
    let offset = 0, guard;
    do {
      const response = f.read({ section, offset });
      expected ??= response.applicationCapabilities;
      assert.deepEqual(response.applicationCapabilities, expected, section);
      assert.equal(response.guard.applicationCapabilitiesDigest, digest(expected));
      assert.match(response.coverage.pageGuard, /applicationCapabilitiesDigest/);
      assert.ok(Buffer.byteLength(canonical(response)) <= DIRECTOR_PROJECTION_LIMITS.bytes);
      if (guard) assert.deepEqual(response.guard, guard); else guard = response.guard;
      if (section === "plan") assert.equal(response.guard.dataDigest, response.plan.sourceDigest, "plan digest remains the exact canonical source identity");
      offset = response.page.nextOffset;
    } while (offset !== null);
    // Even an empty terminal page must retain the capability facts and guard.
    const terminal = f.read({ section, offset: DIRECTOR_PROJECTION_LIMITS.maximumOffset });
    assert.deepEqual(terminal.applicationCapabilities, expected);
    assert.deepEqual(terminal.guard, guard);
    assert.equal(terminal.page.returned, 0);
  }
  const shots = collect(f, "shots");
  assert.equal(f.read({ section: "shots" }).guard.dataDigest, digest(shots), "record data guards still hash the complete collection");
  assert.equal(canonical(f.store.getProject(f.project.id)), beforeProject);
  assert.equal(canonical(f.store.db.prepare("SELECT * FROM entities ORDER BY rowid").all()), beforeEntities);
  assert.equal(f.store.db.prepare("SELECT total_changes() AS count").get().count, beforeChanges);
  assert.equal(f.store.cursor(f.project.id), beforeCursor);
  assert.equal(f.provider.acceptedCount(), 0);
});

test("saved speech profiles and generated voice selections cannot enable absent narration workflows", t => {
  const speech = { id: "configured-speech", revision: "7", kind: "speech", adapter: "openai-speech", executionVersion: "1",
    configuration: { model: "tts-model", settings: { voice: "warm", enabled: true } }, maxConcurrency: 1, unitCostMicros: "10000", maxRetries: 0 };
  const transcription = { ...speech, id: "configured-transcription", kind: "transcription", adapter: "openai-transcription", configuration: { model: "asr-model" } };
  const f = setup(t, 1, [...DEFAULT_PROFILES, speech, transcription]);
  const lock = canonical(f.store.get("capability_lock", f.project.capabilityLockId));
  const original = f.read();
  new NarrationService(f.service).reviseSegments(f.project.id, f.actor, 0, "generated-intent", { add: [{
    text: "A polished narration", textKind: "draft", language: "en", meaning: "Product introduction",
    source: { kind: "generated", voice: "warm", profileRevisionId: "configured-speech@7" },
  }] });
  const view = f.read({ section: "narration" }), capabilities = view.applicationCapabilities.narration;
  assert.deepEqual(view.profiles.slice(-2), [speech, transcription], "saved provider information is preserved separately");
  assert.equal(view.narrationDraft.segments[0].script.source.profileRevisionId, "configured-speech@7");
  assert.equal(capabilities.speechSynthesis.implemented, false); assert.equal(capabilities.speechSynthesis.available, false);
  assert.equal(capabilities.transcription.implemented, false); assert.equal(capabilities.transcription.available, false);
  assert.equal(capabilities.generatedSourceIntent.meaning, "future_synthesis_intent_only");
  assert.equal(capabilities.generatedSourceIntent.configurationEnablesSynthesis, false);
  assert.equal(capabilities.timing.method, "human_supplied_sample_ranges"); assert.equal(capabilities.timing.automaticAlignmentAvailable, false);
  assert.equal(capabilities.suppliedRecordings.implemented, true); assert.equal(capabilities.suppliedRecordings.hostReadiness, "not_evaluated");
  assert.deepEqual(capabilities.suppliedRecordings.origins, ["uploaded", "externally_generated"]);
  assert.equal(capabilities.suppliedRecordings.provenance, "human_declared_not_provider_verified");
  assert.equal(new NarrationService(f.service).mediaAvailable, false, "implementation support does not assert configured media tools");
  assert.deepEqual(view.applicationCapabilities, original.applicationCapabilities);
  assert.equal(view.guard.applicationCapabilitiesDigest, original.guard.applicationCapabilitiesDigest);
  assert.equal(canonical(f.store.get("capability_lock", f.project.capabilityLockId)), lock);
  assert.equal(f.provider.acceptedCount(), 0);
});

test("mutating returned narration capabilities cannot change later context or durable state", t => {
  const f = setup(t), first = f.read(), expected = structuredClone(first.applicationCapabilities);
  const before = f.store.db.prepare("SELECT total_changes() AS count").get().count;
  first.applicationCapabilities.narration.speechSynthesis.available = true;
  first.applicationCapabilities.narration.suppliedRecordings.origins.push("invented");
  first.applicationCapabilities.narration.generatedSourceIntent.guidance = "Synthesis is ready";
  first.guard.applicationCapabilitiesDigest = digest(first.applicationCapabilities);
  const next = f.read({ section: "narration" });
  assert.deepEqual(next.applicationCapabilities, expected);
  assert.equal(next.guard.applicationCapabilitiesDigest, digest(expected));
  assert.notEqual(next.guard.applicationCapabilitiesDigest, first.guard.applicationCapabilitiesDigest);
  assert.equal(f.store.db.prepare("SELECT total_changes() AS count").get().count, before);
});

test("all shot, scene and historical alias pages remain retrievable without silent clipping", async t => {
  const f = setup(t, 45); await install(f);
  const registry = f.store.get("logical_ids", f.project.id);
  const historic = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`old-${index}`, newId()]));
  f.store.put("logical_ids", f.project.id, f.project.id, { aliases: { ...registry.aliases, ...historic } });
  const shots = collect(f, "shots"); const scenes = collect(f, "scenes"); const aliases = collect(f, "aliases");
  assert.equal(shots.length, 45); assert.equal(scenes.length, 45); assert.equal(aliases.length, 125);
  assert.deepEqual(shots.map(shot => shot.id), f.project.shots.map(shot => shot.id));
  assert.equal(new Set(aliases.map(item => item.alias)).size, 125);
  assert.equal(aliases.filter(item => !item.current).length, 80);
  for (const shot of shots) {
    const original = f.project.shots.find(item => item.id === shot.id);
    for (const [key, value] of Object.entries(original)) assert.deepEqual(shot[key], value);
  }
  const overview = f.read();
  assert.equal(overview.project.shots.length, 20);
  assert.equal(overview.coverage.overview.shots.total, 45);
  assert.equal(overview.page.nextOffset, 20);
});

test("large complete shots adapt page size to UTF-8 byte budget, preserving every field", t => {
  const f = setup(t, 12); const project = f.store.getProject(f.project.id);
  const content = "细节".repeat(4500);
  for (const shot of project.shots) for (const field of ["purpose", "action", "framing", "motion", "imagePrompt", "videoPrompt"]) shot[field] = content;
  f.store.saveProject({ ...project, revisionId: newId() }, project.headVersion);
  const first = f.read({ section: "shots" });
  assert.ok(first.page.returned < 12 && first.page.returned >= 1);
  const all = collect(f, "shots"); assert.equal(all.length, 12);
  assert.ok(all.every(shot => shot.framing === content && shot.videoPrompt === content));
});

test("canonical source is chunked by an explicit character cursor and reconstructed exactly", async t => {
  const f = setup(t, 25); const project = f.store.getProject(f.project.id);
  for (const shot of project.shots) {
    shot.imagePrompt = `镜头${shot.id} ` + "texture ".repeat(500);
    shot.promptIntent = { image: shotIntentDigest(shot, "image"), video: shotIntentDigest(shot, "video") };
  }
  f.store.saveProject({ ...project, revisionId: newId() }, project.headVersion);
  const { prepared } = await install(f);
  assert.ok(prepared.compiled.canonicalSource.length > DIRECTOR_PROJECTION_LIMITS.sourceCharacters);
  let offset = 0; let source = ""; let pages = 0; let guard;
  do {
    const response = f.read({ section: "plan", offset });
    assert.equal(response.page.offsetUnit, "utf16_characters");
    assert.ok(response.source.length <= DIRECTOR_PROJECTION_LIMITS.sourceCharacters);
    assert.ok(Buffer.byteLength(canonical(response)) <= DIRECTOR_PROJECTION_LIMITS.bytes);
    assert.equal(response.plan.sourceLength, prepared.compiled.canonicalSource.length);
    if (guard) assert.deepEqual(response.guard, guard); else guard = response.guard;
    source += response.source; offset = response.page.nextOffset; pages++;
  } while (offset !== null);
  assert.ok(pages > 1); assert.equal(source, prepared.compiled.canonicalSource);
});

test("receipt context omits previous read_context payloads and preserves compact result identities", t => {
  const f = setup(t);
  const large = { project: { secretRecursiveContext: "Do not recursively copy this context".repeat(15000) }, preparedId: "prepared-fixture", revisionId: "revision-fixture", headVersion: 9, activePlanId: "plan-fixture" };
  f.store.insert("tool_invocation", newId(), f.project.id, { requestId: f.actor.requestId, epochId: f.actor.epochId, callId: "context-fixture", tool: "read_context", state: "succeeded", argumentsDigest: digest({}), result: large, resultDigest: digest(large), error: null });
  f.store.insert("tool_invocation", newId(), f.project.id, { requestId: f.actor.requestId, epochId: f.actor.epochId, callId: "apply-tool-fixture", tool: "apply_change", state: "succeeded", argumentsDigest: digest({}), result: { preparedId: "prepared-fixture" }, resultDigest: digest({ preparedId: "prepared-fixture" }), error: null });
  f.store.command(`local-human:${f.project.id}:apply`, "apply-fixture", digest({}), () => ({ preparedId: "applied-proposal", revisionId: "saved-revision", headVersion: 2, activePlanId: null, cursor: 5, hugeUnrelatedField: large }));
  const other = f.service.createProject("Other project");
  f.store.command(`local-human:${other.id}:apply`, "other-private-receipt", digest({}), () => ({ preparedId: "other-private-proposal" }));
  const response = f.read({ section: "receipts" }); const serialized = canonical(response);
  assert.ok(serialized.length < 20000); assert.ok(!serialized.includes("secretRecursiveContext"));
  assert.ok(!serialized.includes("context-fixture"));
  assert.ok(!serialized.includes("other-private"));
  assert.equal(response.items.find(item => item.kind === "tool").preparedId, "prepared-fixture");
  assert.equal(response.items.find(item => item.kind === "command" && item.key === "apply-fixture").preparedId, "applied-proposal");
  assert.equal(f.read().toolCalls[0].state, "succeeded");
});

test("real read_context audit events do not invalidate pagination or shift receipt ordering", async t => {
  const f = setup(t, 25); const tools = new ToolInvocationService(f.service);
  const first = await tools.invoke(f.project.id, f.actor, "page-one", "read_context", { section: "shots" });
  const second = await tools.invoke(f.project.id, f.actor, "page-two", "read_context", { section: "shots", offset: first.page.nextOffset });
  assert.deepEqual(first.guard, second.guard);
  assert.deepEqual(first.applicationCapabilities, second.applicationCapabilities);
  assert.equal(first.applicationCapabilities.narration.transcription.available, false);
  assert.equal(first.guard.applicationCapabilitiesDigest, digest(first.applicationCapabilities));
  assert.ok(second.cursor > first.cursor, "raw audit cursor remains available for SSE");
  assert.equal(first.items.length + second.items.length, 25);
  const receiptsOne = await tools.invoke(f.project.id, f.actor, "receipts-one", "read_context", { section: "receipts" });
  const receiptsTwo = await tools.invoke(f.project.id, f.actor, "receipts-two", "read_context", { section: "receipts" });
  assert.deepEqual(receiptsOne.guard, receiptsTwo.guard); assert.deepEqual(receiptsOne.items, receiptsTwo.items);
  assert.equal(f.store.list("tool_invocation", f.project.id).length, 4, "all reads retain durable audit receipts");
  const overview = f.read(); assert.equal(overview.toolCalls.length, 0);
  assert.equal(f.provider.acceptedCount(), 0);
});

test("paged overview includes all recent messages and active holds with explicit coverage", t => {
  const f = setup(t, 1);
  for (let index = 0; index < 42; index++) f.service.beginRequest(f.project.id, "local-human", `Follow-up ${index}`, { editing: false });
  const messages = collect(f, "overview", "messages");
  assert.equal(messages.length, 43); assert.equal(messages[0].text, "Follow-up 41");
  assert.equal(new Set(messages.map(item => item.id)).size, messages.length);
  const first = f.read(); assert.equal(first.coverage.overview.messages.total, 43);
  assert.ok(first.holds.some(hold => hold.ownerId === f.human.requestId));
});

test("revision and collection guards expose state changes between pages", t => {
  const f = setup(t, 25); const first = f.read({ section: "shots" });
  const project = f.store.getProject(f.project.id);
  f.store.saveProject({ ...project, revisionId: newId(), shots: project.shots.map((shot, i) => i === 24 ? { ...shot, framing: "New framing" } : shot) }, project.headVersion);
  const next = f.read({ section: "shots", offset: first.page.nextOffset });
  assert.notEqual(next.guard.headVersion, first.guard.headVersion); assert.notEqual(next.guard.revisionId, first.guard.revisionId); assert.notEqual(next.guard.dataDigest, first.guard.dataDigest);
  const grants = f.read({ section: "grants" });
  f.service.authorize(f.project.id, f.human, [{ scopeId: f.project.id, kind: "image" }], "new-grant");
  const newerGrants = f.read({ section: "grants" });
  assert.equal(newerGrants.headVersion, grants.headVersion); assert.notEqual(newerGrants.guard.dataDigest, grants.guard.dataDigest, "grant changes may not advance the creative head");
});

test("invalid queries, cross-project actors and revoked epochs are rejected", t => {
  const f = setup(t);
  for (const bad of [{ section: "shell" }, { offset: -1 }, { offset: 1.1 }, { offset: 10_000_001 }, { path: "/tmp/private" }]) assert.throws(() => f.read(bad), { code: "VALIDATION_ERROR" });
  const other = f.service.createProject("Other");
  assert.throws(() => projectDirectorContext(f.service, other.id, f.actor), { code: "ACTOR_DENIED" });
  assert.throws(() => projectDirectorContext(f.service, f.project.id, { ...f.actor, principalId: "forged" }), { code: "ACTOR_DENIED" });
  f.service.beginRequest(f.project.id, "local-human", "Replace the active request");
  assert.throws(() => f.read(), { code: "EPOCH_REVOKED" });
});

test("a single oversized record fails explicitly instead of silently dropping or clipping data", t => {
  const f = setup(t, 1); const project = f.store.getProject(f.project.id);
  project.shots[0].imagePrompt = "x".repeat(DIRECTOR_PROJECTION_LIMITS.bytes);
  f.store.saveProject(project, project.headVersion);
  assert.throws(() => f.read({ section: "shots" }), { code: "CONTEXT_ITEM_TOO_LARGE" });
  assert.equal(f.read().project.shots.length, 1, "minimal overview remains usable");
});
