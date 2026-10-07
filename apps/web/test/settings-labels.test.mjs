import test from "node:test";
import assert from "node:assert/strict";
import {
  settingsAccountLine,
  settingsEstimate,
  settingsScopeLabel,
  settingsPlanCopy,
} from "../src/settings-labels.ts";
import { settingsUiTranslations } from "../src/settings-ui-translations.ts";
import { translateUiText } from "../src/locale-model.ts";
import { directorPlan } from "../src/director-plan-model.ts";
const shot = (id, sceneId = "scene") => ({
  id,
  sceneId,
  revisionId: `${id}-r`,
  purpose: "Custom purpose {count}",
  action: "",
  framing: "",
  motion: "",
  desiredFrames: 180,
  imagePrompt: "User image prompt",
  videoPrompt: "User video prompt",
  cueId: null,
  narration: { mode: "none", text: "Human narration", voice: "stock" },
});
function snapshot() {
  return {
    project: {
      id: "project",
      name: "Work is stopped",
      headVersion: 3,
      revisionId: "revision",
      activePlanId: null,
      brief: "Review the conversation",
      story: "Models for this project",
      scenes: [{ id: "scene", purpose: "User scene" }],
      shots: [shot("one"), shot("two")],
      cues: [],
      narration: { script: "Human script", source: "manual" },
    },
    plan: null,
    outputs: [],
    attempts: [],
    currentAttemptIds: [],
    holds: [],
    messages: [{ id: "request", text: "Work is stopped" }],
    conversation: [],
  };
}
const director = { mode: "native", status: "idle" };
function provider(adapter = "openai-image") {
  return {
    id: "owned-provider",
    label: "Models for this project",
    profile: {
      kind: "image",
      adapter,
      configuration: { model: "Custom model name {count}" },
    },
    readiness: {
      registered: true,
      configurationValid: true,
      credential: { required: true, present: true, backendUnavailable: false },
      mediaTools: { required: false, available: true },
      realExecutionEnabled: true,
    },
    estimatedCost: {
      basis: "host_configured",
      currency: "USD",
      unitMicros: "100001",
      actualVendorPriceVerified: false,
    },
  };
}
function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test("known Director model copy localizes all plan fields without mutating source or saved creative content", () => {
  const value = freeze(snapshot()),
    original = JSON.stringify(value),
    plan = freeze(directorPlan(value, director, null)),
    copy = settingsPlanCopy(value, plan, "zh-CN");
  assert.equal(copy.title, "分镜已保存");
  assert.equal(copy.detail, "场景和镜头方向已可继续完善。");
  assert.equal(copy.saved, "1 个场景 · 2 个镜头已保存。");
  assert.equal(copy.next, "讨论下一步修改，或检查需要制作的媒体。");
  assert.equal(copy.actionLabel, "查看场景操作");
  assert.equal(JSON.stringify(value), original);
  assert.equal(value.project.brief, "Review the conversation");
  assert.equal(value.project.name, "Work is stopped");
  assert.deepEqual(settingsPlanCopy(value, plan, "en"), {
    title: plan.title,
    detail: plan.detail,
    saved: plan.saved,
    next: plan.next,
    actionLabel: plan.actionLabel,
  });
});
test("human question headers that collide with registered UI labels remain verbatim", () => {
  const value = snapshot();
  value.questions = [
    {
      id: "q",
      requestId: "r",
      state: "pending",
      canAnswer: true,
      questions: [
        {
          id: "answer",
          header: "Work is stopped",
          question: "Actual user question {count}",
          options: [],
        },
      ],
    },
  ];
  const plan = directorPlan(value, director, null),
    copy = settingsPlanCopy(value, plan, "zh-CN");
  assert.equal(copy.title, "需要你的回答");
  assert.equal(copy.detail, "Work is stopped");
  assert.equal(
    value.questions[0].questions[0].question,
    "Actual user question {count}",
  );
});
test("dynamic in-progress job counts use only current attempts and translate without altering job identities", () => {
  const value = snapshot();
  value.project.activePlanId = "plan";
  value.plan = {
    id: "plan",
    nodes: [{ id: "current-node", kind: "image", shotId: "one" }],
  };
  value.attempts = [
    { id: "current-job", nodeId: "current-node", phase: "remote_pending" },
    { id: "historical-job", nodeId: "current-node", phase: "remote_pending" },
  ];
  value.currentAttemptIds = ["current-job"];
  const plan = directorPlan(value, director, null),
    copy = settingsPlanCopy(value, plan, "zh-CN");
  assert.equal(copy.title, "媒体工作正在进行");
  assert.equal(copy.detail, "1 个任务正在准备、生成或保存。");
  assert.deepEqual(value.currentAttemptIds, ["current-job"]);
});
test("saved media copy preserves current-plan identity and deduplicates one artifact across output ports", () => {
  const value = snapshot();
  value.project.activePlanId = "plan";
  value.plan = {
    id: "plan",
    nodes: [
      { id: "image", kind: "image", shotId: "one" },
      { id: "video", kind: "video", shotId: "one" },
    ],
  };
  value.outputs = [
    {
      nodeId: "image",
      port: "image",
      artifact: { artifactId: "frame", kind: "image", sha256: "a".repeat(64) },
    },
    {
      nodeId: "image",
      port: "preview",
      artifact: { artifactId: "frame", kind: "image", sha256: "a".repeat(64) },
    },
    {
      nodeId: "video",
      port: "video",
      artifact: { artifactId: "clip", kind: "video", sha256: "b".repeat(64) },
    },
  ];
  let plan = directorPlan(value, director, null);
  assert.equal(
    settingsPlanCopy(value, plan, "zh-CN").saved,
    "1 个场景 · 2 个镜头 · 1 张图片 · 1 个视频已保存。",
  );
  value.project.activePlanId = "different";
  plan = directorPlan(value, director, null);
  assert.equal(
    settingsPlanCopy(value, plan, "zh-CN").saved,
    "1 个场景 · 2 个镜头已保存。",
  );
});
test("resume direction and exact scope IDs survive localized labels and numbering changes", () => {
  const value = snapshot(),
    ids = ["two", "two", "missing"];
  assert.equal(settingsScopeLabel(value, ids, "zh-CN"), "镜头 1.2，已保存范围");
  assert.equal(settingsScopeLabel(value, ids, "en"), "Shot 1.2, Saved scope");
  value.project.shots.reverse();
  assert.equal(settingsScopeLabel(value, ["two"], "zh-CN"), "镜头 1.1");
  assert.deepEqual(ids, ["two", "two", "missing"]);
  assert.equal(
    settingsScopeLabel(value, ["project", "two"], "zh-CN"),
    "整部影片",
  );
  assert.equal(value.messages[0].text, "Work is stopped");
});
test("unknown and future model copy stays unchanged rather than undergoing text replacement", () => {
  const value = snapshot(),
    plan = directorPlan(value, director, null),
    future = {
      ...plan,
      title: "Novel future status",
      detail: "A saved description {count}",
      saved: "Unknown saved summary",
      next: "Next future operation",
    };
  const copy = settingsPlanCopy(value, future, "zh-CN");
  assert.equal(copy.title, future.title);
  assert.equal(copy.detail, future.detail);
  assert.equal(copy.saved, future.saved);
  assert.equal(copy.next, future.next);
  for (const content of [
    "Custom provider name",
    "Review the conversation in my script",
    "custom/model-id",
    "/Users/name/codex",
    "<script>{count}</script>",
  ])
    assert.equal(
      translateUiText(content, "zh-CN", settingsUiTranslations),
      content,
    );
});
test("account/status translations preserve model/provider names and stored configuration", () => {
  const value = freeze(provider()),
    original = JSON.stringify(value);
  assert.equal(settingsAccountLine(value, "en"), "OpenAI API · key saved");
  assert.equal(settingsAccountLine(value, "zh-CN"), "OpenAI API · 密钥已保存");
  assert.equal(JSON.stringify(value), original);
  const missing = provider();
  missing.readiness.credential.present = false;
  assert.equal(
    settingsAccountLine(missing, "zh-CN"),
    "OpenAI API · 需要配置 API 密钥",
  );
  const codex = provider("codex-image");
  codex.readiness.credential.required = false;
  assert.equal(settingsAccountLine(codex, "zh-CN"), "Codex 订阅 · 已配置");
});
test("configured estimate keeps exact currency arithmetic and does not become a verified vendor price", () => {
  const value = freeze(provider());
  assert.equal(
    settingsEstimate(value, "en"),
    "Configured estimate: $0.100001 USD / attempt",
  );
  assert.equal(
    settingsEstimate(value, "zh-CN"),
    "配置的预估：每次 $0.100001 美元",
  );
  assert.equal(value.estimatedCost.actualVendorPriceVerified, false);
  const invalid = provider();
  invalid.estimatedCost.unitMicros = "Infinity";
  assert.equal(settingsEstimate(invalid, "zh-CN"), "暂无预估");
  assert.equal(
    settingsEstimate(provider("codex-image"), "zh-CN"),
    "使用你的 Codex 订阅",
  );
});
test("exact whitelist switches controlled copy in both directions while preserving unknown content", () => {
  assert.equal(
    translateUiText("Saving media choices…", "zh-CN", settingsUiTranslations),
    "正在保存媒体选择…",
  );
  assert.equal(
    translateUiText("正在保存媒体选择…", "en", settingsUiTranslations),
    "Saving media choices…",
  );
  assert.equal(
    translateUiText("请求保存为 {value}", "en", settingsUiTranslations),
    "请求保存为 {value}",
  );
});

test("account summaries have correct English plurals and no untranslated placeholder in either language", async () => {
 const { settingsMediaAccountCount } = await import("../src/settings-labels.ts");
 assert.equal(settingsMediaAccountCount(1,"en"),"1 media account");
 assert.equal(settingsMediaAccountCount(2,"en"),"2 media accounts");
 assert.equal(settingsMediaAccountCount(1,"zh-CN"),"1 个媒体账号");
 assert.equal(settingsMediaAccountCount(2,"zh-CN"),"2 个媒体账号");
});
