import test from "node:test";
import assert from "node:assert/strict";
import { translate, translateUiText } from "../src/legacy/locale-model.ts";
import { hierarchyUiLabel, workbenchCopy } from "../src/legacy/workbench-copy.ts";
import { makeReferencedMessage, referenceKey } from "../src/legacy/reference-model.ts";

const translator = (locale) => (english, chinese, values) =>
  translate(locale, english, chinese, values);

test("workbench review and uncertain-outcome labels translate as exact UI copy while execution phases remain unchanged", () => {
  assert.equal(
    translateUiText("Awaiting review", "zh-CN", workbenchCopy),
    "待检查",
  );
  assert.equal(
    translateUiText("待检查", "en", workbenchCopy),
    "Awaiting review",
  );
  assert.equal(
    translateUiText("Outcome unconfirmed", "zh-CN", workbenchCopy),
    "结果待核实",
  );
  for (const value of [
    "submission_unknown",
    "fake-image-v1",
    "gpt-image-2",
    "My shot says 当前关键帧 and must keep these words.",
  ]) {
    assert.equal(translateUiText(value, "en", workbenchCopy), value);
    assert.equal(translateUiText(value, "zh-CN", workbenchCopy), value);
  }
});

test("canonical hierarchy presentation changes language without translating custom or project titles", () => {
  assert.equal(
    hierarchyUiLabel("Shot 2.7", "shot", translator("zh-CN")),
    "镜头 2.7",
  );
  assert.equal(
    hierarchyUiLabel("Scene 03", "scene", translator("zh-CN")),
    "场景 03",
  );
  assert.equal(
    hierarchyUiLabel("Shot 2.7", "shot", translator("en")),
    "Shot 2.7",
  );
  assert.equal(
    hierarchyUiLabel("Shot 2.7", "project", translator("zh-CN")),
    "Shot 2.7",
  );
  assert.equal(
    hierarchyUiLabel("Scene 03: 我的场景", "scene", translator("en")),
    "Scene 03: 我的场景",
  );
});

test("displaying a localized reference cannot change its submitted scope, reference text or retry identity", () => {
  const project = {
    id: "project",
    name: "保留原名",
    scenes: [{ id: "scene", purpose: "原始意图" }],
    shots: [{ id: "shot", sceneId: "scene", purpose: "User-authored label" }],
  };
  const reference = Object.freeze({
    key: referenceKey("project", "shot", "shot"),
    projectId: "project",
    kind: "shot",
    id: "shot",
    label: "Shot 1.1",
    detail: "保留用户文字",
  });
  const before = makeReferencedMessage(
    project,
    "Do not translate this prompt: 当前关键帧",
    [],
    [reference],
    "same-key",
    true,
    false,
  );
  assert.equal(
    hierarchyUiLabel(reference.label, reference.kind, translator("zh-CN")),
    "镜头 1.1",
  );
  assert.equal(
    hierarchyUiLabel(reference.label, reference.kind, translator("en")),
    "Shot 1.1",
  );
  const after = makeReferencedMessage(
    project,
    "Do not translate this prompt: 当前关键帧",
    [],
    [reference],
    "same-key",
    true,
    false,
  );
  assert.deepEqual(after, before);
  assert.equal(after.key, "same-key");
  assert.deepEqual(after.body.scopeIds, ["shot"]);
  assert.match(after.body.text, /\[@Shot 1\.1\]/);
  assert.match(after.body.text, /Do not translate this prompt: 当前关键帧$/);
});

test("parameterized UI captions interpolate user text once without translating its content", () => {
  const purpose = "保持光线柔和 — Keep {number} exactly as written";
  assert.equal(
    translate("en", "Shot {number}: {purpose}", "镜头 {number}：{purpose}", {
      number: "1.2",
      purpose,
    }),
    "Shot 1.2: " + purpose,
  );
  assert.equal(
    translate("zh-CN", "Shot {number}: {purpose}", "镜头 {number}：{purpose}", {
      number: "1.2",
      purpose,
    }),
    "镜头 1.2：" + purpose,
  );
});
