import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { compilePlan } from "@openslate/core";
import { SKILL_LIMITS, SKILL_TOOL_IDS, loadSkillCatalog, verifySkillSnapshot, createSkillLock, verifySkillLock, activateSkills, readActivatedSkillFile } from "../dist/skills/index.js";

const compatibility = { toolContract: "1.0.0", planLanguage: "1.0.0", workflowContract: "1.0.0" };
const checksum = value => createHash("sha256").update(value).digest("hex");
function cleanup(root) {
  if (!existsSync(root)) return;
  function writable(path) { const stat = lstatSync(path); if (stat.isSymbolicLink()) return; if (stat.isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) writable(join(path, name)); } }
  writable(root); rmSync(root, { recursive: true, force: true });
}
function fixture(t, id = "production") {
  const root = mkdtempSync(join(tmpdir(), "openslate-skills-")); t.after(() => cleanup(root));
  const source = join(root, "source", id); mkdirSync(join(source, "references"), { recursive: true });
  const manifest = { id, version: "1.0.0", entry: "SKILL.md", files: ["SKILL.md", "references/guide.md", "references/context.json"], compatibility, requiredToolIds: [...SKILL_TOOL_IDS] };
  writeFileSync(join(source, "openslate.skill.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(source, "SKILL.md"), `---\nname: ${id}\ndescription: "Use for bounded production reasoning."\n---\n# Guide\nRead [guidance](references/guide.md) and [data](references/context.json).\n`);
  writeFileSync(join(source, "references/guide.md"), "# Human review\nKeep unchanged takes.\n");
  writeFileSync(join(source, "references/context.json"), '{"mode":"instruction-only"}\n');
  const environment = { snapshotRoot: join(root, "snapshots"), compatibility, availableToolIds: [...SKILL_TOOL_IDS] };
  const load = () => loadSkillCatalog({ ...environment, packageRoots: [source] });
  const setManifest = patch => writeFileSync(join(source, "openslate.skill.json"), JSON.stringify({ ...manifest, ...patch }));
  return { root, source, manifest, environment, load, setManifest };
}
function lockFor(f, catalog = f.load(), bindings = []) {
  return createSkillLock(catalog, { selectedSkillIds: ["production"], bindings, prompts: [{ id: "production/review@1", skillId: "production", path: "references/guide.md" }] });
}

test("snapshots cover exact bytes, ignore source location/timestamps, and publish no temporary paths", t => {
  const f = fixture(t); const first = f.load().skills[0];
  assert.equal(first.files.length, 4);
  assert.equal(first.files.find(file => file.path === "openslate.skill.json").sha256, checksum(readFileSync(join(f.source, "openslate.skill.json"))));
  assert.equal(lstatSync(first.entryPath).mode & 0o222, 0);
  assert.deepEqual(readdirSync(f.environment.snapshotRoot), [first.packageDigest]);
  utimesSync(join(f.source, "references/guide.md"), new Date(0), new Date(0));
  assert.equal(f.load().skills[0].packageDigest, first.packageDigest);
  const other = join(f.root, "different-checkout"); cpSync(f.source, other, { recursive: true });
  const elsewhere = loadSkillCatalog({ ...f.environment, packageRoots: [other] });
  assert.equal(elsewhere.skills[0].packageDigest, first.packageDigest);
  writeFileSync(join(f.source, "openslate.skill.json"), `${JSON.stringify(f.manifest)}\n`);
  assert.notEqual(f.load().skills[0].packageDigest, first.packageDigest, "manifest formatting bytes also belong to identity");
});

test("a lock never follows source edits; successive requests get explicit selection and fresh context identities", t => {
  const f = fixture(t); const catalog = f.load(); const lock = lockFor(f, catalog);
  const first = activateSkills(lock, { ...f.environment, requestId: "request-1", contextDigest: checksum("project revision 1"), selectedSkillIds: ["production"], stageBindings: [{ stageId: "review", scopeId: "scene-1", promptId: "production/review@1", proposalId: "proposal-1" }] });
  writeFileSync(join(f.source, "references/guide.md"), "# Revised guidance\nAsk a new question.\n");
  const successor = f.load(); assert.notEqual(successor.skills[0].packageDigest, catalog.skills[0].packageDigest);
  const second = activateSkills(lock, { ...f.environment, requestId: "request-2", contextDigest: checksum("project revision 2"), selectedSkillIds: ["production"] });
  assert.equal(first.skills[0].packageDigest, second.skills[0].packageDigest);
  assert.notEqual(first.activationId, second.activationId); assert.notEqual(first.contextSnapshotId, second.contextSnapshotId); assert.notEqual(first.contextDigest, second.contextDigest);
  const read = readActivatedSkillFile(JSON.parse(JSON.stringify(lock)), JSON.parse(JSON.stringify(second)), f.environment, { skillId: "production", path: "references/guide.md" });
  assert.match(read.content, /Keep unchanged takes/);
  assert.equal(read.evidence.requestId, "request-2"); assert.equal(read.evidence.contextSnapshotId, second.contextSnapshotId);
  assert.equal(first.stageBindings[0].promptSha256, read.evidence.sha256);
  assert.throws(() => { lock.skills[0].version = "2.0.0"; }, TypeError);
  const none = activateSkills(lock, { ...f.environment, requestId: "status-request", contextDigest: checksum("same state"), selectedSkillIds: [] });
  assert.equal(none.skills.length, 0);
  assert.throws(() => readActivatedSkillFile(lock, none, f.environment, { skillId: "production", path: "references/guide.md" }), { code: "SKILL_NOT_ACTIVATED" });
  assert.throws(() => activateSkills(lock, { ...f.environment, requestId: "missing-selection", contextDigest: checksum("state") }), /bounded array/);
  assert.throws(() => activateSkills(lock, { ...f.environment, requestId: "unlocked", contextDigest: checksum("state"), selectedSkillIds: ["plan-authoring"] }), { code: "SKILL_NOT_LOCKED" });
});

test("compatibility locks reject changed runtime implementations, contracts, missing tools and tampered records", t => {
  const f = fixture(t); const bindings = [{ kind: "compiler", id: "typescript-plan-v1", digest: checksum("build-1") }];
  const lock = lockFor(f, f.load(), bindings); const environment = { ...f.environment, bindings };
  assert.equal(verifySkillLock(lock, environment).length, 1);
  assert.throws(() => verifySkillLock(lock, f.environment), { code: "SKILL_COMPATIBILITY_MISMATCH" });
  assert.throws(() => verifySkillLock(lock, { ...environment, bindings: [{ ...bindings[0], digest: checksum("build-2") }] }), { code: "SKILL_COMPATIBILITY_MISMATCH" });
  assert.throws(() => verifySkillLock(lock, { ...environment, compatibility: { ...compatibility, planLanguage: "2.0.0" } }), { code: "SKILL_COMPATIBILITY_MISMATCH" });
  assert.throws(() => verifySkillLock(lock, { ...environment, availableToolIds: ["read_context"] }), { code: "SKILL_COMPATIBILITY_MISMATCH" });
  assert.throws(() => verifySkillLock({ ...lock, skills: [{ ...lock.skills[0], version: "2.0.0" }] }, environment), { code: "SKILL_LOCK_INVALID" });
  const activation = activateSkills(lock, { ...environment, requestId: "request", contextDigest: checksum("context"), selectedSkillIds: ["production"] });
  assert.throws(() => readActivatedSkillFile(lock, { ...activation, requestId: "another-authority" }, environment, { skillId: "production", path: "SKILL.md" }), { code: "SKILL_ACTIVATION_INVALID" });
});

test("corrupt or missing snapshots fail closed without replacing pinned bytes from source", t => {
  const f = fixture(t); const catalog = f.load(); const skill = catalog.skills[0]; const lock = lockFor(f, catalog);
  const ref = join(skill.immutableRoot, "references/guide.md"); chmodSync(ref, 0o644); writeFileSync(ref, "corruption"); chmodSync(ref, 0o444);
  assert.throws(() => verifySkillSnapshot(f.environment.snapshotRoot, skill.packageDigest), { code: "SKILL_SNAPSHOT_INVALID" });
  assert.throws(f.load, { code: "SKILL_SNAPSHOT_INVALID" });
  assert.equal(readFileSync(ref, "utf8"), "corruption", "source reload must not repair a published identity in place");
  assert.throws(() => activateSkills(lock, { ...f.environment, requestId: "request", contextDigest: checksum("context"), selectedSkillIds: ["production"] }), { code: "SKILL_SNAPSHOT_INVALID" });
  cleanup(skill.immutableRoot);
  assert.throws(() => verifySkillLock(lock, f.environment), { code: "SKILL_SNAPSHOT_INVALID" });
});

test("snapshot writable modes and extra files are rejected even when declared content hashes match", t => {
  const f = fixture(t); const skill = f.load().skills[0];
  chmodSync(skill.entryPath, 0o644);
  assert.throws(() => verifySkillSnapshot(f.environment.snapshotRoot, skill.packageDigest), { code: "SKILL_SNAPSHOT_INVALID" });
  chmodSync(skill.entryPath, 0o444); chmodSync(skill.immutableRoot, 0o755);
  writeFileSync(join(skill.immutableRoot, "extra.md"), "unexpected"); chmodSync(skill.immutableRoot, 0o555);
  assert.throws(() => verifySkillSnapshot(f.environment.snapshotRoot, skill.packageDigest), { code: "SKILL_SNAPSHOT_INVALID" });
});

test("duplicate IDs are rejected before publishing either package", t => {
  const f = fixture(t); const second = join(f.root, "duplicate"); cpSync(f.source, second, { recursive: true });
  assert.throws(() => loadSkillCatalog({ ...f.environment, packageRoots: [f.source, second] }), /Duplicate skill id/);
  assert.equal(existsSync(f.environment.snapshotRoot), false);
});

test("the maximum declared file count and long paths fit verified snapshot metadata", t => {
  const f = fixture(t); const directory = "r".repeat(160); mkdirSync(join(f.source, directory));
  const extra = Array.from({ length: SKILL_LIMITS.files - f.manifest.files.length }, (_, index) => `${directory}/reference-${index}.md`);
  for (const name of extra) writeFileSync(join(f.source, name), "Bounded reference.\n");
  f.setManifest({ files: [...f.manifest.files, ...extra] });
  const skill = f.load().skills[0];
  assert.equal(skill.files.length, SKILL_LIMITS.files + 1);
  assert.ok(readFileSync(join(skill.immutableRoot, ".openslate-snapshot.json")).length > SKILL_LIMITS.manifestBytes);
  assert.equal(verifySkillSnapshot(f.environment.snapshotRoot, skill.packageDigest).packageDigest, skill.packageDigest);
});

test("concurrent publishers converge on one complete verified snapshot", async t => {
  const f = fixture(t);
  const moduleUrl = new URL("../dist/skills/index.js", import.meta.url).href;
  const code = `import {loadSkillCatalog} from ${JSON.stringify(moduleUrl)}; const c=loadSkillCatalog(JSON.parse(process.argv[1])); process.stdout.write(c.skills[0].packageDigest);`;
  const options = JSON.stringify({ ...f.environment, packageRoots: [f.source] });
  const run = promisify(execFile);
  const outputs = await Promise.all([1, 2].map(() => run(process.execPath, ["--input-type=module", "--eval", code, options], { timeout: 10000 })));
  assert.equal(outputs[0].stdout, outputs[1].stdout);
  assert.deepEqual(readdirSync(f.environment.snapshotRoot), [outputs[0].stdout]);
  assert.equal(verifySkillSnapshot(f.environment.snapshotRoot, outputs[0].stdout).id, "production");
});

for (const [label, patch] of [
  ["unknown manifest fields", { scripts: ["run.sh"] }],
  ["noncanonical id", { id: "../escape" }],
  ["version ranges", { version: "^1.0.0" }],
  ["prerelease contracts", { compatibility: { ...compatibility, toolContract: "1.0.0-beta" } }],
  ["incompatible contracts", { compatibility: { ...compatibility, workflowContract: "2.0.0" } }],
  ["unknown tool", { requiredToolIds: ["shell"] }],
  ["duplicate tools", { requiredToolIds: ["read_context", "read_context"] }],
  ["non-native entry", { entry: "references/guide.md" }],
  ["undeclared entry", { files: ["references/guide.md"] }],
  ["duplicate files", { files: ["SKILL.md", "SKILL.md"] }],
  ["explicit manifest", { files: ["SKILL.md", "openslate.skill.json"] }],
  ["traversal", { files: ["SKILL.md", "../external.md"] }],
  ["absolute paths", { files: ["SKILL.md", "/external.md"] }],
  ["backslash traversal", { files: ["SKILL.md", "..\\external.md"] }],
  ["scripts", { files: ["SKILL.md", "run.ts"] }],
]) test(`strict manifest rejects ${label}`, t => { const f = fixture(t); f.setManifest(patch); assert.throws(f.load); });

test("JSON duplicate keys and excessive nesting are rejected in declared references", t => {
  const f = fixture(t);
  writeFileSync(join(f.source, "references/context.json"), '{"mode":"first","mode":"second"}'); assert.throws(f.load, /Duplicate JSON key/);
  writeFileSync(join(f.source, "references/context.json"), `${"[".repeat(34)}null${"]".repeat(34)}`); assert.throws(f.load, /complexity limit/);
  writeFileSync(join(f.source, "references/context.json"), '{"ok":true}');
  writeFileSync(join(f.source, "openslate.skill.json"), `{"id":"wrong",${JSON.stringify(f.manifest).slice(1)}`); assert.throws(f.load, /Duplicate JSON key/);
});

test("references must exist, stay within the package, and be explicitly declared", t => {
  const f = fixture(t);
  for (const link of ["missing.md", "../../external.md", "%2e%2e/%2e%2e/external.md", "file:///tmp/external.md", "javascript:alert(1)"]) {
    writeFileSync(join(f.source, "references/guide.md"), `[unsupported](${link})`); assert.throws(f.load, undefined, link);
  }
  writeFileSync(join(f.source, "references/guide.md"), "Read [entry](../SKILL.md) and [official source](https://example.com/documentation).\n");
  assert.equal(f.load().skills.length, 1);
  writeFileSync(join(f.source, "undeclared.md"), "extra"); assert.throws(f.load, /missing or undeclared/);
});

for (const kind of ["file", "directory", "package-root"]) test(`symlink ${kind} cannot enter a trusted instruction snapshot`, t => {
  const f = fixture(t); const outside = join(f.root, "outside"); mkdirSync(outside);
  if (kind === "file") { rmSync(join(f.source, "references/guide.md")); writeFileSync(join(outside, "guide.md"), "external"); symlinkSync(join(outside, "guide.md"), join(f.source, "references/guide.md")); }
  if (kind === "directory") { cpSync(join(f.source, "references"), outside, { recursive: true }); rmSync(join(f.source, "references"), { recursive: true }); symlinkSync(outside, join(f.source, "references")); }
  if (kind === "package-root") { const link = join(f.root, "package-link"); symlinkSync(f.source, link); assert.throws(() => loadSkillCatalog({ ...f.environment, packageRoots: [link] })); return; }
  assert.throws(f.load, /Symlinks/);
});

test("frontmatter, encoding, executable mode, and file bounds are enforced", t => {
  const f = fixture(t); const entry = join(f.source, "SKILL.md"); const original = readFileSync(entry);
  writeFileSync(entry, "---\nname: wrong\ndescription: test\n---\nbody"); assert.throws(f.load, /must match/);
  writeFileSync(entry, "---\nname: production\ndescription: >\n  folded YAML\n---\nbody"); assert.throws(f.load, /Complex YAML/);
  writeFileSync(entry, original); chmodSync(entry, 0o755); assert.throws(f.load, /non-executable/); chmodSync(entry, 0o644);
  writeFileSync(join(f.source, "references/guide.md"), Buffer.from([0xff, 0xfe])); assert.throws(f.load, /valid UTF-8/);
  writeFileSync(join(f.source, "references/guide.md"), "x".repeat(SKILL_LIMITS.fileBytes + 1)); assert.throws(f.load, /bounded/);
});

test("stage prompts must belong to selected pinned skills and duplicate bindings are rejected", t => {
  const f = fixture(t); const catalog = f.load(); const lock = lockFor(f, catalog);
  assert.throws(() => createSkillLock(catalog, { selectedSkillIds: ["production"], bindings: [], prompts: [{ id: "prompt", skillId: "production", path: "references/missing.md" }] }), /declared instruction/);
  assert.throws(() => activateSkills(lock, { ...f.environment, requestId: "request", contextDigest: checksum("context"), selectedSkillIds: [], stageBindings: [{ stageId: "review", scopeId: "scene", promptId: "production/review@1" }] }), /explicitly selected/);
  assert.throws(() => activateSkills(lock, { ...f.environment, requestId: "request", contextDigest: checksum("context"), selectedSkillIds: ["production", "production"] }), /Duplicate selected/);
  const binding = { kind: "compiler", id: "one", digest: checksum("build") };
  assert.throws(() => createSkillLock(catalog, { selectedSkillIds: ["production"], bindings: [binding, binding] }), /Duplicate capability/);
});

test("repository production and plan-authoring packages resolve and activate with exact stage prompt provenance", t => {
  const root = mkdtempSync(join(tmpdir(), "openslate-bundled-skills-")); t.after(() => cleanup(root));
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const environment = { snapshotRoot: join(root, "snapshots"), compatibility, availableToolIds: [...SKILL_TOOL_IDS] };
  const catalog = loadSkillCatalog({ ...environment, packageRoots: [join(repository, "skills/production"), join(repository, "skills/plan-authoring")] });
  assert.deepEqual(catalog.skills.map(skill => skill.id), ["plan-authoring", "production"]);
  const lock = createSkillLock(catalog, { selectedSkillIds: ["production", "plan-authoring"], bindings: [], prompts: [{ id: "production/shot_plan@1", skillId: "production", path: "references/stages/shot_plan.md" }] });
  const activation = activateSkills(lock, { ...environment, requestId: "request-storyboard-edit", contextDigest: checksum("accepted narration and two shots"), selectedSkillIds: ["production", "plan-authoring"], stageBindings: [{ stageId: "shot_plan", scopeId: "shot-1", promptId: "production/shot_plan@1" }] });
  const read = readActivatedSkillFile(lock, activation, environment, { skillId: "production", path: "references/stages/shot_plan.md" });
  assert.equal(read.evidence.sha256, activation.stageBindings[0].promptSha256);
  assert.ok(read.content.length > 0);
  assert.throws(() => readActivatedSkillFile(lock, activation, environment, { skillId: "production", path: "openslate.skill.json" }), /declared instruction/);
});

test("shipped plan-authoring example compiles, round-trips and still requires an exact review declaration", () => {
  const repository = fileURLToPath(new URL("../../../", import.meta.url));
  const document = readFileSync(join(repository, "skills/plan-authoring/references/example.md"), "utf8");
  const examples = [...document.matchAll(/^```typescript\n([\s\S]*?)^```/gm)]; assert.equal(examples.length, 1);
  const source = examples[0][1];
  const context = JSON.parse(readFileSync(join(repository, "skills/plan-authoring/references/example-context.json"), "utf8"));
  const compiled = compilePlan(source, { ...structuredClone(context), allocateId: randomUUID });
  assert.deepEqual(compiled.nodes.map(node => node.kind), ["image", "video", "timeline", "render"]);
  assert.equal(compiled.gates.length, 1);
  assert.equal(compiled.nodes.find(node => node.kind === "video").inputs[0].role, "first_frame");
  const roundtrip = compilePlan(compiled.canonicalSource, { ...structuredClone(context), allocateId: randomUUID });
  assert.equal(roundtrip.graphDigest, compiled.graphDigest);
  const unsafe = source.replace("p.approvedImage(frame, review)", "frame"); assert.notEqual(unsafe, source);
  assert.throws(() => compilePlan(unsafe, { ...structuredClone(context), allocateId: randomUUID }), /review|approved/i);
});
