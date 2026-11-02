// Deterministic local edit: selected screen intervals, per-stage narration, full film.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const manifestPath = resolve(process.argv[2]);
const base = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const output = resolve(base, manifest.output);
const temporary = join(base, "edit");
mkdirSync(temporary, { recursive: true });
const ffmpeg = process.env.FFMPEG ?? "ffmpeg";
const ffprobe = process.env.FFPROBE ?? "ffprobe";
const run = (file, args) => {
  const result = spawnSync(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${file} failed: ${result.error?.message ?? result.stderr.slice(-5000)}`);
  return result.stdout + result.stderr;
};
const duration = file => Number(run(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file]).trim());
const encode = ["-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];
const parts = [];
run(process.env.PYTHON ?? "python3", [fileURLToPath(new URL("cards.py", import.meta.url)), manifestPath, temporary]);
function card(id, seconds) {
  const path = join(temporary, `${id}.mp4`);
  run(ffmpeg, ["-y", "-v", "error", "-loop", "1", "-framerate", "30", "-i", join(temporary, `${id}.png`), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", String(seconds), ...encode, path]);
  parts.push(path);
}
card("title", 3);
for (const stage of manifest.stages) {
  if (stage.beforeCard) card(stage.beforeCard, 2);
  const audio = join(base, "narration", `${stage.id}.wav`);
  const args = ["-y", "-v", "error", "-filter_complex_threads", "2"];
  const filters = [];
  let screenDuration = 0;
  stage.segments.forEach((segment, index) => {
    for (const value of [segment.start, segment.duration, segment.speed ?? 1]) if (!Number.isFinite(value) || value < 0) throw new Error("Invalid screen interval");
    const speed = segment.speed ?? 1;
    if (speed <= 0 || segment.duration <= 0) throw new Error("Positive duration and speed required");
    if (segment.image) args.push("-loop", "1", "-framerate", "30", "-t", String(segment.duration), "-i", resolve(base, segment.image));
    else args.push("-ss", String(segment.start), "-t", String(segment.duration), "-i", resolve(base, stage.source ?? manifest.raw));
    filters.push(`[${index}:v]setpts=(PTS-STARTPTS)/${speed},fps=30,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v${index}]`);
    screenDuration += segment.duration / speed;
  });
  const count = stage.segments.length;
  if (!count) throw new Error("Every stage needs a recorded interval");
  const seconds = Math.max(screenDuration, duration(audio) + 0.6);
  args.push("-i", audio);
  filters.push(`${stage.segments.map((_, i) => `[v${i}]`).join("")}concat=n=${count}:v=1:a=0,tpad=stop_mode=clone:stop_duration=120,trim=duration=${seconds}[v]`);
  filters.push(`[${count}:a]apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS[a]`);
  const path = join(temporary, `${stage.id}.mp4`);
  run(ffmpeg, [...args, "-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]", ...encode, path]);
  parts.push(path);
  console.log(`Edited ${stage.id}: ${seconds.toFixed(2)} seconds`);
}
// The downloaded studio export remains untouched; only normalize its copy for concat.
const film = join(temporary, "film.mp4");
run(ffmpeg, ["-y", "-v", "error", "-i", resolve(base, manifest.film), "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30", ...encode, film]);
parts.push(film);
card("end", 4);
const concat = join(temporary, "concat.txt");
writeFileSync(concat, parts.map(path => `file '${path.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
const joined = join(temporary, "joined.mp4");
run(ffmpeg, ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", joined]);
const analysis = run(ffmpeg, ["-hide_banner", "-i", joined, "-af", "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]);
const measured = JSON.parse(analysis.slice(analysis.lastIndexOf("{"), analysis.lastIndexOf("}") + 1));
const loudnorm = `loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true:print_format=json`;
const master = run(ffmpeg, ["-y", "-hide_banner", "-i", joined, "-c:v", "copy", "-af", loudnorm, "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", output]);
writeFileSync(join(temporary, "loudness.json"), JSON.stringify({ analysis: measured, master: JSON.parse(master.slice(master.lastIndexOf("{"), master.lastIndexOf("}") + 1)) }, null, 2));
console.log(output);
