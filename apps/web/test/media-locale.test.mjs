import test from "node:test";
import assert from "node:assert/strict";
import { translate, translateUiText } from "../src/legacy/locale-model.ts";
import {
  mediaControlledMessage,
  mediaHierarchyLabel,
  mediaRecordingLabel,
  mediaUiCopy,
} from "../src/legacy/media-ui-copy.ts";
import {
  recordingLabel,
  narrationTimingIssues,
} from "../src/legacy/narration-model.ts";
import { PendingCommandRegistry } from "../src/legacy/pending-command.ts";

const translation = (locale) => ({
  t: (english, chinese, values) => translate(locale, english, chinese, values),
  ui: (text, extra = mediaUiCopy) => translateUiText(text, locale, extra),
});
test("controlled production and recovery copy changes language while unknown content and empty states stay intact", () => {
  const chinese = translation("zh-CN"),
    english = translation("en");
  assert.equal(chinese.ui("Generate narration"), "生成旁白");
  assert.equal(chinese.ui("Retry saved request"), "重试已保存的请求");
  assert.equal(
    chinese.ui(
      "Response uncertain · the request will not be repeated automatically",
    ),
    "响应尚未确认 · 不会自动重复请求",
  );
  for (const raw of [
    "",
    "My original voice {number}",
    "openai-custom:voice_123",
    "跨语言原始录音.wav",
    "Scene study about light",
    "Provider-specific diagnostic: sample 41",
  ]) {
    assert.equal(chinese.ui(raw), raw);
    assert.equal(english.ui(raw), raw);
  }
  assert.equal(english.ui("生成旁白"), "Generate narration");
  assert.equal(mediaHierarchyLabel("Scene 02", "zh-CN"), "场景 02");
  assert.equal(mediaHierarchyLabel("Shot 2.3", "zh-CN"), "镜头 2.3");
  assert.equal(
    mediaHierarchyLabel("Scene study about light", "zh-CN"),
    "Scene study about light",
  );
});
test("generated recording labels retain provider voice, immutable digest and duration without translating captured content", () => {
  const audio = {
      originEvidence: "verified_generated_audio",
      generation: { voice: "Registered {number} 蓝色" },
      declaredOrigin: "generated",
      media: {
        sha256: "a".repeat(64),
        probe: { audio: { durationSeconds: 6.25 } },
      },
    },
    original = structuredClone(audio),
    english = translation("en"),
    chinese = translation("zh-CN");
  assert.equal(
    mediaRecordingLabel(audio, 2, english.t),
    recordingLabel(audio, 2),
  );
  assert.equal(
    mediaRecordingLabel(audio, 2, chinese.t),
    "录音 3 · 6.3 秒 · 由 OpenSlate 生成 · Registered {number} 蓝色 · aaaaaaaa",
  );
  assert.deepEqual(audio, original);
});
test("timing and acceptance feedback translates only the controlled sentence around its original values", () => {
  const { t, ui } = translation("zh-CN");
  const issues = narrationTimingIssues([
    { cue: { startSample: 0, endSample: 96000 }, entry: { atSample: 0 } },
    { cue: { startSample: 0, endSample: 48000 }, entry: { atSample: 48000 } },
  ]);
  assert.equal(issues.length, 1);
  assert.equal(
    mediaControlledMessage(issues[0], t, ui),
    "段落 2 的开始位置早于上一段落的结束时间（2 秒）。请延后视频位置或缩短上一段的范围。",
  );
  assert.equal(
    mediaControlledMessage(
      "Narration accepted. Update the visual plan: Original detail {seconds}",
      t,
      ui,
    ),
    "旁白已确认，请更新画面计划：Original detail {seconds}",
  );
  assert.equal(
    mediaControlledMessage(
      "Unregistered diagnostic with original user words",
      t,
      ui,
    ),
    "Unregistered diagnostic with original user words",
  );
});
test("changing presentation language cannot replace or resend an uncertain media command", async () => {
  const registry = new PendingCommandRegistry(),
    projectId = "film",
    command = {
      path: "/api/projects/film/scenes/scene/generate",
      key: "exact-existing-decision",
      body: {
        kind: "image",
        targetShotIds: ["shot"],
        regenerate: true,
        revisionId: "unchanged-revision",
        headVersion: 3,
        reviewedFrames: [],
        reviewedHoldDigest: "b".repeat(64),
        reviewedControlAuthorityId: null,
      },
      metadata: {
        sceneId: "scene",
        kind: "image",
        label: "Generate narration",
      },
    };
  const requests = [];
  await registry.run(
    projectId,
    command,
    async (saved) => {
      requests.push(structuredClone(saved));
      throw new Error("lost response");
    },
    () => true,
  );
  const frozen = registry.snapshot(projectId).command,
    original = JSON.stringify(frozen);
  for (const locale of ["zh-CN", "en", "zh-CN"]) {
    const { t, ui } = translation(locale);
    ui("Retry saved request");
    ui("Generate narration");
    mediaHierarchyLabel("Scene 01", locale);
    mediaControlledMessage(
      "Narration accepted. Update the visual plan: exact original recipe",
      t,
      ui,
    );
    assert.equal(
      JSON.stringify(registry.snapshot(projectId).command),
      original,
    );
    assert.equal(registry.snapshot(projectId).command, frozen);
    assert.equal(requests.length, 1);
  }
  await registry.run(
    projectId,
    frozen,
    async (saved) => {
      requests.push(structuredClone(saved));
      return { saved: true };
    },
    () => true,
  );
  assert.deepEqual(requests[1], requests[0]);
  assert.equal(registry.snapshot(projectId).command, null);
});
