import { videoTicks, NATIVE_FRAME_RATES } from "./frame-rate.js";
import { createHash } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { link, mkdtemp, open, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { canonical, digest, invariant, snapshotLocalExecution, type LocalExecutionIdentity } from "@openslate/core";
import type { SuppliedAudioPlacement, SuppliedClip, SuppliedMedia } from "./types.js";
import { validateCaptions, type Caption } from "./captions.js";

export const SOUND_NAMES = ["pop", "thud", "whoosh", "ding", "tick", "boing"] as const;
export type SoundName = typeof SOUND_NAMES[number];
export interface RowEdits { speed?: 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2; holdFrames?: number; zoom?: { scale: number; x?: number; y?: number } }
export type EditedClip = SuppliedClip & RowEdits;
export type EditedAudioPlacement = SuppliedAudioPlacement & { fadeInSamples?: number };
export interface RenderExtras { captions?: Caption[]; mastering?: "loudnorm-0.3.0"; sfxPackDigest?: string }

export function rowEdits(row: Record<string, unknown>, index: number): RowEdits {
  const name = `Row ${index + 1}`, result: RowEdits = {};
  if (row.speed !== undefined) {
    invariant([0.5, 0.75, 1, 1.25, 1.5, 2].includes(row.speed as number), "CODE_PLAN_RENDER_INPUT", `${name}: speed must be one of 0.5, 0.75, 1, 1.25, 1.5, 2`);
    result.speed = row.speed as RowEdits["speed"] & number;
  }
  if (row.holdFrames !== undefined) {
    invariant(Number.isSafeInteger(row.holdFrames) && Number(row.holdFrames) >= 1 && Number(row.holdFrames) <= 90,
      "CODE_PLAN_RENDER_INPUT", `${name}: holdFrames must be an integer in 1–90`);
    result.holdFrames = row.holdFrames as number;
  }
  if (row.zoom !== undefined) {
    const zoom = row.zoom as Record<string, unknown>;
    invariant(zoom && typeof zoom === "object" && !Array.isArray(zoom) && Object.keys(zoom).every(key => ["scale", "x", "y"].includes(key))
      && typeof zoom.scale === "number" && Number.isFinite(zoom.scale) && zoom.scale > 1 && zoom.scale <= 1.4,
    "CODE_PLAN_RENDER_INPUT", `${name}: zoom.scale must be greater than 1 and at most 1.4`);
    for (const key of ["x", "y"]) invariant(zoom[key] === undefined || typeof zoom[key] === "number" && Number.isFinite(zoom[key]) && Number(zoom[key]) >= 0 && Number(zoom[key]) <= 1,
      "CODE_PLAN_RENDER_INPUT", `${name}: zoom.${key} must be in 0–1 (default 0.5)`);
    result.zoom = { scale: zoom.scale, ...(zoom.x === undefined ? {} : { x: zoom.x as number }), ...(zoom.y === undefined ? {} : { y: zoom.y as number }) };
  }
  return result;
}
export const rowFrames = (row: { durationFrames: number } & RowEdits): number => Math.round(row.durationFrames / (row.speed ?? 1)) + (row.holdFrames ?? 0);
export function fadeSamples(value: unknown, duration: number, row: number, field: string): number {
  const max = Math.min(240000, duration);
  invariant(Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= max, "CODE_PLAN_RENDER_INPUT", `Audio row ${row + 1}: ${field} must be an integer in 1–${max}`);
  return value as number;
}

export interface LocalTimelineInput extends RenderExtras {
  projectId: string;
  clips: EditedClip[];
  audio: EditedAudioPlacement[];
}
export interface LocalTimelineDocument extends LocalTimelineInput {
  version: 1;
  localExecution: LocalExecutionIdentity;
  transition: "cut";
  frameRate: { numerator: 30; denominator: 1 };
  sampleRate: 48000;
  totalFrames: number;
  audio: (EditedAudioPlacement & { gainMilliDb: number })[];
  recipeDigest: string;
}
/** File bytes and recipe identity are different hashes; neither grants publication authority. */
export interface LocalTimelineReceipt { recipeDigest: string; sha256: string; byteLength: number }
export interface StoredLocalTimeline {
  document: LocalTimelineDocument;
  receipt: LocalTimelineReceipt;
  /** Trusted host path. Models and browsers receive owned artifact IDs instead. */
  path: string;
}
interface SourceVerifier {
  verifiedSource(source: SuppliedMedia, options?: { signal?: AbortSignal }): Promise<{ source: SuppliedMedia; path: string }>;
}
const MAX_BYTES = 1024 * 1024, MAX_FRAMES = 10800, MAX_SAMPLES = MAX_FRAMES * 1600, MAX_SOURCE_BYTES = 1024 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/, ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
function invalid(value: unknown, message: string): asserts value { invariant(value, "LOCAL_TIMELINE_INVALID", message); }
function rowContext<T>(label: string, action: () => T): T {
  try { return action(); }
  catch (error) { if (error instanceof Error && !error.message.startsWith(label)) error.message = `${label}: ${error.message}`; throw error; }
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function cancelled(signal?: AbortSignal): void { invariant(!signal?.aborted, "MEDIA_CANCELLED", "Timeline operation cancelled"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Bounded JSON copy that rejects hidden fields, accessors and non-data objects without invoking getters. */
function snapshot(value: unknown): unknown {
  let remaining = 12000;
  function copy(input: unknown, depth: number): unknown {
    invalid(--remaining >= 0 && depth <= 12, "Timeline data exceeds its structural limit");
    if (input === null || typeof input === "boolean") return input;
    if (typeof input === "string") { invalid(input.length <= 512, "Timeline string exceeds its limit"); return input; }
    if (typeof input === "number") { invalid(Number.isFinite(input), "Timeline numbers must be finite"); return input; }
    invalid(typeof input === "object" && input !== null, "Timeline values must be JSON data");
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    invalid(array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null, "Timeline objects must be plain data");
    const keys = Reflect.ownKeys(input);
    invalid(keys.length <= 129, "Timeline object exceeds its field limit");
    const result: Record<string, unknown> | unknown[] = array ? [] : {};
    for (const key of keys) {
      if (array && key === "length") continue;
      invalid(typeof key === "string" && (!array || /^(0|[1-9][0-9]*)$/.test(key)), "Timeline has an unsupported field");
      const descriptor = Object.getOwnPropertyDescriptor(input, key)!;
      invalid(descriptor.enumerable && Object.hasOwn(descriptor, "value"), "Timeline fields must be enumerable data");
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    if (array) invalid(keys.length === (input as unknown[]).length + 1 && (result as unknown[]).length === (input as unknown[]).length, "Timeline arrays must be dense");
    return result;
  }
  return copy(value, 0);
}
function object(value: unknown, required: string[], optional: string[] = []): Record<string, unknown> {
  invalid(value && typeof value === "object" && !Array.isArray(value), "Expected a timeline object");
  const record = value as Record<string, unknown>, keys = Object.keys(record);
  invalid(required.every(key => Object.hasOwn(record, key)) && keys.every(key => required.includes(key) || optional.includes(key)), "Timeline fields do not match the supported contract");
  return record;
}
function integer(value: unknown, min: number, max: number): asserts value is number {
  invalid(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, "Timeline integer is outside its supported bounds");
}
function identity(value: unknown, pattern = HASH): asserts value is string { invalid(typeof value === "string" && pattern.test(value), "Invalid timeline identity"); }
function seconds(value: unknown): void { invalid(typeof value === "number" && value > 0 && value <= 361, "Invalid measured source duration"); }
function source(value: unknown, kind: "video" | "audio"): SuppliedMedia {
  const s = object(value, ["id", "artifactId", "kind", "originalSha256", "originalByteLength", "sha256", "byteLength", "probe", "toolchainDigest"]);
  identity(s.id); identity(s.artifactId, ID); identity(s.originalSha256); identity(s.sha256); identity(s.toolchainDigest);
  integer(s.originalByteLength, 1, MAX_SOURCE_BYTES); integer(s.byteLength, 1, MAX_SOURCE_BYTES);
  invalid(s.kind === kind, "Timeline source kind does not match its placement");
  const probe = object(s.probe, ["durationSeconds", kind]); seconds(probe.durationSeconds);
  if (kind === "video") {
    const video = object(probe.video, ["streamIndex", "width", "height", "frameRate", "frames", "durationSeconds", "codec"]);
    integer(video.streamIndex, 0, 0); integer(video.width, 2, 4096); integer(video.height, 2, 4096); integer(video.frames, 1, MAX_FRAMES);
    seconds(video.durationSeconds);
    invalid(NATIVE_FRAME_RATES.includes(video.frameRate as typeof NATIVE_FRAME_RATES[number]) && video.codec === "h264" && (video.width as number) % 2 === 0 && (video.height as number) % 2 === 0, "Timeline video must be normalized silent H264 at a supported constant frame rate");
  } else {
    const audio = object(probe.audio, ["streamIndex", "sampleRate", "channels", "samples", "durationSeconds", "codec"]);
    integer(audio.streamIndex, 0, 0); integer(audio.samples, 1, MAX_SAMPLES); seconds(audio.durationSeconds);
    invalid(audio.sampleRate === 48000 && audio.channels === 2 && audio.codec === "pcm_s16le", "Timeline audio must be measured 48 kHz stereo PCM");
  }
  const { id, ...body } = s;
  invalid(id === digest(body), "Timeline source differs from its descriptor identity");
  return s as unknown as SuppliedMedia;
}
function create(input: unknown): LocalTimelineDocument {
  const value = object(input, ["projectId", "clips", "audio"], ["captions", "mastering", "sfxPackDigest"]); identity(value.projectId, ID);
  invalid(Array.isArray(value.clips) && value.clips.length > 0 && value.clips.length <= 64, "A timeline needs one to 64 clips");
  invalid(Array.isArray(value.audio) && value.audio.length <= 65, "A timeline supports at most 65 audio placements");
  const artifacts = new Map<string, string>();
  const remember = (media: SuppliedMedia) => {
    invalid(!artifacts.has(media.artifactId) || artifacts.get(media.artifactId) === media.id, "One artifact cannot name different source descriptors");
    artifacts.set(media.artifactId, media.id); return media;
  };
  const clips: EditedClip[] = value.clips.map((raw, index) => rowContext(`Row ${index + 1}`, () => {
    const clip = object(raw, ["source", "startFrame", "durationFrames", "fit"], ["speed", "holdFrames", "zoom"]), media = remember(source(clip.source, "video"));
    integer(clip.startFrame, 0, MAX_FRAMES); integer(clip.durationFrames, 1, MAX_FRAMES);
    invalid(clip.startFrame + clip.durationFrames <= videoTicks(media.probe.video!), `Row ${index + 1}: clip exceeds measured source ticks (0–${videoTicks(media.probe.video!) - 1})`);
    invalid(clip.fit === "contain" || clip.fit === "cover", "Clip fit must be contain or cover");
    return { source: media, startFrame: clip.startFrame, durationFrames: clip.durationFrames, fit: clip.fit, ...rowEdits(clip, index) };
  }));
  const totalFrames = clips.reduce((sum, clip) => sum + rowFrames(clip), 0); integer(totalFrames, 1, MAX_FRAMES);
  const audioSources = new Set<string>();
  const audio = value.audio.map((raw, index) => rowContext(`Audio row ${index + 1}`, () => {
    const placement = object(raw, ["source", "startSample", "durationSamples", "atSample"], ["gainMilliDb", "fadeOutSamples", "fadeInSamples"]), media = remember(source(placement.source, "audio"));
    integer(placement.startSample, 0, MAX_SAMPLES); integer(placement.durationSamples, 1, MAX_SAMPLES); integer(placement.atSample, 0, totalFrames * 1600);
    const gainMilliDb = Object.hasOwn(placement, "gainMilliDb") ? placement.gainMilliDb : 0; integer(gainMilliDb, -60000, 12000);
    invalid(placement.startSample + placement.durationSamples <= media.probe.audio!.samples!, `Audio row ${index + 1}: audio exceeds measured source samples (0–${media.probe.audio!.samples! - 1})`);
    invalid(placement.atSample + placement.durationSamples <= totalFrames * 1600, `Audio row ${index + 1}: audio extends beyond the timeline (0–${totalFrames * 1600} samples)`);
    if (placement.fadeOutSamples !== undefined) integer(placement.fadeOutSamples, 1, Math.min(240000, placement.durationSamples));
    if (placement.fadeInSamples !== undefined) fadeSamples(placement.fadeInSamples, placement.durationSamples, index, "fadeInSamples");
    audioSources.add(media.sha256); invalid(audioSources.size <= 65, "Too many distinct audio sources");
    return { source: media, startSample: placement.startSample, durationSamples: placement.durationSamples, atSample: placement.atSample, gainMilliDb, ...(placement.fadeOutSamples !== undefined ? { fadeOutSamples: placement.fadeOutSamples } : {}), ...(placement.fadeInSamples !== undefined ? { fadeInSamples: placement.fadeInSamples as number } : {}) };
  }));
  const ends: number[] = [];
  for (const placement of [...audio].sort((a, b) => a.atSample - b.atSample)) {
    const lane = ends.findIndex(end => end <= placement.atSample);
    if (lane < 0) ends.push(placement.atSample + placement.durationSamples); else ends[lane] = placement.atSample + placement.durationSamples;
    invalid(ends.length <= 8, "Too many simultaneous audio placements");
  }
  const extras: RenderExtras = {};
  if (value.captions !== undefined) extras.captions = validateCaptions(value.captions, totalFrames);
  if (value.mastering !== undefined) { invalid(value.mastering === "loudnorm-0.3.0", "Unsupported timeline mastering recipe"); extras.mastering = value.mastering; }
  if (value.sfxPackDigest !== undefined) { identity(value.sfxPackDigest); extras.sfxPackDigest = value.sfxPackDigest; }
  const body = { version: 1 as const, localExecution: snapshotLocalExecution({ adapter: "local-media", version: "1" }), projectId: value.projectId,
    transition: "cut" as const, frameRate: { numerator: 30 as const, denominator: 1 as const }, sampleRate: 48000 as const, totalFrames, clips, audio, ...extras };
  const document = { ...body, recipeDigest: digest(body) };
  invalid(Buffer.byteLength(canonical(document)) <= MAX_BYTES, "Timeline document exceeds its byte limit");
  return freeze(document);
}

/** Select projectId/clips/audio from the SQL capture; publication target remains with the caller. */
export function createLocalTimelineDocument(input: LocalTimelineInput): LocalTimelineDocument { return create(snapshot(input)); }
export function parseLocalTimelineDocument(input: unknown): LocalTimelineDocument {
  const value = object(snapshot(input), ["version", "localExecution", "projectId", "transition", "frameRate", "sampleRate", "totalFrames", "clips", "audio", "recipeDigest"], ["captions", "mastering", "sfxPackDigest"]);
  const { version: _version, localExecution: _execution, transition: _transition, frameRate: _fps, sampleRate: _rate, totalFrames: _frames, recipeDigest: _digest, ...inputValue } = value;
  const document = create(inputValue);
  invalid(canonical(value) === canonical(document), "Timeline document does not match its canonical recipe");
  return document;
}
function receipt(input: unknown): LocalTimelineReceipt {
  const value = object(snapshot(input), ["recipeDigest", "sha256", "byteLength"]);
  identity(value.recipeDigest); identity(value.sha256); integer(value.byteLength, 1, MAX_BYTES);
  return freeze({ recipeDigest: value.recipeDigest, sha256: value.sha256, byteLength: value.byteLength });
}

/** Content-addressed host storage only. No SQL authority, current-target checks or rendering. */
export class LocalTimelineStore {
  readonly rootDir: string;
  private readonly media: SourceVerifier;
  constructor(options: { rootDir: string; media: SourceVerifier }) {
    invalid(isAbsolute(options.rootDir) && options.rootDir !== "/", "A private absolute timeline directory is required");
    invalid(options.media && typeof options.media.verifiedSource === "function", "A trusted source verifier is required");
    mkdirSync(options.rootDir, { recursive: true, mode: 0o700 }); this.rootDir = realpathSync(options.rootDir); this.media = options.media;
    for (const name of ["tmp", "documents"]) mkdirSync(join(this.rootDir, name), { recursive: true, mode: 0o700 });
  }
  async put(input: LocalTimelineDocument, options: { signal?: AbortSignal } = {}): Promise<StoredLocalTimeline> {
    const signal = options.signal; cancelled(signal);
    const document = parseLocalTimelineDocument(input), bytes = Buffer.from(canonical(document));
    const expected = receipt({ recipeDigest: document.recipeDigest, sha256: hash(bytes), byteLength: bytes.length });
    const unique = new Map([...document.clips, ...document.audio].map(item => [item.source.id, item.source]));
    for (const source of unique.values()) {
      cancelled(signal);
      const verified = await this.media.verifiedSource(source, signal ? { signal } : {}); cancelled(signal);
      invalid(canonical(verified.source) === canonical(source), "Source verification returned a different descriptor");
    }
    cancelled(signal);
    const directory = await mkdtemp(join(this.rootDir, "tmp", "timeline-"));
    let stored: StoredLocalTimeline;
    try {
      const temporary = join(directory, "document.json"), handle = await open(temporary, "wx", 0o444);
      try { cancelled(signal); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      cancelled(signal);
      try { await link(temporary, this.path(expected)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      stored = await this.read(expected, signal ? { signal } : {});
      const parent = await open(join(this.rootDir, "documents"), "r"); try { await parent.sync(); } finally { await parent.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
    // Late cancellation can leave reusable immutable bytes, never a successful result.
    // Do not unlink a shared deduplicated document during cancellation or cleanup.
    cancelled(signal); return stored;
  }
  async read(input: LocalTimelineReceipt, options: { signal?: AbortSignal } = {}): Promise<StoredLocalTimeline> {
    const signal = options.signal; cancelled(signal); const expected = receipt(input), path = this.path(expected);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes: Buffer;
    try {
      const metadata = await handle.stat();
      invalid(metadata.isFile() && metadata.size === expected.byteLength && metadata.size <= MAX_BYTES, "Timeline entry is not the expected bounded regular file");
      bytes = Buffer.alloc(expected.byteLength + 1); let count = 0;
      while (count < bytes.length) {
        cancelled(signal); const result = await handle.read(bytes, count, bytes.length - count, null);
        if (!result.bytesRead) break; count += result.bytesRead;
      }
      invalid(count === expected.byteLength, "Timeline bytes changed during verification"); bytes = bytes.subarray(0, count);
    } finally { await handle.close(); }
    cancelled(signal);
    invalid(hash(bytes) === expected.sha256, "Timeline file hash differs from its receipt");
    let value: unknown; try { value = JSON.parse(bytes.toString("utf8")); } catch { invalid(false, "Timeline file is not JSON"); }
    const document = parseLocalTimelineDocument(value);
    invalid(document.recipeDigest === expected.recipeDigest && Buffer.from(canonical(document)).equals(bytes), "Timeline file is not the exact canonical recipe");
    cancelled(signal); return freeze({ document, receipt: expected, path });
  }
  private path(value: LocalTimelineReceipt): string { return join(this.rootDir, "documents", `${value.sha256}.json`); }
}
