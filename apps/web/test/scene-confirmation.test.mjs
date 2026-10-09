import test from "node:test";
import assert from "node:assert/strict";
import {
  SceneConfirmationRunner,
  SceneConfirmationPending,
} from "../src/scene-confirmation-model.ts";
import { SceneContinuationCache } from "../src/scene-continuation-cache.ts";
import { PendingCommandRegistry } from "../src/pending-command.ts";

function fixture({
  count = 2,
  samples = 48000,
  existing = false,
  unknown = false,
  pending = false,
  importIssue = false,
  textChanged = false,
  longIds = false,
} = {}) {
  let head = 1,
    requestId = "original",
    version = 0,
    intent = "scene-intent";
  const hash = "a".repeat(64),
    calls = [],
    outcomes = new Map(),
    details = new Map(),
    speeches = new Map();
  const rows = Array.from({ length: count }, (_, index) => ({
    shotId: longIds ? `shot-${"x".repeat(150)}-${index}` : `shot-${index}`,
    purpose: "Detail",
    image: { kind: "image", artifactId: `frame-${index}`, sha256: hash },
    imageComplete: true,
    motionPrompt: "Gentle motion",
    plannedFrames: 180,
    durationFrames: 180,
    videoComplete: false,
    videoProfileLabel: "video-model",
    videoSettings: {},
    narrationPending: true,
    imagePending: false,
    videoPending: false,
    blockedCode: null,
    narration: {
      mode: "generated",
      text: `Current words ${index}`,
      voice: "cedar",
      profileId: "speech-model",
      profileRevisionId: "speech-revision",
      ready: false,
      recordingId: null,
      recordingSha256: null,
    },
  }));
  const recording = (index) => ({
    id: `audio-${index}`,
    originEvidence: "verified_generated_audio",
    selection: { artifactDigest: hash, generationEvidenceDigest: hash },
    generation: { voice: "cedar", model: "speech-model" },
    media: {
      sha256: hash,
      probe: { audio: { samples, durationSeconds: samples / 48000 } },
    },
  });
  const speech = (index) => ({
    proposal: {
      id: `proposal-${index}`,
      segment: {
        segmentId: `segment-${index}`,
        segmentRevisionId: `script-${index}`,
        text: rows[index].narration.text,
      },
      model: { profileId: "speech-model", revision: "speech-revision" },
      voice: "cedar",
    },
    application: { candidateId: `candidate-${index}` },
    execution: {
      state: importIssue
        ? "ingesting"
        : unknown
          ? "submission_unknown"
          : pending
            ? "remote_pending"
            : "succeeded",
      candidateId: `candidate-${index}`,
      code: importIssue ? "AUDIO_PCM_INVALID" : null,
    },
    recording: unknown || pending || importIssue ? null : recording(index),
  });
  const view = () => ({
    projectId: "project",
    sceneId: "scene",
    headVersion: head,
    revisionId: `revision-${head}`,
    currentRequestId: requestId,
    confirmationDigest: `review-${head}-${requestId}`,
    sceneIntentDigest: intent,
    reviewedHoldDigest: `holds-${requestId}`,
    reviewedControlAuthorityId: null,
    busy: false,
    paused: false,
    narrationVersion: version,
    rows: structuredClone(rows),
  });
  for (let index = 0; index < count; index++) {
    const row = {
      entry: { segmentId: `segment-${index}`, audioId: null },
      script: {
        id: `script-${index}`,
        text: rows[index].narration.text,
        source: { kind: "generated", voice: "cedar" },
      },
      audio: null,
      cue: null,
    };
    if (textChanged)
      row.audio = { ...recording(index), id: `old-audio-${index}` };
    details.set(rows[index].shotId, {
      shotId: `shot-${index}`,
      headVersion: head,
      segment: row,
      session: null,
      latestSpeechProposalId: existing ? `proposal-${index}` : null,
      committed: false,
      intentCurrent: !textChanged,
    });
    if (existing) speeches.set(`proposal-${index}`, speech(index));
  }
  let loseAccept = false,
    loseGenerate = false,
    loseVideo = false;
  const api = {
    async request(path, options = {}) {
      calls.push({ path, ...structuredClone(options) });
      if (options.method !== "POST") {
        if (path.endsWith("/generation")) return view();
        if (path.endsWith("/narration"))
          return { headVersion: head, snapshot: { state: { version } } };
        if (path.includes("/speech-proposals/"))
          return structuredClone(speeches.get(path.split("/").at(-1)));
        const d = details.get(path.split("/").at(-1));
        assert.ok(d, path);
        return structuredClone({ ...d, headVersion: head });
      }
      const identity = options.key;
      if (outcomes.has(identity)) {
        assert.deepEqual(
          outcomes.get(identity).body,
          options.body,
          "retry retains exact body",
        );
        return structuredClone(outcomes.get(identity).result);
      }
      const b = options.body;
      if ("expectedHeadVersion" in b) assert.equal(b.expectedHeadVersion, head);
      if ("expectedRequestId" in b)
        assert.equal(b.expectedRequestId, requestId);
      if ("expectedNarrationVersion" in b)
        assert.equal(b.expectedNarrationVersion, version);
      let result;
      if (path.includes("/scenes/")) {
        assert.equal(path.endsWith("/generate"), true);
        assert.equal(b.headVersion, head);
        assert.equal(
          rows.every((row) => !row.narrationPending),
          true,
          "video starts only after all narration saves",
        );
        assert.equal(b.reviewedFrames.length, count);
        result = { headVersion: ++head, activePlanId: "video-plan" };
        requestId = "video-request";
      } else {
        const parts = path.split("/"),
          shotId = parts.at(-2),
          index = rows.findIndex((row) => row.shotId === shotId);
        if (path.endsWith("/generated-audio-bindings")) {
          const i = Number(b.segmentId.split("-")[1]),
            d = details.get(rows[i].shotId);
          assert.equal(b.segmentRevisionId, d.segment.script.id);
          assert.equal(b.artifactId, recording(i).id);
          d.segment.audio = recording(i);
          version++;
          result = { state: { version } };
        } else {
          const d = details.get(shotId);
          assert.ok(d, path);
          if (path.endsWith("/initialize")) {
            requestId = `request-${index}`;
            d.session = { id: `session-${index}`, requestId, state: "active" };
            d.segment.script.text = b.text;
            d.headVersion = ++head;
            d.narrationVersion = ++version;
            result = structuredClone(d);
          } else if (path.endsWith("/generate")) {
            assert.equal(b.voice, "cedar");
            assert.equal(b.text, rows[index].narration.text);
            speeches.set(`proposal-${index}`, speech(index));
            d.latestSpeechProposalId = `proposal-${index}`;
            d.headVersion = ++head;
            d.narrationVersion = version;
            result = {
              proposal: { id: `proposal-${index}` },
              shot: structuredClone(d),
            };
          } else if (path.endsWith("/accept")) {
            assert.equal(b.audioId, recording(index).id);
            assert.equal(b.endSample, samples);
            assert.equal(b.durationMode, "keep");
            version++;
            rows[index].narrationPending = false;
            d.committed = true;
            d.headVersion = ++head;
            d.narrationVersion = version;
            result = structuredClone(d);
          } else assert.fail(path);
        }
      }
      outcomes.set(identity, { body: structuredClone(b), result });
      if (path.includes("/scenes/") && loseVideo) {
        loseVideo = false;
        throw new Error("Lost video response");
      }
      if (path.endsWith("/accept") && loseAccept) {
        loseAccept = false;
        throw new Error("Lost save response");
      }
      if (
        path.endsWith("/generate") &&
        path.includes("/narration/") &&
        loseGenerate
      ) {
        loseGenerate = false;
        throw new Error("Lost speech response");
      }
      return structuredClone(result);
    },
  };
  const initial = view();
  const command = {
    path: "/api/projects/project/scenes/scene/confirm",
    key: "decision",
    body: { kind: "video" },
    metadata: { sceneId: "scene", sceneReview: initial },
  };
  return {
    api,
    calls,
    command,
    rows,
    details,
    speeches,
    outcomes,
    mutate() {
      requestId = "new-human-edit";
      intent = "changed-intent";
    },
    trimElsewhere() {
      version++;
    },
    loseVideo() {
      loseVideo = true;
    },
    loseAccept() {
      loseAccept = true;
    },
    loseGenerate() {
      loseGenerate = true;
    },
    view,
  };
}
const posts = (f) => f.calls.filter((call) => call.method === "POST");

test("one explicit scene decision prepares, attaches and saves two exact narration takes before one video request", async () => {
  const f = fixture(),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  const result = await runner.run(f.command);
  assert.equal(result.activePlanId, "video-plan");
  const operations = posts(f).map((call) => call.path.split("/").at(-1));
  assert.deepEqual(operations, [
    "initialize",
    "generate",
    "generated-audio-bindings",
    "accept",
    "initialize",
    "generate",
    "generated-audio-bindings",
    "accept",
    "generate",
  ]);
  assert.equal(f.outcomes.size, 9);
  assert.equal(
    f.rows.every((row) => !row.narrationPending),
    true,
  );
});

test("lost canonical save response reuses its exact command and skips completed shots on continuation", async () => {
  const f = fixture(),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  f.loseAccept();
  await assert.rejects(runner.run(f.command), /Lost save response/);
  await runner.run(f.command);
  assert.equal(
    posts(f).filter((call) => call.path.endsWith("/accept")).length,
    3,
  );
  assert.equal(
    posts(f).filter(
      (call) =>
        call.path.endsWith("/generate") && call.path.includes("/narration/"),
    ).length,
    2,
  );
  assert.equal(f.outcomes.size, 9, "no duplicate dispatch or canonical commit");
});

test("lost speech response is resolved before a new head is interpreted as a stale draft", async () => {
  const f = fixture({ count: 1 }),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  f.loseGenerate();
  await assert.rejects(runner.run(f.command), /Lost speech response/);
  await runner.run(f.command);
  assert.equal(
    posts(f).filter(
      (call) =>
        call.path.endsWith("/generate") && call.path.includes("/narration/"),
    ).length,
    2,
  );
  assert.equal(f.outcomes.size, 5);
});

test("already requested exact speech is followed without another generation and unknown outcome is retained", async () => {
  for (const unknown of [false, true]) {
    const f = fixture({ count: 1, existing: true, unknown }),
      runner = new SceneConfirmationRunner(f.api, async () => {});
    if (unknown)
      await assert.rejects(runner.run(f.command), SceneConfirmationPending);
    else await runner.run(f.command);
    assert.equal(
      posts(f).some(
        (call) =>
          call.path.includes("/narration/") && call.path.endsWith("/generate"),
      ),
      false,
    );
    if (unknown) {
      await assert.rejects(runner.run(f.command), SceneConfirmationPending);
      assert.equal(posts(f).length, 0, "no new session or unknown generation");
    }
  }
});

test("an overlong recording cannot be truncated, change video timing, save acceptance or dispatch video", async () => {
  const f = fixture({ count: 1, samples: 288001 }),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  await assert.rejects(
    runner.run(f.command),
    (error) => error.code === "NARRATION_CUE_OUT_OF_RANGE",
  );
  assert.equal(
    posts(f).some(
      (call) => call.path.endsWith("/accept") || call.path.includes("/scenes/"),
    ),
    false,
  );
  assert.equal(f.rows[0].plannedFrames, 180);
});

test("new writing may materialize stale draft intent but cannot adopt its historical recording", async () => {
  const f = fixture({ count: 1, textChanged: true }),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  await runner.run(f.command);
  assert.equal(
    posts(f).filter(
      (call) =>
        call.path.includes("/narration/") && call.path.endsWith("/generate"),
    ).length,
    1,
  );
  assert.equal(
    posts(f).find((call) => call.path.endsWith("/accept")).body.audioId,
    "audio-0",
  );
});

test("a new edit while speech is pending fences all further operations", async () => {
  const f = fixture({ count: 1, pending: true }),
    runner = new SceneConfirmationRunner(f.api, async () => {
      f.mutate();
    });
  await assert.rejects(
    runner.run(f.command),
    (error) => error.code === "SCENE_REVIEW_STALE",
  );
  assert.equal(
    posts(f).some(
      (call) => call.path.endsWith("/accept") || call.path.includes("/scenes/"),
    ),
    false,
  );
});

test("a narration trim without a project-head change cannot enter the earlier scene confirmation", async () => {
  const f = fixture({ count: 1, pending: true }),
    runner = new SceneConfirmationRunner(f.api, async () => {
      f.trimElsewhere();
    });
  await assert.rejects(
    runner.run(f.command),
    (error) => error.code === "SCENE_REVIEW_STALE",
  );
  assert.equal(
    posts(f).some(
      (call) => call.path.endsWith("/accept") || call.path.includes("/scenes/"),
    ),
    false,
  );
});

test("lost video publication response returns the saved decision without treating its own new request as an external edit", async () => {
  const f = fixture({ count: 1 }),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  f.loseVideo();
  await assert.rejects(runner.run(f.command), /Lost video response/);
  const result = await runner.run(f.command);
  assert.equal(result.activePlanId, "video-plan");
  assert.equal(f.outcomes.size, 5, "single video publication");
  assert.equal(
    posts(f).filter((call) => call.path.includes("/scenes/")).length,
    2,
    "exact retry only",
  );
});

test("long stable shot IDs still produce distinct bounded retry identities for all operations", async () => {
  const f = fixture({ count: 2, longIds: true }),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  await runner.run(f.command);
  const keys = posts(f).map((call) => call.key);
  assert.equal(new Set(keys).size, 9);
  assert.ok(keys.every((key) => key.length <= 160));
});

test("a changed narration workspace before the click rejects the stale displayed decision without opening a session", async () => {
  const f = fixture({ count: 1 }),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  f.trimElsewhere();
  await assert.rejects(
    runner.run(f.command),
    (error) => error.code === "SCENE_REVIEW_STALE",
  );
  assert.equal(posts(f).length, 0);
});

test("the existing scene-size boundary rejects before any narration work is requested", async () => {
  const f = fixture({ count: 65 }),
    runner = new SceneConfirmationRunner(f.api, async () => {});
  await assert.rejects(
    runner.run(f.command),
    (error) => error.code === "VALIDATION_ERROR",
  );
  assert.equal(posts(f).length, 0);
});

test("audio-import attention retains the exact scene request and existing returned job, with accurate phase", async () => {
  const f = fixture({ count: 1, existing: true, importIssue: true }),
    runner = new SceneConfirmationRunner(f.api, async () => {}),
    phases = [];
  for (let i = 0; i < 2; i++)
    await assert.rejects(
      runner.run(f.command, (phase) => phases.push(phase)),
      SceneConfirmationPending,
    );
  assert.ok(phases.includes("Importing narration audio…"));
  assert.equal(
    posts(f).length,
    0,
    "inspect existing completion without another session or provider job",
  );
});

function memoryStorage() {
  const items = new Map();
  return { items, getItem: key => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) };
}

test("every accepted but lost scene step survives a fresh runner and explicit manual continuation", async () => {
  for (let lostAt = 1; lostAt <= 5; lostAt++) {
    const f = fixture({ count: 1 }), storage = memoryStorage(), namespace = "a".repeat(64);
    const cache = new SceneContinuationCache(namespace, storage);
    cache.write("project", { command: f.command, flow: null });
    const original = f.api.request.bind(f.api);
    let posted = 0, lost = false;
    f.api.request = async (path, options) => {
      const result = await original(path, options);
      if (options?.method === "POST" && ++posted === lostAt && !lost) {
        lost = true;
        throw Error("accepted response lost");
      }
      return result;
    };
    const runner = new SceneConfirmationRunner(f.api, async () => {}, 90, cache);
    await assert.rejects(runner.run(f.command), /accepted response lost/);
    const newCache = new SceneContinuationCache(namespace, storage);
    const registry = new PendingCommandRegistry(newCache);
    const before = posts(f).length;
    const recovered = registry.snapshot("project");
    assert.equal(recovered.running, false);
    assert.equal(recovered.recovered, true);
    assert.equal(posts(f).length, before, "hydration makes no POST");
    const newApi = { request: f.api.request.bind(f.api) };
    const resumed = new SceneConfirmationRunner(newApi, async () => {}, 90, newCache);
    const result = await resumed.run(recovered.command);
    assert.equal(result.activePlanId, "video-plan");
    assert.equal(f.outcomes.size, 5, "each backend operation has one identity");
    assert.equal(posts(f).length, 6, "only the exact lost operation is retried");
  }
});

test("scene cache rejects foreign, expired, corrupt, versioned and non-JSON continuations", () => {
  const f = fixture({ count: 1 }), storage = memoryStorage(), namespace = "a".repeat(64);
  const cache = new SceneContinuationCache(namespace, storage);
  assert.equal(cache.write("project", { command: f.command, flow: null }), true);
  const [key, raw] = [...storage.items][0];
  assert.equal(new SceneContinuationCache("b".repeat(64), storage).read("project"), null);
  assert.equal(new SceneContinuationCache(namespace, storage).read("other"), null);
  for (const altered of ["{", JSON.stringify({ ...JSON.parse(raw), version: 99 }),
    JSON.stringify({ ...JSON.parse(raw), expiresAt: Date.now() - 1 }),
    JSON.stringify({ ...JSON.parse(raw), command: { ...f.command, file: {} } })]) {
    storage.items.set(key, altered);
    const fresh = new SceneContinuationCache(namespace, storage);
    assert.equal(fresh.read("project"), null);
    assert.match(fresh.warning, /could not be restored/);
    assert.equal(storage.items.has(key), false, "invalid local hints cannot block a new reviewed decision");
    assert.equal(fresh.currentMatches("project", f.command), true);
  }
});

test("malformed completed step responses are discarded before runner hydration", () => {
  const f = fixture({ count: 1 }), namespace = "a".repeat(64);
  const path = "/api/projects/project/narration/shots/shot-0/initialize";
  const valid = { shotId: "shot-0", headVersion: 2,
    session: { id: "session-0", requestId: "request-0", state: "active" },
    segment: { entry: { segmentId: "segment-0" },
      script: { id: "script-0", text: "Current words 0", source: { kind: "generated" } }, audio: null } };
  for (const malformed of [null, "response", {}, { ...valid, session: null },
    { ...valid, headVersion: "2" }, { ...valid, segment: { script: null } },
    { ...valid, segment: { ...valid.segment, entry: null } },
    { ...valid, segment: { ...valid.segment, script: { ...valid.segment.script, source: null } } }]) {
    const storage = memoryStorage();
    const cache = new SceneContinuationCache(namespace, storage);
    const flow = { review: f.command.metadata.sceneReview, expectedHead: 2,
      expectedRequest: "request-0", expectedNarrationVersion: 1,
      steps: [{ name: "shot-0:open", command: { path, key: "frozen-step", body: { expectedHeadVersion: 1 } },
        done: true, result: valid }], proposals: [], recordings: [] };
    assert.equal(cache.write("project", { command: f.command, flow }), true);
    const [key, raw] = [...storage.items][0];
    const altered = JSON.parse(raw);
    altered.flow.steps[0].result = malformed;
    storage.items.set(key, JSON.stringify(altered));
    const fresh = new SceneContinuationCache(namespace, storage);
    assert.equal(new PendingCommandRegistry(fresh).snapshot("project").command, null);
    assert.match(fresh.warning, /could not be restored/);
    assert.equal(storage.items.has(key), false);
    assert.equal(fresh.currentMatches("project", f.command), true,
      "a fresh reviewed decision is available after invalid hint removal");
    assert.equal(posts(f).length, 0, "hydration never posts a cached response");
  }
});

test("malformed cached recording reference is rejected before continuation", () => {
  const f = fixture({ count: 1 }), namespace = "a".repeat(64), hash = "a".repeat(64);
  const recording = { id: "audio-0", originEvidence: "verified_generated_audio",
    selection: { artifactDigest: hash, generationEvidenceDigest: hash },
    media: { sha256: hash, probe: { audio: { samples: 24000, durationSeconds: 1 } } } };
  for (const bad of [null,
    { ...recording, media: { sha256: hash } },
    { ...recording, media: { sha256: hash, probe: { audio: { samples: null, durationSeconds: 1 } } } },
    { ...recording, selection: null },
    { ...recording, selection: { artifactDigest: hash } }]) {
    const storage = memoryStorage(), cache = new SceneContinuationCache(namespace, storage);
    const flow = { review: f.command.metadata.sceneReview, expectedHead: 1,
      expectedRequest: "original", expectedNarrationVersion: 0, steps: [], proposals: [],
      recordings: [["shot-0", recording]] };
    assert.equal(cache.write("project", { command: f.command, flow }), true);
    const [key, raw] = [...storage.items][0], altered = JSON.parse(raw);
    altered.flow.recordings[0][1] = bad;
    storage.items.set(key, JSON.stringify(altered));
    const fresh = new SceneContinuationCache(namespace, storage);
    assert.equal(new PendingCommandRegistry(fresh).snapshot("project").command, null);
    assert.match(fresh.warning, /could not be restored/);
    assert.equal(posts(f).length, 0);
  }
});

test("completed shots do not consume the 64 unfinished-shot cache limit", () => {
  const f = fixture({ count: 65 }), storage = memoryStorage();
  f.command.metadata.sceneReview.rows[64].videoComplete = true;
  f.command.metadata.sceneReview.rows[64].narrationPending = false;
  const cache = new SceneContinuationCache("a".repeat(64), storage);
  assert.equal(cache.write("project", { command: f.command, flow: null }), true);
  assert.ok(new SceneContinuationCache("a".repeat(64), storage).read("project"));
});

test("lock-time refresh imports a later same-command checkpoint and rejects changed review", () => {
  const f = fixture({ count: 1 }), storage = memoryStorage(), namespace = "a".repeat(64);
  const first = new SceneContinuationCache(namespace, storage);
  first.write("project", { command: f.command, flow: null });
  const second = new SceneContinuationCache(namespace, storage);
  assert.equal(second.read("project").flow, null);
  const flow = { review: f.command.metadata.sceneReview, expectedHead: 2,
    expectedRequest: "request-0", expectedNarrationVersion: 1,
    steps: [{ name: "shot-0:open", command: {
      path: "/api/projects/project/narration/shots/shot-0/initialize",
      key: "frozen-step", body: { expectedHeadVersion: 1 },
    }, done: false }], proposals: [], recordings: [] };
  assert.equal(first.updateFlow("project", f.command, flow), true);
  assert.equal(second.currentMatches("project", f.command), true);
  assert.deepEqual(second.read("project").flow, flow, "the later atomic record replaces stale tab memory");
  const changed = structuredClone(f.command);
  changed.metadata.sceneReview.rows[0].motionPrompt = "Different";
  assert.equal(second.currentMatches("project", changed), false);
});

test("quota failure preserves a durable pending key and pauses before an unsaved new key", () => {
  const f = fixture({ count: 1 }), storage = memoryStorage(), namespace = "a".repeat(64);
  const cache = new SceneContinuationCache(namespace, storage);
  cache.write("project", { command: f.command, flow: null });
  const open = { name: "shot-0:open", command: {
    path: "/api/projects/project/narration/shots/shot-0/initialize",
    key: "frozen-step", body: { expectedHeadVersion: 1 },
  }, done: false };
  const flow = { review: f.command.metadata.sceneReview, expectedHead: 1,
    expectedRequest: "original", expectedNarrationVersion: 0,
    steps: [open], proposals: [], recordings: [] };
  cache.updateFlow("project", f.command, flow);
  const originalSet = storage.setItem;
  storage.setItem = () => { throw Error("quota"); };
  const openResult = { headVersion: 2,
    session: { id: "session-0", requestId: "request-0", state: "active" },
    segment: { entry: { segmentId: "segment-0" },
      script: { id: "script-0", text: "Current words 0", source: { kind: "generated" } }, audio: null } };
  assert.equal(cache.updateFlow("project", f.command, { ...flow, steps: [{ ...open, done: true, result: openResult }] }), false);
  assert.equal(new SceneContinuationCache(namespace, storage).read("project").flow.steps[0].command.key, "frozen-step");
  assert.match(cache.warning, /could not be saved/);
  assert.equal(cache.updateFlow("project", f.command, { ...flow, steps: [open, { ...open, name: "shot-0:speech", command: {
    path: "/api/projects/project/narration/shots/shot-0/generate", key: "new-key", body: { expectedHeadVersion: 2 },
  } }] }), false);
  assert.equal(cache.mustPauseBeforePost, true);
  assert.equal(new SceneContinuationCache(namespace, storage).read("project").flow.steps[0].command.key, "frozen-step",
    "older recoverable progress stays durable while the new POST is withheld");
  storage.setItem = originalSet;
});

test("a failed new-step checkpoint sends no POST and keeps older progress recoverable", async () => {
  const f = fixture({ count: 1 }), storage = memoryStorage(), namespace = "a".repeat(64);
  const cache = new SceneContinuationCache(namespace, storage);
  cache.write("project", { command: f.command, flow: null });
  const set = storage.setItem;
  let fail = false, triggered = false;
  storage.setItem = (key, value) => { if (fail) throw Error("quota"); set(key, value); };
  const request = f.api.request.bind(f.api);
  f.api.request = async (path, options) => {
    const result = await request(path, options);
    if (path.endsWith("/initialize") && options?.method === "POST" && !triggered) {
      fail = true;
      triggered = true;
    }
    return result;
  };
  const runner = new SceneConfirmationRunner(f.api, async () => {}, 90, cache);
  await assert.rejects(runner.run(f.command), SceneConfirmationPending);
  assert.deepEqual(posts(f).map(call => call.path.split("/").at(-1)), ["initialize"]);
  const recovered = new SceneContinuationCache(namespace, storage).read("project");
  assert.equal(recovered.flow.steps.length, 1);
  assert.equal(recovered.flow.steps[0].name, "shot-0:open");
  fail = false;
  const resumed = new SceneConfirmationRunner(f.api, async () => {}, 90, new SceneContinuationCache(namespace, storage));
  assert.equal((await resumed.run(recovered.command)).activePlanId, "video-plan");
  assert.equal(f.outcomes.size, 5);
});
