import { createHash } from "node:crypto";
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { copyFile, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { invariant } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import type { ArtifactRecord } from "../execution/engine.js";
import type { CodePlanStep } from "./records.js";
import { runMediaProcess } from "../media/process.js";
import { codePlanArtifacts } from "./artifacts.js";

export interface ClipFramesInput { artifactId: string; startFrame?: number; endFrame?: number; everyFrames?: number }
export interface VideoFramesMetadata {
  artifactId: string; stepKey: string; fps: 30; durationFrames: number; width: number; height: number;
  frames: number[]; motion: number[]; sheet: { columns: number; rows: number; sha256: string; byteLength: number };
}
export interface PictureFramesMetadata {
  artifactId: string; kind: "image"; width: number; height: number; sheet: { sha256: string; byteLength: number };
}
export type ClipFramesMetadata = VideoFramesMetadata | PictureFramesMetadata;
const MAX_BYTES = 1536 * 1024;
const inputOptions = ["-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm,avi"];
function ownedPictureOrVideo(store: Store, projectId: string, artifactId: string): ArtifactRecord {
  const record = typeof artifactId === "string" && store.get<ArtifactRecord>("artifact", artifactId);
  invariant(record && record.projectId === projectId && ["video", "image"].includes(record.artifact.kind) && record.id === artifactId,
    "CODE_PLAN_ARTIFACT_INVALID", "Choose a video or picture owned by this film");
  return record;
}
export function clipDescription(store: Store, projectId: string, artifactId: string) {
  const record = ownedPictureOrVideo(store, projectId, artifactId);
  invariant(record.artifact.kind === "video", "CODE_PLAN_ARTIFACT_INVALID", "Choose a video owned by this film");
  const step = store.list<CodePlanStep>("code_plan_step", projectId).find(step => step.result?.ok && step.result.artifacts.some(ref => ref.artifactId === artifactId));
  const media = codePlanArtifacts(store, projectId), poster = media.posters.get(record.id);
  return { artifactId, stepKey: step?.key ?? "", shot: step?.shotId ?? "", prompt: String(step?.input.motion ?? step?.input.prompt ?? ""),
    durationFrames: Math.max(1, Math.round((record.physicalDurationSeconds ?? 0) * 30)),
    width: record.width ?? poster?.width ?? (record.fixture ? 160 : 0), height: record.height ?? poster?.height ?? (record.fixture ? 90 : 0) };
}
function mediaTool(name: "ffmpeg" | "ffprobe"): string {
  const override = name === "ffmpeg" ? process.env.OPENSLATE_FFMPEG : process.env.OPENSLATE_FFPROBE;
  const candidates = override ? [resolve(override)] : [...(process.env.PATH ?? "").split(":").filter(Boolean).map(path => resolve(path, name)), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`];
  const path = candidates.find(path => existsSync(path));
  invariant(path, "MEDIA_TOOL_UNAVAILABLE", "Configure local FFmpeg and ffprobe to watch clips");
  return realpathSync(path);
}

/** Only transient files and bytes: no artifact, entity, media step or paid operation is created. */
export async function readClipFrames(store: Store, projectId: string, input: ClipFramesInput,
  options: { signal?: AbortSignal; ffmpegPath?: string; ffprobePath?: string } = {}) {
  const record = ownedPictureOrVideo(store, projectId, input.artifactId);
  const picture = record.artifact.kind === "image", maxInputBytes = (picture ? 32 : 256) * 1024 * 1024;
  const signal = AbortSignal.any([AbortSignal.timeout(25_000), ...(options.signal ? [options.signal] : [])]);
  const directory = await mkdtemp(join(tmpdir(), "openslate-clip-frames-"));
  try {
    invariant(isAbsolute(record.path), "CODE_PLAN_ARTIFACT_INVALID", "Picture or video storage must be local");
    const stat = await lstat(record.path);
    invariant(stat.isFile() && stat.size > 0 && stat.size <= maxInputBytes, "CODE_PLAN_ARTIFACT_INVALID", "Picture or video storage exceeds the review input bound");
    const source = join(directory, "clip");
    await copyFile(record.path, source);
    invariant((await lstat(source)).size <= maxInputBytes, "CODE_PLAN_ARTIFACT_INVALID", "Review input grew beyond its byte bound");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(source, { signal })) hash.update(chunk);
    invariant(hash.digest("hex") === record.artifact.sha256, "ARTIFACT_CORRUPT", "Picture or video bytes differ from the owned artifact");
    if (picture) {
      signal.throwIfAborted();
      const image = await loadImage(await readFile(source)), width = image.width, height = image.height;
      const ratio = Math.min(1, 1536 / Math.max(width, height));
      const sheet = createCanvas(Math.max(1, Math.floor(width * ratio)), Math.max(1, Math.floor(height * ratio)));
      sheet.getContext("2d").drawImage(image, 0, 0, sheet.width, sheet.height);
      let jpeg = await sheet.encode("jpeg", 85);
      for (const quality of [65, 45, 25]) { if (jpeg.byteLength <= MAX_BYTES) break; jpeg = await sheet.encode("jpeg", quality); }
      invariant(jpeg.byteLength <= MAX_BYTES, "CODE_PLAN_SHEET_LIMIT", "The picture exceeds the 1.5 MiB review bound");
      signal.throwIfAborted();
      const metadata: PictureFramesMetadata = { artifactId: record.id, kind: "image", width, height,
        sheet: { sha256: createHash("sha256").update(jpeg).digest("hex"), byteLength: jpeg.byteLength } };
      return { metadata, content: [{ type: "text" as const, text: JSON.stringify(metadata) }, { type: "image" as const, mimeType: "image/jpeg" as const, data: jpeg.toString("base64") }] };
    }
    const run = (file: string, args: string[]) => runMediaProcess(file, args, { cwd: directory, signal, timeoutMs: 24_000, maxOutputBytes: 64 * 1024 });
    const probe = JSON.parse(await run(options.ffprobePath ?? mediaTool("ffprobe"), ["-v", "error", ...inputOptions, "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", source])) as {
      streams?: { codec_type?: string; width?: number; height?: number; duration?: string }[]; format?: { duration?: string };
    };
    const video = probe.streams?.find(stream => stream.codec_type === "video");
    const durationFrames = Math.round(Number(video?.duration ?? probe.format?.duration) * 30), width = video?.width ?? 0, height = video?.height ?? 0;
    invariant(Number.isSafeInteger(durationFrames) && durationFrames > 0 && durationFrames <= 10800
      && width > 0 && height > 0 && width <= 8192 && height <= 8192, "CODE_PLAN_ARTIFACT_INVALID", "Video has no bounded measurable picture");
    const start = input.startFrame ?? 0, end = input.endFrame ?? durationFrames - 1, every = input.everyFrames ?? 15;
    invariant(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end >= start && end < durationFrames
      && Number.isSafeInteger(every) && every >= 1 && every <= 90, "CODE_PLAN_FRAME_RANGE", "Use an inclusive frame range inside the clip and everyFrames from 1 to 90");
    const count = Math.floor((end - start) / every) + 1;
    invariant(count <= 36, "CODE_PLAN_FRAME_LIMIT", `At most 36 cells. Use everyFrames >= ${Math.ceil((end - start + 1) / 36)} or narrow the range (everyFrames is at most 90).`);
    const frames = Array.from({ length: count }, (_, index) => start + index * every);
    const columns = Math.min(6, Math.ceil(Math.sqrt(count * width / height))), rows = Math.ceil(count / columns);
    const cellWidth = Math.min(320, Math.floor(2048 / columns));
    const pictureHeight = Math.max(1, Math.min(Math.floor(cellWidth * height / width), Math.floor(2048 / rows) - 28)), cellHeight = pictureHeight + 28;
    await run(options.ffmpegPath ?? mediaTool("ffmpeg"), ["-nostdin", "-v", "error", "-xerror", "-threads", "1", ...inputOptions,
      "-ss", (start / 30).toFixed(8), "-noautorotate", "-i", source, "-an", "-vf",
      `fps=30,select='not(mod(n,${every}))',scale=${cellWidth}:${pictureHeight}:force_original_aspect_ratio=decrease:flags=bilinear,pad=${cellWidth}:${pictureHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "-fps_mode", "vfr", "-frames:v", String(count), "-threads", "1", join(directory, "%02d.png")]);
    const sheet = createCanvas(columns * cellWidth, rows * cellHeight), context = sheet.getContext("2d");
    context.fillStyle = "#111111"; context.fillRect(0, 0, sheet.width, sheet.height);
    context.font = "16px sans-serif";
    const sample = createCanvas(32, 32), pixels = sample.getContext("2d"), motion: number[] = [];
    let previous: Uint8ClampedArray | undefined;
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted();
      const image = await loadImage(await readFile(join(directory, `${String(index + 1).padStart(2, "0")}.png`)));
      const x = index % columns * cellWidth, y = Math.floor(index / columns) * cellHeight;
      context.drawImage(image, x, y, cellWidth, pictureHeight);
      context.fillStyle = "white"; context.fillText(`f${frames[index]} · ${(frames[index]! / 30).toFixed(1)}s`, x + 5, y + pictureHeight + 20);
      pixels.drawImage(image, 0, 0, 32, 32);
      const current = pixels.getImageData(0, 0, 32, 32).data;
      let difference = 0;
      if (previous) for (let at = 0; at < current.length; at++) if (at % 4 !== 3) difference += Math.abs(current[at]! - previous[at]!);
      motion.push(Number((difference / (32 * 32 * 3 * 255)).toFixed(4))); previous = current;
    }
    let jpeg = await sheet.encode("jpeg", 85);
    for (const quality of [65, 45, 25]) { if (jpeg.byteLength <= MAX_BYTES) break; jpeg = await sheet.encode("jpeg", quality); }
    invariant(jpeg.byteLength <= MAX_BYTES, "CODE_PLAN_SHEET_LIMIT", "The contact sheet exceeds 1.5 MiB; request fewer frames");
    signal.throwIfAborted();
    const metadata: ClipFramesMetadata = { artifactId: record.id, stepKey: clipDescription(store, projectId, record.id).stepKey,
      fps: 30, durationFrames, width, height, frames, motion,
      sheet: { columns, rows, sha256: createHash("sha256").update(jpeg).digest("hex"), byteLength: jpeg.byteLength } };
    return { metadata, content: [{ type: "text" as const, text: JSON.stringify(metadata) }, { type: "image" as const, mimeType: "image/jpeg" as const, data: jpeg.toString("base64") }] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
