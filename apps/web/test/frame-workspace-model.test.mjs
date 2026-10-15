import test from "node:test";
import assert from "node:assert/strict";
import {
  adjacentFrameShot,
  canExposeFrame,
  currentFrameExposures,
  frameHistory,
  frameSelection,
  revokedFrameExposures,
} from "../src/legacy/frame-workspace-model.ts";
import {
  frameExposureIdentity,
  projectResults,
} from "../src/legacy/project-results-model.ts";

const artifact = (id, sha = "a", kind = "image") => ({
  artifactId: id,
  kind,
  sha256: sha.repeat(64),
});
const exposure = (shotId = "one", artifactId = "frame", revision = "r1") => ({
  projectId: "project",
  projectRevisionId: revision,
  shotId,
  artifactId,
  sha256: "a".repeat(64),
  displayed: true,
});
const scene = (id, shotIds) => ({
  id,
  label: id,
  purpose: id,
  shots: shotIds.map((id) => ({
    shot: { id },
    label: id,
    keyframe: {
      current: true,
      artifact: artifact("frame-" + id),
      nodeId: "node-" + id,
    },
  })),
});

function snapshot() {
  const shot = {
    id: "one",
    revisionId: "s1",
    sceneId: "scene",
    purpose: "An actual shot",
    action: "",
    framing: "Close view",
    motion: "Slow motion",
    desiredFrames: 87,
    imagePrompt: "Current image",
    videoPrompt: "Current motion",
    promptIntent: { image: "image-intent", video: "video-intent" },
    cueId: null,
    narration: { mode: "none", text: "", voice: "stock" },
  };
  return {
    project: {
      id: "project",
      revisionId: "r1",
      headVersion: 2,
      activePlanId: "plan",
      shots: [shot],
      scenes: [{ id: "scene", revisionId: "c1", purpose: "Scene" }],
      cues: [],
    },
    plan: {
      id: "plan",
      nodes: [
        {
          id: "node-one",
          kind: "image",
          shotId: "one",
          intentDigest: "image-intent",
          args: { prompt: "Current image" },
        },
      ],
    },
    outputs: [
      {
        nodeId: "node-one",
        port: "image",
        candidateId: "candidate",
        artifact: artifact("frame"),
      },
    ],
    currentAttemptIds: [],
    attempts: [],
    holds: [],
  };
}

test("stable selected shot survives scene and shot reordering; deleted selection has an explicit fallback", () => {
  const before = [scene("a", ["one", "two"]), scene("b", ["three"])];
  assert.equal(frameSelection(before, "two").result.shot.id, "two");
  assert.equal(
    frameSelection([before[1], scene("a", ["two", "one"])], "two").index,
    1,
  );
  assert.equal(frameSelection(before, "deleted").result.shot.id, "one");
  assert.equal(frameSelection([], "two"), null);
});

test("keyboard neighbors follow canonical hierarchy and do not wrap or assume three shots", () => {
  const scenes = [
    scene("a", ["one", "two"]),
    scene("b", ["three", "four", "five"]),
  ];
  assert.equal(adjacentFrameShot(scenes, "one", -1), null);
  assert.equal(adjacentFrameShot(scenes, "two", 1), "three");
  assert.equal(adjacentFrameShot(scenes, "four", -1), "three");
  assert.equal(adjacentFrameShot(scenes, "five", 1), null);
  assert.equal(adjacentFrameShot([], null, 1), null);
});

test("only decoded visible active current main frames can establish exposure", () => {
  const value = exposure(),
    current = [value];
  for (const field of ["active", "visible", "decoded"])
    assert.equal(
      canExposeFrame(value, current, {
        active: true,
        visible: true,
        decoded: true,
        [field]: false,
      }),
      false,
    );
  assert.equal(
    canExposeFrame(value, current, {
      active: true,
      visible: true,
      decoded: true,
    }),
    true,
  );
  assert.equal(
    canExposeFrame({ ...value, sha256: "b".repeat(64) }, current, {
      active: true,
      visible: true,
      decoded: true,
    }),
    false,
  );
  assert.equal(
    canExposeFrame(null, current, {
      active: true,
      visible: true,
      decoded: true,
    }),
    false,
  );
});

test("seen proof survives selection or theme changes while exact identity remains current", () => {
  const first = exposure("one"),
    second = exposure("two", "second");
  const seen = new Map([
    [frameExposureIdentity(first), first],
    [frameExposureIdentity(second), second],
  ]);
  assert.deepEqual(revokedFrameExposures(seen, [second, first]), []);
  assert.deepEqual(revokedFrameExposures(seen, [first, second]), []);
});

test("revision, artifact, hash, non-current or removed shot revokes the precise previous proof", () => {
  const value = exposure(),
    seen = new Map([[frameExposureIdentity(value), value]]);
  for (const changed of [
    { ...value, projectRevisionId: "r2" },
    { ...value, artifactId: "new" },
    { ...value, sha256: "b".repeat(64) },
  ]) {
    assert.deepEqual(revokedFrameExposures(seen, [changed]), [
      { ...value, displayed: false },
    ]);
  }
  assert.deepEqual(revokedFrameExposures(seen, []), [
    { ...value, displayed: false },
  ]);
});

test("the workspace exposure list uses current server provenance and arbitrary saved duration", () => {
  const value = snapshot(),
    results = projectResults(value),
    current = currentFrameExposures(value, results.scenes);
  assert.equal(results.scenes[0].shots[0].shot.desiredFrames, 87);
  assert.deepEqual(current, [exposure()]);
  value.project.shots[0].imagePrompt = "New direction";
  value.project.shots[0].promptIntent.image = "new";
  assert.deepEqual(
    currentFrameExposures(value, projectResults(value).scenes),
    [],
    "A displayed previous image never receives current-frame review proof",
  );
});

test("history includes only actual prior saved same-node images and deduplicates exact bytes", () => {
  const value = snapshot(),
    result = projectResults(value).scenes[0].shots[0];
  value.previousPreviews = [
    { nodeId: "node-one", artifact: artifact("old"), fixture: false },
    { nodeId: "other-node", artifact: artifact("other") },
    { nodeId: "node-one", artifact: artifact("frame") },
  ];
  value.attempts = [
    {
      id: "old-success",
      nodeId: "node-one",
      phase: "succeeded",
      request: { kind: "image" },
      outputs: { image: artifact("old") },
    },
    {
      id: "earlier-success",
      nodeId: "node-one",
      phase: "succeeded",
      request: { kind: "image" },
      outputs: { image: artifact("earlier", "b") },
    },
  ];
  const history = frameHistory(value, result);
  assert.deepEqual(
    history.map((entry) => entry.artifact.artifactId),
    ["old", "earlier"],
  );
  assert.equal(history[0].fixture, false);
  assert.equal(history[1].fixture, null);
});

test("uncertain, failed, wrong-kind and selected current attempt outputs never masquerade as earlier takes", () => {
  const value = snapshot(),
    result = projectResults(value).scenes[0].shots[0];
  value.currentAttemptIds = ["current"];
  value.attempts = [
    {
      id: "unknown",
      nodeId: "node-one",
      phase: "submission_unknown",
      request: { kind: "image" },
      outputs: { image: artifact("unknown") },
    },
    {
      id: "failed",
      nodeId: "node-one",
      phase: "failed",
      request: { kind: "image" },
      outputs: { image: artifact("failed") },
    },
    {
      id: "current",
      nodeId: "node-one",
      phase: "succeeded",
      request: { kind: "image" },
      outputs: { image: artifact("unpublished-current") },
    },
    {
      id: "wrong",
      nodeId: "node-one",
      phase: "succeeded",
      request: { kind: "video" },
      outputs: { image: artifact("wrong") },
    },
    {
      id: "kind",
      nodeId: "node-one",
      phase: "succeeded",
      request: { kind: "image" },
      outputs: { video: artifact("clip", "a", "video") },
    },
  ];
  assert.deepEqual(frameHistory(value, result), []);
});

test("missing current-attempt selection cannot classify arbitrary attempts as history", () => {
  const value = snapshot(),
    result = projectResults(value).scenes[0].shots[0];
  delete value.currentAttemptIds;
  value.attempts = [
    {
      id: "possible",
      nodeId: "node-one",
      phase: "succeeded",
      request: { kind: "image" },
      outputs: { image: artifact("unbound") },
    },
  ];
  assert.deepEqual(frameHistory(value, result), []);
  assert.deepEqual(
    frameHistory(value, {
      ...result,
      keyframe: { ...result.keyframe, nodeId: null },
    }),
    [],
    "Direct conditioning artifacts do not borrow an unrelated image history",
  );
});
