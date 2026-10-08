import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";
import { availableParallelism } from "node:os";
import {
  assertSourceChecksum,
  findTestMediaTool,
  loadTestToolchain,
  managedMediaPrefix,
  mediaEncoderSupport,
  repositoryRoot,
} from "./test-toolchain.mjs";
const profile = loadTestToolchain(),
  prefix = managedMediaPrefix(),
  expected = profile.media.version;
const tools = ["ffmpeg", "ffprobe"].map((tool) => findTestMediaTool(tool));
if (
  tools.every((tool) => tool.path) &&
  mediaEncoderSupport(tools[0].path, profile).ready
) {
  console.log(
    `Test media tools already match FFmpeg ${expected}: ${tools.map((tool) => tool.path).join(", ")}`,
  );
} else {
  if (!["darwin", "linux"].includes(process.platform))
    throw new Error(
      "The source installer supports macOS and Linux. Configure matching ffmpeg/ffprobe binaries explicitly.",
    );
  for (const command of ["curl", "tar", "make", "cc", "pkg-config"]) {
    if (spawnSync(command, ["--version"], { stdio: "ignore" }).status !== 0)
      throw new Error(
        `Missing ${command}. Install compiler/media build prerequisites documented in CONTRIBUTING.md.`,
      );
  }
  if (spawnSync("pkg-config", ["--exists", "x264"]).status !== 0)
    throw new Error(
      "libx264 development files are required. macOS: brew install x264 pkg-config; Ubuntu: apt-get install build-essential pkg-config nasm libx264-dev zlib1g-dev.",
    );
  const cache = join(repositoryRoot, ".cache/test-toolchain");
  mkdirSync(cache, { recursive: true });
  const work = await mkdtemp(join(cache, "build-")),
    archive = join(work, "ffmpeg.tar.xz"),
    install = join(work, "installed");
  const run = (command, args, cwd = work) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: "inherit" });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                `${command} failed (${code}); inspect its build output above.`,
              ),
            ),
      );
    });
  try {
    console.log(
      `Preparing official checksummed FFmpeg ${expected} in ${prefix}.`,
    );
    await run("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--location",
      "--retry",
      "2",
      "--output",
      archive,
      profile.media.sourceUrl,
    ]);
    assertSourceChecksum(archive, profile.media.sourceSha256);
    await run("tar", ["-xf", archive]);
    const source = join(work, `ffmpeg-${expected}`);
    await run(
      "./configure",
      [`--prefix=${install}`, ...profile.media.configure],
      source,
    );
    await run(
      "make",
      ["-j", String(Math.min(4, availableParallelism()))],
      source,
    );
    await run("make", ["install"], source);
    for (const tool of ["ffmpeg", "ffprobe"]) {
      const binary = join(install, "bin", tool);
      chmodSync(binary, 0o755);
      if (
        !spawnSync(binary, ["-version"], {
          encoding: "utf8",
        }).stdout?.startsWith(`${tool} version ${expected} `)
      )
        throw new Error(`Built ${tool} does not match ${expected}.`);
    }
    if (!mediaEncoderSupport(join(install, "bin", "ffmpeg"), profile).ready)
      throw new Error("The built media tools are missing required codecs.");
    writeFileSync(
      join(install, "openslate-test-media.json"),
      JSON.stringify(profile.media, null, 2) + "\n",
    );
    // Remove only this task-owned cache target; production binaries and configuration are untouched.
    if (existsSync(prefix)) rmSync(prefix, { recursive: true, force: true });
    renameSync(install, prefix);
    console.log(
      `Pinned media tools ready: ${join(prefix, "bin", "ffmpeg")} and ffprobe.`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
