import type { ShotNarration, ShotOverview } from "@openslate/core/public";
import { ApiError } from "../../api/client.ts";
import { estimateNarrationSeconds, narrationPace } from "../../model/checks.ts";
import { NARRATION_SAMPLE_RATE, RECORDING_WITHOUT_WORDS, type NarrationAudioRead } from "../../model/narration.ts";
import { STOCK_VOICES } from "../../model/settings-voice.ts";
import type { ProjectSnapshot } from "../../model/types.ts";
import { recompute } from "../fixture-commands.ts";
import type { FixtureWorld } from "../fixture-port.ts";
import { settingsRoutes } from "./settings.ts";
import { DECLINE, type FixtureRoute } from "./types.ts";

/**
 * Simulated narration routes for the sample film (?ui=next&fixture=last-ferry), card B13. Nothing is generated,
 * charged or saved, and no audio leaves the page.
 *
 * - GET /api/narration/voices: the stock voices, the film's narrator (Settings › Voice) marked as its default.
 * - GET /narration/shots/:shotId: the shot's narration section and its current voice line or recording.
 * - GET FIXTURE_AUDIO_ROUTE/:audioId: how long a take is; the page plays a quiet stand-in of that length.
 * - POST /shots/:shotId/narration/recording?expectedHeadVersion=N: a recording as the shot's narration, from the
 *   file's name, size, type and the length the browser read (an unreadable file is refused, as the studio's media
 *   check would). It sets the shot to "my recording", replays a known key, and is undone through POST /storyboard.
 * - POST /storyboard, kind narration, field voice: the shot's voice. A voiced line made in another voice is
 *   no longer current (it is made again with the scene's next keyframes or video, as on the server).
 *   Undo of these two commands is answered here; every other storyboard command is declined (Plan owns them).
 */

export const FIXTURE_AUDIO_ROUTE = "/narration/fixture-audio";

type SnapshotShot = ProjectSnapshot["project"]["shots"][number];
const MIB = 1024 * 1024;
/** Stand-in for the speech model a voice line was made with. */
const FIXTURE_SPEECH_MODEL = "gpt-4o-mini-tts";

interface Recording {
  id: string;
  sha256: string;
  seconds: number;
}

interface UndoEntry {
  commandId: string;
  shotId: string;
  headAfter: number;
  overviewShot: ShotOverview;
  snapshotShot: SnapshotShot | undefined;
  recording: Recording | undefined;
  madeWith: string | undefined;
}

interface NarrationFixture {
  /** Receipts by Idempotency-Key. */
  receipts: Map<string, unknown>;
  /** Each shot's current recording (mode "uploaded"). */
  recordings: Map<string, Recording>;
  /** The voice each shot's voiced line was made with; the film's narrator unless set here. */
  madeWith: Map<string, string>;
  /** Every take this film has shown, for the stand-in audio. */
  lengths: Map<string, number>;
  undo: UndoEntry | null;
  known: Set<string>;
  serial: number;
}

const fixtures = new WeakMap<FixtureWorld, NarrationFixture>();
function state(world: FixtureWorld): NarrationFixture {
  let current = fixtures.get(world);
  if (!current) {
    current = { receipts: new Map(), recordings: new Map(), madeWith: new Map(), lengths: new Map(), undo: null, known: new Set(), serial: 0 };
    fixtures.set(world, current);
  }
  return current;
}

/** A 64-character lowercase hex stand-in for a SHA-256 (fixture only). */
function hexDigest(text: string): string {
  let hash = 0x811c9dc5;
  let out = "";
  for (let round = 0; out.length < 64; round++) {
    for (const char of `${round}:${text}`) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
    out += hash.toString(16).padStart(8, "0");
  }
  return out.slice(0, 64);
}

/** The film's narrator voice, as Settings › Voice keeps it (asked of the route that owns it). */
function filmVoice(world: FixtureWorld): string {
  const route = settingsRoutes.find((candidate) => candidate.method === "GET" && candidate.match.test("/settings/voice"));
  const answer = route?.handle(world, [], undefined) as { narratorVoice?: unknown } | undefined;
  return typeof answer?.narratorVoice === "string" ? answer.narratorVoice : "cedar";
}

const head = (world: FixtureWorld) => world.snapshot.project.headVersion;
const snapshotShot = (world: FixtureWorld, shotId: string) => world.snapshot.project.shots.find((row) => row.id === shotId);

function findShot(world: FixtureWorld, shotId: string): ShotOverview {
  const shot = world.overview.shots[shotId];
  if (!shot) throw new ApiError("NOT_FOUND", 404);
  return shot;
}

function requireHead(world: FixtureWorld, expected: unknown): void {
  if (!Number.isSafeInteger(expected)) throw new ApiError("VALIDATION_ERROR", 400);
  if (expected !== head(world)) throw new ApiError("REVISION_CONFLICT", 409);
}

/** One change to a shot's narration as a new film version, with the roll-ups derived again. */
function apply(world: FixtureWorld, shotId: string, overviewShot: ShotOverview, row: SnapshotShot): void {
  world.update((w) => {
    const headVersion = w.snapshot.project.headVersion + 1;
    const revisionId = `rev-narration-${headVersion}`;
    const shots = w.snapshot.project.shots.map((existing) => (existing.id === shotId ? row : existing));
    w.snapshot = { ...w.snapshot, project: { ...w.snapshot.project, shots, headVersion, revisionId } };
    w.overview = recompute({ ...w.overview, headVersion, revisionId, shots: { ...w.overview.shots, [shotId]: overviewShot } }, w.snapshot.notes ?? []);
  });
}

function remember(world: FixtureWorld, shotId: string): Omit<UndoEntry, "commandId" | "headAfter"> {
  const fixture = state(world);
  return {
    shotId,
    overviewShot: structuredClone(findShot(world, shotId)),
    snapshotShot: structuredClone(snapshotShot(world, shotId)),
    recording: fixture.recordings.get(shotId),
    madeWith: fixture.madeWith.get(shotId),
  };
}

function command(world: FixtureWorld, before: Omit<UndoEntry, "commandId" | "headAfter">): string {
  const fixture = state(world);
  const commandId = `narration-command-${++fixture.serial}`;
  fixture.known.add(commandId);
  fixture.undo = { ...before, commandId, headAfter: head(world) };
  return commandId;
}

// ---- reads ---------------------------------------------------------------------------------------------

function voices(world: FixtureWorld, query: string | undefined) {
  const projectId = new URLSearchParams(query ?? "").get("projectId");
  const film = projectId && projectId === world.snapshot.project.id ? filmVoice(world) : "cedar";
  return { defaultNarratorVoice: film, voices: STOCK_VOICES.map((id) => ({ id, default: id === film })) };
}

/** The shot's take now: its recording, or the voice line the overview reports as voiced. */
function currentAudio(world: FixtureWorld, shot: ShotOverview): NarrationAudioRead | null {
  const fixture = state(world);
  const mode = snapshotShot(world, shot.shotId)?.narration?.mode;
  const recording = fixture.recordings.get(shot.shotId);
  if (mode === "uploaded" && recording) {
    fixture.lengths.set(recording.id, recording.seconds);
    return { id: recording.id, declaredOrigin: "uploaded", media: { sha256: recording.sha256, probe: { audio: { samples: Math.round(recording.seconds * NARRATION_SAMPLE_RATE) } } } };
  }
  const line = shot.narration;
  if (line.state !== "ready" || line.measuredSeconds === undefined) return null;
  const voice = fixture.madeWith.get(shot.shotId) ?? filmVoice(world);
  const id = `fixture-voice-${shot.shotId}-${hexDigest(`${line.text}|${voice}|${line.measuredSeconds}`).slice(0, 12)}`;
  fixture.lengths.set(id, line.measuredSeconds);
  return {
    id,
    originEvidence: "verified_generated_audio",
    media: { sha256: hexDigest(id), probe: { audio: { samples: Math.round(line.measuredSeconds * NARRATION_SAMPLE_RATE) } } },
    generation: { voice, model: FIXTURE_SPEECH_MODEL },
  };
}

function shotDetail(world: FixtureWorld, shotId: string) {
  const shot = findShot(world, shotId);
  const audio = currentAudio(world, shot);
  const row = snapshotShot(world, shotId);
  const text = row?.narration?.text ?? shot.narration.text;
  const segment = audio || text.trim()
    ? { entry: { segmentId: `segment-${shotId}` }, script: { id: `script-${shotId}-${head(world)}`, text, source: row?.narration?.mode === "uploaded" ? { kind: "uploaded" } : { kind: "generated", voice: null, profileRevisionId: null } }, audio, cue: null }
    : null;
  return { shotId, headVersion: head(world), plannedFrames: shot.durationFrames, narrationVersion: head(world), segment, session: null, intentCurrent: true, latestSpeechProposalId: null, committed: shot.narration.state === "ready" };
}

function audioLength(world: FixtureWorld, audioId: string) {
  const seconds = state(world).lengths.get(audioId);
  if (seconds === undefined) throw new ApiError("NOT_FOUND", 404);
  return { seconds };
}

// ---- the recording -----------------------------------------------------------------------------------

interface RecordingBody {
  name?: string;
  size?: number;
  type?: string;
  durationSeconds?: number;
  key?: string;
  /** Answer a refusal as `{ refused: { code } }`: the panel says it in place instead of a toast. */
  refusalInBody?: boolean;
}

function addRecording(world: FixtureWorld, shotId: string, query: string | undefined, raw: unknown): unknown {
  const body: RecordingBody = raw && typeof raw === "object" ? (raw as RecordingBody) : {};
  const fixture = state(world);
  if (body.key && fixture.receipts.has(body.key)) return fixture.receipts.get(body.key);
  try {
    const receipt = recordingCommand(world, shotId, query, body);
    if (body.key) fixture.receipts.set(body.key, receipt);
    return receipt;
  } catch (error) {
    if (body.refusalInBody && error instanceof ApiError) return { refused: { code: error.code } };
    throw error;
  }
}

function recordingCommand(world: FixtureWorld, shotId: string, query: string | undefined, body: RecordingBody) {
  const shot = findShot(world, shotId);
  requireHead(world, Number(new URLSearchParams(query ?? "").get("expectedHeadVersion") ?? Number.NaN));
  const scene = world.overview.scenes.find((candidate) => candidate.sceneId === shot.sceneId);
  if (scene?.confirmation?.state === "running") throw new ApiError("CONFIRMATION_RUNNING", 409);
  const size = Number(body.size ?? 0);
  if (!(size > 0)) throw new ApiError("MEDIA_INVALID_INPUT", 409);
  if (size > 128 * MIB) throw new ApiError("UPLOAD_TOO_LARGE", 409);
  const seconds = Number(body.durationSeconds);
  // The studio measures every recording; one the browser could not read stands for one the studio cannot read.
  if (!(seconds > 0)) throw new ApiError("MEDIA_INVALID_INPUT", 409);
  if (seconds > 360) throw new ApiError("MEDIA_DURATION_LIMIT", 409);

  const fixture = state(world);
  const before = remember(world, shotId);
  const measured = Math.round(seconds * 1000) / 1000;
  const recording: Recording = { id: `fixture-recording-${shotId}-${++fixture.serial}`, sha256: hexDigest(`${body.name}|${size}|${fixture.serial}`), seconds: measured };
  const row = snapshotShot(world, shotId);
  const text = row?.narration?.text.trim() || shot.narration.text.trim() || RECORDING_WITHOUT_WORDS;
  const narration: ShotNarration = { state: "ready", text, measuredSeconds: measured, fits: null };
  fixture.recordings.set(shotId, recording);
  fixture.lengths.set(recording.id, measured);
  const nextRow: SnapshotShot = { ...(row ?? { id: shotId, sceneId: shot.sceneId, purpose: shot.purpose, framing: shot.framing, motion: shot.motion, desiredFrames: shot.durationFrames, imagePrompt: shot.imagePrompt, videoPrompt: shot.imagePrompt }), narration: { mode: "uploaded", text, voice: row?.narration?.voice ?? "stock" } };
  apply(world, shotId, { ...shot, narration }, nextRow);
  const commandId = command(world, before);
  const fits = world.overview.shots[shotId]!.narration.fits !== false;
  return { shotId, headVersion: head(world), commandId, fits, measuredSeconds: measured, recording: { id: recording.id, sha256: recording.sha256, samples: Math.round(measured * NARRATION_SAMPLE_RATE) }, shot: shotDetail(world, shotId) };
}

// ---- the shot's voice (POST /storyboard) ------------------------------------------------------------------

interface StoryboardBody {
  kind?: string;
  id?: string;
  field?: string;
  value?: string;
  commandId?: string;
  expectedHeadVersion?: number;
}

const VOICES = new Set<string>(["stock", "personal", ...STOCK_VOICES]);

function storyboard(world: FixtureWorld, raw: unknown): unknown {
  const body: StoryboardBody = raw && typeof raw === "object" ? (raw as StoryboardBody) : {};
  if (body.kind === "undo") return state(world).known.has(body.commandId ?? "") ? undo(world, body) : DECLINE;
  if (body.kind !== "narration" || body.field !== "voice") return DECLINE;
  if (body.expectedHeadVersion !== undefined) requireHead(world, body.expectedHeadVersion);
  const voice = body.value ?? "";
  if (!VOICES.has(voice)) throw new ApiError("VALIDATION_ERROR", 400);
  const shot = findShot(world, body.id ?? "");
  const row = snapshotShot(world, shot.shotId);
  const fixture = state(world);
  const before = remember(world, shot.shotId);
  const nextRow: SnapshotShot = { ...row!, narration: { mode: row?.narration?.mode ?? "undecided", text: row?.narration?.text ?? "", voice } };
  // A voiced line stays current only in the voice it was made with ("stock" follows the film's narrator).
  const made = fixture.madeWith.get(shot.shotId) ?? filmVoice(world);
  const wanted = voice === "stock" ? filmVoice(world) : voice;
  let narration = shot.narration;
  if (nextRow.narration?.mode === "generated" && narration.state === "ready" && wanted !== made) {
    const pace = narrationPace(narration);
    narration = { state: "text_only", text: narration.text, estimatedSeconds: estimateNarrationSeconds(narration.text, pace.secondsPerUnit), fits: null };
  }
  apply(world, shot.shotId, { ...shot, narration }, nextRow);
  return { commandId: command(world, before), headVersion: head(world) };
}

/** One-step Undo, only while nothing changed since. */
function undo(world: FixtureWorld, body: StoryboardBody): unknown {
  const fixture = state(world);
  const entry = fixture.undo;
  if (!entry || entry.commandId !== body.commandId || entry.headAfter !== head(world)) throw new ApiError("UNDO_UNAVAILABLE", 409);
  fixture.undo = null;
  if (entry.recording) fixture.recordings.set(entry.shotId, entry.recording);
  else fixture.recordings.delete(entry.shotId);
  if (entry.madeWith) fixture.madeWith.set(entry.shotId, entry.madeWith);
  else fixture.madeWith.delete(entry.shotId);
  const current = snapshotShot(world, entry.shotId)!;
  const { narration: _now, ...rest } = current;
  const row: SnapshotShot = entry.snapshotShot?.narration ? { ...rest, narration: entry.snapshotShot.narration } : rest;
  // The shot's other fields stay as they are now; only its narration goes back.
  apply(world, entry.shotId, { ...findShot(world, entry.shotId), narration: entry.overviewShot.narration }, row);
  const commandId = `narration-command-${++fixture.serial}`;
  return { commandId, headVersion: head(world) };
}

// ---- the stand-in audio ----------------------------------------------------------------------------------

/**
 * A quiet stand-in for a take of `seconds`: a low hum shaped into syllable-like pulses, 8 kHz 16-bit mono WAV.
 * The sample film has no recordings; this lets its player load, seek and play for the real length.
 */
export function fixtureVoiceWav(seconds: number): ArrayBuffer {
  const rate = 8000;
  const count = Math.max(1, Math.round(Math.min(Math.max(seconds, 0.1), 400) * rate));
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); text(8, "WAVE");
  text(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const t = i / rate;
    const syllable = Math.max(0, Math.sin(Math.PI * 3.6 * t)) ** 2;
    const fade = Math.min(1, t * 20, (count / rate - t) * 20);
    const sample = 0.08 * syllable * fade * (Math.sin(2 * Math.PI * 180 * t) + 0.4 * Math.sin(2 * Math.PI * 360 * t));
    view.setInt16(44 + i * 2, Math.round(sample * 32767), true);
  }
  return buffer;
}

export const narrationRoutes: FixtureRoute[] = [
  { method: "GET", match: /^\/api\/narration\/voices(?:\?(.*))?$/, handle: (world, [query]) => voices(world, query) },
  { method: "GET", match: /^\/narration\/shots\/([^/?]+)$/, handle: (world, [shotId]) => shotDetail(world, decodeURIComponent(shotId ?? "")) },
  { method: "GET", match: /^\/narration\/fixture-audio\/([^/?]+)$/, handle: (world, [audioId]) => audioLength(world, decodeURIComponent(audioId ?? "")) },
  { method: "POST", match: /^\/shots\/([^/?]+)\/narration\/recording(?:\?(.*))?$/, handle: (world, [shotId, query], body) => addRecording(world, decodeURIComponent(shotId ?? ""), query, body) },
  { method: "POST", match: /^\/storyboard$/, handle: (world, _params, body) => storyboard(world, body) },
];
