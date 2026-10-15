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

/** The studio store from React's tree, as a handle: scenarios use it to make the film move on, or to close it. */
async function studioStore(page) {
  return page.evaluateHandle(() => {
    const root = document.querySelector(".app");
    const key = Object.keys(root).find((name) => name.startsWith("__reactFiber$"));
    for (let fiber = root[key]; fiber; fiber = fiber.return) {
      const store = fiber.memoizedProps?.value?.store;
      if (store?.setView) return store;
    }
    throw new Error("No studio store in the React tree");
  });
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
      // The index follows the scroll: This computer fills the end of the page.
      await page.waitForFunction(() => document.querySelector(".set-index [data-section='set-computer']")?.getAttribute("aria-current") === "true", null, { timeout: 3000 })
        .catch(() => { throw new Error("The index does not mark This computer at the end of the page"); });
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
      // The select names its estimate and status for a screen reader.
      const described = await select.evaluate((el) => (el.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" | "));
      expect(/free stand-in/.test(described) && /Ready/.test(described), `The video select is described as ${JSON.stringify(described)}`);
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
    // Studio events do not make a check stale by themselves; the server refuses a switch when the film's pending work
    // changed since the check, and then the row stops offering it and keeps keyboard focus.
    name: "next-settings-stale-switch",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      const video = row(page, "video");
      await page.locator(`${video} select`).selectOption("fake-video-v1");
      await expectText(page, `${video} .impact`, /5 clips not made yet/);
      expect(await page.locator(`${video} [data-act='model-apply']`).isEnabled(), "Switch is off after the check");
      // An event that changes no work (the review setting) keeps Switch.
      const store = await studioStore(page);
      const cursor = await store.evaluate((s) => s.getState().overview.cursor);
      const review = (on) => page.waitForFunction((value) => document.querySelector("#set-director [data-act='review-toggle']")?.getAttribute("aria-checked") === value, String(on));
      await page.click("#set-director [data-act='review-toggle']");
      await review(false);
      await page.waitForTimeout(200);
      expect((await store.evaluate((s) => s.getState().overview.cursor)) > cursor, "Turning the review setting off made no studio event");
      expect(await page.locator(`${video} .impact-row[data-stale]`).count() === 0, "An unrelated event made the check stale");
      expect(await page.locator(`${video} [data-act='model-apply']`).isEnabled(), "Switch went away after an unrelated event");
      await page.click("#set-director [data-act='review-toggle']");
      await review(true);
      // Scene 3's keyframes start (simulated): the settings look the same, the pending work does not, so the server refuses.
      await store.evaluate((s) => s.makeKeyframes(s.getState().overview.scenes[2].sceneId));
      await page.click(`${video} [data-act='model-apply']`);
      await expectText(page, ".toast", /The model settings changed\. Check the switch again\./);
      await expectText(page, `${video} .impact-row[data-stale]`, /The film or its settings changed since this check\./);
      expect(await page.locator(`${video} [data-act='model-apply']`).count() === 0, "Switch is still offered on a refused check");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "model-recheck", null, { timeout: 3000 })
        .catch(async () => { throw new Error(`Focus went to ${await focusedAct(page)} after the refused switch, not to Check again`); });
      await shot(page, "settings-1440-stale");
      // Once the keyframes are back, Check again reads the film as it is now, and Switch applies.
      await store.evaluate((s) => new Promise((resolve) => {
        const done = () => Object.values(s.getState().overview.shots).every((shot) => shot.keyframe.state !== "running");
        if (done()) return resolve();
        const stop = s.subscribe(() => { if (done()) { stop(); resolve(); } });
      }));
      await page.waitForTimeout(300);
      await page.click(`${video} [data-act='model-recheck']`);
      await expectText(page, `${video} .impact-row:not([data-stale]) .impact`, /Use Demo video for video\?/);
      await page.click(`${video} [data-act='model-apply']`);
      await expectText(page, ".toast", /Video now uses Demo video\./);
      await page.waitForFunction(() => !document.querySelector("#set-models .mrow[data-job='video'] .impact"));
      // Choosing A, then B, then A again while A is still being checked waits for A's check instead of failing.
      const image = page.locator(`${row(page, "image")} select`);
      await image.selectOption("codex-image");
      await image.selectOption("fake-image-v1");
      await image.selectOption("codex-image");
      await expectText(page, `${row(page, "image")} .impact`, /Use Codex image · gpt-6-astra for keyframes\?/);
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
      const save = page.locator("#set-director [data-act='director-save']");
      await program.fill("");
      expect(await save.isDisabled(), "Save is on with no program");
      const why = await save.evaluate((el) => (el.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
      expect(/No Codex program found\. Enter its full path, starting with \//.test(why), `Save is off without saying why: ${JSON.stringify(why)}`);
      await program.fill("codex");
      expect(await save.isDisabled(), "Save is on with a relative program path");
      await program.fill("/usr/local/bin/codex");
      await page.locator("#set-director form select").selectOption("gpt-6-astra-mini");
      await page.click("#set-director [data-act='director-save']");
      await expectText(page, ".toast", /Codex runs and is signed in/);
      await expectText(page, "#set-director .kv", /gpt-6-astra-mini/);
      // Switching the Director to the demo from the Models row: impact first. The review setting stays as saved (the
      // server reviews every film's batches; the demo's reviews are scripted and free) and can still be changed.
      await page.locator(`${row(page, "director")} select`).selectOption("fake");
      await expectText(page, `${row(page, "director")} .impact`, /Use Demo Director as the Director\?.*next turn/);
      await page.click(`${row(page, "director")} [data-act='model-apply']`);
      await expectText(page, ".toast", /scripted demo/);
      await expectText(page, "#set-director [data-act='director-edit']", /Set up Codex/);
      await expectText(page, "#set-director [data-review-note]", /scripted notes: free/);
      expect((await toggle.getAttribute("aria-checked")) === "true", "The review switch no longer shows the saved setting");
      expect(!(await toggle.isDisabled()), "The review switch cannot be turned off with the Demo Director");
      expect(await page.locator("#set-director [data-review-reason]").count() === 0, "The review switch gives a reason with the Demo Director");
      await toggle.click();
      await page.waitForFunction(() => document.querySelector("#set-director [data-act='review-toggle']")?.getAttribute("aria-checked") === "false");
      await shot(page, "settings-1440-director-demo");
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
      const toast = await box(page, ".toast");
      expect(toast.bottom > 900 - 40, `The toast sits at ${Math.round(toast.top)}-${Math.round(toast.bottom)}, not at the foot of the workspace`);
      await expectText(page, "#set-voice .undo-line", /Was Cedar/);
      await page.click("#set-voice [data-act='narrator-undo']");
      await page.waitForFunction(() => document.querySelector("#set-voice [data-act='narrator']")?.value === "cedar");
      // Adding a personal voice needs a name, an id and both consents.
      await page.click("#set-voice [data-act='voice-open']");
      // The section index follows the scroll, not only the last link pressed.
      await page.locator("#set-voice").evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForFunction(() => document.querySelector(".set-index [data-section='set-voice']")?.getAttribute("aria-current") === "true", null, { timeout: 3000 })
        .catch(() => { throw new Error("The index does not mark Voice while it is at the top"); });
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
      await expectText(page, "#set-computer [data-row='key-openai']", /Used by keyframes, narration, transcription/);
      await expectText(page, "#set-computer .keys-note", /\.\/start\.sh --restart/);
      await page.click("#set-computer [data-act='recheck']");
      await expectText(page, ".toast", /Checked this computer\./);
      // The section index scrolls to a section and puts focus on its heading, with a visible ring for keyboard users.
      await page.focus(".set-index [data-section='set-language']");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.activeElement?.id === "set-language-h");
      const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      expect(ring !== "none", "The section heading has no focus ring after a keyboard jump");
      // Only the chosen language is in the tab order, like a native radio group.
      const tabs = await page.locator("#set-language [role='radio']").evaluateAll((els) => els.map((el) => `${el.dataset.v}:${el.tabIndex}`));
      expect(tabs.join("|") === "en:0|zh-CN:-1", `The language radios' tab order is ${tabs.join("|")}`);
      expect((await page.locator(".set-index [data-section='set-language']").getAttribute("aria-current")) === "true", "The index does not mark Language");
      // Once the jump lands at the end of the page, the chosen section stays marked.
      await page.waitForTimeout(1100);
      expect((await page.locator(".set-index [data-section='set-language']").getAttribute("aria-current")) === "true", "The index lost Language after the jump landed");
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
      const broken = await page.locator("#set-computer .keys-note code").evaluateAll((els) => els.filter((el) => el.getClientRects().length > 1).map((el) => el.textContent));
      expect(!broken.length, `Commands break across lines: ${broken.join(", ")}`);
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
    // Settings with no film open (the gear on Start): the film sections say so; This computer and Language work.
    name: "next-settings-no-film",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      const store = await studioStore(page);
      await store.evaluate((s) => s.dispatch({ type: "project", projectId: null }));
      await expectText(page, "main[data-view='settings'] .view-head .line", /^No film is open\. The first three are set for each film/);
      for (const section of ["set-models", "set-director", "set-voice"]) await expectText(page, `#${section} [data-no-film]`, /Open a film to/);
      expect(await page.locator("#set-models select, #set-voice select, #set-director form").count() === 0, "A film control shows with no film open");
      expect((await page.locator(".set-index [data-section='set-computer']").getAttribute("aria-current")) === "true", "The index does not mark This computer");
      await expectText(page, "#set-computer [data-row='codex']", /Codex is checked inside a film\..*Not checked/s);
      await expectText(page, "#set-computer [data-row='key-openai']", /Used by keyframes, narration, transcription/);
      const computer = await box(page, "#set-computer");
      expect(computer.top < 300, `This computer is at ${Math.round(computer.top)}, not scrolled into view`);
      await shot(page, "settings-1440-no-film");
      await page.click("#set-computer [data-act='recheck']");
      await expectText(page, ".toast", /Checked this computer\./);
      await page.click("#set-language [data-act='set-language'][data-v='zh-CN']");
      await expectText(page, "main[data-view='settings'] .view-head .line", /^没有打开的影片。/);
    },
  },
  {
    // The view against a real fixture studio (not the in-browser sample film), so the route shapes are the server's.
    // "Check again" is not pressed here: it would run the local Codex setup check.
    name: "next-settings-live",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
      await page.waitForFunction(() => /scenes? ·/.test(document.querySelector(".topbar")?.textContent ?? ""), null, { timeout: 15000 });
      // The review setting's real POST: body, head version and Idempotency-Key, answered by the server.
      const reviewPosts = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/settings/director-review")) reviewPosts.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] ?? "" });
      });
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
      // GET /settings/director-review answers the saved setting, on by default, for any Director.
      const toggle = page.locator("#set-director [data-act='review-toggle']");
      await page.waitForFunction(() => document.querySelector("#set-director [data-act='review-toggle']")?.getAttribute("aria-checked") === "true", null, { timeout: 10000 })
        .catch(async () => { throw new Error(`The review switch reads ${await toggle.getAttribute("aria-checked")}, not the server's default (on)`); });
      expect(!(await toggle.isDisabled()), "The review switch cannot be turned off");
      await toggle.click();
      await expectText(page, ".toast", /The Director will not look at new keyframes\./);
      await page.waitForFunction(() => document.querySelector("#set-director [data-act='review-toggle']")?.getAttribute("aria-checked") === "false");
      await toggle.click();
      await page.waitForFunction(() => document.querySelector("#set-director [data-act='review-toggle']")?.getAttribute("aria-checked") === "true");
      expect(reviewPosts.length === 2, `${reviewPosts.length} review POSTs were sent`);
      expect(reviewPosts.every((p) => typeof p.body.expectedHeadVersion === "number" && Object.keys(p.body).sort().join() === "enabled,expectedHeadVersion" && p.key.length > 0), `Review POSTs: ${JSON.stringify(reviewPosts)}`);
      expect(reviewPosts.map((p) => p.body.enabled).join() === "false,true", `Review POSTs: ${JSON.stringify(reviewPosts)}`);
      await page.waitForSelector("#set-computer [data-row='codex']", { timeout: 10000 });
      await shot(page, "settings-live-1440");
    },
  },
];
