// Offline synthesized placeholders, authored for OpenSlate. No samples or third-party assets.
// Rebuild with: OPENSLATE_FFMPEG_PATH=/absolute/path/to/ffmpeg node scripts/make-sfx.mjs
import { mkdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { findTestMediaTool } from "./test-toolchain.mjs";
const ffmpeg = process.env.OPENSLATE_FFMPEG_PATH ?? findTestMediaTool("ffmpeg").path;
if (!ffmpeg) throw new Error("Configure the pinned local FFmpeg; this script never downloads tools.");
const root = fileURLToPath(new URL("../apps/server/assets/sfx/", import.meta.url));
mkdirSync(root, { recursive: true });
// Chirps, damped partials and deterministic pseudo-noise, with short attack/release envelopes.
const sounds = {
  pop: [0.18, "0.65*sin(2*PI*(520*t-900*t*t))*exp(-32*t)*(1-exp(-700*t))"],
  thud: [0.42, "(0.68*sin(2*PI*(85*t-48*t*t))+0.12*sin(2*PI*173*t))*exp(-15*t)*(1-exp(-800*t))"],
  whoosh: [0.65, "0.35*(sin(2*PI*(1700*t+2200*t*t))+0.35*sin(2*PI*(4211*t-1700*t*t))+0.2*sin(2*PI*7331*t))*pow(sin(PI*t/0.65),2)"],
  ding: [0.72, "0.34*(sin(2*PI*1318.51*t)*exp(-4*t)+0.35*sin(2*PI*2637.02*t)*exp(-6*t)+0.12*sin(2*PI*3955.53*t)*exp(-9*t))*(1-exp(-1000*t))"],
  tick: [0.09, "0.55*(sin(2*PI*2800*t)+0.3*sin(2*PI*6100*t))*exp(-100*t)*(1-exp(-2000*t))"],
  boing: [0.72, "0.5*(sin(2*PI*(180*t+18*(1-exp(-12*t)))+4*exp(-5*t)*sin(2*PI*19*t))+0.15*sin(2*PI*360*t))*exp(-5*t)*(1-exp(-700*t))"],
};
for (const [sound, [duration, expression]] of Object.entries(sounds)) {
  const path = join(root, `${sound}.wav`);
  const result = spawnSync(ffmpeg, ["-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", `aevalsrc='${expression}':s=48000:d=${duration}`,
    "-af", `afade=t=out:st=${duration - 0.025}:d=0.025`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", path], { encoding: "utf8", timeout: 15000 });
  if (result.status !== 0) throw new Error(`${sound}: ${result.stderr || result.error}`);
  if (duration >= 1.5 || statSync(path).size >= 150000) throw new Error(`${sound} exceeds the sound-pack limits`);
  console.log(`${sound}: ${duration}s, ${statSync(path).size} bytes`);
}
