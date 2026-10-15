import test from "node:test";
import assert from "node:assert/strict";
import {
  timelineEditor,
  timelineMoveCommand,
  timelineNudgeCommand,
  timelineDurationFrames,
  timelineDurationCommand,
  timelineMusicStart,
  timelineMusicCommand,
  timelineMusicSpan,
} from "../src/legacy/timeline-editor-model.ts";

const shot = (id, sceneId = "scene-a") => ({
  id,
  sceneId,
  revisionId: `${id}-revision`,
  purpose: id,
  framing: "",
  action: "",
  motion: "",
  desiredFrames: 180,
  imagePrompt: "image",
  videoPrompt: "video",
  cueId: null,
  narration: { mode: "none", text: "", voice: "stock" },
  promptIntent: { image: `${id}-image`, video: `${id}-video` },
});
function snapshot() {
  return {
    project: {
      id: "project",
      headVersion: 7,
      revisionId: "revision",
      activePlanId: null,
      name: "Film",
      brief: "",
      story: "",
      scenes: [
        { id: "scene-a", purpose: "Reveal" },
        { id: "scene-b", purpose: "Detail" },
        { id: "empty-scene", purpose: "Later" },
      ],
      shots: [shot("a"), shot("d", "scene-b"), shot("b"), shot("c")],
      cues: [],
      soundtrack: { audioId: "owned-audio", gainMilliDb: -18000 },
    },
    plan: null,
    currentAttemptIds: [],
    attempts: [],
    outputs: [],
    holds: [],
    messages: [],
  };
}
test("timeline follows saved scene hierarchy, not interleaved storage order, and keeps orphaned shots visible", () => {
  const value = snapshot();
  value.project.shots.push(shot("orphan", "deleted-scene"));
  const result = timelineEditor(value);
  assert.deepEqual(
    result.clips.map((clip) => clip.result.shot.id),
    ["a", "b", "c", "d", "orphan"],
  );
  assert.deepEqual(
    result.clips.map((clip) => [clip.startFrame, clip.endFrame]),
    [
      [0, 180],
      [180, 360],
      [360, 540],
      [540, 720],
      [720, 900],
    ],
  );
  assert.equal(result.groups[2].purpose, "Later");
  assert.equal(result.groups[2].startFrame, result.groups[2].endFrame);
  assert.equal(result.clips.at(-1).sceneLabel, "未分组");
  assert.equal(result.totalFrames, 900);
});
test("before/after drops preserve stable shot/scene IDs and resolve the actual destination neighbor", () => {
  const value = snapshot();
  assert.deepEqual(timelineMoveCommand(value, "a", "b", "after", 7), {
    kind: "moveShot",
    id: "a",
    sceneId: "scene-a",
    beforeId: "c",
    expectedHeadVersion: 7,
  });
  assert.deepEqual(timelineMoveCommand(value, "a", "c", "after", 7), {
    kind: "moveShot",
    id: "a",
    sceneId: "scene-a",
    expectedHeadVersion: 7,
  });
  assert.deepEqual(timelineMoveCommand(value, "d", "b", "before", 7), {
    kind: "moveShot",
    id: "d",
    sceneId: "scene-a",
    beforeId: "b",
    expectedHeadVersion: 7,
  });
  assert.deepEqual(
    value.project.shots.map((shot) => shot.id),
    ["a", "d", "b", "c"],
    "a preview must never modify saved state",
  );
});
test("stale drags, deleted targets, orphan destinations and no-op drops cannot create a new command", () => {
  const value = snapshot();
  assert.equal(timelineMoveCommand(value, "a", "c", "before", 6), null);
  assert.equal(timelineMoveCommand(value, "a", "a", "after", 7), null);
  assert.equal(timelineMoveCommand(value, "a", "b", "before", 7), null);
  assert.equal(timelineMoveCommand(value, "unknown", "b", "after", 7), null);
  value.project.shots.push(shot("orphan", "missing-scene"));
  assert.equal(timelineMoveCommand(value, "a", "orphan", "before", 7), null);
});
test("keyboard nudging cannot silently move a shot into another scene", () => {
  const value = snapshot();
  assert.equal(timelineNudgeCommand(value, "a", -1), null);
  assert.equal(timelineNudgeCommand(value, "c", 1), null);
  assert.equal(timelineNudgeCommand(value, "d", 1), null);
  assert.deepEqual(timelineNudgeCommand(value, "b", -1), {
    kind: "moveShot",
    id: "b",
    sceneId: "scene-a",
    beforeId: "a",
    expectedHeadVersion: 7,
  });
});
test("planned duration is frame accurate, bounded to 3–15 seconds, and fenced against later project edits", () => {
  for (const invalid of [
    "",
    "2.99",
    "15.01",
    "-5",
    "Infinity",
    "3e0",
    "4 seconds",
    "NaN",
  ])
    assert.equal(timelineDurationFrames(invalid), null, invalid);
  assert.equal(timelineDurationFrames("3"), 90);
  assert.equal(timelineDurationFrames("15"), 450);
  assert.equal(timelineDurationFrames("3.02"), 91);
  const value = snapshot();
  assert.deepEqual(timelineDurationCommand(value, "a", "4.5", 7), {
    kind: "shot",
    id: "a",
    field: "desiredFrames",
    value: "135",
    expectedHeadVersion: 7,
  });
  assert.equal(timelineDurationCommand(value, "a", "4.5", 6), null);
  assert.equal(timelineDurationCommand(value, "a", "6", 7), null);
  assert.equal(value.project.shots[0].desiredFrames, 180);
});
test("music dragging maps actual track pixels to project frames and clamps film boundaries", () => {
  assert.equal(timelineMusicStart(0, 100, 600, 720), 120);
  assert.equal(timelineMusicStart(120, -400, 600, 720), 0);
  assert.equal(timelineMusicStart(120, 900, 600, 720), 719);
  assert.equal(timelineMusicStart(120, 90, 0, 720), 0);
  assert.equal(timelineMusicStart(120, Infinity, 600, 720), 0);
});
test("music changes use real soundtrack commands and reject stale, missing, invalid or unchanged state", () => {
  const value = snapshot();
  assert.deepEqual(timelineMusicCommand(value, "startFrame", 60, 7), {
    kind: "soundtrack",
    field: "startFrame",
    value: "60",
    expectedHeadVersion: 7,
  });
  assert.deepEqual(timelineMusicCommand(value, "muted", true, 7), {
    kind: "soundtrack",
    field: "muted",
    value: "true",
    expectedHeadVersion: 7,
  });
  assert.deepEqual(timelineMusicCommand(value, "gainMilliDb", -12000, 7), {
    kind: "soundtrack",
    field: "gainMilliDb",
    value: "-12000",
    expectedHeadVersion: 7,
  });
  for (const [field, next] of [
    ["startFrame", -1],
    ["startFrame", 720],
    ["startFrame", 1.5],
    ["gainMilliDb", 1000],
    ["gainMilliDb", -61000],
    ["gainMilliDb", -18000],
    ["muted", false],
    ["muted", "true"],
  ])
    assert.equal(timelineMusicCommand(value, field, next, 7), null);
  assert.equal(timelineMusicCommand(value, "muted", true, 6), null);
  value.project.soundtrack = null;
  assert.equal(timelineMusicCommand(value, "muted", true, 7), null);
});
test("music lane reflects actual source duration clipped to film without inventing a missing duration", () => {
  assert.deepEqual(timelineMusicSpan(60, 900, 600), { left: 10, width: 90 });
  assert.deepEqual(timelineMusicSpan(60, 60, 600), { left: 10, width: 10 });
  assert.deepEqual(timelineMusicSpan(60, null, 600), { left: 10, width: null });
  assert.deepEqual(timelineMusicSpan(0, 900, 0), { left: 0, width: null });
});
test("a changed plan keeps earlier keyframes labeled as earlier and never promotes stale video into current playback", () => {
  const value = snapshot(),
    target = value.project.shots[0];
  value.project.activePlanId = "plan";
  value.plan = {
    id: "plan",
    nodes: [
      {
        id: "image",
        kind: "image",
        shotId: "a",
        intentDigest: "old-image",
        args: { prompt: "old image" },
      },
      {
        id: "video",
        kind: "video",
        shotId: "a",
        intentDigest: "old-video",
        args: { prompt: "old video", durationFrames: 180 },
      },
    ],
  };
  value.outputs = [
    {
      nodeId: "image",
      port: "image",
      artifact: {
        artifactId: "old-image",
        sha256: "a".repeat(64),
        kind: "image",
      },
      fixture: false,
    },
    {
      nodeId: "video",
      port: "video",
      artifact: {
        artifactId: "old-video",
        sha256: "b".repeat(64),
        kind: "video",
      },
      fixture: false,
    },
  ];
  const result = timelineEditor(value).clips[0].result;
  assert.equal(result.keyframe.artifact.artifactId, "old-image");
  assert.equal(result.keyframe.current, false);
  assert.equal(result.video.current, false);
  assert.equal(target.imagePrompt, "image");
});
