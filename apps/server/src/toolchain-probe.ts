import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { parseChangeProposal } from "@openslate/core";

const directory = mkdtempSync(join(tmpdir(), "openslate-toolchain-"));
const results: Record<string, unknown> = { node: process.version, platform: process.platform, architecture: process.arch, networkCalls: 0 };
try {
  const db = new Database(":memory:");
  results.sqlite = db.prepare("select sqlite_version() as version").get();
  db.exec("create table probe(value text not null)");
  db.transaction(() => db.prepare("insert into probe values(?)").run("durable-contract-fixture"))();
  results.sqliteTransaction = (db.prepare("select count(*) as n from probe").get() as { n: number }).n === 1;
  db.close();
  try { parseChangeProposal({ variant: "project", expectedHeadVersion: "0", creative: { brief: "probe" } }); results.strictSchema = false; }
  catch { results.strictSchema = true; }
  const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? "ffmpeg";
  const ffprobe = process.env.OPENSLATE_FFPROBE_PATH ?? "ffprobe";
  const version = spawnSync(ffmpeg, ["-version"], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  results.ffmpeg = version.stdout?.split("\n")[0] ?? null;
  const file = join(directory, "fixture.mp4");
  const encoded = spawnSync(ffmpeg, ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=navy:s=160x90:r=30:d=0.2", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000", "-movflags", "+faststart", file], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  if (encoded.status !== 0) { results.mediaProbe = "blocked"; results.diagnostic = encoded.error?.message ?? encoded.stderr; }
  else {
    const probed = spawnSync(ffprobe, ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
    if (probed.status !== 0) { results.mediaProbe = "blocked"; results.diagnostic = probed.error?.message ?? probed.stderr; }
    else {
      const streams = (JSON.parse(probed.stdout) as { streams: { codec_type: string; codec_name: string; avg_frame_rate?: string; nb_frames?: string; sample_rate?: string }[] }).streams;
      const video = streams.find(s => s.codec_type === "video"), audio = streams.find(s => s.codec_type === "audio");
      results.mediaProbe = video?.codec_name === "h264" && video.avg_frame_rate === "30/1" && video.nb_frames === "6" && audio?.codec_name === "aac" && audio.sample_rate === "48000" ? "passed" : "failed";
      results.media = { videoCodec: video?.codec_name, frames: video?.nb_frames, frameRate: video?.avg_frame_rate, audioCodec: audio?.codec_name, sampleRate: audio?.sample_rate };
    }
  }
  if (!process.version.startsWith("v24.") || !results.sqliteTransaction || !results.strictSchema || results.mediaProbe !== "passed") process.exitCode = 2;
  console.log(JSON.stringify(results, null, 2));
} finally { rmSync(directory, { recursive: true, force: true }); }
