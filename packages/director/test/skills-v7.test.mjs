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
  assert.match(keyframes, /Use the actual returned keyframe and voice-line work and its price\/quote as evidence/);
  assert.match(keyframes, /Only the application's reported outcome establishes that work started/);
  assert.match(keyframes, /replies to a review.*read-only turns.*discuss-only turns.*cannot start/);
  assert.match(keyframes, /scene-anchored note for each with a `confirm_video` choice/);
  assert.match(keyframes, /Confirm in this chat or in Keyframes/);
  assert.match(keyframes, /Offering a choice starts nothing/);
  assert.match(keyframes, /Never blindly resubmit an unknown outcome/);
  for (const name of ['production', 'plan-authoring']) {
    const manifest = JSON.parse(skillFile(`${name}/openslate.skill.json`));
    assert.ok(manifest.requiredToolIds.includes('make_keyframes'));
    assert.match(skillFile(`${name}/SKILL.md`), /make_keyframes/);
  }
});

test('V7 keeps clicked confirmation for video while clear typed decisions settle proposals', () => {
  for (const path of ['production/SKILL.md', 'production/references/notes.md', 'production/references/keyframes.md', 'production/references/stages/review.md', 'production/references/stages/video.md', 'plan-authoring/SKILL.md', 'plan-authoring/references/grammar.md']) {
    const text = skillFile(path);
    assert.match(text, /confirm_video/, path);
    assert.match(text, /Confirm in this chat or in Keyframes/, path);
    assert.match(text, /regenerate_keyframe/, path);
    assert.ok(text.includes('For video, point to the Confirm card in the chat or in Keyframes; offer a fresh one if the old one is settled or stale.'), path);
    assert.match(text, /(?:after|until) the application reports it/, path);
  }
  const notes = skillFile('production/references/notes.md');
  assert.match(notes, /confirm_video` is not an accept\/keep choice/);
  assert.match(notes, /Offering choices in editing or keyframe-review turns starts nothing and costs nothing/);
  assert.match(notes, /first chat or workspace action settles the note/);
  assert.match(notes, /elsewhere: true/);
  assert.match(notes, /settled note stays settled/);
  assert.match(notes, /proposal` choice.*Now\/After preview in chat/);
  for (const path of ['production/SKILL.md', 'production/references/notes.md', 'production/references/current-contract.md', 'plan-authoring/SKILL.md', 'plan-authoring/references/grammar.md']) {
    const text = skillFile(path);
    assert.match(text, /accept_proposal/, path);
    assert.match(text, /reject_proposal/, path);
    assert.match(text, /\{proposalId\}/, path);
    assert.match(text, /letter, subject.*only held proposal/, path);
    assert.match(text, /several are open.*ambiguous.*ask which one/s, path);
    assert.match(text, /continue other requested work.*accepted prompts/, path);
  }
  assert.match(notes, /source: "user"/);
  assert.match(notes, /App-message, keyframe-review, automatic and read-only turns cannot make proposal decisions/);
  assert.match(notes, /Only a successful application receipt establishes a proposal decision/);
  assert.match(notes, /use its reported state for the next action/);
  for (const name of ['production', 'plan-authoring']) {
    const manifest = JSON.parse(skillFile(`${name}/openslate.skill.json`));
    assert.ok(manifest.requiredToolIds.includes('accept_proposal'));
    assert.ok(manifest.requiredToolIds.includes('reject_proposal'));
  }
  for (const path of readdirSync(join(repository, 'skills/v7'), { recursive: true }).filter(path => path.endsWith('.md'))) {
    assert.doesNotMatch(skillFile(path), /chat approval (?:cannot|can't) replace|go (?:find|press) the button|conversation never starts video|Video is always human-only/i, path);
  }
});

test('V7 has one concise bilingual reply style shared by both skills and preserves outcome evidence', () => {
  const paths = readdirSync(join(repository, 'skills/v7'), { recursive: true }).filter(path => path.endsWith('.md'));
  const styles = paths.flatMap(path => [...skillFile(path).matchAll(/^## Reply style\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
    .map(match => ({ path, text: match[1] })));
  assert.equal(styles.length, 1, 'reply style is defined once across the v7 packages');
  assert.equal(styles[0].path, 'production/SKILL.md');
  const style = styles[0].text;
  assert.match(style, /Lead with concrete work saved, changed or started/);
  assert.match(style, /app-reported results and the price when returned/);
  assert.match(style, /Then give one plain next step or the one action/);
  assert.match(style, /Mention an unmet request only when the person asked for it, once, with a brief reason and a way forward/);
  assert.match(style, /concise in English and Chinese/);
  assert.match(style, /omit unrelated disclaimers and unsolicited app rules or limits/);
  assert.match(style, /omit 不代表\/不能视为\/不能评价\/我不会\/我没有 boilerplate/);
  assert.ok(style.includes('These rules govern what you do; do not recite rules or limits to the person.'));
  assert.match(style, /Only application evidence establishes that work started, was accepted or was saved/);
  assert.match(style, /unknown outcome's original operation and call identities/);
  assert.match(style, /inspect receipts and stop dependent work until reconciled; never resubmit blindly/);
  assert.match(style, /"waiting for the service's answer", with the next step/);
  assert.match(skillFile('plan-authoring/SKILL.md'), /Follow the production skill's Reply style/);
  assert.match(skillFile('plan-authoring/references/grammar.md'), /Only an apply receipt establishes saved writing/);
});

test('V7 removes instructions to recite negative disclaimers while retaining truth and money boundaries', () => {
  const paths = readdirSync(join(repository, 'skills/v7'), { recursive: true }).filter(path => path.endsWith('.md'));
  for (const path of paths) {
    const text = skillFile(path);
    assert.doesNotMatch(text, /report (?:any|a) refusal[^.]*without claiming success|report no saved change|report returned work, price and (?:per-scene )?refusals|and any per-scene refusal code/i, path);
    assert.doesNotMatch(text, /(?:say|state|tell|report)[^.\n]*(?:does not mean|nothing started|did not retry|cannot judge|not visually approved)/i, path);
    assert.doesNotMatch(text, /never (?:invent evidence or )?judge[^.\n]*picture|without (?:attached )?images[^.\n]*(?:discuss writing|ask[^.\n]*inspect)/i, `${path}: unseen-picture reply wording`);
    assert.doesNotMatch(text, /(?:distinguish|separate) technical availability from|(?:tool (?:receipts?|success)|saved output)[^.\n]*(?:not|isn't)[^.\n]*artistic quality/i, `${path}: technical/creative reply wording`);
    assert.doesNotMatch(text, /for video,[^.\n]*(?:yes|ok|go ahead)[^.\n]*(?:not confirmation|do not confirm)/i, `${path}: typed-video reply wording`);
    assert.doesNotMatch(text, /(?:held proposal(?: or note)?|proposal or note)[^.\n]*(?:not permission|cannot start|can't start)[^.\n]*paid work/i, `${path}: held-work reply wording`);
  }
  const keyframes = skillFile('production/references/keyframes.md');
  assert.match(keyframes, /only after the application reports it/);
  assert.match(keyframes, /Never blindly resubmit an unknown outcome/);
  assert.match(keyframes, /preserve its callId, inspect receipts and current outcomes/);
  assert.match(skillFile('production/references/notes.md'), /Never claim work started until the application reports it/);
});

test('V7 describes inspected pictures and saved work positively while preserving attached visual provenance', () => {
  for (const path of ['production/references/notes.md', 'production/references/continuity-review.md', 'production/references/stages/review.md']) {
    const text = skillFile(path);
    assert.match(text, /Comment on the pictures in `?attachedKeyframes`?/, path);
    assert.match(text, /creative observations grounded in those attached pictures/, path);
    assert.match(text, /For other pictures, describe what changed and offer to look once the person opens them\./, path);
  }
  assert.match(skillFile('production/references/notes.md'), /Copy `seenKeyframe` only from an exact attached entry\./);
  for (const path of ['production/SKILL.md', 'plan-authoring/SKILL.md', 'production/references/stages/review.md']) {
    const text = skillFile(path);
    assert.match(text, /Say what was made using application receipts/, path);
    assert.match(text, /give creative observations(?: on finished clips)? only from inspected media/, path);
  }
  assert.match(skillFile('production/references/stages/review.md'), /name the one step that needs the person's confirmation/);
  assert.match(skillFile('plan-authoring/SKILL.md'), /start requested keyframes from a fresh human editing request/);
  assert.match(skillFile('production/SKILL.md'), /Never author image, review or video declarations/);
  assert.match(skillFile('plan-authoring/SKILL.md'), /never declare new speech\/transcription source or pass suggestions to `apply_change`/);
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
