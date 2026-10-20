import type { DirectorNote, DirectorProposal, GenerationOverview, KeyframeSlot, MediaSlot, SceneOverview, ShotNarration, ShotOverview } from "@openslate/core/public";
import type { DirectorStatus, ProjectSnapshot } from "../model/types.ts";
import { fixtureFitSeconds } from "./narration-fit.ts";

/**
 * The Last Ferry: the fictional film from the chosen design (docs/ai/prototypes/last-ferry).
 * Its state matches the prototype at the start: Scene 1 saved, Scene 2 keyframes back with
 * 2.2 and 2.3 not opened and 2.3's line too long, the Director's notes a and b open on Scene 2,
 * Scene 3 not started.
 */
export const FPS = 30;
export const PROJECT_ID = "last-ferry";

const sha = (seed: string) => seed.padEnd(64, "0").replace(/[^0-9a-f]/g, "a").slice(0, 64);
export const artifactFor = (key: string) => ({ artifactId: `art-${key}`, sha256: sha(hexOf(key)), kind: "image" as const });

/** Hex-only digest stand-in, deterministic and dependency-free (fixture only). */
function hexOf(text: string): string {
  let out = "";
  for (const char of text) out += char.charCodeAt(0).toString(16);
  return out;
}

interface Row {
  id: string;
  scene: number;
  framing: string;
  prompt: string;
  motion: string;
  seconds: number;
  narration: string | null;
  narrationSeconds: number;
  keyframe: "ready" | "none";
  opened: boolean;
  video: "ready" | "none";
}

const rows: Row[] = [
  { id: "1.1", scene: 1, framing: "Wide", prompt: "The ticket office at closing time, shutters half down, one lamp on.", motion: "Slow pan right", seconds: 6, narration: null, narrationSeconds: 0, keyframe: "ready", opened: true, video: "ready" },
  { id: "1.2", scene: 1, framing: "Medium", prompt: "Mara at the counter, sliding coins across.", motion: "Static", seconds: 5, narration: "One for the morning boat.", narrationSeconds: 2.1, keyframe: "ready", opened: true, video: "ready" },
  { id: "1.3", scene: 1, framing: "Close-up", prompt: "The clerk stamps the ticket.", motion: "Slow push-in", seconds: 6, narration: null, narrationSeconds: 0, keyframe: "ready", opened: true, video: "ready" },
  { id: "2.1", scene: 2, framing: "Wide", prompt: "The empty harbour at dawn, the ferry moored, fog over the water.", motion: "Slow push-in", seconds: 5, narration: null, narrationSeconds: 0, keyframe: "ready", opened: true, video: "none" },
  { id: "2.2", scene: 2, framing: "Medium", prompt: "Mara on the pier in her red coat, a ticket in her hand.", motion: "Static, breath visible", seconds: 4, narration: null, narrationSeconds: 0, keyframe: "ready", opened: false, video: "none" },
  { id: "2.3", scene: 2, framing: "Close-up", prompt: "The ticket’s printed date, “Sunday 31 March”, under Mara’s thumb.", motion: "Slow tilt down", seconds: 6, narration: "It was the last boat of the season, and I nearly missed it.", narrationSeconds: 7.4, keyframe: "ready", opened: false, video: "none" },
  { id: "3.1", scene: 3, framing: "Wide", prompt: "The ferry pulls away into the fog.", motion: "Slow pull-back", seconds: 8, narration: null, narrationSeconds: 0, keyframe: "none", opened: false, video: "none" },
  { id: "3.2", scene: 3, framing: "Close-up", prompt: "Mara at the rail, the harbour behind her.", motion: "Static", seconds: 8, narration: "I didn’t look back.", narrationSeconds: 1.6, keyframe: "none", opened: false, video: "none" },
];

export const shotId = (label: string) => `shot-${label.replace(".", "-")}`;
export const sceneId = (ordinal: number) => `scene-${ordinal}`;
const sceneTitles = ["Closing time", "Harbour at dawn", "Departure"];
const sceneStates: SceneOverview["state"][] = ["video_saved", "keyframes_back", "not_started"];

function keyframe(row: Row): KeyframeSlot {
  if (row.keyframe === "none") return { state: "none", takeCount: 0, opened: false };
  return { state: "ready", artifact: artifactFor(row.id), takeCount: 1, opened: row.opened };
}

function video(row: Row): MediaSlot {
  return row.video === "ready" ? { state: "ready", artifact: { ...artifactFor(`${row.id}-clip`), kind: "video" }, takeCount: 1 } : { state: "none", takeCount: 0 };
}

function narration(row: Row): ShotNarration {
  if (!row.narration) return { state: "none", text: "", fits: true };
  if (row.keyframe === "none") return { state: "text_only", text: row.narration, estimatedSeconds: row.narrationSeconds, fits: row.narrationSeconds <= row.seconds };
  const fitSeconds = fixtureFitSeconds(row.seconds * FPS, row.narrationSeconds, FPS);
  return { state: "ready", text: row.narration, measuredSeconds: row.narrationSeconds, fits: row.narrationSeconds <= row.seconds,
    ...(fitSeconds !== undefined ? { fitSeconds } : {}) };
}

export function lastFerryOverview(): GenerationOverview {
  const shots: Record<string, ShotOverview> = {};
  for (const row of rows)
    shots[shotId(row.id)] = {
      shotId: shotId(row.id),
      sceneId: sceneId(row.scene),
      label: row.id,
      framing: row.framing,
      purpose: row.prompt,
      imagePrompt: row.prompt,
      motion: row.motion,
      durationFrames: row.seconds * FPS,
      keyframe: keyframe(row),
      video: video(row),
      narration: narration(row),
      quotes: { regenerateKeyframe: { micros: row.narration && row.keyframe === "none" ? "50000" : "40000", units: row.narration && row.keyframe === "none" ? 2 : 1, unitMicros: row.narration && row.keyframe === "none" ? "0" : "40000", priceUnknown: false } },
    };
  const scenes: SceneOverview[] = [1, 2, 3].map((ordinal) => {
    const inScene = rows.filter((row) => row.scene === ordinal);
    const ids = inScene.map((row) => shotId(row.id));
    const state = sceneStates[ordinal - 1]!;
    const videoTargets = state === "keyframes_back" ? ids : [];
    const keyframeTargets = state === "not_started" ? ids : [];
    const missingVoices = inScene.filter((row) => row.narration && row.keyframe === "none").length;
    const scene: SceneOverview = {
      sceneId: sceneId(ordinal),
      ordinal,
      title: sceneTitles[ordinal - 1]!,
      purpose: sceneTitles[ordinal - 1]!,
      state,
      shotIds: ids,
      counts: {
        shots: ids.length,
        keyframesReady: inScene.filter((row) => row.keyframe === "ready").length,
        opened: inScene.filter((row) => row.opened).length,
        videosReady: inScene.filter((row) => row.video === "ready").length,
      },
      videoTargets,
      keyframeTargets,
      quotes: {
        regenerateKeyframe: { micros: "40000", units: 1, unitMicros: "40000", priceUnknown: false },
        confirmVideo: { micros: String(videoTargets.length * 500000), units: videoTargets.length, unitMicros: videoTargets.length ? "500000" : "0", priceUnknown: false },
        oneClip: { micros: "500000", units: 1, unitMicros: "500000", priceUnknown: false },
        oneVoice: { micros: "10000", units: 1, unitMicros: "10000", priceUnknown: false },
        voice: { micros: String(missingVoices * 10000), units: missingVoices, unitMicros: missingVoices ? "10000" : "0", priceUnknown: false },
        ...(keyframeTargets.length ? { makeKeyframes: { micros: String(keyframeTargets.length * 40000 + missingVoices * 10000), units: keyframeTargets.length + missingVoices, unitMicros: missingVoices ? "0" : "40000", priceUnknown: false } } : {}),
      },
      blockers: state === "keyframes_back"
        ? [
            ...inScene.filter((row) => !row.opened).map((row) => ({ code: "frame_not_opened" as const, shotId: shotId(row.id) })),
            ...inScene.filter((row) => row.narrationSeconds > row.seconds).map((row) => ({ code: "narration_too_long" as const, shotId: shotId(row.id) })),
            // The Director's blocking note b on 2.3 (see lastFerryNotes).
            ...(ordinal === 2 ? [{ code: "recommendation_open" as const, shotId: shotId("2.3") }] : []),
          ]
        : [],
      confirmationDigest: state === "keyframes_back" ? "f".repeat(64) : null,
    };
    return scene;
  });
  return {
    projectId: PROJECT_ID,
    revisionId: "rev-1",
    headVersion: 12,
    cursor: 100,
    fps: FPS,
    stopped: null,
    director: { state: "idle", scopeIds: [] },
    controlAuthorityId: null,
    scenes,
    shots,
    restartCasualties: [],
  };
}

/** Local "YYYY-MM-DDTHH:MM:00" on the given day, so the sample conversation always reads as today. */
function todayAt(now: Date, hours: number, minutes: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(hours)}:${pad(minutes)}:00`;
}

export function lastFerrySnapshot(now: Date = new Date()): ProjectSnapshot {
  return {
    project: {
      id: PROJECT_ID,
      name: "The Last Ferry",
      revisionId: "rev-1",
      headVersion: 12,
      brief: "Mara buys the last ticket for the morning ferry and leaves her town.",
      story: "Closing time at the ticket office; the harbour at dawn; the ferry departs.",
      scenes: [1, 2, 3].map((ordinal) => ({ id: sceneId(ordinal), revisionId: `scene-rev-${ordinal}`, purpose: sceneTitles[ordinal - 1]!, title: sceneTitles[ordinal - 1]! })),
      shots: rows.map((row) => ({
        id: shotId(row.id),
        sceneId: sceneId(row.scene),
        purpose: row.prompt,
        framing: row.framing,
        motion: row.motion,
        desiredFrames: row.seconds * FPS,
        imagePrompt: row.prompt,
        videoPrompt: `${row.prompt} ${row.motion}.`,
        ...(row.narration ? { narration: { mode: "generated" as const, text: row.narration, voice: "stock" as const } } : {}),
      })),
    },
    conversation: [
      { id: "m1", role: "user", text: "@Scene 2 make the harbour feel colder, more like early morning, and keep Mara's red coat.", scopeIds: [sceneId(2)], at: todayAt(now, 10, 42) },
      { id: "m2", role: "assistant", text: "I rewrote the three Scene 2 prompts with a blue dawn light and kept Mara's red coat in 2.2. Keyframes for all three shots are back. Two things to check before I make video:", at: todayAt(now, 10, 44) },
    ],
    questions: [],
    notes: lastFerryNotes(now),
    control: { paused: false },
    cursor: 100,
  };
}

/**
 * The Director's two notes from the design, written with its 10:44 reply: (a) an observation on 2.2's coat,
 * (b) a blocking recommendation on 2.3's line, carried out by the held proposal p1.
 */
export function lastFerryNotes(now: Date = new Date()): DirectorNote[] {
  const createdAt = todayAt(now, 10, 44);
  const base = { requestId: "request-scene-2", turnId: "turn-1", state: "open" as const, version: 1, createdAt };
  return [
    {
      ...base,
      noteId: "note-a",
      letter: "a",
      anchor: { sceneId: sceneId(2), shotIds: [shotId("2.2")] },
      kind: "observation",
      blocking: false,
      text: "Mara's coat came out maroon, not red.",
      seenKeyframe: { shotId: shotId("2.2"), ...(({ artifactId, sha256 }) => ({ artifactId, sha256 }))(artifactFor("2.2")) },
      choices: [{ kind: "accept", label: "Keep maroon" }, { kind: "regenerate_keyframe", shotIds: [shotId("2.2")] }],
    },
    {
      ...base,
      noteId: "note-b",
      letter: "b",
      anchor: { sceneId: sceneId(2), shotIds: [shotId("2.3")] },
      kind: "recommendation",
      blocking: true,
      text: "The 2.3 line runs 7.4 s but the shot is 6 s.",
      choices: [{ kind: "proposal", proposalId: "p1" }, { kind: "edit_field", shotId: shotId("2.3"), field: "narration" }],
    },
  ];
}

/** The held proposal behind note b: make 2.3 eight seconds (film 48 s → 50 s); it keeps 2.3's keyframe. */
export function lastFerryProposals(now: Date = new Date()): DirectorProposal[] {
  return [{
    proposalId: "p1",
    noteId: "note-b",
    requestId: "request-scene-2",
    state: "held",
    preview: {
      changes: [{ shotId: shotId("2.3"), field: "desiredFrames", before: String(6 * FPS), after: String(8 * FPS) }],
      timeline: [
        { shotId: shotId("2.1"), sceneId: sceneId(2), label: "2.1", nowSeconds: 5, afterSeconds: 5, changed: false },
        { shotId: shotId("2.2"), sceneId: sceneId(2), label: "2.2", nowSeconds: 4, afterSeconds: 4, changed: false },
        { shotId: shotId("2.3"), sceneId: sceneId(2), label: "2.3", nowSeconds: 6, afterSeconds: 8, changed: true },
      ],
      effects: [{ shotId: shotId("2.3"), effect: "keeps_keyframe" }],
      filmSecondsNow: 48,
      filmSecondsAfter: 50,
    },
    previewDigest: "p1-preview",
    createdAt: todayAt(now, 10, 44),
  }];
}

export const lastFerryDirector: DirectorStatus = { mode: "fake", status: "idle", activeRequestId: null };

/** Which picture key (in last-ferry-pictures.ts) an artifact id shows; a later take ("art-1.1~3") shows its shot's. */
export function pictureKey(artifactId: string): string {
  return artifactId.replace(/^art-/, "").replace(/~\d+$/, "");
}
