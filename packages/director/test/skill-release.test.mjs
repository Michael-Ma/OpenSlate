import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonical, digest, FILM_KINDS, STAGES, toolCatalog } from "@openslate/core";
import { activateSkills, createSkillLock, createSkillReleaseLock, loadSkillCatalog, loadSkillRelease, readActivatedSkillFile, routeSkills, routeSkillsFromKey,
  skillReleaseBudget, verifyPublishedSkillSnapshot, verifySkillLock, verifySkillLockRelease, verifySkillLockSnapshots, verifySkillReleaseSnapshot } from "../dist/skills/index.js";
import { packageDigest, repositoryRoot, syntheticPackages, writeSkillRelease } from "./skill-release-fixture.mjs";

const contract = toolContract => ({ toolContract, planLanguage: "1.0.0", workflowContract: "1.0.0" });
function cleanup(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) cleanup(join(path, name)); }
  rmSync(path, { recursive: true, force: true });
}
function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "openslate-skill-release-")); t.after(() => cleanup(root));
  const written = writeSkillRelease(join(root, "v8"), options);
  const environment = { snapshotRoot: join(root, "snapshots"), compatibility: contract("7.0.0"), availableToolIds: [...toolCatalog("7.0.0").names] };
  return { root, written, environment, load: (extra = {}) => loadSkillRelease({ ...environment, releaseRoot: written.root, routeKinds: FILM_KINDS, ...extra }) };
}
const prompts = STAGES.map(stage => ({ id: `production/${stage}@1`, skillId: "production", path: `references/stages/${stage}.md` }));
const mutate = (change) => { const packages = syntheticPackages(); change(Object.fromEntries(packages.map(item => [item.id, item])), packages); return packages; };

test("schema 1 manifests keep exactly their six fields, bytes and shipped digests", t => {
  const root = mkdtempSync(join(tmpdir(), "openslate-skill-v1-")); t.after(() => cleanup(root));
  const environment = { snapshotRoot: join(root, "snapshots"), compatibility: contract("6.0.0"), availableToolIds: [...toolCatalog("6.0.0").names] };
  const pins = { production: "6d86d6772bbaeadbf967f3d7d73b2e8531e56501096c8703acd226b339b439f5", "plan-authoring": "16cb63a6398eaa11c2b474f05fe0cd52f12e46d603a6544e3aa2076b954d16cf" };
  const catalog = loadSkillCatalog({ ...environment, packageRoots: ["production", "plan-authoring"].map(id => join(repositoryRoot, "skills/v7", id)), expectedPackageDigests: pins });
  for (const skill of catalog.skills) {
    assert.deepEqual(Object.keys(skill.manifest).sort(), ["compatibility", "entry", "files", "id", "requiredToolIds", "version"]);
    assert.equal(skill.packageDigest, packageDigest(join(repositoryRoot, "skills/v7", skill.id)), "the fixture's digest helper matches the loader");
  }
  const lock = createSkillLock(catalog, { selectedSkillIds: ["production", "plan-authoring"], bindings: [], prompts });
  assert.equal(lock.schemaVersion, 1); assert.equal(Object.hasOwn(lock, "release"), false);
  const { lockDigest, ...body } = lock; assert.equal(digest(body), lockDigest);
  assert.equal(verifySkillLock(lock, environment).length, 2);
  // A v1 activation reads only what it activated, and its evidence keeps the v1 shape.
  const activation = activateSkills(lock, { ...environment, requestId: "v1", contextDigest: "a".repeat(64), selectedSkillIds: ["production"] });
  assert.equal(activation.schemaVersion, 1); assert.equal(Object.hasOwn(activation, "routing"), false);
  assert.throws(() => readActivatedSkillFile(lock, activation, environment, { skillId: "plan-authoring", path: "SKILL.md" }), { code: "SKILL_NOT_ACTIVATED" });
  const read = readActivatedSkillFile(lock, activation, environment, { skillId: "production", path: "references/notes.md" }, { via: "read_guidance" });
  assert.deepEqual(Object.keys(read.evidence).sort(), ["activationId", "contextSnapshotId", "lockId", "packageDigest", "path", "readId", "requestId", "sha256", "skillId"]);
  assert.throws(() => activateSkills(lock, { ...environment, requestId: "v1", contextDigest: "a".repeat(64), selectedSkillIds: ["production"],
    routing: { ruleVersion: 1, inputs: { typePackage: null, formatPackages: [], toneTags: [], conditions: [] }, inputDigest: "0".repeat(64), selected: ["production"], reasons: {} } }), { code: "SKILL_ROUTING_INVALID" });
  // Schema 2 fields without schemaVersion stay unknown fields of a schema 1 manifest.
  const legacy = join(root, "legacy"); mkdirSync(legacy);
  writeFileSync(join(legacy, "SKILL.md"), "---\nname: legacy\ndescription: Legacy.\n---\n");
  writeFileSync(join(legacy, "openslate.skill.json"), JSON.stringify({ id: "legacy", version: "1.0.0", entry: "SKILL.md", files: ["SKILL.md"], compatibility: contract("6.0.0"), requiredToolIds: [], role: "craft" }));
  assert.throws(() => loadSkillCatalog({ ...environment, snapshotRoot: join(root, "legacy-snapshots"), packageRoots: [legacy] }), /Unexpected or missing fields/);
});

test("a release loads, snapshots itself and locks every package with schema 2", t => {
  const f = fixture(t), release = f.load({ expectedReleaseDigest: f.written.releaseDigest });
  assert.equal(release.releaseDigest, f.written.releaseDigest);
  assert.deepEqual(release.catalog.skills.map(skill => [skill.id, skill.manifest.role]).sort(), [["craft-characters", "craft"], ["craft-story", "craft"], ["format-social-vertical", "format"],
    ["plan-authoring", "core"], ["production", "core"], ["type-music-video", "type"]]);
  assert.deepEqual(canonical(verifySkillReleaseSnapshot(f.environment.snapshotRoot, release.releaseDigest)), canonical(release.release));
  assert.equal(verifyPublishedSkillSnapshot(f.environment.snapshotRoot, release.releaseDigest), "release");
  assert.equal(verifyPublishedSkillSnapshot(f.environment.snapshotRoot, release.catalog.skills[0].packageDigest), "package");
  const lock = createSkillReleaseLock(release, { bindings: [], prompts });
  assert.equal(lock.schemaVersion, 2);
  assert.deepEqual(lock.release, { version: "8.0.0", releaseDigest: release.releaseDigest });
  assert.equal(lock.skills.length, 6, "every release package is locked, not only routed ones");
  assert.equal(verifySkillLock(lock, f.environment).length, 6);
  assert.equal(verifySkillLockRelease(lock, f.environment.snapshotRoot).releaseDigest, release.releaseDigest);
  // Loading the same release again reuses every snapshot.
  assert.equal(f.load().releaseDigest, release.releaseDigest);
  // A tampered lock body or a lock naming another release is refused.
  assert.throws(() => verifySkillLockSnapshots({ ...lock, release: { ...lock.release, version: "8.0.1" } }, f.environment.snapshotRoot), { code: "SKILL_LOCK_INVALID" });
  const { lockDigest: _, ...body } = lock; const other = { ...body, release: { ...lock.release, releaseDigest: "f".repeat(64) } };
  assert.throws(() => verifySkillLockSnapshots({ ...other, lockDigest: digest(other) }, f.environment.snapshotRoot), { code: "SKILL_SNAPSHOT_INVALID" });
  const dropped = { ...body, skills: body.skills.filter(skill => skill.id !== "craft-characters") };
  assert.throws(() => verifySkillLockSnapshots({ ...dropped, lockDigest: digest(dropped) }, f.environment.snapshotRoot), { code: "SKILL_LOCK_INVALID" });
  // A changed release snapshot fails closed.
  const snapshot = join(f.environment.snapshotRoot, release.releaseDigest);
  chmodSync(snapshot, 0o755); chmodSync(join(snapshot, "release.json"), 0o644);
  writeFileSync(join(snapshot, "release.json"), readFileSync(join(snapshot, "release.json"), "utf8").replace("8.0.0", "8.0.1"));
  chmodSync(join(snapshot, "release.json"), 0o444); chmodSync(snapshot, 0o555);
  assert.throws(() => verifySkillLock(lock, f.environment), { code: "SKILL_SNAPSHOT_INVALID" });
});

for (const [label, options, expected] of [
  ["a package changed after its pin", { tamper: root => writeFileSync(join(root, "craft-story/SKILL.md"), readFileSync(join(root, "craft-story/SKILL.md"), "utf8") + "\nextra\n") }, "SKILL_PACKAGE_MISMATCH"],
  ["a wrong expected release digest", { expectedReleaseDigest: "0".repeat(64) }, "SKILL_PACKAGE_MISMATCH"],
  ["an unlisted package directory", { tamper: root => { mkdirSync(join(root, "craft-extra")); writeFileSync(join(root, "craft-extra/SKILL.md"), "x"); } }, "SKILL_RELEASE_INVALID"],
  ["a release for another contract", { environment: { compatibility: contract("6.0.0"), availableToolIds: [...toolCatalog("6.0.0").names] } }, "SKILL_COMPATIBILITY_MISMATCH"],
  ["two contracts in one release", { packages: mutate(p => { p["craft-story"].compatibility = { ...p["craft-story"].compatibility, planLanguage: "2.0.0" }; }) }, "SKILL_RELEASE_INVALID"],
  ["a dependency cycle", { packages: mutate(p => { p["craft-story"].requires = ["craft-characters"]; p["craft-characters"].requires = ["craft-story"]; }) }, "SKILL_RELEASE_INVALID"],
  ["an optional cycle", { packages: mutate(p => { p["craft-story"].optional = [{ id: "craft-characters", when: "has_characters" }]; p["craft-characters"].optional = [{ id: "craft-story", when: "has_soundtrack" }]; }) }, "SKILL_RELEASE_INVALID"],
  ["a craft package requiring a type package", { packages: mutate(p => { p["craft-story"].requires = ["type-music-video"]; }) }, "SKILL_RELEASE_INVALID"],
  ["a core package with dependencies", { packages: mutate(p => { p["plan-authoring"].requires = ["craft-story"]; }) }, "SKILL_RELEASE_INVALID"],
  ["a missing dependency", { packages: mutate(p => { p["type-music-video"].requires = ["craft-music-timing"]; }) }, "SKILL_RELEASE_INVALID"],
  ["required chains deeper than two", { packages: mutate((p, all) => {
    all.push({ ...p["craft-characters"], id: "craft-deep", files: { "SKILL.md": "---\nname: craft-deep\ndescription: Deep.\n---\n" } });
    p["craft-characters"].requires = ["craft-deep"]; p["craft-story"].requires = ["craft-characters"]; }) }, "SKILL_RELEASE_INVALID"],
  ["a package outside the release major", { packages: mutate(p => { p["craft-story"].version = "9.0.0"; }) }, "SKILL_RELEASE_INVALID"],
  ["a release below major 8", { release: { release: "7.1.0" } }, "SKILL_PACKAGE_INVALID"],
  ["routes on a craft package", { packages: mutate(p => { p["craft-story"].routes = { kinds: ["explainer"] }; }) }, "SKILL_PACKAGE_INVALID"],
  ["a type package without routes", { packages: mutate(p => { delete p["type-music-video"].routes; }) }, "SKILL_PACKAGE_INVALID"],
  ["an expression as a condition", { packages: mutate(p => { p["type-music-video"].optional = [{ id: "craft-characters", when: "has_characters && kids" }]; }) }, "SKILL_PACKAGE_INVALID"],
  ["a route table naming a package that does not route the kind", { routes: table => ({ ...table, explainer: "type-music-video" }) }, "SKILL_RELEASE_INVALID"],
  ["a manifest route missing from the table", { routes: table => ({ ...table, music_video: "fallback" }) }, "SKILL_RELEASE_INVALID"],
  ["a film kind the table does not cover", { routes: table => { const { tutorial: _, ...rest } = table; return rest; } }, "SKILL_RELEASE_INVALID"],
  ["a route for a kind the application does not know", { routes: table => ({ ...table, podcast: "fallback" }) }, "SKILL_RELEASE_INVALID"],
  ["general routed to a package", { routes: table => ({ ...table, general: "type-music-video" }) }, "SKILL_PACKAGE_INVALID"],
  ["core not listing every core package", { release: { core: ["production"] } }, "SKILL_RELEASE_INVALID"],
  ["a type package as fallback", { release: { fallback: { kind: "general", inject: ["type-music-video"] } } }, "SKILL_RELEASE_INVALID"],
  ["an injected reference outside core", { release: { inject: [{ package: "craft-story", path: "references/frameworks.md" }] } }, "SKILL_RELEASE_INVALID"],
  ["an undeclared injected reference", { release: { inject: [{ package: "production", path: "references/missing.md" }] } }, "SKILL_RELEASE_INVALID"],
  ["a schema 1 manifest in a release", { manifest: (id, value) => { if (id !== "craft-characters") return value; const { schemaVersion: _, role: __, requires: ___, optional: ____, ...legacy } = value; return legacy; } }, "SKILL_RELEASE_INVALID"],
]) test(`release validation refuses ${label} before publishing a snapshot`, t => {
  const { tamper, expectedReleaseDigest, environment, routes, ...write } = options;
  const f = fixture(t, write);
  if (routes) {
    const path = join(f.written.root, "release.json"), value = JSON.parse(readFileSync(path, "utf8"));
    const base = { ...value.routes }; writeFileSync(path, JSON.stringify({ ...value, routes: routes(base) }));
  }
  if (tamper) tamper(f.written.root);
  assert.throws(() => f.load({ ...(expectedReleaseDigest ? { expectedReleaseDigest } : {}), ...(environment ?? {}) }), { code: expected });
  assert.equal(existsSync(f.environment.snapshotRoot), false, "nothing is published when a release is invalid");
});

test("routing is pure and deterministic: kind, formats, tone and closed facts select packages with reasons", t => {
  const release = fixture(t).load();
  const table = [
    ["general (no filmKind)", undefined, [], ["production", "plan-authoring", "craft-story"], { "craft-story": "fallback" }],
    ["a kind whose type package is not in the release", "explainer", [], ["production", "plan-authoring", "craft-story"], { "craft-story": "fallback" }],
    ["music video", "music_video", [], ["production", "plan-authoring", "type-music-video", "craft-story"], { "type-music-video": "route:type", "craft-story": "requires:type-music-video" }],
    ["music video with characters", "music_video", ["has_characters", "has_soundtrack"], ["production", "plan-authoring", "type-music-video", "craft-story", "craft-characters"], { "craft-characters": "when:has_characters" }],
    ["vertical social as a spine", "social_vertical", [], ["production", "plan-authoring", "format-social-vertical", "craft-story"], { "format-social-vertical": "route:format", "craft-story": "fallback" }],
  ];
  for (const [label, filmKind, facts, selected, reasons] of table) {
    const decision = routeSkills(filmKind, release, facts);
    assert.deepEqual(decision.selected, selected, label);
    for (const [id, reason] of Object.entries(reasons)) assert.equal(decision.reasons[id], reason, `${label}: ${id}`);
    assert.equal(decision.inputDigest, digest(decision.inputs));
    assert.deepEqual(routeSkills(filmKind, release, [...facts].reverse()), decision, `${label} ignores fact order`);
  }
  // Format modifiers derive their condition, so a type package's optional format joins, and tone tags derive audience facts.
  const vertical = routeSkillsFromKey({ typePackage: "type-music-video", formatPackages: ["format-social-vertical"], toneTags: ["kids"] }, release, []);
  assert.deepEqual(vertical.inputs.conditions, ["audience:kids", "modifier:social_vertical"]);
  assert.deepEqual(vertical.selected, ["production", "plan-authoring", "type-music-video", "format-social-vertical", "craft-story"]);
  assert.equal(routeSkills("kids_animated_story", release, []).inputs.toneTags[0], "kids");
  assert.throws(() => routeSkills("music_video", release, ["stage:nope"]), /Unknown routing condition/);
});

test("a release activation injects only routed packages, rejects altered routing and reads any locked package on request", t => {
  const f = fixture(t), release = f.load(), lock = createSkillReleaseLock(release, { bindings: [], prompts });
  const routing = routeSkills("music_video", release, []);
  const base = { ...f.environment, requestId: "r", contextDigest: "a".repeat(64) };
  assert.throws(() => activateSkills(lock, { ...base, selectedSkillIds: ["production"] }), { code: "SKILL_ROUTING_INVALID" }, "a release lock needs a routing decision");
  assert.throws(() => activateSkills(lock, { ...base, routing: { ...routing, selected: [...routing.selected, "craft-characters"] } }), { code: "SKILL_ROUTING_INVALID" });
  assert.throws(() => activateSkills(lock, { ...base, routing: { ...routing, inputs: { ...routing.inputs, conditions: ["has_characters"] } } }), { code: "SKILL_ROUTING_INVALID" });
  assert.throws(() => activateSkills(lock, { ...base, routing, selectedSkillIds: ["production"] }), { code: "SKILL_ROUTING_INVALID" });
  const activation = activateSkills(lock, { ...base, routing, stageBindings: [{ stageId: "intake", scopeId: "project", promptId: "production/intake@1" }] });
  assert.equal(activation.schemaVersion, 2); assert.equal(activation.readable, "lock");
  assert.deepEqual(activation.skills.map(skill => skill.id), [...routing.selected].sort());
  assert.deepEqual(activation.routing, routing);
  const read = readActivatedSkillFile(lock, activation, f.environment, { skillId: "craft-characters", path: "SKILL.md" }, { via: "read_guidance" });
  assert.equal(read.evidence.via, "read_guidance"); assert.equal(read.evidence.bytes, Buffer.byteLength(read.content));
  assert.equal(readActivatedSkillFile(lock, activation, f.environment, { skillId: "production", path: "SKILL.md" }).evidence.via, "inject");
  assert.throws(() => readActivatedSkillFile(lock, activation, f.environment, { skillId: "craft-music-timing", path: "SKILL.md" }), { code: "SKILL_NOT_LOCKED" });
  assert.throws(() => readActivatedSkillFile(lock, activation, f.environment, { skillId: "craft-story", path: "references/missing.md" }), /declared instruction files/);
  assert.throws(() => readActivatedSkillFile(lock, activation, f.environment, { skillId: "craft-story", path: "openslate.skill.json" }), /declared instruction files/);
  assert.throws(() => readActivatedSkillFile(lock, activation, f.environment, { skillId: "craft-story", path: "../production/SKILL.md" }), /Unsafe package path/);
  const { activationDigest: _, ...body } = activation; const forged = { ...body, routing: { ...routing, selected: [...routing.selected, "craft-characters"] } };
  assert.throws(() => readActivatedSkillFile(lock, { ...forged, activationDigest: "0".repeat(64) }, f.environment, { skillId: "production", path: "SKILL.md" }), { code: "SKILL_ACTIVATION_INVALID" });
});

test("the CI budget check measures entries, references and the worst-case injection", t => {
  const release = fixture(t, { release: { budget: { injectedWords: 10000, entryWords: { core: 5000, type: 100, craft: 600, format: 700 }, referenceWords: 700 } } }).load();
  const report = skillReleaseBudget(release);
  assert.ok(report.violations.some(item => item.startsWith("type-music-video/SKILL.md")), "a type entry over its budget");
  assert.ok(report.violations.some(item => item.startsWith("craft-story/references/frameworks.md")), "a reference over its budget");
  assert.ok(report.worstCaseInjectedWords > 0);
  const generous = skillReleaseBudget(fixture(t, { release: { budget: { injectedWords: 1000000, entryWords: { core: 100000, type: 100000, craft: 100000, format: 100000 }, referenceWords: 100000 } } }).load());
  assert.deepEqual(generous.violations, []);
  const tight = skillReleaseBudget(fixture(t, { release: { budget: { injectedWords: 100, entryWords: { core: 100000, type: 100000, craft: 100000, format: 100000 }, referenceWords: 100000 } } }).load());
  assert.ok(tight.violations.some(item => item.startsWith("Worst-case injection")));
});

const shipped = join(repositoryRoot, "skills/v8");
test("the shipped v8 release validates, fits its word budget and keeps permissions in core", { skip: !existsSync(join(shipped, "release.json")) && "skills/v8 is assembled in a later step" }, t => {
  const root = mkdtempSync(join(tmpdir(), "openslate-shipped-release-")); t.after(() => cleanup(root));
  const release = loadSkillRelease({ snapshotRoot: join(root, "snapshots"), compatibility: contract("7.0.0"), availableToolIds: [...toolCatalog("7.0.0").names], releaseRoot: shipped, routeKinds: FILM_KINDS });
  assert.deepEqual(skillReleaseBudget(release).violations, []);
  for (const skill of release.catalog.skills.filter(item => item.manifest.role !== "core")) for (const file of skill.manifest.files) {
    const text = readFileSync(join(skill.immutableRoot, file), "utf8");
    assert.doesNotMatch(text, /regenerate:\s*true|accept_proposal|reject_proposal/, `${skill.id}/${file} must leave permissions and decisions to core`);
  }
});
