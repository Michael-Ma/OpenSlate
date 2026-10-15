// Next UI, Start view (the films on this computer), on the Last Ferry fixture (?ui=next&fixture=last-ferry):
// nothing is generated, charged or saved. Design: docs/ai/prototypes/last-ferry/start.html.
// Set BROWSER_CHECK_SHOTS=/some/dir to also save screenshots of each scenario.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const FIXTURE = "ui=next&fixture=last-ferry";

async function shot(page, name) {
  const dir = process.env.BROWSER_CHECK_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
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

async function noSidewaysScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth <= innerWidth, `The page scrolls sideways: ${scrollWidth}px content in a ${innerWidth}px window`);
}

/**
 * Open the Start view. The shell has no way there yet (the lead adds it), so use a real control when
 * one exists, else ask the studio store for the view directly, as the control would.
 */
async function openStart(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  await page.waitForSelector(".topbar .film span", { timeout: 20000 });
  const control = page.locator("[data-act='all-films'], [data-act='open-start']").first();
  if (await control.count()) await control.click();
  else {
    const found = await page.evaluate(() => {
      const root = document.getElementById("root");
      const key = root && Object.keys(root).find((name) => name.startsWith("__reactContainer$"));
      const stack = key ? [root[key]] : [];
      while (stack.length) {
        const fiber = stack.pop();
        if (!fiber) continue;
        const value = fiber.memoizedProps?.value;
        if (value?.store && typeof value.store.setView === "function") { value.store.setView("start"); return true; }
        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
      }
      return false;
    });
    expect(found, "Could not reach the studio store to open Start");
  }
  await page.waitForSelector("main.work[data-view='start'] .view-head h1", { timeout: 10000 });
}

const row = (page, id) => page.locator(`main[data-view='start'] .film-row[data-film='${id}']`);

/** The film the top bar shows: the picker's chosen option, or the plain title when there is one film. */
async function topFilm(page, name, timeout = 8000) {
  await page.waitForFunction((expected) => {
    const pick = document.querySelector(".topbar [data-act='project']");
    const shown = pick ? pick.selectedOptions[0]?.textContent : document.querySelector(".topbar .film b")?.textContent;
    return shown === expected;
  }, name, { timeout }).catch(async () => {
    const shown = await page.evaluate(() => { const pick = document.querySelector(".topbar [data-act='project']"); return pick ? pick.selectedOptions[0]?.textContent : document.querySelector(".topbar .film b")?.textContent; });
    throw new Error(`The top bar shows "${shown}", expected "${name}"`);
  });
}

async function filmNames(page) {
  return page.locator("main[data-view='start'] .film-row h2").allInnerTexts();
}

export const scenarios = [
  {
    name: "next-start-films",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      await page.waitForSelector("main[data-view='start'] .film-row");
      expect(JSON.stringify(await filmNames(page)) === JSON.stringify(["The Last Ferry", "Demo: The Last Ferry", "Night bus"]), `Films are ${JSON.stringify(await filmNames(page))}`);
      await expectText(page, "main[data-view='start'] .view-head .line", /^3 films on this computer$/);
      await expectText(page, ".film-row[data-film='last-ferry'] .meta", /^3 scenes · 8 shots · 48 s · changed today \d\d:\d\d$/);
      await expectText(page, ".film-row[data-film='last-ferry'] .prog", /3 of 8 clips made/);
      await expectText(page, ".film-row[data-film='night-bus'] .prog", /0 of 2 clips made/);
      expect(await row(page, "last-ferry").locator(".ticks i.on").count() === 3, "The Last Ferry does not show 3 green ticks");
      expect(await row(page, "last-ferry").locator("[data-act='open-film']").evaluate((el) => el.classList.contains("primary")), "The open film's Open is not the primary action");
      expect(!(await row(page, "night-bus").locator("[data-act='open-film']").evaluate((el) => el.classList.contains("primary"))), "Another film's Open is primary");
      // Layout from the study: the list starts beside the Director column, rows are at most 900 wide.
      const first = await row(page, "last-ferry").boundingBox();
      expect(Math.abs(first.x - 414) <= 2 && Math.abs(first.width - 900) <= 2, `First row is at ${first.x}, ${first.width} wide; expected 414, 900`);
      await noSidewaysScroll(page);
      await shot(page, "start-films-1440");

      // Archived films sit apart, folded.
      await expectText(page, "[data-act='toggle-archived']", /^Archived \(1\)$/);
      await page.click("[data-act='toggle-archived']");
      await expectText(page, ".arch-row[data-film='lighthouse-test']", /Lighthouse test.*1 shot · archived · its media stays on this computer/s);
      await shot(page, "start-films-archived-1440");

      // ••• opens the menu under its button; Rename edits in place; Enter saves; the toast says so.
      await row(page, "night-bus").locator("[data-act='film-menu']").click();
      await page.waitForSelector(".start-menu [data-act='menu-rename']");
      expect(await page.evaluate(() => document.activeElement?.dataset.act) === "menu-rename", "The menu's first item does not have focus");
      await shot(page, "start-films-menu-1440");
      await page.click(".start-menu [data-act='menu-rename']");
      const input = row(page, "night-bus").locator("[data-act='rename-input']");
      await input.waitFor();
      expect(await input.evaluate((el) => el === document.activeElement && el.selectionStart === 0 && el.selectionEnd === el.value.length), "The rename field is not focused with its name selected");
      await shot(page, "start-films-rename-1440");
      await input.fill("Night bus, take two");
      await input.press("Enter");
      await expectText(page, ".film-row[data-film='night-bus'] h2", /^Night bus, take two$/);
      await expectText(page, ".toast", /Renamed to Night bus, take two\./);
      // Esc leaves a rename without saving.
      await row(page, "night-bus").locator("[data-act='film-menu']").click();
      await page.click(".start-menu [data-act='menu-rename']");
      await row(page, "night-bus").locator("[data-act='rename-input']").fill("Never saved");
      await row(page, "night-bus").locator("[data-act='rename-input']").press("Escape");
      await expectText(page, ".film-row[data-film='night-bus'] h2", /^Night bus, take two$/);
      // The menu works from the keyboard: Enter opens it on its first item, arrows move, Esc returns to •••.
      const more = row(page, "demo-ferry").locator("[data-act='film-menu']");
      await more.focus();
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.activeElement?.dataset.act === "menu-rename");
      await page.keyboard.press("ArrowDown");
      expect(await page.evaluate(() => document.activeElement?.dataset.act) === "menu-archive", "ArrowDown did not move to Archive…");
      await page.keyboard.press("Escape");
      await page.waitForSelector(".start-menu", { state: "detached" });
      expect(await more.evaluate((el) => el === document.activeElement && el.getAttribute("aria-expanded") === "false"), "Esc did not close the menu back onto •••");
    },
  },
  {
    name: "next-start-archive-restore",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      const more = row(page, "night-bus").locator("[data-act='film-menu']");
      await more.click();
      await page.click(".start-menu [data-act='menu-archive']");
      await page.waitForSelector("dialog.start-dialog[open]");
      await expectText(page, "dialog.start-dialog h2", /^Archive Night bus\?$/);
      await shot(page, "start-archive-dialog-1440");
      // Esc closes it and focus goes back to •••.
      await page.keyboard.press("Escape");
      await page.waitForSelector("dialog.start-dialog", { state: "detached" });
      expect(await more.evaluate((el) => el === document.activeElement), "Focus did not return to ••• after the dialog closed");
      await more.click();
      await page.click(".start-menu [data-act='menu-archive']");
      await page.click("dialog.start-dialog [data-act='archive-confirm']");
      await page.waitForSelector("dialog.start-dialog", { state: "detached" });
      await expectText(page, ".toast", /Archived Night bus\. Its media stays on this computer\./);
      expect(await row(page, "night-bus").count() === 0, "Night bus is still in the list after archiving");
      await expectText(page, "main[data-view='start'] .view-head .line", /^2 films on this computer$/);
      await expectText(page, "[data-act='toggle-archived']", /^Archived \(2\)$/);
      await page.click("[data-act='toggle-archived']");
      await page.click(".arch-row[data-film='night-bus'] [data-act='restore-film']");
      await expectText(page, ".toast", /Restored Night bus\./);
      await row(page, "night-bus").waitFor();
      await expectText(page, "[data-act='toggle-archived']", /^Archived \(1\)$/);
      // The open film warns that it is open; archiving it is allowed while nothing runs.
      await row(page, "last-ferry").locator("[data-act='film-menu']").click();
      await page.click(".start-menu [data-act='menu-archive']");
      await expectText(page, "dialog.start-dialog", /It is the film open now/);
      await page.click("dialog.start-dialog [data-act='archive-cancel']");
    },
  },
  {
    name: "next-start-open-films",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      // A film with shots opens on Keyframes, and the top bar follows the switch.
      await row(page, "demo-ferry").locator("[data-act='open-film']").click();
      await page.waitForSelector("main.work[data-view='keyframes'] .preview .pic-img", { timeout: 15000 });
      await topFilm(page, "Demo: The Last Ferry");
      expect((await page.locator(".topbar [data-act='tab'][aria-selected='true']").getAttribute("data-view")) === "keyframes", "Keyframes is not the selected tab");
      // Back to the list: the demo film is now the open one.
      await openStart(page);
      expect(await row(page, "demo-ferry").locator("[data-act='open-film']").evaluate((el) => el.classList.contains("primary")), "The film just opened is not marked as open");
      await row(page, "last-ferry").locator("[data-act='open-film']").click();
      await page.waitForSelector("main.work[data-view='keyframes'] .preview .pic-img", { timeout: 15000 });
      await topFilm(page, "The Last Ferry");
    },
  },
  {
    name: "next-start-new-film-from-plan",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      await page.click("main[data-view='start'] [data-act='new-from-plan']");
      await page.waitForSelector("dialog.start-sheet[open]");
      expect(await page.locator("dialog.start-sheet [data-act='film-name']").evaluate((el) => el === document.activeElement), "The name field does not have focus");
      expect((await page.locator("dialog.start-sheet [data-step='plan']").getAttribute("aria-checked")) === "true", "Bring a written plan is not the chosen first step");
      await page.fill("dialog.start-sheet [data-act='film-name']", "Harbour lights");
      await page.fill("dialog.start-sheet [data-act='plan-text']", "Scene 1: the harbour at night. Scene 2: the ferry's lights in the fog.");
      await expectText(page, "dialog.start-sheet .plan-row .count", /^70 of 12,000 characters$/);
      await expectText(page, "dialog.start-sheet .impact", /all ready/);
      await page.click("dialog.start-sheet [data-act='see-models']");
      await expectText(page, "dialog.start-sheet .mrow[data-job='keyframes']", /OpenAI gpt-image-2\s+about \$0\.04 a keyframe\s+✓ ready/);
      await expectText(page, "dialog.start-sheet .mrow[data-job='director']", /Codex · gpt-6-astra/);
      await expectText(page, "dialog.start-sheet .sheet-foot", /Creating a film is free\./);
      await shot(page, "start-new-plan-1440");
      // Arrow keys move between first steps.
      await page.focus("dialog.start-sheet [data-step='plan']");
      await page.keyboard.press("ArrowDown");
      expect((await page.locator("dialog.start-sheet [data-step='empty']").getAttribute("aria-checked")) === "true", "ArrowDown did not choose the next step");
      await page.keyboard.press("ArrowUp");
      await page.click("dialog.start-sheet [data-act='create-film']");
      await page.waitForSelector("dialog.start-sheet", { state: "detached", timeout: 10000 });
      await page.waitForSelector("main[data-view='plan']", { timeout: 10000 });
      await topFilm(page, "Harbour lights");
      await expectText(page, ".toast", /Created Harbour lights\. The Director is reading the plan/);
      await openStart(page);
      await expectText(page, ".film-row:first-child h2", /^Harbour lights$/);
      await expectText(page, ".film-row:first-child .prog", /No shots yet/);
    },
  },
  {
    name: "next-start-new-film-director",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      await page.click("main[data-view='start'] [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      expect((await page.locator("dialog.start-sheet [data-step='director']").getAttribute("aria-checked")) === "true", "Talk to the Director is not the default first step");
      await page.keyboard.type("Last stop");
      await page.keyboard.press("Enter");
      await page.waitForSelector("main[data-view='plan']", { timeout: 10000 });
      await expectText(page, ".toast", /Created Last stop\. Tell the Director what the film is about\./);
      // The top bar switched to the new film (its picker lists it) once its snapshot is in.
      await topFilm(page, "Last stop");
      await page.waitForFunction(() => document.activeElement?.closest("#director") && document.activeElement.tagName === "TEXTAREA", null, { timeout: 5000 });
      // The new film's Director answers in its own thread.
      await page.keyboard.type("A short film about the last bus home.");
      // Sending waits for the new film's event stream to connect.
      await page.waitForSelector("#director [data-act='send']:not([disabled])", { timeout: 5000 });
      await page.keyboard.press("Enter");
      await expectText(page, "#director .thread", /Noted\. I would draft scenes and shots/, 8000);
      // Cancel and Esc close the sheet without making anything.
      await openStart(page);
      const count = (await filmNames(page)).length;
      await page.click("main[data-view='start'] [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      await page.keyboard.press("Escape");
      await page.waitForSelector("dialog.start-sheet", { state: "detached" });
      expect(await page.locator("main[data-view='start'] [data-act='new-film']").evaluate((el) => el === document.activeElement), "Focus did not return to New film");
      expect((await filmNames(page)).length === count, "Closing the sheet made a film");
    },
  },
  {
    name: "next-start-first-run-demo",
    query: `${FIXTURE}&start=first-run`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      await page.waitForSelector("main[data-view='start'] .welcome");
      await expectText(page, "main[data-view='start'] .view-head", /Welcome to OpenSlate/);
      await expectText(page, ".welcome [data-card='own'] .setup", /Codex\s+not found/);
      await expectText(page, ".welcome [data-card='own'] .setup", /Keys for keyframes, video, narration\s+none set/);
      expect(await page.locator(".welcome [data-card='demo'] [data-act='open-demo']").evaluate((el) => el.classList.contains("primary")), "Open the demo film is not the primary action without keys");
      expect(await page.locator(".welcome [data-act='new-from-plan']").isDisabled(), "Bring a written plan is on without Codex");
      await noSidewaysScroll(page);
      await shot(page, "start-first-run-1440");
      // New film anyway: only the empty outline is possible, and the models say they start as stand-ins.
      await page.click(".welcome [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      expect((await page.locator("dialog.start-sheet [data-step='empty']").getAttribute("aria-checked")) === "true", "The empty outline is not chosen without Codex");
      expect(await page.locator("dialog.start-sheet [data-step='director']").isDisabled(), "Talk to the Director is on without Codex");
      await expectText(page, "dialog.start-sheet .impact", /No keys are set, so this film starts with free stand-in models/);
      await page.click("dialog.start-sheet [data-act='see-models']");
      await expectText(page, "dialog.start-sheet .mrow[data-job='video']", /Stand-in\s+free stand-in\s+MiniMax H3: key not set/);
      await shot(page, "start-first-run-new-1440");
      await page.click("dialog.start-sheet [data-act='sheet-cancel']");
      await page.waitForSelector("dialog.start-sheet", { state: "detached" });
      // The demo makes its own film and opens it on Keyframes.
      await page.click(".welcome [data-act='open-demo']");
      await page.waitForSelector("main.work[data-view='keyframes'] .preview .pic-img", { timeout: 15000 });
      await topFilm(page, "Demo film");
      await expectText(page, ".toast", /Made Demo film\. The stand-in Director is filling it in; nothing is charged\./);
    },
  },
  {
    name: "next-start-narrow",
    query: FIXTURE,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await openStart(page);
      await page.waitForSelector("main[data-view='start'] .film-row");
      await noSidewaysScroll(page);
      const box = await row(page, "last-ferry").boundingBox();
      expect(box.x >= 15 && box.x + box.width <= 375, `The first row is not inside the 16 px gutters: ${JSON.stringify(box)}`);
      await shot(page, "start-films-390");
      await page.click("main[data-view='start'] [data-act='new-from-plan']");
      await page.waitForSelector("dialog.start-sheet[open]");
      await page.click("dialog.start-sheet [data-act='see-models']");
      await noSidewaysScroll(page);
      const sheet = await page.locator("dialog.start-sheet").boundingBox();
      expect(sheet.width <= 390 && sheet.x >= 0, `The sheet is ${sheet.width} wide at ${sheet.x}`);
      await shot(page, "start-new-390");
      await page.keyboard.press("Escape");
      await row(page, "night-bus").locator("[data-act='film-menu']").click();
      const menu = await page.locator(".start-menu").boundingBox();
      expect(menu.x >= 0 && menu.x + menu.width <= 390, `The menu leaves the screen: ${JSON.stringify(menu)}`);
      await page.click(".start-menu [data-act='menu-rename']");
      await noSidewaysScroll(page);
      await shot(page, "start-rename-390");
    },
  },
  {
    name: "next-start-first-run-narrow",
    query: `${FIXTURE}&start=first-run`,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await openStart(page);
      await page.waitForSelector("main[data-view='start'] .welcome");
      await noSidewaysScroll(page);
      await shot(page, "start-first-run-390");
    },
  },
  {
    name: "next-start-chinese",
    query: `${FIXTURE}&lang=zh-CN`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      await expectText(page, "main[data-view='start'] .view-head", /影片\s*本机有 3 部影片/);
      await expectText(page, "main[data-view='start'] .view-head .actions", /打开示例影片\s*从书面计划新建\s*新建影片/);
      await expectText(page, ".film-row[data-film='last-ferry'] .meta", /^3 场 · 8 个镜头 · 48 秒 · 今天 \d\d:\d\d 修改$/);
      await expectText(page, ".film-row[data-film='last-ferry'] .prog", /已生成 3\/8 段视频/);
      await shot(page, "start-films-zh-1440");
      await page.click("main[data-view='start'] [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      await page.click("dialog.start-sheet [data-act='see-models']");
      await expectText(page, "dialog.start-sheet .mrow[data-job='video']", /每段视频约 \$0\.50/);
      await noSidewaysScroll(page);
      await shot(page, "start-new-zh-1440");
    },
  },
];
