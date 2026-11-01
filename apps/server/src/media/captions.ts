import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { invariant } from "@openslate/core";

// Loading the native font catalog must not delay graph composition workers or old caption-free films.
const requireCanvas = createRequire(import.meta.url);
let canvas: typeof import("@napi-rs/canvas") | undefined;
function canvasApi(): typeof import("@napi-rs/canvas") { return canvas ??= requireCanvas("@napi-rs/canvas") as typeof import("@napi-rs/canvas"); }

export interface Caption { text: string; atFrame: number; durationFrames: number; position?: "top" | "middle" | "bottom" }
export interface CaptionFont { family: string; sha256?: string }
export interface CaptionLayout { caption: Caption; font: CaptionFont; fontSize: number; lines: string[] }
export interface FrozenCaption extends Caption { font: CaptionFont; sha256: string; byteLength: number }
export type FontLookup = (cjk: boolean) => CaptionFont | undefined;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** System fonts only. Font paths stay on the host; receipts contain their family and readable file digest. */
export const systemCaptionFont: FontLookup = cjk => {
  const { GlobalFonts } = canvasApi();
  const preferred = process.platform === "darwin" ? ["PingFang SC", "Hiragino Sans GB", "Heiti SC"]
    : process.platform === "win32" ? ["Microsoft YaHei"] : ["Noto Sans CJK SC", "Noto Sans CJK", "Noto Sans SC"];
  const family = [...preferred, ...(cjk ? [] : ["Arial", "DejaVu Sans", "Liberation Sans", "sans-serif"])].find(name => GlobalFonts.has(name));
  if (!family) return undefined;
  const roots = process.platform === "darwin" ? ["/System/Library/Fonts", "/System/Library/Fonts/Supplemental", "/Library/Fonts"]
    : process.platform === "win32" ? [join(process.env.WINDIR ?? "C:\\Windows", "Fonts")] : ["/usr/share/fonts", "/usr/local/share/fonts"];
  const compact = (s: string) => s.replace(/[^a-z]/gi, "").toLowerCase();
  const target = compact(family), aliases = family === "Microsoft YaHei" ? ["msyh"] : family === "Heiti SC" ? ["stheiti"]
    : family.startsWith("Noto Sans") ? ["notosanscjk", "notosanssc"] : [];
  let scanned = 0;
  function find(root: string, depth = 0): string | undefined {
    if (depth > 5 || scanned > 4000) return;
    let entries; try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      scanned++;
      if (entry.isFile() && /\.(ttf|ttc|otf)$/i.test(entry.name) && [target, ...aliases].some(name => compact(entry.name).startsWith(name))) return join(root, entry.name);
      if (entry.isDirectory()) { const path = find(join(root, entry.name), depth + 1); if (path) return path; }
    }
  }
  for (const root of roots) {
    const path = find(root);
    if (path) { try { return { family, sha256: sha(readFileSync(path)) }; } catch { break; } }
  }
  return { family };
};

export function validateCaptions(value: unknown, totalFrames = 10800): Caption[] {
  invariant(Array.isArray(value) && value.length <= 64, "CODE_PLAN_RENDER_INPUT", "Use at most 64 captions");
  const captions = value.map((raw, index) => {
    const name = `Caption ${index + 1}`;
    invariant(raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).every(key => ["text", "atFrame", "durationFrames", "position"].includes(key)), "CODE_PLAN_RENDER_INPUT", `${name}: use text, atFrame, durationFrames and optional position`);
    const c = raw as Caption;
    invariant(typeof c.text === "string" && c.text.trim().length > 0 && [...c.text].length <= 80 && !/[\x00-\x08\x0b-\x1f\x7f]/.test(c.text), "CODE_PLAN_RENDER_INPUT", `${name}: text must contain 1–80 characters`);
    invariant(Number.isSafeInteger(c.atFrame) && c.atFrame >= 0 && c.atFrame < totalFrames, "CODE_PLAN_RENDER_INPUT", `${name}: atFrame must be an integer in 0–${totalFrames - 1}`);
    invariant(Number.isSafeInteger(c.durationFrames) && c.durationFrames >= 1 && c.atFrame + c.durationFrames <= totalFrames, "CODE_PLAN_RENDER_INPUT", `${name}: durationFrames must be an integer in 1–${totalFrames - c.atFrame}`);
    invariant(c.position === undefined || ["top", "middle", "bottom"].includes(c.position), "CODE_PLAN_RENDER_INPUT", `${name}: position must be top, middle or bottom`);
    return { text: c.text, atFrame: c.atFrame, durationFrames: c.durationFrames, ...(c.position === undefined ? {} : { position: c.position }) };
  });
  const ordered = captions.map((caption, index) => ({ ...caption, index })).sort((a, b) => a.atFrame - b.atFrame);
  for (let i = 1; i < ordered.length; i++) invariant(ordered[i]!.atFrame >= ordered[i - 1]!.atFrame + ordered[i - 1]!.durationFrames,
    "CODE_PLAN_RENDER_INPUT", `Caption ${ordered[i]!.index + 1}: overlaps caption ${ordered[i - 1]!.index + 1}; captions must not overlap`);
  return captions;
}

/** Also called during plan normalization: refuse missing CJK fonts and more than two measured lines early. */
export function layoutCaptions(captions: Caption[], width: number, height: number, lookup: FontLookup = systemCaptionFont): CaptionLayout[] {
  if (!captions.length) return [];
  const { createCanvas } = canvasApi();
  const context = createCanvas(1, 1).getContext("2d"), fontSize = Math.max(1, Math.round(height * 0.052));
  const fonts = new Map<boolean, CaptionFont | undefined>();
  return captions.map((caption, index) => {
    const cjk = CJK.test(caption.text);
    if (!fonts.has(cjk)) fonts.set(cjk, lookup(cjk));
    const font = fonts.get(cjk);
    invariant(font, "CODE_PLAN_RENDER_INPUT", `Caption ${index + 1}: ${cjk ? "no CJK system font is available (PingFang SC, Hiragino Sans GB, Heiti SC, Noto Sans CJK or Microsoft YaHei)" : "no suitable system font is available"}`);
    context.font = `bold ${fontSize}px "${font.family}"`;
    const maxWidth = width * 0.84, lines: string[] = [];
    // Unicode code points permit CJK wrapping and split an overlong English word without dropping characters.
    for (const paragraph of caption.text.split("\n")) {
      let line = "";
      for (const char of paragraph) {
        if (context.measureText(line + char).width > maxWidth && line) {
          // Prefer a word boundary for English; a CJK line can break at any character.
          const boundary = line.lastIndexOf(" ");
          if (boundary > line.length / 2) { lines.push(line.slice(0, boundary)); line = line.slice(boundary + 1); }
          else { lines.push(line); line = ""; }
        }
        line += char;
      }
      lines.push(line.trim());
    }
    invariant(lines.length <= 2 && lines.every(line => context.measureText(line).width <= maxWidth), "CODE_PLAN_RENDER_INPUT",
      `Caption ${index + 1}: text must fit at most 2 lines within ${Math.floor(maxWidth)} px at ${fontSize} px (1–80 characters); shorten it`);
    return { caption, font, fontSize, lines };
  });
}

export function rasterizeCaption(layout: CaptionLayout, width: number, height: number): Buffer {
  const { createCanvas } = canvasApi();
  const canvas = createCanvas(width, height), context = canvas.getContext("2d");
  const { caption, font, fontSize, lines } = layout;
  context.font = `bold ${fontSize}px "${font.family}"`;
  context.textAlign = "center"; context.textBaseline = "middle"; context.lineJoin = "round";
  context.fillStyle = "white"; context.strokeStyle = "rgba(0,0,0,0.9)"; context.lineWidth = Math.max(1, fontSize * 0.1);
  context.shadowColor = "rgba(0,0,0,0.65)"; context.shadowBlur = Math.max(1, fontSize * 0.14); context.shadowOffsetY = fontSize * 0.06;
  const center = height * (caption.position === "top" ? 0.12 : caption.position === "middle" ? 0.5 : 0.78), lineHeight = fontSize * 1.25;
  lines.forEach((line, index) => { const y = center + (index - (lines.length - 1) / 2) * lineHeight; context.strokeText(line, width / 2, y); context.fillText(line, width / 2, y); });
  return canvas.toBuffer("image/png");
}
