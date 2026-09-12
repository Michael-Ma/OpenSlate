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
import { DIRECTOR_PROJECTION_LIMITS, projectDirectorContext } from "../dist/application/context-projection.js";
import { projectFixture, sourceFor } from "./execution-fixture.mjs";

function setup(t, count = 2) {
  const directory = mkdtempSync(join(tmpdir(), "openslate-context-projection-"));
  const store = new Store(join(directory, "state.sqlite"));
  const provider = new FakeProvider(join(directory, "fake.sqlite"));
  const engine = new Engine(store, provider, { artifactDir: join(directory, "artifacts") });
  const service = new ProductionService(store, engine);
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
function collect(f, section, field = "items") {
  let offset = 0; const values = []; let count = 0; let identity;
  do {
    const response = f.read({ section, offset });
    assert.ok(Buffer.byteLength(canonical(response)) <= DIRECTOR_PROJECTION_LIMITS.bytes);
    assert.ok(response.page.returned <= DIRECTOR_PROJECTION_LIMITS.records);
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
