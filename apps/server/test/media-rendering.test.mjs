import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, symlink, copyFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalMediaService } from "../dist/media/index.js";
import { runMediaProcess } from "../dist/media/process.js";

const execute = promisify(execFile);
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? (existsSync("/opt/homebrew/bin/ffmpeg") ? "/opt/homebrew/bin/ffmpeg" : "/usr/bin/ffmpeg");
const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? (existsSync("/opt/homebrew/bin/ffprobe") ? "/opt/homebrew/bin/ffprobe" : "/usr/bin/ffprobe");
let root, inputs, redPath, bluePath, audioPath, red, blue, audio, shared;

function service(name, limits) {
  return new LocalMediaService({ rootDir: join(root, name), allowedInputRoots: [inputs], ffmpegPath: ffmpeg, ffprobePath: ffprobe, ...(limits ? { limits } : {}) });
}
function video(source, durationFrames = 12, startFrame = 0) { return { source, startFrame, durationFrames, fit: "contain" }; }
async function manifest(clips = [video(red)], audio = [], owner = shared) {
  return owner.freezeManifest({ projectId: "project-1", targetRevisionId: "timeline-1", width: 160, height: 90, clips, audio });
}
function code(expected) { return error => error?.code === expected; }

before(async () => {
  root = await mkdtemp(join(tmpdir(), "openslate-media-tests-"));
  inputs = join(root, "supplied"); await mkdir(inputs);
  redPath = join(inputs, "red ; shell syntax is a filename.mp4");
  bluePath = join(inputs, "blue.mp4"); audioPath = join(inputs, "voice.wav");
  for (const [path, color, size, rate] of [[redPath, "red", "160x90", "24"], [bluePath, "blue", "90x160", "30"]]) {
    await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", `color=c=${color}:s=${size}:r=${rate}:d=1`, "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", path], { timeout: 15000 });
  }
  await execute(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000:duration=1", "-c:a", "pcm_s16le", audioPath], { timeout: 15000 });
  shared = service("shared");
  red = await shared.importMedia({ artifactId: "red", path: redPath, kind: "video" });
  blue = await shared.importMedia({ artifactId: "blue", path: bluePath, kind: "video" });
  audio = await shared.importMedia({ artifactId: "narration", path: audioPath, kind: "audio" });
});
after(async () => { if (root) await rm(root, { recursive: true, force: true }); });

test("supplied sources preserve originals and normalize measured video/audio independently", async () => {
  assert.equal(red.probe.video.frameRate, "30/1");
  assert.equal(red.probe.video.frames, 30);
  assert.equal(blue.probe.video.frames, 30);
  assert.equal(blue.probe.video.width, 90);
  assert.equal(red.probe.audio, undefined);
  assert.equal(audio.probe.audio.sampleRate, 48000);
  assert.equal(audio.probe.audio.channels, 2);
  assert.equal(audio.probe.audio.samples, 48000);
  assert.equal(audio.probe.video, undefined);
  assert.deepEqual(await readFile(join(shared.rootDir, "blobs", `${red.originalSha256}.source`)), await readFile(redPath));
  assert.equal(Object.isFrozen(red.probe.video), true);
  assert.equal(Object.hasOwn(red, "path"), false);
  const raw = await shared.probe(redPath);
  assert.equal(raw.video.frameRate, "24/1");
});

test("real FFmpeg render respects exact cut frames, explicit fit and sample-based audio placement", async () => {
  const frozen = await manifest([video(red, 9, 3), { ...video(blue, 15, 5), fit: "cover" }], [{ source: audio, startSample: 1000, durationSamples: 24000, atSample: 6000, gainMilliDb: -3000 }]);
  assert.equal(frozen.totalFrames, 24);
  assert.equal(Object.isFrozen(frozen.clips), true);
  let selected;
  const result = await shared.render(frozen, { publish(completion) { selected = completion.artifact.id; return true; } });
  assert.equal(result.status, "published");
  assert.equal(selected, result.artifact.id);
  assert.equal(result.artifact.probe.video.frames, 24);
  assert.equal(result.artifact.probe.video.width, 160);
  assert.equal(result.artifact.probe.video.height, 90);
  assert.equal(result.artifact.probe.audio.sampleRate, 48000);
  assert.ok(Math.abs(result.artifact.probe.audio.samples - 38400) <= 2048);
  assert.ok((await stat(result.artifact.path)).size > 0);
  const picture = await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", result.artifact.path, "-map", "0:v:0", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { encoding: "buffer", timeout: 10000 });
  assert.equal(picture.stdout.length, 24 * 3);
  for (let frame = 0; frame < 24; frame++) {
    const red = picture.stdout[frame * 3], blue = picture.stdout[frame * 3 + 2];
    assert.ok(frame < 9 ? red > blue + 100 : blue > red + 100, `unexpected cut content at frame ${frame}`);
  }
  const sound = await execute(ffmpeg, ["-nostdin", "-v", "error", "-i", result.artifact.path, "-map", "0:a:0", "-f", "s16le", "-"], { encoding: "buffer", timeout: 10000 });
  const energy = (start, end) => {
    let sum = 0;
    for (let sample = start; sample < end; sample++) sum += sound.stdout.readInt16LE(sample * 4) ** 2;
    return Math.sqrt(sum / (end - start));
  };
  assert.ok(energy(0, 2000) < 5, "placement should start with silence");
  assert.ok(energy(8000, 16000) > 100, "narration should be present at its placed samples");
  assert.ok(energy(34000, 37000) < 5, "timeline tail should be padded with silence");
  const reopened = service("shared");
  assert.deepEqual(await reopened.readCompletion(frozen.digest, result.artifact.sha256), { manifest: frozen, artifact: result.artifact });
});

test("a target edit during rendering keeps the prior preview and retains a historical output", async () => {
  const frozen = await manifest([video(red, 8)]);
  let target = "timeline-1", selected = "existing-preview";
  const result = await shared.render(frozen, {
    isCurrent() { setImmediate(() => { target = "timeline-2"; }); return true; },
    publish(completion) {
      if (target !== completion.manifest.targetRevisionId) return false;
      selected = completion.artifact.id; return true;
    },
  });
  assert.equal(result.status, "historical");
  assert.equal(selected, "existing-preview");
  assert.ok(existsSync(result.artifact.path));
  await assert.rejects(shared.render(frozen, { isCurrent: () => false, publish: () => { throw new Error("must not publish"); } }), code("MEDIA_STALE_TARGET"));
});

test("failed application publication leaves a verified receipt recoverable after restart", async () => {
  const frozen = await manifest([video(blue, 6)]);
  let observed;
  await assert.rejects(shared.render(frozen, { publish(completion) { observed = completion; throw new Error("synthetic database failure"); } }), /synthetic database failure/);
  const reopened = service("shared");
  assert.deepEqual(await reopened.readCompletion(frozen.digest, observed.artifact.sha256), observed);
  assert.deepEqual(await readdir(join(shared.rootDir, "tmp")), []);
});

test("completion recovery stops on the original signal even after byte verification finishes", async () => {
  const frozen = await manifest([video(red, 7)]), completed = await shared.render(frozen);
  const reopened = service("shared"), controller = new AbortController(), options = { signal: controller.signal };
  const hash = reopened.hashFile.bind(reopened); let hashed = false;
  reopened.hashFile = async (...args) => {
    const result = await hash(...args); hashed = true;
    options.signal = new AbortController().signal; controller.abort(); return result;
  };
  await assert.rejects(reopened.readCompletion(frozen.digest, completed.artifact.sha256, options), code("MEDIA_CANCELLED"));
  assert.equal(hashed, true);
  assert.deepEqual(await service("shared").readCompletion(frozen.digest, completed.artifact.sha256), { manifest: frozen, artifact: completed.artifact });
});

test("completion discovery propagates cancellation and cannot return late recovered results", async () => {
  const frozen = await manifest([video(blue, 7)]); await shared.render(frozen);
  const reopened = service("shared"), controller = new AbortController(), original = reopened.readCompletion.bind(reopened);
  reopened.readCompletion = async (...args) => {
    assert.equal(args[2].signal, controller.signal);
    const result = await original(...args); controller.abort(); return result;
  };
  await assert.rejects(reopened.findCompletions(frozen.digest, { signal: controller.signal }), code("MEDIA_CANCELLED"));
  await assert.rejects(reopened.findCompletions(frozen.digest, { signal: controller.signal }), code("MEDIA_CANCELLED"));
});

test("recovery bounds owned JSON before parsing and pre-abort performs no source or manifest work", async () => {
  const owner = service("bounded-records"), manifestId = "1".repeat(64), outputId = "2".repeat(64);
  await writeFile(join(owner.rootDir, "completions", `${manifestId}-${outputId}.json`), Buffer.alloc(1024 * 1024 + 1, 32));
  await assert.rejects(owner.readCompletion(manifestId, outputId), code("MEDIA_MANIFEST_LIMIT"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(owner.verifiedSource(red, { signal: controller.signal }), code("MEDIA_CANCELLED"));
  await assert.rejects(owner.freezeManifest({ projectId: "p", targetRevisionId: "t", width: 160, height: 90, clips: [video(red)] }, { signal: controller.signal }), code("MEDIA_CANCELLED"));
  assert.deepEqual(await readdir(join(owner.rootDir, "manifests")), []);
});

test("render retains its original signal when the caller replaces mutable options", async () => {
  const frozen = await manifest([video(red, 5)]), owner = service("shared"), controller = new AbortController();
  const options = { signal: controller.signal }, read = owner.readManifest.bind(owner); let runs = 0;
  owner.readManifest = async (...args) => {
    const result = await read(...args); options.signal = new AbortController().signal; controller.abort(); return result;
  };
  owner.run = async () => { runs++; throw new Error("must not launch a media subprocess"); };
  await assert.rejects(owner.render(frozen, options), code("MEDIA_CANCELLED"));
  assert.equal(runs, 0);
});

test("render cancellation during final temporary cleanup retains recoverable output without reporting success", async () => {
  const frozen = await manifest([video(blue, 5)]), owner = service("shared"), controller = new AbortController();
  const temporary = owner.temporary.bind(owner); let depth = 0;
  owner.temporary = async operation => {
    depth++; try { return await temporary(operation); }
    finally { if (--depth === 0) controller.abort(); }
  };
  await assert.rejects(owner.render(frozen, { signal: controller.signal }), code("MEDIA_CANCELLED"));
  assert.deepEqual(await readdir(join(owner.rootDir, "tmp")), []);
  assert.equal((await service("shared").findCompletions(frozen.digest)).length, 1);
});

test("ranges are checked against measured frames/samples with no implicit looping or narration truncation", async () => {
  await assert.rejects(manifest([video(red, 31)]), code("MEDIA_SOURCE_TOO_SHORT"));
  await assert.rejects(manifest([video(red, 1, 0.5)]), code("MEDIA_INVALID_INPUT"));
  await assert.rejects(manifest([video(red, 12)], [{ source: audio, startSample: 0, durationSamples: 24000, atSample: 0 }]), code("MEDIA_AUDIO_OUTSIDE_TIMELINE"));
  await assert.rejects(manifest([video(red, 30)], [{ source: audio, startSample: 47000, durationSamples: 2000, atSample: 0 }]), code("MEDIA_SOURCE_TOO_SHORT"));
  await assert.rejects(shared.freezeManifest({ projectId: "p", targetRevisionId: "t", width: 161, height: 90, clips: [video(red)] }), code("MEDIA_INVALID_INPUT"));
});

test("URLs, files outside allowed roots, symlinks and playlist demuxers are rejected", async () => {
  await assert.rejects(shared.probe("https://example.invalid/video.mp4"), code("MEDIA_PATH_REJECTED"));
  const outside = join(root, "outside.mp4"); await copyFile(redPath, outside);
  await assert.rejects(shared.probe(outside), code("MEDIA_PATH_REJECTED"));
  const alias = join(inputs, "alias.mp4"); await symlink(redPath, alias);
  await assert.rejects(shared.probe(alias), code("MEDIA_PATH_REJECTED"));
  const playlist = join(inputs, "playlist.m3u8");
  await writeFile(playlist, "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nhttps://example.invalid/no-network.mp4\n#EXT-X-ENDLIST\n");
  await assert.rejects(shared.probe(playlist), code("MEDIA_TOOL_FAILED"));
  assert.deepEqual(await readdir(join(shared.rootDir, "tmp")), []);
});

test("the frozen plan and service-issued descriptors cannot be changed by caller data", async () => {
  const original = await manifest([video(red, 7)]);
  await assert.rejects(shared.render({ ...original, totalFrames: 6 }), code("MEDIA_INTEGRITY_ERROR"));
  await assert.rejects(manifest([video({ ...red, sha256: "0".repeat(64) })]), code("MEDIA_INTEGRITY_ERROR"));
  const other = service("other");
  await assert.rejects(other.freezeManifest({ projectId: "p", targetRevisionId: "t", width: 160, height: 90, clips: [video(red)] }), { code: "ENOENT" });
});

test("changed source bytes are detected before dispatch and original user files remain untouched", async () => {
  const owner = service("corrupt");
  const source = await owner.importMedia({ artifactId: "copy", path: redPath, kind: "video" });
  const frozen = await manifest([video(source)], [], owner);
  const path = join(owner.rootDir, "blobs", `${source.sha256}.mp4`);
  await chmod(path, 0o600); await writeFile(path, "corrupt synthetic blob");
  await assert.rejects(owner.render(frozen), code("MEDIA_INTEGRITY_ERROR"));
  assert.equal((await shared.probe(redPath)).video.frames, 24);
  assert.deepEqual(await readdir(join(owner.rootDir, "completions")), []);
});

test("cancellation stops a running render, cleans temporary files, and never publishes", async () => {
  const frozen = await manifest([video(red, 30)]);
  const controller = new AbortController();
  let published = false;
  const running = shared.render(frozen, { signal: controller.signal, publish() { published = true; return true; } });
  const timer = setTimeout(() => controller.abort(), 15);
  try { await assert.rejects(running, code("MEDIA_CANCELLED")); } finally { clearTimeout(timer); }
  assert.equal(published, false);
  assert.deepEqual(await readdir(join(shared.rootDir, "tmp")), []);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(shared.render(frozen, { signal: cancelled.signal }), code("MEDIA_CANCELLED"));
});

test("process cancellation and timeout await actual child exit, with bounded diagnostics", async () => {
  const controller = new AbortController();
  const pidFile = join(root, "child-pid");
  const running = runMediaProcess(process.execPath, ["--openssl-config=/dev/null", "-e", "require('node:fs').writeFileSync(process.argv[1], String(process.pid));setInterval(()=>{},1000)", pidFile], { cwd: root, timeoutMs: 5000, signal: controller.signal });
  for (let n = 0; n < 100 && !existsSync(pidFile); n++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(existsSync(pidFile), true);
  const pid = Number(await readFile(pidFile, "utf8"));
  controller.abort();
  await assert.rejects(running, code("MEDIA_CANCELLED"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await assert.rejects(runMediaProcess(process.execPath, ["--openssl-config=/dev/null", "-e", "setInterval(()=>{},1000)"], { cwd: root, timeoutMs: 50 }), code("MEDIA_TIMEOUT"));
  await assert.rejects(runMediaProcess(process.execPath, ["--openssl-config=/dev/null", "-e", "process.stdout.write('x'.repeat(10000))"], { cwd: root, timeoutMs: 1000, maxOutputBytes: 100 }), code("MEDIA_TOOL_OUTPUT_LIMIT"));
});

test("byte limits, failed executables and one-worker admission fail without publishing", async () => {
  const bounded = service("bounded", { maxInputBytes: 1024 });
  await assert.rejects(bounded.importMedia({ artifactId: "large", path: redPath, kind: "video" }), code("MEDIA_INPUT_LIMIT"));
  const broken = new LocalMediaService({ rootDir: join(root, "broken"), allowedInputRoots: [inputs], ffmpegPath: "/does-not-exist-openslate", ffprobePath: ffprobe });
  await assert.rejects(broken.importMedia({ artifactId: "red", path: redPath, kind: "video" }), code("MEDIA_TOOL_UNAVAILABLE"));
  assert.deepEqual(await readdir(join(broken.rootDir, "tmp")), []);
  const running = shared.probe(redPath);
  await assert.rejects(shared.probe(bluePath), code("MEDIA_BUSY"));
  await running;
});

test("a size-limited normalization is rejected rather than imported as a short take", async () => {
  const bounded = service("small-output", { maxOutputBytes: 1024 });
  await assert.rejects(bounded.importMedia({ artifactId: "red", path: redPath, kind: "video" }), error => ["MEDIA_TOOL_FAILED", "MEDIA_OUTPUT_LIMIT", "MEDIA_VALIDATION_FAILED", "MEDIA_DURATION_LIMIT"].includes(error?.code));
  assert.deepEqual(await readdir(join(bounded.rootDir, "sources")), []);
  assert.deepEqual(await readdir(join(bounded.rootDir, "tmp")), []);
});

test("executable bytes are pinned and a changed configured tool cannot fulfill a frozen render", async () => {
  const tool = join(root, "ffmpeg-copy");
  await copyFile(ffmpeg, tool); await chmod(tool, 0o755);
  const owner = new LocalMediaService({ rootDir: join(root, "tool-change"), allowedInputRoots: [inputs], ffmpegPath: tool, ffprobePath: ffprobe });
  const source = await owner.importMedia({ artifactId: "red", path: redPath, kind: "video" });
  const frozen = await manifest([video(source)], [], owner);
  await writeFile(tool, Buffer.concat([await readFile(tool), Buffer.from("changed synthetic executable")]));
  await assert.rejects(owner.render(frozen), code("MEDIA_TOOLCHAIN_CHANGED"));
  assert.deepEqual(await readdir(join(owner.rootDir, "completions")), []);
});
