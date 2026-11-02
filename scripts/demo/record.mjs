// JSON-lines browser recording driver. No provider credentials enter this process.
import { chromium } from "playwright-core";
import { createInterface } from "node:readline";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";

// Test runs live in the repository's git-ignored data/test-runs folder, one folder per run.
const run = new Date().toISOString().slice(0, 10).replaceAll("-", "");
const output = resolve(process.env.DEMO_RAW_DIR ?? join(import.meta.dirname, "../../data/test-runs", `${run}-demo`, "raw"));
const origin = process.env.DEMO_ORIGIN ?? "http://127.0.0.1:5173";
const target = new URL(origin);
if (target.hostname !== "127.0.0.1" || target.port === "3001" || target.protocol !== "http:") throw new Error("Use a loopback side instance, never port 3001.");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ locale: "en-US", viewport: { width: 1920, height: 1080 }, recordVideo: { dir: output, size: { width: 1920, height: 1080 } } });
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  return url.origin === target.origin || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const started = Date.now();
const events = [];
const save = () => writeFile(join(output, "recording.json"), JSON.stringify({ startedAt: new Date(started).toISOString(), events }, null, 2));
page.on("pageerror", error => { events.push({ at: (Date.now() - started) / 1000, error: error.message }); });
console.log(JSON.stringify({ ready: true, output }));
const commands = createInterface({ input: process.stdin });
try {
  for await (const line of commands) {
    if (!line.trim()) continue;
    let command;
    try {
      command = JSON.parse(line);
      let result;
      const locator = () => command.role ? page.getByRole(command.role, { name: command.name, exact: command.exact ?? true }) : page.locator(command.selector);
      switch (command.op) {
        case "pair": {
          const log = await readFile(command.log, "utf8");
          const match = log.match(/#connect=([A-Za-z0-9_-]+)/);
          if (!match) throw new Error("No pairing URL in side-instance log");
          await page.goto(`${origin}/#connect=${match[1]}`);
          await page.waitForSelector("[data-act=all-films]");
          break;
        }
        case "snapshot": result = await page.locator("body").innerText(); break;
        case "controls": result = await page.locator("button,input,textarea,select,a,video").evaluateAll(els => els.map(el => ({ tag: el.tagName, role: el.getAttribute("role"), text: (el.innerText || "").slice(0, 160), label: el.getAttribute("aria-label"), act: el.getAttribute("data-act"), placeholder: el.getAttribute("placeholder"), type: el.getAttribute("type"), value: el.value, disabled: el.disabled }))); break;
        case "click": await locator().click(); break;
        case "fill": await locator().fill(command.value); break;
        case "press": await locator().press(command.key); break;
        case "select": await locator().selectOption(command.value); break;
        case "scroll": await locator().scrollIntoViewIfNeeded(); break;
        case "wait": await page.waitForTimeout(Math.min(command.ms ?? 1000, 30000)); break;
        case "screenshot": await page.screenshot({ path: join(output, command.file ?? "current.png") }); break;
        case "mark": events.push({ at: (Date.now() - started) / 1000, stage: command.stage }); await save(); break;
        case "read": {
          if (!/^\/api\/projects\/[A-Za-z0-9_-]+\/(code-plan|conversation|overview)(\/versions\/\d+|\/steps\/[A-Za-z0-9_-]+)?$/.test(command.path)) throw new Error("Only project-scoped read endpoints are supported");
          const response = await page.request.get(origin + command.path);
          result = { status: response.status(), body: await response.json() };
          if (command.file) await writeFile(join(output, command.file), JSON.stringify(result, null, 2));
          break;
        }
        case "download": {
          const pending = page.waitForEvent("download");
          await locator().click();
          const download = await pending;
          await download.saveAs(resolve(command.path));
          result = { saved: resolve(command.path) };
          break;
        }
        case "close": break;
        default: throw new Error("Unknown recording command");
      }
      console.log(JSON.stringify({ op: command.op, ok: true, result }));
      if (command.op === "close") break;
    } catch (error) { console.log(JSON.stringify({ op: command?.op, ok: false, error: error.message })); }
  }
} finally {
  commands.close();
  process.stdin.pause();
  process.stdin.unref?.();
  const video = page.video();
  await context.close();
  events.push({ at: (Date.now() - started) / 1000, stage: "recording-end", video: await video.path() });
  await save();
  await browser.close();
}
