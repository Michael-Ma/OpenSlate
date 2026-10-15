// Browser checks against a disposable fixture studio. Never connects to port 3001.
// Usage: node scripts/browser-check.mjs [scenario-name ...]
// Needs a prior `pnpm build` and Google Chrome (driven through playwright-core's chrome channel).
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const repo = resolve(import.meta.dirname, "..");
const scenarioDir = join(repo, "scripts", "browser");

function freePort() {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => (port === 3001 ? freePort().then(done, fail) : done(port)));
    });
  });
}

function startStudio(port) {
  const child = spawn(process.execPath, ["scripts/storyboard-review.mjs", "--fixtures", "--port", String(port)], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const ready = new Promise((done, fail) => {
    let buffer = "";
    const timer = setTimeout(() => fail(new Error("Fixture studio did not start in 60 s.\n" + stderr)), 60000);
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n")) {
        if (!line.startsWith("{")) continue;
        try {
          const value = JSON.parse(line);
          if (typeof value.url === "string") { clearTimeout(timer); done(value); }
        } catch { /* partial line */ }
      }
    });
    child.once("exit", (code) => { clearTimeout(timer); fail(new Error(`Fixture studio exited with ${code}.\n${stderr}`)); });
  });
  return { child, ready };
}

async function loadScenarios(selected) {
  const files = readdirSync(scenarioDir).filter((file) => file.endsWith(".mjs")).sort();
  const scenarios = [];
  for (const file of files) {
    const module = await import(pathToFileURL(join(scenarioDir, file)).href);
    for (const scenario of module.scenarios ?? []) if (!selected.length || selected.includes(scenario.name)) scenarios.push(scenario);
  }
  return scenarios;
}

const scenarios = await loadScenarios(process.argv.slice(2));
if (!scenarios.length) throw new Error("No browser scenarios selected.");
const browser = await chromium.launch({ channel: "chrome", headless: true });
let failed = 0;
try {
  for (const scenario of scenarios) {
    // A fresh studio per scenario: launch codes are single-use and state must not leak between scenarios.
    const port = await freePort();
    const studio = startStudio(port);
    const context = await browser.newContext({ viewport: scenario.viewport ?? { width: 1440, height: 900 } });
    const page = await context.newPage();
    const consoleErrors = [];
    // Chrome reports failed requests as a bare "Failed to load resource"; log the response instead so the URL is visible.
    page.on("console", (message) => { if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) consoleErrors.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 400) consoleErrors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    page.on("pageerror", (error) => consoleErrors.push(String(error)));
    const started = Date.now();
    try {
      const { url, projectId } = await studio.ready;
      const origin = new URL(url).origin;
      await page.goto(scenario.ui ? `${origin}/?ui=${scenario.ui}${new URL(url).hash}` : url);
      await scenario.run({ page, origin, projectId });
      const allowed = scenario.allowConsoleErrors ?? [];
      const unexpected = consoleErrors.filter((text) => !allowed.some((pattern) => pattern.test(text)));
      if (unexpected.length) throw new Error("Console errors:\n" + unexpected.join("\n"));
      console.log(`ok   ${scenario.name} (${Date.now() - started} ms)`);
    } catch (error) {
      failed++;
      console.log(`FAIL ${scenario.name}\n     ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n     ")}`);
      await page.screenshot({ path: join(tmpdir(), `openslate-browser-check-${scenario.name}.png`) }).catch(() => {});
    } finally {
      await context.close();
      studio.child.kill("SIGTERM");
      await new Promise((done) => { studio.child.once("exit", done); setTimeout(done, 5000); });
    }
  }
} finally {
  await browser.close();
}
console.log(`${scenarios.length - failed} of ${scenarios.length} browser scenarios passed`);
process.exitCode = failed ? 1 : 0;
