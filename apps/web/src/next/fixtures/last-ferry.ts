import type { GenerationOverview, KeyframeSlot, MediaSlot, SceneOverview, ShotNarration, ShotOverview } from "@openslate/core/public";
import type { DirectorStatus, ProjectSnapshot } from "../model/types.ts";

/**
 * The Last Ferry: the fictional film from the chosen design (docs/ai/prototypes/last-ferry).
 * Its state matches the prototype at the start: Scene 1 saved, Scene 2 keyframes back with
 * 2.2 and 2.3 not opened and 2.3's line too long, Scene 3 not started.
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
  return { state: "ready", text: row.narration, measuredSeconds: row.narrationSeconds, fits: row.narrationSeconds <= row.seconds };
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
    };
  const scenes: SceneOverview[] = [1, 2, 3].map((ordinal) => {
    const inScene = rows.filter((row) => row.scene === ordinal);
    const ids = inScene.map((row) => shotId(row.id));
    const state = sceneStates[ordinal - 1]!;
    const videoTargets = state === "keyframes_back" ? ids : [];
    const keyframeTargets = state === "not_started" ? ids : [];
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
        ...(videoTargets.length ? { confirmVideo: { micros: String(videoTargets.length * 500000), units: videoTargets.length, unitMicros: "500000", priceUnknown: false } } : {}),
        ...(keyframeTargets.length ? { makeKeyframes: { micros: String(keyframeTargets.length * 40000), units: keyframeTargets.length, unitMicros: "40000", priceUnknown: false } } : {}),
      },
      blockers: state === "keyframes_back"
        ? [
            ...inScene.filter((row) => !row.opened).map((row) => ({ code: "frame_not_opened" as const, shotId: shotId(row.id) })),
            ...inScene.filter((row) => row.narrationSeconds > row.seconds).map((row) => ({ code: "narration_too_long" as const, shotId: shotId(row.id) })),
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

export function lastFerrySnapshot(): ProjectSnapshot {
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
      { id: "m1", role: "user", text: "@Scene 2 make the harbour feel colder, more like early morning, and keep Mara's red coat.", scopeIds: [sceneId(2)], at: "2026-10-14T10:42:00" },
      { id: "m2", role: "assistant", text: "I rewrote the three Scene 2 prompts with a blue dawn light and kept Mara's red coat in 2.2. Keyframes for all three shots are back. Two things to check before I make video:", at: "2026-10-14T10:44:00" },
    ],
    questions: [],
    control: { paused: false },
    cursor: 100,
  };
}

export const lastFerryDirector: DirectorStatus = { mode: "fake", status: "idle", activeRequestId: null };

/** Which picture key (in last-ferry-pictures.ts) an artifact id shows. */
export function pictureKey(artifactId: string): string {
  return artifactId.replace(/^art-/, "");
}
