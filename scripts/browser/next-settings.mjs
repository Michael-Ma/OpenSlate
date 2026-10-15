// Next UI, Settings view, on the Last Ferry fixture film (?ui=next&fixture=last-ferry): nothing is checked,
// charged or saved. Layout numbers come from docs/ai/prototypes/last-ferry/settings.html at 1440 x 900.
// Set BROWSER_CHECK_SHOTS=/some/dir to also save screenshots of each scenario.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";

async function shot(page, name, options = {}) {
  const dir = process.env.BROWSER_CHECK_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`), ...options });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectText(page, selector, pattern, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    last = await page.locator(selector).first().innerText().catch(() => "");
    if (pattern.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} never matched ${pattern}; last text: ${JSON.stringify(last)}`);
}

/** Open Settings: the top bar's gear when the shell has it, otherwise the same store.setView("settings") through React's tree. */
async function openSettings(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  await page.waitForSelector(".topbar .film span", { timeout: 20000 });
  const gear = page.locator(".topbar [data-act='settings'], .topbar [data-view='settings']");
  if (await gear.count()) await gear.first().click();
  else {
    await page.evaluate(() => {
      const root = document.querySelector(".app");
      const key = Object.keys(root).find((name) => name.startsWith("__reactFiber$"));
      for (let fiber = root[key]; fiber; fiber = fiber.return) {
        const store = fiber.memoizedProps?.value?.store;
        if (store?.setView) { store.setView("settings"); return; }
      }
      throw new Error("No studio store in the React tree");
    });
  }
  await page.waitForSelector("main[data-view='settings'] #set-models .mtable", { timeout: 10000 });
  await page.waitForSelector("#set-voice .voice-card", { timeout: 10000 });
  await page.waitForSelector("#set-computer [data-row='key-openai']", { timeout: 10000 });
}

async function box(page, selector) {
  const value = await page.locator(selector).first().boundingBox();
  if (!value) throw new Error(`${selector} is not on screen`);
  return { left: value.x, top: value.y, right: value.x + value.width, bottom: value.y + value.height, width: value.width, height: value.height };
}

function near(name, actual, expected, tolerance = 6) {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${name} is ${Math.round(actual)}, expected ${expected} ± ${tolerance}`);
}

async function noSidewaysScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth <= innerWidth, `The page scrolls sideways: ${scrollWidth}px content in a ${innerWidth}px window`);
  const wide = await page.evaluate(() => [...document.querySelectorAll("main[data-view='settings'] *")]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth + 1 && !el.closest(".set-index, .segctl"); })
    .slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${el.className}`));
  expect(!wide.length, `Elements stick out past the right edge: ${wide.join(", ")}`);
}

const row = (page, job) => `#set-models .mrow[data-job='${job}']`;

async function focusedAct(page) {
  return page.evaluate(() => document.activeElement?.getAttribute("data-act") ?? document.activeElement?.id ?? document.activeElement?.tagName);
}

export const scenarios = [
  {
    name: "next-settings-layout",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      await shot(page, "settings-1440");
      // The study: index at 414, sections 616-1376, the Models panel under the title.
      const title = await box(page, "main[data-view='settings'] .view-head h1");
      near("title left", title.left, 414); near("title top", title.top, 67, 8);
      const index = await box(page, ".set-index");
      near("index left", index.left, 414); near("index width", index.width, 180, 2);
      const models = await box(page, "#set-models");
      near("sections left", models.left, 616); near("sections right", models.right, 1376); near("models top", models.top, 98, 8);
      const jobs = await page.locator("#set-models .mrow .job").allInnerTexts();
      expect(jobs.join("|") === "Director|Keyframes|Video|Narration|Transcription", `Jobs read ${jobs.join("|")}`);
      const prices = await page.locator("#set-models .mrow .price").allInnerTexts();
      expect(prices.join("|") === "uses your Codex plan|about $0.04 a keyframe|about $0.50 a clip|about $0.01 a voice line|about $0.01 a transcription", `Estimates read ${prices.join("|")}`);
      expect(!prices.some((p) => /\$0\.00/.test(p)), "An estimate reads $0.00");
      const ready = await page.locator("#set-models .mrow .ready.y").count();
      expect(ready === 5, `${ready} of 5 models read Ready`);
      // Not-ready models are listed but cannot be chosen, with their reason.
      const viggle = await page.locator(`${row(page, "video")} option[value='viggle-h3']`).evaluate((o) => ({ disabled: o.disabled, text: o.textContent }));
      expect(viggle.disabled && /key not set/.test(viggle.text), `The Viggle option is ${JSON.stringify(viggle)}`);
      // The work area scrolls; the page itself does not.
      const scroll = await page.evaluate(() => ({ page: document.documentElement.scrollHeight, inner: innerHeight }));
      expect(scroll.page <= scroll.inner, `The page scrolls: ${JSON.stringify(scroll)}`);
      // No amber in this view: it belongs to the Director's content.
      const amber = await page.evaluate(() => [...document.querySelectorAll("main[data-view='settings'] *")].some((el) => {
        const s = getComputedStyle(el);
        return [s.color, s.backgroundColor, s.borderTopColor].some((c) => c === "rgb(240, 178, 74)");
      }));
      expect(!amber, "Amber appears in the Settings view");
      // The rest of the page, for the side-by-side with the study.
      await page.locator("#set-computer").scrollIntoViewIfNeeded();
      await shot(page, "settings-1440-lower");
    },
  },
  {
    name: "next-settings-switch-model",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      const select = page.locator(`${row(page, "video")} select`);
      await select.selectOption("fake-video-v1");
      const impact = await expectText(page, `${row(page, "video")} .impact`, /Use Demo video for video\?/);
      expect(/5 clips not made yet \(2\.1, 2\.2, 2\.3, 3\.1, 3\.2\) would use it\./.test(impact), `Impact reads ${impact}`);
      expect(/The 3 clips already made stay as they are\./.test(impact), `Impact reads ${impact}`);
      expect(/Switching makes nothing and charges nothing\./.test(impact), `Impact does not say nothing is charged: ${impact}`);
      await expectText(page, `${row(page, "video")} .price`, /^free stand-in$/);
      await shot(page, "settings-1440-switch");
      // Cancel puts it back, and focus returns to the select.
      await page.click(`${row(page, "video")} [data-act='model-cancel']`);
      expect((await select.inputValue()) === "minimax-h3", "Cancel did not restore the saved model");
      expect(await page.locator(`${row(page, "video")} .impact`).count() === 0, "The impact stayed after Cancel");
      await page.waitForTimeout(50);
      expect((await focusedAct(page)) === "model", `Focus went to ${await focusedAct(page)} after Cancel`);
      // Switch applies it.
      await select.selectOption("fake-video-v1");
      await expectText(page, `${row(page, "video")} .impact`, /5 clips not made yet/);
      await page.click(`${row(page, "video")} [data-act='model-apply']`);
      await expectText(page, ".toast", /Video now uses Demo video\./);
      await page.waitForFunction(() => !document.querySelector("#set-models .mrow[data-job='video'] .impact"));
      expect((await select.inputValue()) === "fake-video-v1", "The switch did not stick");
      // A switch with nothing unfinished says only new work uses it.
      await page.locator(`${row(page, "transcription")} select`).selectOption("fake-transcription-v1");
      await expectText(page, `${row(page, "transcription")} .impact`, /only new work will use it/);
    },
  },
  {
    name: "next-settings-director",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      const toggle = page.locator("#set-director [data-act='review-toggle']");
      expect((await toggle.getAttribute("aria-checked")) === "true", "The review switch is not on");
      await toggle.click();
      await expectText(page, ".toast", /The Director will not look at new keyframes\./);
      await page.waitForFunction(() => document.querySelector("#set-director [data-act='review-toggle']")?.getAttribute("aria-checked") === "false");
      await toggle.click();
      await page.waitForFunction(() => document.querySelector("#set-director [data-act='review-toggle']")?.getAttribute("aria-checked") === "true");
      // Change… opens the Codex form; Saving checks Codex.
      await page.click("#set-director [data-act='director-edit']");
      await page.waitForSelector("#set-director form[data-form='director']");
      await page.waitForFunction(() => document.activeElement?.value === "/usr/local/bin/codex", null, { timeout: 3000 }).catch(() => { throw new Error("Change… did not focus the program field"); });
      await shot(page, "settings-1440-director-form");
      const program = page.locator("#set-director form input").first();
      await program.fill("codex");
      expect(await page.locator("#set-director [data-act='director-save']").isDisabled(), "Save is on with a relative program path");
      await program.fill("/usr/local/bin/codex");
      await page.locator("#set-director form select").selectOption("gpt-6-astra-mini");
      await page.click("#set-director [data-act='director-save']");
      await expectText(page, ".toast", /Codex runs and is signed in/);
      await expectText(page, "#set-director .kv", /gpt-6-astra-mini/);
      // Switching the Director to the demo from the Models row: impact first, then the review switch turns off with its reason.
      await page.locator(`${row(page, "director")} select`).selectOption("fake");
      await expectText(page, `${row(page, "director")} .impact`, /Use Demo Director as the Director\?.*next turn/);
      await page.click(`${row(page, "director")} [data-act='model-apply']`);
      await expectText(page, ".toast", /scripted demo/);
      await expectText(page, "#set-director [data-review-reason]", /Needs the Codex Director\./);
      expect(await toggle.isDisabled(), "The review switch is still on without the Codex Director");
      expect((await toggle.getAttribute("aria-checked")) === "false", "A disabled review switch still reads on");
      await expectText(page, "#set-director [data-act='director-edit']", /Set up Codex/);
    },
  },
  {
    name: "next-settings-voice",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      const narrator = page.locator("#set-voice [data-act='narrator']");
      expect((await narrator.inputValue()) === "cedar", "The narrator is not Cedar");
      await narrator.selectOption("marin");
      await expectText(page, ".toast", /New voice lines use Marin\./);
      await expectText(page, "#set-voice .undo-line", /Was Cedar/);
      await page.click("#set-voice [data-act='narrator-undo']");
      await page.waitForFunction(() => document.querySelector("#set-voice [data-act='narrator']")?.value === "cedar");
      // Adding a personal voice needs a name, an id and both consents.
      await page.click("#set-voice [data-act='voice-open']");
      const add = page.locator("#set-voice [data-act='voice-add']");
      await page.locator("#set-voice form[data-form='voice'] input.input").first().fill("Second take");
      await page.locator("#set-voice form[data-form='voice'] input.mono").fill("voice_take2");
      await page.check("#set-voice [data-act='consent-own']");
      expect(await add.isDisabled(), "Add voice is on with one consent");
      await expectText(page, "#set-voice .form-acts .hint", /Both confirmations are needed\./);
      await page.check("#set-voice [data-act='consent-permit']");
      await shot(page, "settings-1440-add-voice");
      expect(!(await add.isDisabled()), "Add voice is off with both consents");
      await add.click();
      await expectText(page, ".toast", /Added Second take\./);
      await page.waitForFunction(() => document.querySelectorAll("#set-voice .voice-card").length === 2);
      // Revoke asks first; Esc keeps it and focus returns to the button.
      const revoke = page.locator("#set-voice .voice-card", { hasText: "Second take" }).locator("[data-act='voice-revoke']");
      await revoke.click();
      await page.waitForSelector("dialog.set-dialog[open]");
      await expectText(page, "dialog.set-dialog", /Voice lines already made with it keep their audio\./);
      await shot(page, "settings-1440-revoke");
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog.set-dialog"));
      expect((await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))) === "Revoke Second take…", "Focus did not return to Revoke after Esc");
      await revoke.click();
      await page.click("dialog.set-dialog [data-act='revoke-confirm']");
      await expectText(page, ".toast", /Revoked Second take\./);
      await expectText(page, "#set-voice .voice-card.revoked", /Second take/);
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "voice-open");
    },
  },
  {
    name: "next-settings-computer-and-language",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      const rows = await page.locator("#set-computer .srow").evaluateAll((els) => els.map((el) => `${el.querySelector("b").textContent}: ${el.querySelector(".ready").textContent}`));
      expect(rows.join("|") === "Codex: ✓ Found|FFmpeg: ✓ Found|OpenAI key: ✓ Set|MiniMax key: ✓ Set|Viggle key: Not set", `This computer reads ${rows.join("|")}`);
      await expectText(page, "#set-computer [data-row='key-openai']", /Used by Keyframes, Narration, Transcription/);
      await expectText(page, "#set-computer .keys-note", /\.\/start\.sh --restart/);
      await page.click("#set-computer [data-act='recheck']");
      await expectText(page, ".toast", /Checked this computer\./);
      // The section index scrolls to a section and puts focus on its heading.
      await page.click(".set-index [data-section='set-language']");
      await page.waitForFunction(() => document.activeElement?.id === "set-language-h");
      expect((await page.locator(".set-index [data-section='set-language']").getAttribute("aria-current")) === "true", "The index does not mark Language");
      // Language: 中文, then back with the arrow keys.
      await page.click("#set-language [data-act='set-language'][data-v='zh-CN']");
      await expectText(page, "main[data-view='settings'] .view-head h1", /^设置$/);
      await expectText(page, "main[data-view='settings'] .view-head .line", /前三项只对《The Last Ferry》生效/);
      await expectText(page, `${row(page, "video")} .price`, /每段视频约 \$0\.50/);
      await page.locator("#set-models").scrollIntoViewIfNeeded();
      await shot(page, "settings-1440-zh");
      await page.focus("#set-language [data-act='set-language'][data-v='zh-CN']");
      await page.keyboard.press("ArrowLeft");
      await expectText(page, "main[data-view='settings'] .view-head h1", /^Settings$/);
    },
  },
  {
    name: "next-settings-medium",
    query,
    viewport: { width: 1024, height: 768 },
    async run({ page }) {
      await openSettings(page);
      await noSidewaysScroll(page);
      const index = await page.evaluate(() => getComputedStyle(document.querySelector(".set-index")).flexDirection);
      expect(index === "row", `Between 900 and 1279 px the index is a ${index}, not a row of pills`);
      const head = await box(page, "main[data-view='settings'] .view-head .line");
      const pills = await box(page, ".set-index");
      expect(pills.top >= head.bottom, `The section index (top ${pills.top}) overlaps the scope line (bottom ${head.bottom})`);
      await page.locator(`${row(page, "video")} select`).selectOption("fake-video-v1");
      await expectText(page, `${row(page, "video")} .impact`, /5 clips not made yet/);
      await noSidewaysScroll(page);
      await shot(page, "settings-1024");
    },
  },
  {
    name: "next-settings-narrow",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await openSettings(page);
      await noSidewaysScroll(page);
      const index = await page.evaluate(() => getComputedStyle(document.querySelector(".set-index")).flexDirection);
      expect(index === "row", `The section index is a ${index}, not a row of pills`);
      const display = await page.evaluate(() => getComputedStyle(document.querySelector("#set-models .mtable")).display);
      expect(display === "block", `The models table is ${display}, not stacked cards`);
      await shot(page, "settings-390", { fullPage: true });
      await page.locator(`${row(page, "video")} select`).selectOption("fake-video-v1");
      await expectText(page, `${row(page, "video")} .impact`, /5 clips not made yet/);
      await page.click("#set-voice [data-act='voice-open']");
      await page.click("#set-director [data-act='director-edit']");
      await noSidewaysScroll(page);
      await shot(page, "settings-390-open", { fullPage: true });
      await page.click("#set-language [data-act='set-language'][data-v='zh-CN']");
      await expectText(page, "main[data-view='settings'] .view-head h1", /^设置$/);
      await noSidewaysScroll(page);
      await shot(page, "settings-390-zh", { fullPage: true });
    },
  },
  {
    // The view against a real fixture studio (not the in-browser sample film), so the route shapes are the server's.
    // "Check again" is not pressed here: it would run the local Codex setup check.
    name: "next-settings-live",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    // The review switch's route arrives with server card B10; until then the view reads a 404 and says so.
    allowConsoleErrors: [/^HTTP 404 \/api\/projects\/[^/]+\/settings\/director-review$/],
    async run({ page }) {
      await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
      await page.waitForFunction(() => /scenes? ·/.test(document.querySelector(".topbar")?.textContent ?? ""), null, { timeout: 15000 });
      await page.evaluate(() => {
        const root = document.querySelector(".app");
        const key = Object.keys(root).find((name) => name.startsWith("__reactFiber$"));
        for (let fiber = root[key]; fiber; fiber = fiber.return) {
          const store = fiber.memoizedProps?.value?.store;
          if (store?.setView) { store.setView("settings"); return; }
        }
      });
      await page.waitForSelector("main[data-view='settings'] #set-models .mtable", { timeout: 15000 });
      const jobs = await page.locator("#set-models .mrow .job").allInnerTexts();
      expect(jobs.join("|") === "Director|Keyframes|Video|Narration|Transcription", `Jobs read ${jobs.join("|")}`);
      const prices = await page.locator("#set-models .mrow .price").allInnerTexts();
      expect(prices.every((p) => p && !/\$0\.00/.test(p)), `Estimates read ${prices.join("|")}`);
      await page.waitForSelector("#set-voice [data-act='narrator']", { timeout: 10000 });
      expect((await page.locator("#set-voice [data-act='narrator']").inputValue()) === "cedar", "The live narrator voice is not Cedar");
      await expectText(page, "#set-director [data-review-reason]", /later update|Codex Director/);
      expect(await page.locator("#set-director [data-act='review-toggle']").isDisabled(), "The review switch is on without its route");
      await page.waitForSelector("#set-computer [data-row='codex']", { timeout: 10000 });
      await shot(page, "settings-live-1440");
    },
  },
];
