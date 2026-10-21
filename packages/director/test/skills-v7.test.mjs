import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { STAGES, applyCreativePatch, parseToolArguments, toolCatalog } from "@openslate/core";
import { activateSkills, createSkillLock, loadSkillCatalog, readActivatedSkillFile, verifySkillLock } from "../dist/skills/index.js";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const skillFile = path => readFileSync(join(repository, "skills/v7", path), "utf8");
const jsonExamples = path => [...skillFile(path).matchAll(/^```json\n([\s\S]*?)^```/gm)].map(match => JSON.parse(match[1]));
function cleanup(path) {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) cleanup(join(path, name));
  }
  rmSync(path, { recursive: true, force: true });
}

test("V7 packages activate every stage with contract 6 and retain verified instruction provenance", t => {
  const root = mkdtempSync(join(tmpdir(), "openslate-v7-guidance-"));
  t.after(() => cleanup(root));
  const environment = {
    snapshotRoot: join(root, "snapshots"),
    compatibility: { toolContract: "6.0.0", planLanguage: "1.0.0", workflowContract: "1.0.0" },
    availableToolIds: [...toolCatalog("6.0.0").names],
  };
  const catalog = loadSkillCatalog({ ...environment, packageRoots: ["production", "plan-authoring"].map(id => join(repository, "skills/v7", id)) });
  assert.deepEqual(catalog.skills.map(skill => [skill.id, skill.version]), [["plan-authoring", "7.0.0"], ["production", "7.0.0"]]);
  const lock = createSkillLock(catalog, { selectedSkillIds: ["production", "plan-authoring"], bindings: [],
    prompts: STAGES.map(stage => ({ id: `production/${stage}@1`, skillId: "production", path: `references/stages/${stage}.md` })) });
  assert.equal(verifySkillLock(lock, environment).length, 2);
  const activation = activateSkills(lock, { ...environment, requestId: "v7-storyboard", contextDigest: "a".repeat(64),
    selectedSkillIds: ["production", "plan-authoring"],
    stageBindings: STAGES.map(stage => ({ stageId: stage, scopeId: "scene", promptId: `production/${stage}@1` })) });
  for (const binding of activation.stageBindings) {
    const read = readActivatedSkillFile(lock, activation, environment, { skillId: "production", path: `references/stages/${binding.stageId}.md` });
    assert.equal(read.evidence.sha256, binding.promptSha256);
    assert.match(read.content, new RegExp(`^# production/${binding.stageId}@1`));
  }
  assert.throws(() => loadSkillCatalog({ ...environment, snapshotRoot: join(root, "old-contract"),
    compatibility: { ...environment.compatibility, toolContract: "5.0.0" },
    packageRoots: [join(repository, "skills/v7/production")] }), { code: "SKILL_COMPATIBILITY_MISMATCH" });
});

test("V7 replaces the generation example with a contract-6 creative patch that saves scene title and shot links", () => {
  const examples = jsonExamples("plan-authoring/references/example.md");
  assert.equal(examples.length, 1);
  const change = parseToolArguments("prepare_change", examples[0], "6.0.0").arguments;
  assert.equal(change.variant, "project");
  assert.equal(change.source, undefined);
  assert.equal(change.requestNewTakes, undefined);
  const fixture = JSON.parse(skillFile("plan-authoring/references/example-context.json"));
  assert.equal(change.expectedHeadVersion, fixture.project.headVersion);
  const before = structuredClone(fixture.project);
  const saved = applyCreativePatch(before, change.creative, shot => shot);
  assert.deepEqual(before, fixture.project, "creative application preserves the supplied review baseline");
  assert.equal(saved.scenes.length, 1);
  assert.equal(saved.scenes[0].title, fixture.expected.sceneTitle);
  assert.equal(saved.scenes[0].purpose, fixture.expected.scenePurpose);
  assert.equal(saved.shots.length, 1);
  assert.equal(saved.shots[0].sceneId, saved.scenes[0].id);
  assert.notEqual(saved.shots[0].id, "stitching");
  assert.equal(saved.shots[0].framing, fixture.expected.framing);
  assert.equal(saved.shots[0].desiredFrames, fixture.expected.desiredFrames);
  assert.deepEqual(saved.shots[0].narration, { mode: "none", text: "", voice: "stock" });
  assert.throws(() => parseToolArguments("prepare_change", examples[0], "5.0.0"), { code: "VALIDATION_ERROR" });
});

test("V7 notes exercise the complete coherent proposal field set and earlier catalogs refuse it", () => {
  const examples = jsonExamples("production/references/notes.md");
  assert.equal(examples.length, 1);
  const proposed = parseToolArguments("propose_change", examples[0], "6.0.0").arguments;
  assert.deepEqual(Object.keys(proposed.patch.updateShots[0]).sort(), ["id", "purpose", "action", "framing", "motion", "desiredFrames", "imagePrompt", "videoPrompt", "narration"].sort());
  assert.deepEqual(Object.keys(proposed.patch.updateScenes[0]).sort(), ["id", "title", "purpose"].sort());
  assert.equal(proposed.source, undefined);
  assert.equal(proposed.requestNewTakes, undefined);
  assert.throws(() => parseToolArguments("propose_change", examples[0], "5.0.0"), { code: "VALIDATION_ERROR" });
  const wrongFraming = structuredClone(examples[0]);
  wrongFraming.patch.updateShots[0].framing = "A long descriptive framing label";
  assert.throws(() => parseToolArguments("propose_change", wrongFraming, "6.0.0"), { code: "VALIDATION_ERROR" });
});


test('V7 keyframe examples name one requested scope and reserve regeneration for explicit shots', () => {
  const examples = jsonExamples('production/references/keyframes.md');
  assert.equal(examples.length, 3);
  for (const input of examples) assert.deepEqual(parseToolArguments('make_keyframes', input, '6.0.0').arguments, input);
  assert.deepEqual(examples, [{ sceneIds: ['requested-scene-id'] }, { shotIds: ['requested-shot-id'] }, { shotIds: ['requested-shot-id'], regenerate: true }]);
  const keyframes = skillFile('production/references/keyframes.md');
  assert.match(keyframes, /fresh human conversation request in an editing turn/);
  assert.match(keyframes, /Never send both lists/);
  assert.match(keyframes, /Report the actual returned keyframe and voice-line work, its price\/quote/);
  assert.match(keyframes, /per-scene refusal code/);
  assert.match(keyframes, /replies to a review.*read-only turns.*discuss-only turns.*cannot start/);
  assert.match(keyframes, /Video is always human-only/);
  assert.match(keyframes, /Never blindly resubmit an unknown outcome/);
  for (const name of ['production', 'plan-authoring']) {
    const manifest = JSON.parse(skillFile(`${name}/openslate.skill.json`));
    assert.ok(manifest.requiredToolIds.includes('make_keyframes'));
    assert.match(skillFile(`${name}/SKILL.md`), /make_keyframes/);
  }
});

test('V7 audio guidance permits only eligible current-request transcription and preserves explicit adoption', () => {
  const text = skillFile('production/references/audio-proposals.md');
  assert.match(text, /audio attachment sent by the person with this fresh editing conversation/);
  assert.match(text, /asks what it says or its line is needed/);
  assert.match(text, /Automatic, review, review-reply, read-only and discuss-only turns never start transcription/);
  assert.match(text, /Other recordings remain pending transcription suggestions/);
  assert.match(text, /transcripts never attach, adopt or accept themselves/);
  assert.match(text, /never resubmit blindly/);
});
