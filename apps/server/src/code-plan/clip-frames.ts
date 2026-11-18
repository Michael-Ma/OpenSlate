import { createHash } from "node:crypto";
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { copyFile, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { DomainError, invariant } from "@openslate/core";
import type { Store } from "../persistence/store.js";
import type { ArtifactRecord } from "../execution/engine.js";
import type { CodePlanStep } from "./records.js";
import { runMediaProcess } from "../media/process.js";
import { imageFormat, imageInputArgs } from "../media/image-input.js";
import { rowFrames } from "../media/local-timeline.js";
import { codePlanRenderSources, object } from "./artifacts.js";
import { renderSource, renderTimelineFrames } from "./cut-findings.js";
import { codePlanArtifacts } from "./artifacts.js";

export interface ClipFramesInput { artifactId: string; startFrame?: number; endFrame?: number; everyFrames?: number; cuts?: boolean; fromCut?: number }
export interface VideoFramesMetadata {
  artifactId: string; stepKey: string; fps: 30; durationFrames: number; width: number; height: number;
  cuts?: { cut: number; frame: number; beforeShotId?: string; afterShotId?: string }[];
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

/** Resolve boundaries from the render's frozen recipe, rather than a later plan's timeline. */
export function renderCutPairs(store: Store, projectId: string, artifactId: string, fromCut = 1) {
  invariant(Number.isSafeInteger(fromCut) && fromCut >= 1 && fromCut <= 63, "CODE_PLAN_FRAME_RANGE", "fromCut must be a cut number from 1 to 63");
  const steps = store.list<CodePlanStep>("code_plan_step", projectId);
  const step = steps.find(step => step.kind === "render" && step.result?.ok && step.result.artifacts.some(ref => ref.artifactId === artifactId));
  invariant(step, "CODE_PLAN_ARTIFACT_INVALID", "cuts: true reads a render");
  const sources = codePlanRenderSources(store, projectId);
  const timeline = (Array.isArray(step.input.timeline) ? step.input.timeline : []).map(object);
  const intent = step.attemptId ? store.get<{ recipe: { frameRate: { numerator: number }; clips: { durationFrames: number; speed?: 1; holdFrames?: number }[] } }>("code_plan_render_intent", step.attemptId) : undefined;
  let cursor = 0;
  const cuts = timeline.slice(0, -1).map((row, index) => {
    const frozen = intent?.recipe.clips[index];
    const frames = frozen ? rowFrames(frozen) : renderTimelineFrames({ timeline: [row] }, sources);
    invariant(frames !== undefined, "CODE_PLAN_FRAME_RANGE", "The render has no measured cut boundaries");
    cursor += frames;
    const fps = intent?.recipe.frameRate.numerator ?? 30;
    const frame = Math.round(Math.round(cursor * fps / 30) * 30 / fps);
    const before = renderSource(row, sources)?.shotId, after = renderSource(timeline[index + 1]!, sources)?.shotId;
    return { cut: index + 1, frame, ...(before ? { beforeShotId: before } : {}), ...(after ? { afterShotId: after } : {}) };
  });
  // Native-rate rows shorter than one output frame can disappear at rounding boundaries.
  const totalTicks = intent ? intent.recipe.clips.reduce((sum, row) => sum + rowFrames(row), 0) : renderTimelineFrames(step.input, sources);
  const fps = intent?.recipe.frameRate.numerator ?? 30;
  const end = totalTicks === undefined ? Infinity : Math.round(Math.round(totalTicks * fps / 30) * 30 / fps);
  const visible: typeof cuts = [];
  for (let index = 0; index < cuts.length;) {
    const first = cuts[index]!;
    let last = index;
    while (cuts[last + 1]?.frame === first.frame) last++;
    const final = cuts[last]!;
    // A row rounded to no output pictures contributes no side of a cut.
    if (first.frame > 0 && first.frame < end) visible.push({ cut: final.cut, frame: final.frame,
      ...(first.beforeShotId ? { beforeShotId: first.beforeShotId } : {}),
      ...(final.afterShotId ? { afterShotId: final.afterShotId } : {}) });
    index = last + 1;
  }
  invariant(!visible.length && fromCut === 1 || visible.some(cut => cut.cut >= fromCut), "CODE_PLAN_FRAME_RANGE", "fromCut is past the render's last cut");
  return visible.filter(cut => cut.cut >= fromCut).slice(0, 18);
}

/** Only transient files and bytes: no artifact, entity, media step or paid operation is created. */
export async function readClipFrames(store: Store, projectId: string, input: ClipFramesInput,
  options: { signal?: AbortSignal; ffmpegPath?: string; ffprobePath?: string } = {}) {
  invariant(!input.cuts || input.startFrame === undefined && input.endFrame === undefined && input.everyFrames === undefined,
    "CODE_PLAN_FRAME_RANGE", "cuts: true cannot be combined with startFrame, endFrame or everyFrames");
  invariant(input.fromCut === undefined || input.cuts === true, "CODE_PLAN_FRAME_RANGE", "fromCut needs cuts: true");
  const cuts = input.cuts ? renderCutPairs(store, projectId, input.artifactId, input.fromCut) : undefined;
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
    const run = (file: string, args: string[]) => runMediaProcess(file, args, { cwd: directory, signal, timeoutMs: 24_000, maxOutputBytes: 64 * 1024 });
    if (picture) {
      signal.throwIfAborted();
      const ffmpeg = options.ffmpegPath ?? mediaTool("ffmpeg"), target = join(directory, "picture.png");
      let image: Awaited<ReturnType<typeof loadImage>>;
      try {
        const inputArgs = imageInputArgs(imageFormat(await readFile(source)));
        const scale = "scale=w='max(1,floor(iw*min(1,1536/max(iw,ih))))':h='max(1,floor(ih*min(1,1536/max(iw,ih))))'";
        // Canvas can mistake content credentials in a generated PNG for SVG. Decode only a fresh, plain PNG.
        await run(ffmpeg, ["-nostdin", "-v", "error", "-xerror", "-threads", "1", "-filter_threads", "1", ...inputArgs, "-i", source,
          "-map", "0:v:0", "-map_metadata", "-1", "-frames:v", "1", "-vf", scale, "-threads", "1", "-c:v", "png", "-f", "image2", target]);
        image = await loadImage(await readFile(target));
      } catch (error) {
        if (error instanceof DomainError && !["IMAGE_FORMAT_UNSUPPORTED", "MEDIA_TOOL_FAILED"].includes(error.code)) throw error;
        throw new DomainError("CODE_PLAN_ARTIFACT_INVALID", "The picture could not be read");
      }
      const width = record.width ?? image.width, height = record.height ?? image.height;
      const sheet = createCanvas(image.width, image.height);
      sheet.getContext("2d").drawImage(image, 0, 0, sheet.width, sheet.height);
      let jpeg = await sheet.encode("jpeg", 85);
      for (const quality of [65, 45, 25]) { if (jpeg.byteLength <= MAX_BYTES) break; jpeg = await sheet.encode("jpeg", quality); }
      invariant(jpeg.byteLength <= MAX_BYTES, "CODE_PLAN_SHEET_LIMIT", "The picture exceeds the 1.5 MiB review bound");
      signal.throwIfAborted();
      const metadata: PictureFramesMetadata = { artifactId: record.id, kind: "image", width, height,
        sheet: { sha256: createHash("sha256").update(jpeg).digest("hex"), byteLength: jpeg.byteLength } };
      return { metadata, content: [{ type: "text" as const, text: JSON.stringify(metadata) }, { type: "image" as const, mimeType: "image/jpeg" as const, data: jpeg.toString("base64") }] };
    }
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
    const frames = cuts ? cuts.flatMap(cut => [cut.frame - 1, cut.frame]) : Array.from({ length: Math.floor((end - start) / every) + 1 }, (_, index) => start + index * every);
    invariant(frames.every(frame => frame >= 0 && frame < durationFrames), "CODE_PLAN_FRAME_RANGE", "Cut boundaries exceed the rendered picture");
    const count = frames.length;
    invariant(count <= 36, "CODE_PLAN_FRAME_LIMIT", `At most 36 cells. Use everyFrames >= ${Math.ceil((end - start + 1) / 36)} or narrow the range (everyFrames is at most 90).`);
    const selected = [...new Set(frames)];
    const columns = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(count * width / height)))), rows = Math.max(1, Math.ceil(count / columns));
    const cellWidth = Math.min(320, Math.floor(2048 / columns));
    const pictureHeight = Math.max(1, Math.min(Math.floor(cellWidth * height / width), Math.floor(2048 / rows) - 28)), cellHeight = pictureHeight + 28;
    if (count) await run(options.ffmpegPath ?? mediaTool("ffmpeg"), ["-nostdin", "-v", "error", "-xerror", "-threads", "1", ...inputOptions,
      "-noautorotate", "-i", source, "-an", "-vf",
      `fps=30:round=near:start_time=0,select='${selected.map(frame => `eq(n,${frame})`).join("+")}',scale=${cellWidth}:${pictureHeight}:force_original_aspect_ratio=decrease:flags=bilinear,pad=${cellWidth}:${pictureHeight}:(ow-iw)/2:(oh-ih)/2:color=black`,
      "-fps_mode", "vfr", "-frames:v", String(selected.length), "-threads", "1", join(directory, "%02d.png")]);
    const sheet = createCanvas(columns * cellWidth, rows * cellHeight), context = sheet.getContext("2d");
    context.fillStyle = "#111111"; context.fillRect(0, 0, sheet.width, sheet.height);
    context.font = "16px sans-serif";
    const sample = createCanvas(32, 32), pixels = sample.getContext("2d"), motion: number[] = [];
    let previous: Uint8ClampedArray | undefined;
    for (let index = 0; index < count; index++) {
      signal.throwIfAborted();
      const image = await loadImage(await readFile(join(directory, `${String(selected.indexOf(frames[index]!) + 1).padStart(2, "0")}.png`)));
      const x = index % columns * cellWidth, y = Math.floor(index / columns) * cellHeight;
      context.drawImage(image, x, y, cellWidth, pictureHeight);
      context.fillStyle = "white"; context.fillText(`${cuts ? `cut ${cuts[Math.floor(index / 2)]!.cut} ${index % 2 ? "after" : "before"} · f${frames[index]}` : `f${frames[index]} · ${(frames[index]! / 30).toFixed(1)}s`}`, x + 5, y + pictureHeight + 20);
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
      fps: 30, durationFrames, width, height, frames, motion, ...(cuts ? { cuts } : {}),
      sheet: { columns, rows, sha256: createHash("sha256").update(jpeg).digest("hex"), byteLength: jpeg.byteLength } };
    return { metadata, content: [{ type: "text" as const, text: JSON.stringify(metadata) }, { type: "image" as const, mimeType: "image/jpeg" as const, data: jpeg.toString("base64") }] };
  } finally { await rm(directory, { recursive: true, force: true }); }
}
