import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  assertSourceChecksum,
  findTestMediaTool,
  inspectTestToolchain,
  loadTestToolchain,
  managedMediaPrefix,
  requireTestToolchain,
  testEnvironment,
} from "../test-toolchain.mjs";
function fixture(t, versions = {}) {
  const root = mkdtempSync(join(tmpdir(), "openslate-test-toolchain-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "scripts"));
  writeFileSync(join(root, ".nvmrc"), "24.15.0\n");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10.33.0" }),
  );
  writeFileSync(
    join(root, "scripts/test-media-toolchain.json"),
    JSON.stringify({
      version: "8.1.1",
      sourceUrl: "https://ffmpeg.org/releases/ffmpeg-8.1.1.tar.xz",
      sourceSha256: "a".repeat(64),
      configure: ["--enable-libx264"],
      requiredEncoders: ["libx264", "aac", "pcm_s16le", "png", "mjpeg"],
    }),
  );
  const calls = [],
    environment = { PATH: "/fixture/tools" },
    probe = (path, args) => {
      calls.push({ path, args });
      if (path === "pnpm")
        return { status: 0, stdout: (versions.pnpm ?? "10.33.0") + "\n" };
      if (path === "/fixture/tools/ffmpeg" && args.includes("-encoders"))
        return {
          status: 0,
          stdout: ["libx264", "aac", "pcm_s16le", "png", "mjpeg"]
            .filter((name) => name !== versions.missingEncoder)
            .map((name) => "V..... " + name + " fixture")
            .join("\n"),
        };
      if (path === "/fixture/tools/ffmpeg")
        return {
          status: 0,
          stdout: `ffmpeg version ${versions.ffmpeg ?? "8.1.1"} Copyright`,
        };
      if (path === "/fixture/tools/ffprobe")
        return {
          status: 0,
          stdout: `ffprobe version ${versions.ffprobe ?? "8.1.1"} Copyright`,
        };
      return { status: 1, stdout: "" };
    };
  return { root, environment, probe, calls, nodeVersion: "24.15.0" };
}
test("Node patch and package-manager drift are rejected rather than silently sharing a major version", (t) => {
  const f = fixture(t);
  assert.equal(inspectTestToolchain(f).ready, true);
  assert.throws(
    () => requireTestToolchain({ ...f, nodeVersion: "24.21.0" }),
    /Node: expected 24.15.0, found 24.21.0/,
  );
  const manager = fixture(t, { pnpm: "10.34.0" });
  assert.throws(
    () => requireTestToolchain(manager),
    /pnpm: expected 10.33.0, found 10.34.0/,
  );
});
test("FFmpeg and ffprobe must both match the pinned release; the former Linux CI pair fails clearly", (t) => {
  const f = fixture(t, { ffmpeg: "6.1.1", ffprobe: "6.1.1" }),
    report = inspectTestToolchain(f);
  assert.equal(report.ready, false);
  assert.throws(
    () => requireTestToolchain(f),
    /ffmpeg: expected 8.1.1, found 6.1.1/,
  );
  const mixed = fixture(t, { ffprobe: "6.1.1" });
  assert.equal(inspectTestToolchain(mixed).ready, false);
});
test("an explicit incompatible media override cannot be replaced by an available different binary", (t) => {
  const f = fixture(t),
    original = f.probe;
  f.environment.OPENSLATE_FFMPEG_PATH = "/explicit/ffmpeg";
  f.probe = (path, args) =>
    path === "/explicit/ffmpeg"
      ? { status: 0, stdout: "ffmpeg version 6.1.1 Copyright" }
      : original(path, args);
  const found = findTestMediaTool("ffmpeg", f);
  assert.equal(found.path, null);
  assert.deepEqual(found.observations, [
    { path: "/explicit/ffmpeg", version: "6.1.1" },
  ]);
  assert.equal(
    f.calls.some((call) => call.path === "/fixture/tools/ffmpeg"),
    false,
  );
});
test("the test runner passes the verified absolute media pair to every test and child tool convention", (t) => {
  const f = fixture(t),
    report = requireTestToolchain(f),
    parent = { PATH: "/fixture/tools", UNRELATED: "preserved" },
    before = structuredClone(parent),
    environment = testEnvironment(report, parent);
  assert.equal(environment.OPENSLATE_FFMPEG_PATH, "/fixture/tools/ffmpeg");
  assert.equal(environment.OPENSLATE_FFPROBE_PATH, "/fixture/tools/ffprobe");
  assert.equal(environment.OPENSLATE_FFMPEG, environment.OPENSLATE_FFMPEG_PATH);
  assert.equal(
    environment.OPENSLATE_FFPROBE,
    environment.OPENSLATE_FFPROBE_PATH,
  );
  assert.deepEqual(parent, before);
  assert.throws(
    () => testEnvironment({ ...report, ready: false }, parent),
    /Verify/,
  );
});
test("only the official archive for the exact pin is admitted and a floating Node declaration fails", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.root, ".nvmrc"), "24\n");
  assert.throws(() => loadTestToolchain(f.root), /Invalid pinned/);
  writeFileSync(join(f.root, ".nvmrc"), "24.15.0\n");
  const path = join(f.root, "scripts/test-media-toolchain.json"),
    p = JSON.parse(readFileSync(path, "utf8"));
  p.sourceUrl = "https://example.com/ffmpeg.tar.xz";
  writeFileSync(path, JSON.stringify(p));
  assert.throws(() => loadTestToolchain(f.root), /Invalid pinned/);
});
test("a corrupt download is rejected before extraction and cache identities separate platforms, architectures and configurations", (t) => {
  const f = fixture(t),
    file = join(f.root, "archive.tar.xz"),
    bytes = Buffer.from("verified source fixture");
  writeFileSync(file, bytes);
  const sha = createHash("sha256").update(bytes).digest("hex");
  assert.doesNotThrow(() => assertSourceChecksum(file, sha));
  writeFileSync(file, Buffer.from("changed source"));
  assert.throws(
    () => assertSourceChecksum(file, sha),
    /will not be extracted or executed/,
  );
  const p = loadTestToolchain(f.root);
  assert.notEqual(
    managedMediaPrefix(f.root, p, "darwin", "arm64"),
    managedMediaPrefix(f.root, p, "linux", "x64"),
  );
  assert.notEqual(
    managedMediaPrefix(f.root, p),
    managedMediaPrefix(f.root, {
      ...p,
      media: { ...p.media, configure: ["--disable-network"] },
    }),
  );
});

test("a same-version media binary missing required codecs cannot pass the parity gate", (t) => {
  const f = fixture(t, { missingEncoder: "png" });
  assert.throws(() => requireTestToolchain(f), /missing: png/);
});
