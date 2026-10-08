import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
export function loadTestToolchain(root = repositoryRoot) {
  const node = readFileSync(join(root, ".nvmrc"), "utf8").trim();
  const manager = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  ).packageManager;
  const media = JSON.parse(
    readFileSync(join(root, "scripts/test-media-toolchain.json"), "utf8"),
  );
  if (
    !/^24\.\d+\.\d+$/.test(node) ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(manager) ||
    !/^\d+\.\d+\.\d+$/.test(media.version) ||
    !/^[a-f0-9]{64}$/.test(media.sourceSha256) ||
    media.sourceUrl !==
      `https://ffmpeg.org/releases/ffmpeg-${media.version}.tar.xz` ||
    !Array.isArray(media.requiredEncoders) ||
    !media.requiredEncoders.length ||
    !media.requiredEncoders.every(
      (name) => typeof name === "string" && /^[a-z0-9_]+$/.test(name),
    ) ||
    !Array.isArray(media.configure) ||
    !media.configure.every(
      (arg) => typeof arg === "string" && /^--[a-z0-9-]+$/.test(arg),
    )
  )
    throw new Error(
      "Invalid pinned test toolchain. Use exact Node/pnpm/media versions and a checksummed official FFmpeg source.",
    );
  return { node, pnpm: manager.slice(5), media };
}
export function managedMediaPrefix(
  root = repositoryRoot,
  profile = loadTestToolchain(root),
  platform = process.platform,
  architecture = process.arch,
) {
  const key = createHash("sha256")
    .update(JSON.stringify(profile.media))
    .digest("hex")
    .slice(0, 12);
  return join(
    root,
    ".cache/test-toolchain",
    `ffmpeg-${profile.media.version}-${platform}-${architecture}-${key}`,
  );
}
export function assertSourceChecksum(path, expected) {
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (actual !== expected)
    throw new Error(
      `FFmpeg source checksum mismatch: expected ${expected}, received ${actual}. The archive will not be extracted or executed.`,
    );
}
const probeCommand = (command, args) =>
  spawnSync(command, args, {
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 65536,
  });
/** Explicit overrides are authoritative: an incompatible override never silently falls back. */
export function findTestMediaTool(
  tool,
  {
    root = repositoryRoot,
    profile = loadTestToolchain(root),
    environment = process.env,
    probe = probeCommand,
  } = {},
) {
  const override =
    environment[`OPENSLATE_${tool.toUpperCase()}_PATH`] ??
    environment[`OPENSLATE_${tool.toUpperCase()}`];
  const candidates = override
    ? [resolve(root, override)]
    : [
        join(managedMediaPrefix(root, profile), "bin", tool),
        ...(environment.PATH ?? "")
          .split(":")
          .filter(Boolean)
          .map((directory) => resolve(root, directory, tool)),
        `/opt/homebrew/bin/${tool}`,
        `/usr/local/bin/${tool}`,
        `/usr/bin/${tool}`,
      ];
  const observations = [];
  for (const path of [...new Set(candidates)]) {
    const result = probe(path, ["-version"]);
    const version =
      result.status === 0
        ? (new RegExp(`^${tool} version ([^\\s]+)`).exec(
            result.stdout ?? "",
          )?.[1] ?? null)
        : null;
    observations.push({ path, version });
    if (version === profile.media.version)
      return { path, version, observations };
  }
  return { path: null, version: null, observations };
}
export function mediaEncoderSupport(path, profile, probe = probeCommand) {
  const result = probe(path, ["-hide_banner", "-encoders"]);
  const encoders = new Set(
    (result.stdout ?? "")
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter((fields) => /^[VAS][A-Z.]{5}$/.test(fields[0] ?? ""))
      .map((fields) => fields[1]),
  );
  const missing = profile.media.requiredEncoders.filter(
    (name) => !encoders.has(name),
  );
  return { ready: result.status === 0 && !missing.length, missing };
}
export function inspectTestToolchain({
  root = repositoryRoot,
  environment = process.env,
  nodeVersion = process.versions.node,
  probe = probeCommand,
} = {}) {
  const profile = loadTestToolchain(root),
    checks = [];
  checks.push({
    name: "Node",
    expected: profile.node,
    actual: nodeVersion,
    ready: nodeVersion === profile.node,
    action: "Run nvm install and nvm use in the repository.",
  });
  const packageManager = probe("pnpm", ["--version"]),
    actualPnpm =
      packageManager.status === 0
        ? (packageManager.stdout?.trim() ?? null)
        : null;
  checks.push({
    name: "pnpm",
    expected: profile.pnpm,
    actual: actualPnpm,
    ready: actualPnpm === profile.pnpm,
    action: `Use pnpm ${profile.pnpm} from package.json.`,
  });
  const tools = {};
  for (const tool of ["ffmpeg", "ffprobe"]) {
    const found = findTestMediaTool(tool, {
      root,
      profile,
      environment,
      probe,
    });
    tools[tool] = found.path;
    checks.push({
      name: tool,
      expected: profile.media.version,
      actual:
        found.version ??
        found.observations.find((item) => item.version)?.version ??
        null,
      ready: !!found.path,
      action:
        "Run pnpm setup:test-media, then unset incompatible media overrides or point them at the pinned binaries.",
    });
  }
  if (tools.ffmpeg) {
    const supported = mediaEncoderSupport(tools.ffmpeg, profile, probe);
    checks.push({
      name: "media encoders",
      expected: profile.media.requiredEncoders.join(", "),
      actual: supported.ready
        ? "available"
        : "missing: " + supported.missing.join(", "),
      ready: supported.ready,
      action: "Run pnpm setup:test-media to build the required codec profile.",
    });
  }
  return {
    profile,
    checks,
    tools,
    ready: checks.every((check) => check.ready),
  };
}
export function requireTestToolchain(options) {
  const report = inspectTestToolchain(options);
  if (!report.ready)
    throw new Error(
      "Test toolchain differs from CI:\n" +
        report.checks
          .filter((check) => !check.ready)
          .map(
            (check) =>
              `${check.name}: expected ${check.expected}, found ${check.actual ?? "unavailable"}. ${check.action}`,
          )
          .join("\n"),
    );
  return report;
}
export function testEnvironment(report, parent = process.env) {
  if (!report.ready || !report.tools.ffmpeg || !report.tools.ffprobe)
    throw new Error("Verify the test toolchain before starting tests.");
  return {
    ...parent,
    OPENSLATE_FFMPEG_PATH: report.tools.ffmpeg,
    OPENSLATE_FFPROBE_PATH: report.tools.ffprobe,
    OPENSLATE_FFMPEG: report.tools.ffmpeg,
    OPENSLATE_FFPROBE: report.tools.ffprobe,
  };
}
export function describeTestToolchain(report) {
  return report.checks
    .map((check) => `${check.name} ${check.actual ?? "unavailable"}`)
    .join(" · ");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    console.log(
      "Pinned test toolchain: " + describeTestToolchain(requireTestToolchain()),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
