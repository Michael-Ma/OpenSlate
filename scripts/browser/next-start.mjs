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

/** No error toast is showing (a refusal inside a modal dialog is said there; the toast would sit behind its backdrop). */
async function noErrorToast(page, message) {
  const text = await page.locator(".toast[data-tone='error']").allInnerTexts();
  expect(text.length === 0, `${message}: ${JSON.stringify(text)}`);
}

/** The element is in front: what the pointer would hit at its centre is inside it (not under a backdrop). */
async function inFront(page, selector, message) {
  const hit = await page.locator(selector).first().evaluate((el) => {
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return !!top && el.contains(top);
  });
  expect(hit, message);
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

/** The row's ••• has focus (where a closed inline rename puts it back). */
async function focusOnMenu(page, id, message) {
  await page.waitForFunction((film) => document.activeElement?.matches(`.film-row[data-film='${film}'] [data-act='film-menu']`), id, { timeout: 3000 })
    .catch(async () => { throw new Error(`${message}; focus is on ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`); });
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
      await focusOnMenu(page, "night-bus", "Saving a rename did not put focus back on •••");
      // Esc leaves a rename without saving, and focus goes back to •••.
      await row(page, "night-bus").locator("[data-act='film-menu']").click();
      await page.click(".start-menu [data-act='menu-rename']");
      await row(page, "night-bus").locator("[data-act='rename-input']").fill("Never saved");
      await row(page, "night-bus").locator("[data-act='rename-input']").press("Escape");
      await expectText(page, ".film-row[data-film='night-bus'] h2", /^Night bus, take two$/);
      await focusOnMenu(page, "night-bus", "Esc in a rename did not put focus back on •••");
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
      // The collapsed line names each paid default with its price.
      await expectText(page, "dialog.start-sheet .impact", /all ready: Codex · gpt-6-astra Director \(uses your Codex plan\), OpenAI gpt-image-2 keyframes \(about \$0\.04 a keyframe\), MiniMax H3 video \(about \$0\.50 a clip\),/);
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
      // No film is open on a first run, so whether this computer has Codex is only known once a film is made.
      await expectText(page, ".welcome [data-card='own'] .setup", /Codex\s+checked when you make a film/);
      await expectText(page, ".welcome [data-card='own'] .setup", /Keys for media models\s+none set/);
      // The study always lists Codex, FFmpeg and keys.
      await expectText(page, ".welcome [data-card='own'] .setup", /FFmpeg · ffprobe\s+✓ found/);
      expect(await page.locator(".welcome [data-card='demo'] [data-act='open-demo']").evaluate((el) => el.classList.contains("primary")), "Open the demo film is not the primary action without keys");
      // A written plan waits for Codex to be found, so a pasted plan is never dropped; the button says why.
      const fromPlan = page.locator(".welcome [data-act='new-from-plan']");
      expect(await fromPlan.isDisabled(), "Bring a written plan is on although Codex is not known");
      const why = await fromPlan.evaluate((el) => document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? "");
      expect(why === "Needs the Codex Director, which is checked when you make a film", `Bring a written plan says ${JSON.stringify(why)}`);
      await noSidewaysScroll(page);
      await shot(page, "start-first-run-1440");
      // New film anyway: while Codex is unknown the empty outline is the default, the Codex steps stay possible
      // and say when Codex is checked; the models say they start as stand-ins.
      await page.click(".welcome [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      expect((await page.locator("dialog.start-sheet [data-step='empty']").getAttribute("aria-checked")) === "true", "The empty outline is not the default while Codex is unknown");
      expect(!(await page.locator("dialog.start-sheet [data-step='director']").isDisabled()), "Talk to the Director is off although Codex is not known to be missing");
      const planStep = page.locator("dialog.start-sheet [data-step='plan']");
      expect(await planStep.isDisabled(), "Bring a written plan can be chosen although Codex is not known");
      await expectText(page, "dialog.start-sheet [data-hint='codex-unknown']", /checked when the film is made\. A written plan can be brought from the film’s Plan once Codex is found/);
      expect((await planStep.getAttribute("aria-describedby")) === (await page.locator("dialog.start-sheet [data-hint='codex-unknown']").getAttribute("id")), "The off step does not point at its reason");
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
    // A real first run on a computer without Codex: the film is made, its Director step finds no Codex,
    // and that is final (no Try again); closing the sheet leaves the film in the list.
    name: "next-start-first-run-no-codex",
    query: `${FIXTURE}&start=first-run`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      await page.waitForSelector("main[data-view='start'] .welcome");
      await page.click(".welcome [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      await page.fill("dialog.start-sheet [data-act='film-name']", "Harbour");
      await page.click("dialog.start-sheet [data-step='director']");
      expect((await page.locator("dialog.start-sheet [data-step='director']").getAttribute("aria-checked")) === "true", "Talk to the Director could not be chosen");
      await page.click("dialog.start-sheet [data-act='create-film']");
      await expectText(page, "dialog.start-sheet .impact.cost", /Harbour was created, but Codex was not found on this computer, so the film starts with the stand-in Director\./);
      await noErrorToast(page, "An error toast sits behind the sheet");
      expect(await page.locator("dialog.start-sheet [data-act='create-film']").count() === 0, "Try again is offered although it cannot find Codex");
      const open = page.locator("dialog.start-sheet [data-act='open-created']");
      expect(await open.evaluate((el) => el.classList.contains("primary") && el === document.activeElement), "Open the film is not the focused primary action");
      await shot(page, "start-first-run-no-codex-1440");
      // Close: the film made before the Director step is in the list (and the first run is over).
      await page.click("dialog.start-sheet [data-act='sheet-close']");
      await page.waitForSelector("dialog.start-sheet", { state: "detached" });
      await page.waitForSelector("main[data-view='start'] .film-row h2");
      expect(JSON.stringify(await filmNames(page)) === JSON.stringify(["Harbour"]), `Films are ${JSON.stringify(await filmNames(page))}`);
      expect(await page.locator("main[data-view='start'] .welcome").count() === 0, "The welcome still shows with a film in the list");
      await row(page, "film-1").locator("[data-act='open-film']").click();
      await page.waitForSelector("main[data-view='plan']", { timeout: 10000 });
      await topFilm(page, "Harbour");
    },
  },
  {
    // Codex is here, but each new film's first setup check answers "busy": the sheet says the check is
    // still running, Try again finishes the same film, a failed sheet that is closed leaves its film
    // listed; an empty outline opens at once and sets its Director up afterwards, quietly.
    name: "next-start-setup-retry",
    query: `${FIXTURE}&start=setup-busy`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      await page.click("main[data-view='start'] [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      expect((await page.locator("dialog.start-sheet [data-step='director']").getAttribute("aria-checked")) === "true", "Talk to the Director is not the default with Codex");
      await page.keyboard.type("Crossing");
      await page.keyboard.press("Enter");
      await expectText(page, "dialog.start-sheet .impact.cost", /Crossing was created, and its Codex Director is still being checked\. Try again in a moment/);
      await noErrorToast(page, "An error toast sits behind the sheet");
      await inFront(page, "dialog.start-sheet .impact.cost", "The sheet's refusal is not in front");
      expect(await page.locator("dialog.start-sheet [data-act='create-film']").evaluate((el) => el === document.activeElement), "Try again does not have focus");
      await shot(page, "start-setup-failed-1440");
      // Esc closes it: the film is listed, not lost.
      await page.keyboard.press("Escape");
      await page.waitForSelector("dialog.start-sheet", { state: "detached" });
      await expectText(page, "main[data-view='start'] .film-row:first-child h2", /^Crossing$/);
      const count = (await filmNames(page)).length;
      // Try again finishes the same film: one film, opened in Plan with the Director ready.
      await page.click("main[data-view='start'] [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      await page.keyboard.type("Second crossing");
      await page.keyboard.press("Enter");
      await page.waitForSelector("dialog.start-sheet [data-act='open-created']");
      await page.click("dialog.start-sheet [data-act='create-film']");
      await page.waitForSelector("main[data-view='plan']", { timeout: 10000 });
      await expectText(page, ".toast", /Created Second crossing\. Tell the Director what the film is about\./);
      await topFilm(page, "Second crossing");
      await openStart(page);
      const names = await filmNames(page);
      expect(names.filter((name) => name === "Second crossing").length === 1 && names.length === count + 1, `Try again made a second film: ${JSON.stringify(names)}`);
      // An empty outline does not need the Director: a failed setup only means it starts with the stand-in.
      await page.click("main[data-view='start'] [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      await page.fill("dialog.start-sheet [data-act='film-name']", "Outline only");
      await page.click("dialog.start-sheet [data-step='empty']");
      await page.click("dialog.start-sheet [data-act='create-film']");
      await page.waitForSelector("main[data-view='plan']", { timeout: 10000 });
      await expectText(page, ".toast", /^Created Outline only\. Add its first scene in the Plan\./);
      // Its Director setup ran after it opened and was refused (busy) without a word: the toast is still the Created one.
      await page.waitForTimeout(400);
      await expectText(page, ".toast", /^Created Outline only\./);
      expect((await page.locator(".toast[data-tone='error']").count()) === 0, "The quiet Director setup left an error toast");
    },
  },
  {
    // Refusals while a modal dialog is open are said inside it, in front of the backdrop, not in the toast behind it.
    name: "next-start-refusals",
    query: `${FIXTURE}&start=refusals`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      const before = (await filmNames(page)).length;
      await page.click("main[data-view='start'] [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      await page.fill("dialog.start-sheet [data-act='film-name']", "Ferry two");
      await page.click("dialog.start-sheet [data-step='empty']");
      await expectText(page, "dialog.start-sheet .impact", /all ready/);
      await page.click("dialog.start-sheet [data-act='create-film']");
      await expectText(page, "dialog.start-sheet [data-alert='create'] [role='alert']", /^!?\s*The film was not created\. This computer’s models changed while the sheet was open\. Check them and create the film again\.$/);
      await noErrorToast(page, "An error toast sits behind the sheet");
      await inFront(page, "dialog.start-sheet [data-alert='create']", "The sheet's refusal is not in front");
      await shot(page, "start-refusal-create-1440");
      // The models were read again; Create now makes the film.
      await page.click("dialog.start-sheet [data-act='create-film']");
      await page.waitForSelector("main[data-view='plan']", { timeout: 10000 });
      await expectText(page, ".toast", /^Created Ferry two\./);
      await openStart(page);
      expect((await filmNames(page)).length === before + 1, "The refused Create made a film");
      // Archiving a film whose jobs run is refused; the dialog says so and stays open.
      await row(page, "night-bus").locator("[data-act='film-menu']").click();
      await page.click(".start-menu [data-act='menu-archive']");
      await page.click("dialog.start-dialog [data-act='archive-confirm']");
      await expectText(page, "dialog.start-dialog [role='alert']", /It was not archived\. Jobs are still running here\. Wait for them to finish, then try again\./);
      await noErrorToast(page, "An error toast sits behind the archive dialog");
      await inFront(page, "dialog.start-dialog [role='alert']", "The dialog's refusal is not in front");
      await shot(page, "start-refusal-archive-1440");
      await page.click("dialog.start-dialog [data-act='archive-cancel']");
      await page.waitForSelector("dialog.start-dialog", { state: "detached" });
      await row(page, "night-bus").waitFor();
    },
  },
  {
    // Create waits for this computer's models, so a film never gets the stand-ins only because the list was still being read.
    name: "next-start-models-loading",
    query: `${FIXTURE}&start=slow-models`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      await page.click("main[data-view='start'] [data-act='new-film']");
      await page.waitForSelector("dialog.start-sheet[open]");
      const create = page.locator("dialog.start-sheet [data-act='create-film']");
      // The sample answers the models 2.5 s after Start opened; the sheet opens well before that.
      expect(await page.locator("dialog.start-sheet .impact").count() === 0, "The models were already read; the scenario cannot check the wait");
      expect(await create.isDisabled(), "Create is on while this computer's models are read");
      expect((await create.getAttribute("title")) === "Reading this computer’s models…", `Create's title is ${await create.getAttribute("title")}`);
      // Enter in the name field does not create either.
      await page.keyboard.type("Too soon");
      await page.keyboard.press("Enter");
      await page.waitForTimeout(150);
      expect(await page.locator("dialog.start-sheet[open]").count() === 1, "Enter created a film before the models were read");
      await expectText(page, "dialog.start-sheet .impact", /all ready/, 8000);
      expect(!(await create.isDisabled()), "Create stays off after the models were read");
    },
  },
  {
    // A studio without the stand-in Director: the demo film is made but cannot be filled, so the demo
    // button turns off with its reason (also after leaving Start) instead of making more empty films.
    name: "next-start-demo-unavailable",
    query: `${FIXTURE}&start=no-stand-in`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openStart(page);
      const before = (await filmNames(page)).length;
      const demo = page.locator("main[data-view='start'] .view-head [data-act='open-demo']");
      await demo.click();
      await expectText(page, ".toast", /The demo needs the stand-in Director, which this studio does not have\./);
      await page.waitForFunction(() => document.querySelector("main[data-view='start'] .view-head [data-act='open-demo']")?.disabled === true);
      expect((await demo.getAttribute("title")) === "The demo needs the stand-in Director, which this studio does not have.", `The demo button says ${await demo.getAttribute("title")}`);
      expect((await filmNames(page)).length === before + 1, "The demo film was not listed");
      // Leave Start and come back: still off, and no second film.
      await page.click(".topbar [data-act='tab'][data-view='keyframes']");
      await page.waitForSelector("main.work[data-view='keyframes']");
      await openStart(page);
      await page.waitForSelector("main[data-view='start'] .film-row");
      expect(await page.locator("main[data-view='start'] .view-head [data-act='open-demo']").isDisabled(), "The demo button is on again after leaving Start");
      expect((await filmNames(page)).length === before + 1, "A second demo film was made");
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
