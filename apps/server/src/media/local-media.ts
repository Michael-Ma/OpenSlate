import { constants, mkdirSync, realpathSync } from "node:fs";
import { chmod, link, lstat, mkdtemp, open, readFile, realpath, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, sep } from "node:path";
import { canonical, digest, DomainError, invariant } from "@openslate/core";
import { runMediaProcess } from "./process.js";
import type { FrozenRenderManifest, LocalMediaOptions, MediaLimits, MediaNormalizationIdentity, MediaProbe, RenderCompletion, RenderManifestInput, RenderOptions, RenderResult, SuppliedMedia } from "./types.js";

const DEFAULTS: MediaLimits = { maxInputBytes: 128 * 1024 * 1024, maxOutputBytes: 256 * 1024 * 1024, maxDurationFrames: 10800, maxClips: 64, maxAudioTracks: 8, maxAudioPlacements: 64, timeoutMs: 120000 };
// No playlists, concat demuxer, devices or network protocols. MOV external data
// references remain disabled by the demuxer's default; files are copied first.
const INPUT_OPTIONS = ["-protocol_whitelist", "file", "-format_whitelist", "mov,matroska,webm,avi,wav,mp3,flac,ogg"];
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const FPS = 30, SAMPLE_RATE = 48000, SAMPLES_PER_FRAME = 1600;

/** Partition by sample intervals so late cues never allocate long delay buffers. */
function audioLanes(audio: FrozenRenderManifest["audio"]): number[][] {
  const lanes: number[][] = [], ends: number[] = [];
  for (const index of audio.map((_, i) => i).sort((a, b) => audio[a]!.atSample - audio[b]!.atSample || a - b)) {
    const placement = audio[index]!;
    let lane = ends.findIndex(end => end <= placement.atSample);
    if (lane < 0) { lane = lanes.length; lanes.push([]); }
    lanes[lane]!.push(index); ends[lane] = placement.atSample + placement.durationSamples;
  }
  return lanes;
}

function integer(value: number, min: number, max: number, name: string): void {
  invariant(Number.isSafeInteger(value) && value >= min && value <= max, "MEDIA_INVALID_INPUT", `Invalid ${name}`);
}
function aborted(signal?: AbortSignal): void { if (signal?.aborted) throw new DomainError("MEDIA_CANCELLED", "Media operation cancelled"); }
function frozen<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}
function within(path: string, root: string): boolean { const sub = relative(root, path); return sub !== "" && sub !== ".." && !sub.startsWith(`..${sep}`) && !isAbsolute(sub); }

/** Local supplied-media slice: exact CFR cuts and sample-based audio placements. */
export class LocalMediaService {
  readonly rootDir: string;
  readonly limits: Readonly<MediaLimits>;
  private readonly roots: string[];
  private readonly ffmpeg: string;
  private readonly ffprobe: string;
  private toolchain: string | undefined;
  private readonly executableHashes = new Map<string, string>();
  private busy = false;

  constructor(options: LocalMediaOptions) {
    invariant(isAbsolute(options.rootDir) && options.rootDir !== "/", "MEDIA_INVALID_INPUT", "A private absolute media directory is required");
    for (const path of [options.ffmpegPath, options.ffprobePath]) invariant(isAbsolute(path), "MEDIA_INVALID_INPUT", "Media tools must be configured as absolute paths");
    invariant(options.allowedInputRoots.length > 0 && options.allowedInputRoots.length <= 16, "MEDIA_INVALID_INPUT", "Configure bounded input roots");
    this.roots = options.allowedInputRoots.map(path => {
      invariant(isAbsolute(path) && path !== "/", "MEDIA_INVALID_INPUT", "Input roots must be explicit local directories");
      return realpathSync(path);
    });
    mkdirSync(options.rootDir, { recursive: true, mode: 0o700 });
    this.rootDir = realpathSync(options.rootDir);
    for (const dir of ["tmp", "blobs", "sources", "manifests", "completions"]) mkdirSync(join(this.rootDir, dir), { recursive: true, mode: 0o700 });
    this.ffmpeg = options.ffmpegPath;
    this.ffprobe = options.ffprobePath;
    this.limits = Object.freeze({ ...DEFAULTS, ...options.limits });
    integer(this.limits.maxInputBytes, 1024, 1024 * 1024 * 1024, "input byte limit");
    integer(this.limits.maxOutputBytes, 1024, 1024 * 1024 * 1024, "output byte limit");
    integer(this.limits.maxDurationFrames, 1, 10800, "duration limit");
    integer(this.limits.maxClips, 1, 64, "clip limit");
    integer(this.limits.maxAudioTracks, 0, 8, "audio track limit");
    integer(this.limits.maxAudioPlacements, 0, 64, "audio placement limit");
    integer(this.limits.timeoutMs, 50, 600000, "tool time limit");
  }

  /** Version probes only; no source decoding/transcoding or application-state mutation. */
  async describeNormalization(options: { signal?: AbortSignal } = {}): Promise<MediaNormalizationIdentity> {
    const signal = options.signal;
    return this.exclusive(async () => {
      const toolchainDigest = await this.toolchainDigest(signal); aborted(signal);
      return frozen({ version: 1 as const, recipe: "silent-h264-30fps-v1" as const, toolchainDigest,
        maxInputBytes: this.limits.maxInputBytes, maxOutputBytes: this.limits.maxOutputBytes,
        maxDurationFrames: this.limits.maxDurationFrames, timeoutMs: this.limits.timeoutMs });
    });
  }

  /** Read-only inspection of a bounded snapshot, never a remote URL. */
  async probe(path: string, options: { signal?: AbortSignal } = {}): Promise<MediaProbe> {
    return this.exclusive(async () => this.temporary(async dir => {
      const input = join(dir, "input");
      await this.snapshot(path, input, options.signal);
      return this.inspect(input, options.signal);
    }));
  }

  async importMedia(input: { artifactId: string; path: string; kind: "video" | "audio" }, options: { signal?: AbortSignal } = {}): Promise<SuppliedMedia> {
    return this.exclusive(async () => this.temporary(async dir => {
      invariant(typeof input.artifactId === "string" && ID.test(input.artifactId) && (input.kind === "video" || input.kind === "audio"), "MEDIA_INVALID_INPUT", "Invalid supplied-media identity or kind");
      const sourcePath = join(dir, "input");
      await this.snapshot(input.path, sourcePath, options.signal);
      const inputProbe = await this.inspect(sourcePath, options.signal);
      invariant(inputProbe[input.kind], "MEDIA_STREAM_MISSING", `Supplied file has no ${input.kind} stream`);
      const toolchainDigest = await this.toolchainDigest(options.signal);
      const output = join(dir, input.kind === "video" ? "normalized.mp4" : "normalized.wav");
      const args = ["-nostdin", "-v", "error", "-xerror", "-threads", "1", ...INPUT_OPTIONS, "-i", sourcePath, "-map_metadata", "-1", "-map_chapters", "-1"];
      if (input.kind === "video") args.push("-map", `0:${inputProbe.video!.streamIndex}`, "-an", "-vf", "fps=30,setsar=1,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "18", "-metadata:s:v:0", "rotate=0", "-movflags", "+faststart");
      else args.push("-map", `0:${inputProbe.audio!.streamIndex}`, "-vn", "-af", "aresample=48000,aformat=sample_fmts=s16:channel_layouts=stereo", "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2");
      // The extra second detects an overlong source instead of silently accepting
      // the truncated prefix. Time and byte limits also bound bad metadata.
      args.push("-t", String(this.limits.maxDurationFrames / FPS + 1), "-fs", String(this.limits.maxOutputBytes), output);
      await this.run(this.ffmpeg, args, options.signal);
      const probe = await this.inspect(output, options.signal);
      if (input.kind === "video") invariant(probe.video?.frameRate === "30/1" && probe.video.frames > 0 && !probe.audio, "MEDIA_VALIDATION_FAILED", "Normalized video must be silent 30 fps media");
      else invariant(probe.audio?.sampleRate === SAMPLE_RATE && probe.audio.channels === 2 && probe.audio.samples !== null && !probe.video, "MEDIA_VALIDATION_FAILED", "Normalized audio must have measured 48 kHz stereo samples");
      const expectedDuration = inputProbe[input.kind]!.durationSeconds;
      const observedDuration = input.kind === "video" ? probe.video!.frames / FPS : probe.audio!.samples! / SAMPLE_RATE;
      // Decoder delay/padding can differ slightly from compressed audio metadata;
      // a size-limited prefix must never become an apparently complete import.
      invariant(Math.abs(expectedDuration - observedDuration) <= (input.kind === "video" ? 1 / FPS + 0.001 : 0.1), "MEDIA_VALIDATION_FAILED", "Normalization truncated or changed source duration");
      await this.decode(output, options.signal);
      aborted(options.signal);
      const original = await this.installFile(sourcePath, "source", this.limits.maxInputBytes);
      const normalized = await this.installFile(output, input.kind === "video" ? "mp4" : "wav", this.limits.maxOutputBytes);
      const body = { artifactId: input.artifactId, kind: input.kind, originalSha256: original.sha256, originalByteLength: original.byteLength, sha256: normalized.sha256, byteLength: normalized.byteLength, probe, toolchainDigest };
      const result: SuppliedMedia = { id: digest(body), ...body };
      await this.installJson("sources", result.id, result);
      return frozen(result);
    }));
  }

  async freezeManifest(input: RenderManifestInput): Promise<FrozenRenderManifest> {
    // Detach from the caller before the first asynchronous file read.
    const value = structuredClone(input);
    invariant(typeof value.projectId === "string" && typeof value.targetRevisionId === "string" && ID.test(value.projectId) && ID.test(value.targetRevisionId), "MEDIA_INVALID_INPUT", "Invalid project or target revision identity");
    integer(value.width, 2, 1920, "width"); integer(value.height, 2, 1920, "height");
    invariant(value.width % 2 === 0 && value.height % 2 === 0 && value.width * value.height <= 1920 * 1080, "MEDIA_INVALID_INPUT", "Output requires bounded even dimensions");
    invariant(Array.isArray(value.clips) && value.clips.length > 0 && value.clips.length <= this.limits.maxClips, "MEDIA_INVALID_INPUT", "Invalid clip count");
    invariant(Array.isArray(value.audio ?? []) && (value.audio?.length ?? 0) <= this.limits.maxAudioPlacements, "MEDIA_INVALID_INPUT", "Too many audio placements");
    let totalFrames = 0;
    const clips = [];
    const sourceIdentities = new Map<string, string>();
    const rememberSource = (source: SuppliedMedia) => {
      const previous = sourceIdentities.get(source.artifactId);
      invariant(previous === undefined || previous === source.id, "MEDIA_INTEGRITY_ERROR", "One artifact identity cannot name different source descriptors");
      sourceIdentities.set(source.artifactId, source.id);
    };
    for (const clip of value.clips) {
      const source = await this.readSource(clip.source);
      rememberSource(source);
      invariant(source.kind === "video" && source.probe.video, "MEDIA_INVALID_INPUT", "Clip requires normalized video");
      integer(clip.startFrame, 0, this.limits.maxDurationFrames, "source start frame");
      integer(clip.durationFrames, 1, this.limits.maxDurationFrames, "clip duration");
      invariant(clip.startFrame + clip.durationFrames <= source.probe.video.frames, "MEDIA_SOURCE_TOO_SHORT", "A clip cannot exceed measured source frames");
      invariant(clip.fit === "contain" || clip.fit === "cover", "MEDIA_INVALID_INPUT", "Choose explicit contain or cover fit");
      totalFrames += clip.durationFrames;
      clips.push({ source, startFrame: clip.startFrame, durationFrames: clip.durationFrames, fit: clip.fit });
    }
    integer(totalFrames, 1, this.limits.maxDurationFrames, "total frames");
    const totalSamples = totalFrames * SAMPLES_PER_FRAME;
    const audio = [];
    const audioStreams = new Set<string>();
    for (const placement of value.audio ?? []) {
      const source = await this.readSource(placement.source);
      invariant(source.kind === "audio" && source.probe.audio?.samples !== null && source.probe.audio?.samples !== undefined, "MEDIA_INVALID_INPUT", "Audio placement requires measured normalized audio");
      rememberSource(source); audioStreams.add(source.sha256);
      invariant(audioStreams.size <= this.limits.maxAudioTracks, "MEDIA_INVALID_INPUT", "Too many distinct audio source streams");
      integer(placement.startSample, 0, this.limits.maxDurationFrames * SAMPLES_PER_FRAME, "source start sample");
      integer(placement.durationSamples, 1, this.limits.maxDurationFrames * SAMPLES_PER_FRAME, "audio duration");
      integer(placement.atSample, 0, totalSamples, "audio placement");
      integer(placement.gainMilliDb ?? 0, -60000, 12000, "audio gain");
      invariant(placement.startSample + placement.durationSamples <= source.probe.audio.samples, "MEDIA_SOURCE_TOO_SHORT", "Audio range exceeds measured samples");
      invariant(placement.atSample + placement.durationSamples <= totalSamples, "MEDIA_AUDIO_OUTSIDE_TIMELINE", "Audio cannot be silently cut at the timeline boundary");
      audio.push({ source, startSample: placement.startSample, durationSamples: placement.durationSamples, atSample: placement.atSample, gainMilliDb: placement.gainMilliDb ?? 0 });
    }
    invariant(audioLanes(audio).length <= this.limits.maxAudioTracks, "MEDIA_INVALID_INPUT", "Too many simultaneous audio placements");
    const body = { version: 1 as const, projectId: value.projectId, targetRevisionId: value.targetRevisionId, width: value.width, height: value.height, frameRate: { numerator: 30 as const, denominator: 1 as const }, sampleRate: 48000 as const, totalFrames, clips, audio, toolchainDigest: await this.toolchainDigest() };
    const manifest: FrozenRenderManifest = { digest: digest(body), ...body };
    await this.installJson("manifests", manifest.digest, manifest);
    return frozen(manifest);
  }

  async render(input: FrozenRenderManifest, options: RenderOptions = {}): Promise<RenderResult> {
    return this.exclusive(async () => this.temporary(async dir => {
      // Read the immutable stored recipe; caller-supplied paths/filters cannot enter FFmpeg.
      const manifest = await this.readManifest(input);
      invariant(manifest.clips.length <= this.limits.maxClips && manifest.audio.length <= this.limits.maxAudioPlacements && manifest.totalFrames <= this.limits.maxDurationFrames,
        "MEDIA_INVALID_INPUT", "Frozen manifest exceeds the current local resource limits");
      aborted(options.signal);
      invariant(!options.isCurrent || options.isCurrent(manifest) === true, "MEDIA_STALE_TARGET", "Render target is already stale");
      invariant(manifest.toolchainDigest === await this.toolchainDigest(options.signal), "MEDIA_TOOLCHAIN_CHANGED", "Frozen render toolchain changed");
      const args = ["-nostdin", "-v", "error", "-xerror", "-filter_complex_threads", "1"];
      for (const clip of manifest.clips) { await this.verifySource(clip.source); args.push("-threads", "1", ...INPUT_OPTIONS, "-i", this.blobPath(clip.source)); }
      const audioSources = new Map<string, { source: SuppliedMedia; indices: number[] }>();
      for (const [index, placement] of manifest.audio.entries()) {
        await this.readSource(placement.source);
        const group = audioSources.get(placement.source.sha256) ?? { source: placement.source, indices: [] };
        group.indices.push(index); audioSources.set(placement.source.sha256, group);
      }
      invariant(audioSources.size <= this.limits.maxAudioTracks, "MEDIA_INVALID_INPUT", "Frozen manifest exceeds the current audio source limit");
      for (const group of audioSources.values()) { await this.verifySource(group.source); args.push("-threads", "1", ...INPUT_OPTIONS, "-i", this.blobPath(group.source)); }
      const filters: string[] = [];
      manifest.clips.forEach((clip, index) => {
        const size = `${manifest.width}:${manifest.height}`;
        const fit = clip.fit === "contain" ? `scale=${size}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${size}:(ow-iw)/2:(oh-ih)/2:color=black` : `scale=${size}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${size}`;
        filters.push(`[${index}:v:0]trim=start_frame=${clip.startFrame}:end_frame=${clip.startFrame + clip.durationFrames},setpts=PTS-STARTPTS,${fit},setsar=1,format=yuv420p[v${index}]`);
      });
      filters.push(`${manifest.clips.map((_, i) => `[v${i}]`).join("")}concat=n=${manifest.clips.length}:v=1:a=0[outv]`);
      if (manifest.audio.length) {
        const lanes = audioLanes(manifest.audio);
        invariant(lanes.length <= this.limits.maxAudioTracks, "MEDIA_INVALID_INPUT", "Frozen manifest exceeds the simultaneous audio limit");
        let sourceIndex = manifest.clips.length;
        for (const group of audioSources.values()) {
          filters.push(`[${sourceIndex++}:a:0]asplit=${group.indices.length}${group.indices.map(index => `[sourcea${index}]`).join("")}`);
        }
        manifest.audio.forEach((placement, index) => {
          filters.push(`[sourcea${index}]atrim=start_sample=${placement.startSample}:end_sample=${placement.startSample + placement.durationSamples},asetpts=PTS-STARTPTS,volume=${placement.gainMilliDb / 1000}dB[a${index}]`);
        });
        lanes.forEach((indices, lane) => {
          const parts: string[] = []; let cursor = 0, silenceIndex = 0;
          const silence = (samples: number) => {
            if (!samples) return;
            const label = `silence${lane}_${silenceIndex++}`;
            filters.push(`anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end_sample=${samples},asetpts=PTS-STARTPTS[${label}]`);
            parts.push(`[${label}]`);
          };
          for (const index of indices) {
            const placement = manifest.audio[index]!; silence(placement.atSample - cursor); parts.push(`[a${index}]`);
            cursor = placement.atSample + placement.durationSamples;
          }
          silence(manifest.totalFrames * SAMPLES_PER_FRAME - cursor);
          filters.push(`${parts.join("")}concat=n=${parts.length}:v=0:a=1[lane${lane}]`);
        });
        filters.push(`${lanes.map((_, i) => `[lane${i}]`).join("")}amix=inputs=${lanes.length}:duration=longest:dropout_transition=0:normalize=0,apad=whole_len=${manifest.totalFrames * SAMPLES_PER_FRAME},atrim=end_sample=${manifest.totalFrames * SAMPLES_PER_FRAME},aresample=48000[outa]`);
      }
      const output = join(dir, "render.mp4");
      args.push("-filter_complex", filters.join(";"), "-map", "[outv]");
      if (manifest.audio.length) args.push("-map", "[outa]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2");
      else args.push("-an");
      args.push("-map_metadata", "-1", "-map_chapters", "-1", "-c:v", "libx264", "-threads", "1", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-fps_mode", "cfr", "-frames:v", String(manifest.totalFrames), "-movflags", "+faststart", "-fs", String(this.limits.maxOutputBytes), output);
      await this.run(this.ffmpeg, args, options.signal);
      const probe = await this.inspect(output, options.signal);
      invariant(probe.video?.frames === manifest.totalFrames && probe.video.width === manifest.width && probe.video.height === manifest.height && probe.video.frameRate === "30/1" && probe.video.codec === "h264", "MEDIA_VALIDATION_FAILED", "Rendered picture does not match frozen frame count or geometry");
      if (manifest.audio.length) {
        invariant(probe.audio?.sampleRate === SAMPLE_RATE && probe.audio.channels === 2 && probe.audio.codec === "aac" && probe.audio.samples !== null && Math.abs(probe.audio.samples - manifest.totalFrames * SAMPLES_PER_FRAME) <= 2048, "MEDIA_VALIDATION_FAILED", "Rendered audio does not match the timeline within AAC padding tolerance");
      } else invariant(!probe.audio, "MEDIA_VALIDATION_FAILED", "Unexpected output audio");
      await this.decode(output, options.signal);
      aborted(options.signal);
      const installed = await this.installFile(output, "mp4", this.limits.maxOutputBytes);
      const completion: RenderCompletion = { manifest, artifact: { id: installed.sha256, manifestDigest: manifest.digest, ...installed, probe } };
      // A filesystem receipt precedes application publication. Callback failure or
      // process loss may leave history/orphans, never a half-written final file.
      await this.installJson("completions", `${manifest.digest}-${installed.sha256}`, completion);
      aborted(options.signal);
      let status: RenderResult["status"] = "completed";
      if (options.publish) {
        const published = options.publish(frozen(completion));
        invariant(typeof published === "boolean", "MEDIA_INVALID_CALLBACK", "Publication must synchronously compare and select the target");
        status = published ? "published" : "historical";
      }
      return frozen({ ...completion, status });
    }));
  }

  /** Recover an already installed completion; selection still needs the guarded host port. */
  async readCompletion(manifestDigest: string, sha256: string): Promise<RenderCompletion> {
    invariant(HASH.test(manifestDigest) && HASH.test(sha256), "MEDIA_INVALID_INPUT", "Invalid completion identity");
    const result = JSON.parse(await readFile(join(this.rootDir, "completions", `${manifestDigest}-${sha256}.json`), "utf8")) as RenderCompletion;
    await this.readManifest(result.manifest);
    invariant(result.manifest.digest === manifestDigest && result.artifact.id === sha256 && result.artifact.manifestDigest === manifestDigest && result.artifact.sha256 === sha256 && result.artifact.path === join(this.rootDir, "blobs", `${sha256}.mp4`), "MEDIA_INTEGRITY_ERROR", "Completion identity mismatch");
    const verified = await this.hashFile(result.artifact.path, this.limits.maxOutputBytes);
    invariant(verified.sha256 === sha256 && verified.byteLength === result.artifact.byteLength, "MEDIA_INTEGRITY_ERROR", "Completion artifact changed");
    return frozen(result);
  }

  /** Trusted host access only: verify a service-issued descriptor before copying bytes. */
  async verifiedSource(source: SuppliedMedia): Promise<{ source: SuppliedMedia; path: string }> {
    const value = structuredClone(source);
    await this.verifySource(value);
    return { source: frozen(value), path: this.blobPath(value) };
  }

  /** Discover installed receipts after a process exit before its SQL completion commit. */
  async findCompletions(manifestDigest: string): Promise<RenderCompletion[]> {
    invariant(HASH.test(manifestDigest), "MEDIA_INVALID_INPUT", "Invalid manifest identity");
    const { opendir } = await import("node:fs/promises");
    const names: string[] = [];
    for await (const entry of await opendir(join(this.rootDir, "completions"))) {
      if (entry.isFile() && entry.name.startsWith(`${manifestDigest}-`) && /^[a-f0-9]{64}-[a-f0-9]{64}\.json$/.test(entry.name)) {
        names.push(entry.name);
        invariant(names.length <= 8, "MEDIA_RECEIPT_LIMIT", "Too many outputs for one frozen manifest");
      }
    }
    const results: RenderCompletion[] = [];
    for (const name of names.sort()) results.push(await this.readCompletion(manifestDigest, name.slice(65, 129)));
    return results;
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    invariant(!this.busy, "MEDIA_BUSY", "This local media worker is already running an operation");
    this.busy = true;
    try { return await fn(); } finally { this.busy = false; }
  }
  private async temporary<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(this.rootDir, "tmp", "job-"));
    try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
  }
  private async run(executable: string, args: string[], signal?: AbortSignal): Promise<string> {
    aborted(signal);
    let binary: { sha256: string; byteLength: number };
    try { binary = await this.hashFile(await realpath(executable), 256 * 1024 * 1024); }
    catch (error) {
      if (["ENOENT", "EACCES", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new DomainError("MEDIA_TOOL_UNAVAILABLE", "Unable to read configured media executable");
      throw error;
    }
    const previous = this.executableHashes.get(executable);
    invariant(!previous || previous === binary.sha256, "MEDIA_TOOLCHAIN_CHANGED", "Configured media executable changed during this worker lifetime");
    this.executableHashes.set(executable, binary.sha256);
    return runMediaProcess(executable, args, { cwd: this.rootDir, timeoutMs: this.limits.timeoutMs, ...(signal ? { signal } : {}) });
  }
  private async toolchainDigest(signal?: AbortSignal): Promise<string> {
    if (!this.toolchain) {
      const ffmpeg = await this.run(this.ffmpeg, ["-version"], signal);
      const ffprobe = await this.run(this.ffprobe, ["-version"], signal);
      this.toolchain = digest({ recipe: "openslate-supplied-media-v1", ffmpeg, ffprobe, ffmpegSha256: this.executableHashes.get(this.ffmpeg), ffprobeSha256: this.executableHashes.get(this.ffprobe) });
    }
    return this.toolchain;
  }
  private async snapshot(path: string, destination: string, signal?: AbortSignal): Promise<void> {
    invariant(typeof path === "string" && isAbsolute(path) && !path.includes("\0"), "MEDIA_PATH_REJECTED", "Only explicitly allowed local file paths are accepted");
    invariant(!(await lstat(path)).isSymbolicLink(), "MEDIA_PATH_REJECTED", "Input symlinks are not accepted");
    const resolved = await realpath(path);
    invariant(this.roots.some(root => within(resolved, root)), "MEDIA_PATH_REJECTED", "Input is outside configured local roots");
    const source = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
    let target;
    try {
      const metadata = await source.stat();
      invariant(metadata.isFile() && metadata.size > 0 && metadata.size <= this.limits.maxInputBytes, "MEDIA_INPUT_LIMIT", "Input must be a bounded regular file");
      target = await open(destination, "wx", 0o600);
      const buffer = Buffer.alloc(65536);
      let total = 0;
      while (true) {
        aborted(signal);
        const { bytesRead } = await source.read(buffer, 0, buffer.length, null);
        if (!bytesRead) break;
        total += bytesRead;
        invariant(total <= this.limits.maxInputBytes, "MEDIA_INPUT_LIMIT", "Input grew beyond its byte limit");
        let offset = 0;
        while (offset < bytesRead) { const result = await target.write(buffer, offset, bytesRead - offset); invariant(result.bytesWritten > 0, "MEDIA_WRITE_FAILED", "Unable to write source snapshot"); offset += result.bytesWritten; }
      }
      invariant(total === metadata.size, "MEDIA_INPUT_CHANGED", "Input size changed while copying");
      await target.sync();
    } finally { await target?.close(); await source.close(); }
  }
  private async inspect(path: string, signal?: AbortSignal): Promise<MediaProbe> {
    // Validate cheap container metadata before asking ffprobe to decode every
    // frame. This is a bounded worker, not a hostile-code or OS memory sandbox.
    const headerText = await this.run(this.ffprobe, ["-v", "error", ...INPUT_OPTIONS, "-show_streams", "-show_format", "-of", "json", path], signal);
    const header = JSON.parse(headerText) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
    invariant(Array.isArray(header.streams) && header.streams.length > 0 && header.streams.length <= 16, "MEDIA_VALIDATION_FAILED", "Invalid media stream count");
    const headerDuration = Number(header.format?.duration);
    invariant(Number.isFinite(headerDuration) && headerDuration > 0 && headerDuration <= this.limits.maxDurationFrames / FPS + 0.001, "MEDIA_DURATION_LIMIT", "Media duration exceeds the configured limit or is unknown");
    for (const stream of header.streams) if (stream.codec_type === "video") { integer(Number(stream.width), 1, 4096, "source width"); integer(Number(stream.height), 1, 4096, "source height"); }
    const text = await this.run(this.ffprobe, ["-v", "error", ...INPUT_OPTIONS, "-count_frames", "-show_streams", "-show_format", "-of", "json", path], signal);
    const data = JSON.parse(text) as { streams?: Record<string, unknown>[]; format?: Record<string, unknown> };
    invariant(Array.isArray(data.streams) && data.streams.length > 0 && data.streams.length <= 16, "MEDIA_VALIDATION_FAILED", "Invalid media streams");
    const durationSeconds = Number(data.format?.duration);
    invariant(Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= this.limits.maxDurationFrames / FPS + 0.001, "MEDIA_DURATION_LIMIT", "Media duration exceeds the configured limit or is unknown");
    const result: MediaProbe = { durationSeconds };
    const video = data.streams.find(s => s.codec_type === "video" && (s.disposition as { attached_pic?: number } | undefined)?.attached_pic !== 1);
    const audio = data.streams.find(s => s.codec_type === "audio");
    if (video) {
      const width = Number(video.width), height = Number(video.height), frames = Number(video.nb_read_frames);
      integer(width, 1, 4096, "source width"); integer(height, 1, 4096, "source height");
      integer(frames, 1, this.limits.maxDurationFrames * 8, "measured source frame count");
      invariant(!video.sample_aspect_ratio || ["1:1", "0:1", "N/A"].includes(String(video.sample_aspect_ratio)), "MEDIA_UNSUPPORTED", "Anamorphic source normalization is not supported in this slice");
      const streamDuration = Number(video.duration);
      result.video = { streamIndex: Number(video.index), width, height, frames, durationSeconds: Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : durationSeconds, frameRate: String(video.avg_frame_rate), codec: String(video.codec_name) };
    }
    if (audio) {
      const sampleRate = Number(audio.sample_rate), channels = Number(audio.channels);
      integer(sampleRate, 8000, 192000, "source sample rate"); integer(channels, 1, 8, "source channel count");
      const timeBase = String(audio.time_base).split("/").map(Number);
      const duration = Number(audio.duration_ts);
      let samples: number | null = null;
      if (Number.isSafeInteger(duration) && duration > 0 && Number.isSafeInteger(timeBase[0]) && Number.isSafeInteger(timeBase[1]) && timeBase[0]! > 0 && timeBase[1]! > 0) {
        const numerator = BigInt(duration) * BigInt(timeBase[0]!) * BigInt(sampleRate), denominator = BigInt(timeBase[1]!);
        const rounded = (numerator + denominator / 2n) / denominator;
        if (rounded <= BigInt(Number.MAX_SAFE_INTEGER)) samples = Number(rounded);
      }
      const streamDuration = Number(audio.duration);
      result.audio = { streamIndex: Number(audio.index), sampleRate, channels, samples, durationSeconds: samples === null ? (Number.isFinite(streamDuration) && streamDuration > 0 ? streamDuration : durationSeconds) : samples / sampleRate, codec: String(audio.codec_name) };
    }
    invariant(result.video || result.audio, "MEDIA_STREAM_MISSING", "No usable video or audio stream");
    return result;
  }
  private async decode(path: string, signal?: AbortSignal): Promise<void> {
    await this.run(this.ffmpeg, ["-nostdin", "-v", "error", "-xerror", "-threads", "1", "-err_detect", "explode", ...INPUT_OPTIONS, "-i", path, "-map", "0:v?", "-map", "0:a?", "-f", "null", "-"], signal);
  }
  private blobPath(source: SuppliedMedia): string {
    invariant(HASH.test(source.sha256), "MEDIA_INTEGRITY_ERROR", "Invalid source hash");
    return join(this.rootDir, "blobs", `${source.sha256}.${source.kind === "video" ? "mp4" : "wav"}`);
  }
  private async readSource(source: SuppliedMedia): Promise<SuppliedMedia> {
    invariant(source && HASH.test(source.id), "MEDIA_INVALID_INPUT", "Unknown supplied-media descriptor");
    const stored = JSON.parse(await readFile(join(this.rootDir, "sources", `${source.id}.json`), "utf8")) as SuppliedMedia;
    const { id, ...body } = stored;
    invariant(id === digest(body) && canonical(stored) === canonical(source), "MEDIA_INTEGRITY_ERROR", "Source differs from its frozen descriptor");
    return stored;
  }
  private async verifySource(source: SuppliedMedia): Promise<void> {
    await this.readSource(source);
    const observed = await this.hashFile(this.blobPath(source), this.limits.maxOutputBytes);
    invariant(observed.sha256 === source.sha256 && observed.byteLength === source.byteLength, "MEDIA_INTEGRITY_ERROR", "Normalized media changed after import");
  }
  private async readManifest(manifest: FrozenRenderManifest): Promise<FrozenRenderManifest> {
    invariant(manifest && HASH.test(manifest.digest), "MEDIA_INVALID_INPUT", "Invalid manifest identity");
    const stored = JSON.parse(await readFile(join(this.rootDir, "manifests", `${manifest.digest}.json`), "utf8")) as FrozenRenderManifest;
    const { digest: identity, ...body } = stored;
    invariant(identity === digest(body) && canonical(stored) === canonical(manifest), "MEDIA_INTEGRITY_ERROR", "Manifest changed after freezing");
    return frozen(stored);
  }
  private async hashFile(path: string, maxBytes: number): Promise<{ sha256: string; byteLength: number }> {
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const metadata = await file.stat();
      invariant(metadata.isFile() && metadata.size > 0 && metadata.size <= maxBytes, "MEDIA_OUTPUT_LIMIT", "Media file exceeds its byte limit");
      const hash = createHash("sha256"), buffer = Buffer.alloc(65536);
      let byteLength = 0;
      while (true) { const result = await file.read(buffer, 0, buffer.length, null); if (!result.bytesRead) break; byteLength += result.bytesRead; invariant(byteLength <= maxBytes, "MEDIA_OUTPUT_LIMIT", "Media file grew beyond its byte limit"); hash.update(buffer.subarray(0, result.bytesRead)); }
      invariant(byteLength === metadata.size, "MEDIA_INTEGRITY_ERROR", "Media file size changed");
      return { sha256: hash.digest("hex"), byteLength };
    } finally { await file.close(); }
  }
  private async syncDirectory(path: string): Promise<void> { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
  private async installFile(path: string, extension: "mp4" | "wav" | "source", maxBytes: number): Promise<{ sha256: string; byteLength: number; path: string }> {
    const observed = await this.hashFile(path, maxBytes);
    await chmod(path, 0o444);
    const file = await open(path, "r"); try { await file.sync(); } finally { await file.close(); }
    const destination = join(this.rootDir, "blobs", `${observed.sha256}.${extension}`);
    try { await link(path, destination); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await this.hashFile(destination, maxBytes);
      invariant(existing.sha256 === observed.sha256 && existing.byteLength === observed.byteLength, "MEDIA_INTEGRITY_ERROR", "Existing immutable blob is corrupt");
    }
    await this.syncDirectory(join(this.rootDir, "blobs"));
    return { ...observed, path: destination };
  }
  private async installJson(directory: string, id: string, value: unknown): Promise<void> {
    const text = canonical(value);
    invariant(Buffer.byteLength(text) <= 1024 * 1024, "MEDIA_MANIFEST_LIMIT", "Media record is too large");
    await this.temporary(async dir => {
      const temporary = join(dir, "record.json"), destination = join(this.rootDir, directory, `${id}.json`);
      const file = await open(temporary, "wx", 0o444);
      try { await file.writeFile(text); await file.sync(); } finally { await file.close(); }
      try { await link(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; invariant(await readFile(destination, "utf8") === text, "MEDIA_INTEGRITY_ERROR", "Immutable media record conflict"); }
      await this.syncDirectory(join(this.rootDir, directory));
    });
  }
}
