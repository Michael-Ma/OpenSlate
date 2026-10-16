// Next studio shell checks: top bar, tabs, Settings and All films, language, the narrow drawer, Connect,
// the film-wide strip (stopped, offline, restart casualties), Stop and its confirm, the session-expired dialog,
// and no sideways scroll from 900 to 1366 px in every view. The Keyframes inspector draws every row and action whole
// at common window sizes, and the preview shows the whole frame on a narrow stage.
// Set BROWSER_CHECK_SHOTS=/some/dir to also save screenshots of each scenario.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { inspectorWhole, previewWholeFrame } from "./inspector-whole.mjs";

const FIXTURE = "ui=next&fixture=last-ferry";
const LIVE = "ui=next";
const VIEWS = ["plan", "keyframes", "assets", "film"];

async function shot(page, name) {
  const dir = process.env.BROWSER_CHECK_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

/** The shell is up and the film's overview has been read (the counts come from it). */
async function ready(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  await page.waitForSelector(".topbar .counts", { timeout: 20000, state: "attached" });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function until(page, read, test, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`${message}; last: ${JSON.stringify(last)}`);
}

/**
 * Answer a request with the studio's own JSON, changed by `change`. A request the reload cut off (its response
 * already disposed) is left alone.
 */
async function rewrite(route, change) {
  try {
    const response = await route.fetch();
    const json = await response.json();
    change(json);
    await route.fulfill({ response, json });
  } catch {
    await route.abort().catch(() => {});
  }
}

const tab = (page, view) => page.locator(`.topbar [data-act='tab'][data-view='${view}']`);

/** Open a view the way a person would: a tab, the gear, or the mark. Start has no tabs, so a tab is reached through Settings. */
async function openView(page, view) {
  if (view === "settings") await page.locator(".topbar [data-act='settings']").click();
  else if (view === "start") await page.locator(".topbar [data-act='all-films']").click();
  else {
    if (!(await tab(page, view).count())) await page.locator(".topbar [data-act='settings']").click();
    await tab(page, view).click();
  }
  await page.waitForSelector(`.app[data-view='${view}']`);
}
// A number and its unit are joined by a no-break space (i18n keepTogether); it reads as a space here.
const text = (page, selector) => page.locator(selector).first().innerText().then((value) => value.replaceAll("\u00a0", " ")).catch(() => "");
const strip = (page) => page.locator(".film-strip-slot .film-strip");

async function noSidewaysScroll(page, where = "") {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth <= innerWidth, `The page scrolls sideways${where ? ` (${where})` : ""}: ${scrollWidth}px content in a ${innerWidth}px window`);
}

/** Measure actual rendered text and hit targets: a priced action may wrap, but every line must stay visible. */
async function pricedActionsFit(page, width) {
  expect(await page.locator(".card .callout .link").count() > 0, `No priced card callout is present at ${width}`);
  expect(await page.locator(".insp-actions [data-act='regen']").count() === 1, `The inspector purchase action is missing at ${width}`);
  const actions = page.locator(".card .callout .link, .insp-actions .pill");
  for (let index = 0; index < await actions.count(); index++) {
    const action = actions.nth(index);
    // At phone widths the cards scroll inside their row and the inspector is further down the page.
    await action.scrollIntoViewIfNeeded();
    const layout = await action.evaluate((button) => {
      const box = (element) => {
        const { left, top, right, bottom } = element.getBoundingClientRect();
        return { left, top, right, bottom };
      };
      const textRects = (element, clamped = false) => {
        if (!element) return [];
        const clip = element.getBoundingClientRect();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const rects = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          // Text for screen readers only is not drawn.
          if (!node.textContent.trim() || node.parentElement?.closest(".sr-only")) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) {
            // Only picture captions are intentionally clamped. Buttons must show every text line.
            if (!clamped || (rect.top < clip.bottom && rect.bottom > clip.top)) rects.push({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom });
          }
        }
        return rects;
      };
      const callout = button.closest(".callout-note");
      const picture = callout && button.closest(".card").querySelector(".pic");
      const rect = box(button);
      const hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      return {
        // The inspector's price is the note that describes its button; a card link carries its own.
        text: [button.textContent, ...(button.getAttribute("aria-describedby") || "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "")].join(" ").trim(), rect, bounds: box(picture || button.closest(".insp")), lines: textRects(button),
        paid: !!callout || button.getAttribute("data-act") === "regen",
        callout: !!callout,
        blockers: !picture ? [] : [
          { name: "shot badge", rect: box(picture.querySelector(".badge")) },
          { name: "note chip", rect: box(callout.querySelector(".anno")) },
          ...textRects(picture.querySelector(".ptxt"), true).map((rect) => ({ name: "picture caption", rect })),
        ],
        scroll: [button.scrollWidth, button.clientWidth, button.scrollHeight, button.clientHeight],
        hit: hit === button || button.contains(hit),
      };
    });
    const where = `${layout.callout ? "note link" : "inspector action"} at ${width}`;
    const detail = JSON.stringify(layout);
    const contains = (outer, inner) => inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
    const overlaps = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    expect(!layout.paid || /\$[\d.]+/.test(layout.text), `A paid ${where} has no price: ${layout.text}`);
    expect(contains(layout.bounds, layout.rect), `A priced ${where} leaves its picture/panel: ${detail}`);
    expect(layout.lines.length > 0 && layout.lines.every((line) => contains(layout.rect, line)), `A priced ${where} clips its text: ${detail}`);
    expect(layout.scroll[0] <= layout.scroll[1] + 1 && layout.scroll[2] <= layout.scroll[3] + 1, `A priced ${where} hides overflowing text: ${detail}`);
    expect(layout.blockers.every((blocker) => !overlaps(layout.rect, blocker.rect)), `A priced ${where} overlaps a badge or caption: ${detail}`);
    expect(layout.hit, `A priced ${where} is not clickable: ${detail}`);
    // A card's link is one line where the card has room (two lines would cover the picture it is about); on the
    // two-card rows below 1100 the price may take a second line, never more.
    const lineLimit = typeof width === "number" && width >= 1100 ? 24 : 42;
    expect(!layout.callout || layout.rect.bottom - layout.rect.top <= lineLimit, `A note's link wraps onto the picture at ${width}: ${detail}`);
  }
}

/**
 * Every shot card holds its footer: one title line, the seconds with their unit, the status pill and the motion
 * inside the card, and the motion never squeezed below a word. The prompt over the picture shows whole lines only
 * (no slice of a clamped third line), and the badge and the note chips sit side by side, tops aligned.
 */
async function cardsFit(page, where) {
  const problems = await page.evaluate(() => {
    const out = [];
    const rect = (element) => element.getBoundingClientRect();
    for (const card of document.querySelectorAll(".kf-row .card[data-card]")) {
      const id = card.getAttribute("data-card");
      const outer = rect(card);
      for (const part of card.querySelectorAll(".ttl, .stl, .ttl > *, .stl > *")) {
        const r = rect(part);
        if (r.left < outer.left - 0.5 || r.right > outer.right + 0.5 || r.bottom > outer.bottom - 0.5) out.push(`${id}: "${part.textContent}" leaves the card`);
      }
      const title = card.querySelector(".ttl b");
      const seconds = card.querySelector(".ttl span");
      if (title && rect(title).height > 24) out.push(`${id}: the title wraps (${rect(title).height}px)`);
      if (seconds && rect(seconds).height > 24) out.push(`${id}: the seconds break from their unit`);
      const motion = card.querySelector(".stl > span:last-child");
      if (motion && motion.textContent && rect(motion).width < Math.min(motion.scrollWidth, 40)) out.push(`${id}: the motion is squeezed to ${rect(motion).width}px`);
      const caption = card.querySelector(".pic .ptxt");
      if (caption) {
        const style = getComputedStyle(caption);
        const box = rect(caption);
        const clip = { top: box.top + parseFloat(style.borderTopWidth), bottom: box.bottom - parseFloat(style.borderBottomWidth) };
        const range = document.createRange();
        range.selectNodeContents(caption);
        for (const line of range.getClientRects()) {
          const shown = Math.min(line.bottom, clip.bottom) - Math.max(line.top, clip.top);
          if (shown > 1 && shown < line.height - 1) out.push(`${id}: a prompt line is sliced (${Math.round(shown)} of ${Math.round(line.height)}px show)`);
        }
      }
      const badge = card.querySelector(".pic .badge");
      for (const chip of card.querySelectorAll(".callout .anno")) {
        const a = rect(badge), b = rect(chip);
        if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5) out.push(`${id}: a note chip overlaps the badge`);
        if (Math.abs(a.top - b.top) > 1.5 && chip === card.querySelector(".callout .anno")) out.push(`${id}: the chip and the badge are not aligned (${a.top} vs ${b.top})`);
      }
    }
    return out;
  });
  expect(!problems.length, `Shot cards break at ${where}: ${problems.join("; ")}`);
}

/**
 * The banner's Now / After strip fits its row: every segment inside it, a label that does not fit ends with "…"
 * (never cut through a glyph), and the title keeps each number with its unit on one line. The strip refits a frame
 * after its row resizes, so a new window size gets a moment to settle.
 */
async function stripFits(page, where) {
  const problems = await until(page, () => stripProblems(page), (list) => !list.length, `The banner's strip breaks at ${where}`, 2000).catch((error) => [error.message]);
  expect(!problems.length, problems.join("; "));
}

function stripProblems(page) {
  return page.evaluate(() => {
    const out = [];
    for (const segs of document.querySelectorAll(".banner .tl .segs")) {
      const row = segs.getBoundingClientRect();
      for (const seg of segs.querySelectorAll(":scope > .seg")) {
        const r = seg.getBoundingClientRect();
        if (r.right > row.right + 0.5) out.push(`"${seg.textContent}" runs past the strip (${Math.round(r.right)} > ${Math.round(row.right)})`);
        if (seg.scrollWidth > seg.clientWidth + 1 && getComputedStyle(seg).textOverflow !== "ellipsis") out.push(`"${seg.textContent}" is cut without an ellipsis`);
      }
    }
    for (const keep of document.querySelectorAll(".banner h2 .keep, .banner .sub .keep")) if (keep.getClientRects().length > 1) out.push(`"${keep.textContent}" breaks across lines`);
    return out;
  });
}

/**
 * Scene 2 of the sample film: open its frames, settle 2.3's line through the Director's note (the proposal
 * choice) and make its three clips (one sent, two queued).
 */
async function makeSceneTwoVideo(page) {
  await page.waitForSelector("main.work[data-view='keyframes'] .preview .pic-img", { timeout: 20000 });
  for (const label of ["2-2", "2-3"]) {
    await page.click(`.card [data-act='open-shot'][data-shot='shot-${label}']`);
    await until(page, () => text(page, `[data-card='shot-${label}'] .stl`), (value) => /Opened/.test(value), `${label} never opened`);
  }
  await page.click('.banner [data-act="note-choice"][data-note="note-b"][data-kind="proposal"]');
  await page.waitForSelector('.banner[data-note="note-b"][data-state="settled"]');
  await until(page, () => page.locator("[data-act='confirm-video']").isDisabled(), (disabled) => !disabled, "Confirm stayed disabled");
  await page.click("[data-act='confirm-video']");
  await page.locator(".topbar [data-act='stop-film']").waitFor({ timeout: 5000 });
}

export const scenarios = [
  {
    name: "next-shell-layout",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      const layout = await page.evaluate(() => {
        const app = document.querySelector(".app");
        const director = document.getElementById("director") ?? app.children[1];
        const bar = document.querySelector(".topbar").getBoundingClientRect();
        const column = director.getBoundingClientRect();
        const scroller = document.scrollingElement;
        const settings = document.querySelector(".topbar [data-act='settings']").getBoundingClientRect();
        return {
          bar: { top: bar.top, height: bar.height, width: bar.width },
          column: { left: column.left, width: column.width, top: column.top },
          scroll: { height: scroller.scrollHeight, width: scroller.scrollWidth, innerHeight: window.innerHeight, innerWidth: window.innerWidth },
          title: document.querySelector(".topbar .film b")?.textContent,
          meta: document.querySelector(".topbar .film span")?.textContent,
          counts: document.querySelector(".topbar .counts")?.textContent,
          saved: document.querySelector(".topbar .saved")?.textContent,
          toggleShown: getComputedStyle(document.querySelector(".topbar .dir-toggle")).display !== "none",
          documentTitle: document.title,
          brand: document.querySelector(".topbar [data-act='all-films']")?.getAttribute("aria-label"),
          settings: { label: document.querySelector(".topbar [data-act='settings']").getAttribute("aria-label"), width: settings.width, height: settings.height },
          stop: document.querySelectorAll(".topbar [data-act='stop-film']").length,
          strip: document.querySelector(".film-strip-slot")?.getAttribute("data-strip"),
          described: document.querySelectorAll(".topbar [role='tab'][aria-describedby]").length,
        };
      });
      expect(layout.bar.top === 0 && layout.bar.height === 52 && layout.bar.width === 1440, `Top bar is ${JSON.stringify(layout.bar)}, expected 1440 × 52 at the top`);
      expect(layout.column.left === 0 && layout.column.width === 392 && layout.column.top === 52, `Director column is ${JSON.stringify(layout.column)}, expected 392 wide under the bar`);
      expect(layout.scroll.height <= layout.scroll.innerHeight && layout.scroll.width <= layout.scroll.innerWidth, `The page scrolls: ${JSON.stringify(layout.scroll)}`);
      expect(layout.title === "The Last Ferry", `Film title reads "${layout.title}"`);
      // A number and its unit are joined by a no-break space, so "48 s" never breaks into "48" / "s".
      expect(layout.meta === "48\u00a0s · 30\u00a0fps", `Film meta reads ${JSON.stringify(layout.meta)}`);
      expect(layout.counts === "3 scenes · 8 shots", `Counts read "${layout.counts}"`);
      expect(layout.saved === "Synced", `Connection pill reads "${layout.saved}"`);
      expect(!layout.toggleShown, "The Director toggle shows on a wide screen");
      expect(layout.documentTitle === "The Last Ferry · OpenSlate", `Document title is "${layout.documentTitle}"`);
      expect(layout.brand === "OpenSlate, all films", `The mark is labelled "${layout.brand}"`);
      expect(layout.settings.label === "Settings" && layout.settings.width === 30 && layout.settings.height === 30, `Settings is ${JSON.stringify(layout.settings)}, expected a 30 px round button`);
      expect(layout.stop === 0, "Stop shows while nothing runs");
      expect(layout.strip === "none", `A film-wide strip shows on a quiet film: ${layout.strip}`);
      expect(layout.described === 0, "A tab still says it opens in the classic studio");
      expect((await tab(page, "keyframes").getAttribute("aria-selected")) === "true", "Keyframes is not the selected tab");
      // One title treatment: the bold title on the meta's baseline, never a bordered control (with a picker or without).
      const titleRow = await page.evaluate(() => {
        const title = document.querySelector(".topbar .film b").getBoundingClientRect();
        const meta = document.querySelector(".topbar .film-meta").getBoundingClientRect();
        const name = getComputedStyle(document.querySelector(".topbar .film-name"));
        return { offset: Math.abs(title.bottom - meta.bottom), border: name.borderTopWidth, background: name.backgroundColor };
      });
      expect(titleRow.offset < 2.5 && titleRow.border === "0px" && titleRow.background === "rgba(0, 0, 0, 0)", `The film title is not the plain title on the meta's baseline: ${JSON.stringify(titleRow)}`);
      await shot(page, "next-shell-layout-1440");
    },
  },
  {
    name: "next-shell-narrow",
    query: FIXTURE,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await ready(page);
      await noSidewaysScroll(page);
      const toggle = page.locator(".topbar [data-act='toggle-director']");
      await toggle.waitFor({ state: "visible" });
      const rows = await page.evaluate(() => {
        const top = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().top);
        return { film: top(".topbar .film"), toggle: top(".topbar .dir-toggle"), settings: top(".topbar [data-act='settings']"), tabs: top(".topbar .tabs"), position: getComputedStyle(document.querySelector(".topbar")).position };
      });
      expect(rows.position === "sticky", `Top bar position is ${rows.position}`);
      expect(rows.tabs > rows.film && rows.tabs > rows.toggle, `The tabs are not on their own row: ${JSON.stringify(rows)}`);
      expect(Math.abs(rows.settings - rows.toggle) < 8, `Settings is not on the first row with the Director toggle: ${JSON.stringify(rows)}`);
      await shot(page, "next-shell-narrow-390");

      await toggle.click();
      expect((await toggle.getAttribute("aria-expanded")) === "true", "The toggle does not report the drawer open");
      expect(await page.locator(".app.dir-open").count() === 1, "The app is not in the drawer-open state");
      expect(await page.locator(".topbar[inert]").count() === 1, "The page behind the drawer is not inert");
      const drawer = page.locator("#director");
      if (await drawer.count()) {
        await page.waitForTimeout(300); // slide-in
        const box = await drawer.boundingBox();
        expect(box && box.x === 0 && box.width > 300, `The drawer is not on screen: ${JSON.stringify(box)}`);
      }
      await noSidewaysScroll(page);
      await shot(page, "next-shell-narrow-390-drawer");

      await page.keyboard.press("Escape");
      expect((await toggle.getAttribute("aria-expanded")) === "false", "Esc did not close the drawer");
      expect(await page.locator(".app.dir-open").count() === 0, "The app is still in the drawer-open state");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-act"));
      expect(focused === "toggle-director", `Focus went to ${focused} instead of the Director toggle`);
      expect(await page.locator(".topbar[inert]").count() === 0, "The top bar stayed inert");
      await noSidewaysScroll(page);
    },
  },
  {
    name: "next-shell-language",
    query: FIXTURE,
    async run({ page }) {
      await ready(page);
      const language = page.locator(".topbar [data-act='language']");
      expect((await language.textContent()) === "中文", `The language switch reads "${await language.textContent()}"`);
      await language.click();
      await page.waitForFunction(() => document.querySelector(".topbar [data-view='keyframes']")?.textContent === "关键帧");
      const zh = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        saved: document.querySelector(".topbar .saved")?.textContent,
        counts: document.querySelector(".topbar .counts")?.textContent,
        language: document.querySelector(".topbar [data-act='language']")?.textContent,
        settings: document.querySelector(".topbar [data-act='settings']")?.getAttribute("aria-label"),
      }));
      expect(zh.lang === "zh-CN", `html lang is ${zh.lang}`);
      expect(zh.saved === "已同步", `Connection pill reads "${zh.saved}"`);
      expect(zh.counts === "3\u00a0场 · 8\u00a0个镜头", `Counts read ${JSON.stringify(zh.counts)}`);
      expect(zh.language === "English", `The language switch reads "${zh.language}"`);
      expect(zh.settings === "设置", `Settings is labelled "${zh.settings}"`);
      // The film's own words keep their own stop: "Wide. The empty harbour…", never "Wide。The empty harbour…".
      const caption = await text(page, ".preview .pv-caption");
      expect(/^Wide\. The empty harbour/.test(caption), `The Chinese caption reads ${JSON.stringify(caption)}`);
      await shot(page, "next-shell-language-zh");

      await page.reload();
      await ready(page);
      await page.waitForFunction(() => document.querySelector(".topbar [data-view='keyframes']")?.textContent === "关键帧", null, { timeout: 5000 });
      expect((await page.evaluate(() => document.documentElement.lang)) === "zh-CN", "The language did not survive a reload");

      await page.locator(".topbar [data-act='language']").click();
      await page.waitForFunction(() => document.querySelector(".topbar [data-view='keyframes']")?.textContent === "Keyframes");
    },
  },
  {
    name: "next-shell-views",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      const shown = () => page.evaluate(() => document.querySelector(".app")?.getAttribute("data-view"));
      // Every tab opens its own view.
      for (const view of VIEWS) {
        await tab(page, view).click();
        await until(page, shown, (value) => value === view, `The ${view} tab did not open its view`);
        expect((await tab(page, view).getAttribute("aria-selected")) === "true", `${view} is not the selected tab`);
      }

      // Keyboard: arrows move along the tabs, Enter opens one.
      await tab(page, "plan").click();
      await tab(page, "plan").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      expect((await page.evaluate(() => document.activeElement?.getAttribute("data-view"))) === "assets", "ArrowRight did not move focus to Assets");
      await page.keyboard.press("Enter");
      await until(page, shown, (value) => value === "assets", "Enter did not open Assets");

      // Settings: the gear opens it; no tab is selected, but the tab row stays reachable with Tab.
      const gear = page.locator(".topbar [data-act='settings']");
      await gear.click();
      await until(page, shown, (value) => value === "settings", "The gear did not open Settings");
      expect((await gear.getAttribute("aria-current")) === "page", "Settings is not marked as the current page");
      expect(await page.locator(".topbar [role='tab'][aria-selected='true']").count() === 0, "A tab stays selected on Settings");
      expect(await page.locator(".topbar [role='tab'][tabindex='0']").count() === 1, "The tab row is not in the focus order on Settings");
      expect(await page.locator("main.work[data-view='settings']").count() === 1, "The gear did not show the Settings view");
      await shot(page, "next-shell-settings-1440");

      // The mark opens the films on this computer: no film is open there, so no tabs, counts or Stop.
      await page.locator(".topbar [data-act='all-films']").click();
      await until(page, shown, (value) => value === "start", "The mark did not open the films list");
      const start = await page.evaluate(() => ({
        film: document.querySelector(".topbar .film")?.innerText.replace(/\s+/g, " "),
        tabs: document.querySelectorAll(".topbar [role='tab']").length,
        counts: document.querySelectorAll(".topbar .counts").length,
        current: document.querySelector(".topbar [data-act='all-films']")?.getAttribute("aria-current"),
        title: document.title,
      }));
      expect(start.film === "Films on this computer", `The bar reads "${start.film}" on Start`);
      expect(start.tabs === 0 && start.counts === 0, `Start still shows ${start.tabs} tabs and ${start.counts} counts`);
      expect(start.current === "page", "The mark is not marked as the current page on Start");
      expect(start.title === "OpenSlate", `Document title on Start is "${start.title}"`);
      expect(await page.locator("main.work[data-view='start']").count() === 1, "The mark did not show the Start view");
      // No film is open on Start, so the Director says it works inside a film and its composer is off.
      const director = await page.evaluate(() => {
        const column = document.getElementById("director");
        const box = column.querySelector("[data-field='message']");
        return {
          film: column.getAttribute("data-film"),
          scope: column.querySelector(".dir-head .scene")?.textContent,
          says: column.querySelector("[data-entry='no-film']")?.textContent,
          thread: column.querySelectorAll(".thread [data-entry]:not([data-entry='no-film']), .thread .note, .dir-question").length,
          notices: column.querySelectorAll(".dir-notices").length,
          box: { disabled: box?.disabled, placeholder: box?.placeholder },
          send: column.querySelector("[data-act='send']")?.disabled,
          at: column.querySelector("[data-act='at']")?.disabled,
        };
      });
      expect(director.film === "none" && director.scope === "No film open", `The Director on Start reads ${JSON.stringify(director)}`);
      expect(director.says === "The Director works inside a film. Open a film, or start a new one and choose “Talk to the Director” as its first step.", `The Director on Start says ${JSON.stringify(director.says)}`);
      expect(director.thread === 0 && director.notices === 0, `The previous film's thread or notes show on Start: ${JSON.stringify(director)}`);
      expect(director.box.disabled === true && director.box.placeholder === "Open a film to talk to the Director", `The composer on Start is ${JSON.stringify(director.box)}`);
      expect(director.send === true && director.at === true, `Send or @ is on with no film open: ${JSON.stringify(director)}`);
      await noSidewaysScroll(page, "start");
      await shot(page, "next-shell-start-1440");

      // Back in the film the thread and the composer return.
      await openView(page, "keyframes");
      await until(page, () => page.evaluate(() => document.getElementById("director").getAttribute("data-film")), (value) => value === "open", "The Director did not come back with the film");
      expect(!(await page.locator("#director [data-field='message']").isDisabled()), "The composer stayed off in the film");
    },
  },
  {
    name: "next-shell-stop-continue",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await makeSceneTwoVideo(page);
      // The settled note's banner is only as tall as what it says: no empty band under its one strip row.
      const done = await page.locator('.banner.done[data-note="note-b"]').evaluate((element) => {
        const box = element.getBoundingClientRect();
        return { height: box.height, below: box.bottom - element.querySelector(".banner-main").getBoundingClientRect().bottom };
      });
      expect(done.below <= 16, `The done banner leaves an empty band: ${JSON.stringify(done)}`);
      // 2.2's note link is off while its clip is made: a solid backing (the picture never shows through) and a reason.
      const link = await page.locator("[data-card='shot-2-2'] [data-act='note-regenerate']").evaluate((element) => ({ disabled: element.disabled, title: element.title, background: getComputedStyle(element).backgroundColor, opacity: getComputedStyle(element).opacity }));
      expect(link.disabled && link.title === "Wait for 2.2's clip to finish." && /^rgb\(/.test(link.background) && link.opacity === "1", `The held note link is not legible or does not say why: ${JSON.stringify(link)}`);
      await shot(page, "next-shell-running-1440");
      const stop = page.locator(".topbar [data-act='stop-film']");
      expect((await stop.innerText()).trim() === "Stop", `Stop reads "${await stop.innerText()}"`);
      // At 900 px the bar still fits with Stop in it.
      await page.setViewportSize({ width: 900, height: 900 });
      const bar = await page.evaluate(() => { const node = document.querySelector(".topbar"); return [node.scrollWidth, node.clientWidth]; });
      expect(bar[0] <= bar[1], `The top bar overflows at 900 px with Stop: ${bar}`);
      await noSidewaysScroll(page, "running at 900");
      await shot(page, "next-shell-running-900");
      await page.setViewportSize({ width: 1440, height: 900 });

      // The confirm says what finishes and is charged and what is taken off; Esc keeps going.
      await stop.click();
      const dialog = page.locator("dialog[data-dialog='stop']");
      await dialog.waitFor();
      expect(await dialog.evaluate((node) => node.open && node.matches(":modal")), "The Stop confirm is not a modal dialog");
      expect((await dialog.locator("h2").innerText()) === "Stop the film?", "The confirm has the wrong title");
      const lines = await dialog.locator("li").allInnerTexts();
      expect(lines.some((line) => /^\d+ jobs? already sent will finish and be charged\.$/.test(line)), `The confirm does not say what finishes and is charged: ${JSON.stringify(lines)}`);
      expect(lines.some((line) => /^\d+ queued jobs? will be taken off; (it needs|they need) a new confirm later\.$/.test(line)), `The confirm does not say what is taken off: ${JSON.stringify(lines)}`);
      expect((await page.evaluate(() => document.activeElement?.getAttribute("data-act"))) === "keep-going", "Focus did not start on Keep going");
      await shot(page, "next-shell-stop-dialog-1440");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await until(page, () => page.evaluate(() => document.activeElement?.getAttribute("data-act")), (value) => value === "stop-film", "Focus did not return to Stop");

      await stop.click();
      await page.locator("dialog[data-dialog='stop'] [data-act='confirm-stop']").click();
      await page.waitForSelector(".film-strip[data-strip='stopped']");
      await stop.waitFor({ state: "detached", timeout: 5000 });
      const stopped = await text(page, ".film-strip[data-strip='stopped'] .txt");
      expect(/^Stopped\. Nothing new will be sent\. \d+ jobs? already sent will finish and be charged\. \d+ queued jobs? (was|were) taken off and will need a new confirm\.$/.test(stopped), `The stopped strip reads ${JSON.stringify(stopped)}`);
      await until(page, () => page.evaluate(() => document.activeElement?.getAttribute("data-act")), (value) => value === "continue-film", "Focus did not move to Continue once Stop was gone");
      const box = await strip(page).boundingBox();
      expect(box && Math.abs(box.x - 414) < 2 && Math.abs(box.y - 62) < 2 && Math.abs(box.width - 1004) < 2, `The strip is not at the top of the workspace: ${JSON.stringify(box)}`);
      const continueColour = await page.locator("[data-act='continue-film']").evaluate((node) => getComputedStyle(node).backgroundColor);
      expect(continueColour === "rgb(236, 236, 238)", `Continue is not the white primary action: ${continueColour}`);
      // Stop, the stopped strip and Continue are the shell's: the Director column does not repeat them, and its
      // composer says the Director waits for Continue while Send stays on.
      const repeats = await page.locator("#director [data-act='stop'], #director [data-act='continue'], #director .dir-banner, #director [data-act='stop-film'], #director [data-act='continue-film']").count();
      expect(repeats === 0, `The Director column repeats ${repeats} of the shell's stop controls`);
      expect((await text(page, "#director [data-hint]")) === "Stopped · the Director waits for Continue", `The composer hint reads ${JSON.stringify(await text(page, "#director [data-hint]"))}`);
      await page.locator("#director [data-field='message']").fill("Keep the fog");
      expect(!(await page.locator("#director [data-act='send']").isDisabled()), "Send is off while stopped");
      await page.locator("#director [data-field='message']").fill("");
      // New paid work waits for Continue and says so; free edits still save.
      const regen = page.locator(".insp [data-act='regen']");
      expect((await regen.isDisabled()) && (await regen.getAttribute("data-needs")) === "run" && (await regen.getAttribute("title")) === "The film is stopped. Continue first to start new work.", `A new take is not held while stopped: ${await regen.getAttribute("title")}`);
      expect(!(await page.locator(".insp [data-act='edit-prompt']").isDisabled()), "Edit prompt is off while stopped");
      // The sent clip finishes; then the scene's video says it waits for Continue.
      await until(page, () => text(page, ".vpanel .why"), (value) => value === "Stopped. Continue to make video", "The Video panel does not say it is stopped", 10000);
      expect(await page.locator(".vpanel .go").isDisabled(), "The Video panel's button is on while stopped");
      // With 2.1's clip saved, the scene line counts clips and the panel says which frames its count is of.
      await until(page, () => text(page, ".scene-head"), (value) => /Scene 2 · 3 shots · 1 of 3 clips saved/.test(value), "The scene line does not count the saved clip");
      expect(/2 of 2\s*frames opened\s+1 clip is saved\. Both frames still needing video are opened\./.test(await text(page, ".vpanel")), `The Video panel reads ${JSON.stringify(await text(page, ".vpanel"))}`);
      await noSidewaysScroll(page);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      expect(height <= 900, `The stopped Keyframes view scrolls: ${height}px`);
      // Under the strip the inspector has less room: its rows and actions are still whole.
      await inspectorWhole(page, "under the stopped strip at 1440");
      await shot(page, "next-shell-stopped-1440");

      // The same strip in every view.
      for (const view of ["plan", "assets", "film"]) {
        await tab(page, view).click();
        await page.waitForSelector(`.app[data-view='${view}'] .film-strip[data-strip='stopped']`);
      }
      await page.locator(".topbar [data-act='settings']").click();
      await page.waitForSelector(".app[data-view='settings'] .film-strip[data-strip='stopped']");
      await tab(page, "keyframes").click();

      await page.locator("[data-act='continue-film']").click();
      await page.waitForSelector(".film-strip-slot[data-strip='none']", { state: "attached" });
      await until(page, () => text(page, ".toast"), (value) => value.startsWith("Continued."), "No toast after Continue");
      // The jobs Stop took off need a new confirm, with its price.
      const confirm = await until(page, () => text(page, "[data-act='confirm-video']"), (value) => / · about \$\d/.test(value), "The Video panel does not offer a new confirm with its price after Continue");
      expect(/^Confirm frames & .+ · about \$\d/.test(confirm) && !(await page.locator("[data-act='confirm-video']").isDisabled()), `The new confirm reads ${JSON.stringify(confirm)}`);
      expect((await text(page, "#director [data-hint]")) === "a scene or shot to point at it", "The composer hint did not come back after Continue");
    },
  },
  {
    name: "next-shell-stop-narrow",
    query: FIXTURE,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await ready(page);
      await page.click("[data-act='scene'][data-scene='scene-3']");
      await page.click("[data-act='make-keyframes']");
      const stop = page.locator(".topbar [data-act='stop-film']");
      await stop.waitFor({ timeout: 5000 });
      // Stop ends the tab row, so the film's title keeps its room on the first row (with Stop there it read "The La…").
      const rows = await page.evaluate(() => {
        const top = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().top);
        return { stop: top(".topbar [data-act='stop-film']"), toggle: top(".topbar .dir-toggle"), tabs: top(".topbar .tabs") };
      });
      expect(Math.abs(rows.stop - rows.tabs) < 8 && rows.tabs > rows.toggle, `Stop does not end the tab row: ${JSON.stringify(rows)}`);
      const titleFits = () => page.evaluate(() => { const title = document.querySelector(".topbar .film b"); return title.scrollWidth <= title.clientWidth; });
      expect(await titleFits(), "Stop squeezes the film's title");
      await noSidewaysScroll(page, "running");
      await shot(page, "next-shell-running-390");
      await page.locator(".topbar [data-act='language']").click();
      await page.waitForFunction(() => document.querySelector(".topbar [data-act='stop-film']")?.textContent === "停止");
      expect(await titleFits(), "Stop squeezes the film's title in Chinese");
      await noSidewaysScroll(page, "running in Chinese");
      await shot(page, "next-shell-running-390-zh");
      await page.locator(".topbar [data-act='language']").click();
      await stop.click();
      await page.locator("dialog[data-dialog='stop'] [data-act='confirm-stop']").click();
      await page.waitForSelector(".film-strip[data-strip='stopped']");
      await noSidewaysScroll(page, "stopped");
      await page.evaluate(() => window.scrollTo(0, 0));
      // The scene pills scroll inside their row; the selected one is shown whole.
      const pill = await page.evaluate(() => {
        const row = document.querySelector(".scene-pills").getBoundingClientRect();
        const selected = document.querySelector(".scene-pills [aria-pressed='true']").getBoundingClientRect();
        return { row: [row.left, row.right], selected: [selected.left, selected.right] };
      });
      expect(pill.selected[0] >= pill.row[0] - 0.5 && pill.selected[1] <= pill.row[1] + 0.5, `The selected scene pill is cut by its row: ${JSON.stringify(pill)}`);
      await shot(page, "next-shell-stopped-390");
      // Chinese strings are the longest here; the strip wraps and nothing scrolls sideways.
      await page.locator(".topbar [data-act='language']").click();
      const zh = await until(page, () => text(page, ".film-strip[data-strip='stopped'] .txt"), (value) => value.startsWith("已停止，不会再发送新任务。"), "The strip did not switch to Chinese");
      expect(!/。\s/.test(zh), `The Chinese strip has a space after a full stop: ${JSON.stringify(zh)}`);
      await noSidewaysScroll(page, "stopped in Chinese");
      await shot(page, "next-shell-stopped-390-zh");
      await page.locator(".topbar [data-act='language']").click();
    },
  },
  {
    name: "next-shell-no-sideways-scroll",
    query: FIXTURE,
    viewport: { width: 1366, height: 900 },
    async run({ page }) {
      await ready(page);
      for (const width of [1440, 1366, 1280, 1024, 900]) {
        await page.setViewportSize({ width, height: 900 });
        const column = width < 1280 ? 320 : 392;
        for (const view of [...VIEWS, "settings", "start"]) {
          await openView(page, view);
          await page.waitForTimeout(150);
          await noSidewaysScroll(page, `${view} at ${width}`);
          const sizes = await page.evaluate(() => {
            const bar = document.querySelector(".topbar");
            const main = document.querySelector(".workspace-slot > main");
            return { column: Math.round(document.getElementById("director").getBoundingClientRect().width), bar: [bar.scrollWidth, bar.clientWidth], main: main ? [main.scrollWidth, main.clientWidth] : null };
          });
          expect(sizes.column === column, `The Director column is ${sizes.column}px at ${width}, expected ${column}`);
          expect(sizes.bar[0] <= sizes.bar[1], `The top bar overflows at ${width} on ${view}: ${sizes.bar}`);
          expect(!sizes.main || sizes.main[0] <= sizes.main[1] + 1, `The ${view} workspace overflows sideways at ${width}: ${sizes.main}`);
        }
        await openView(page, "keyframes");
        await page.waitForSelector("main.work[data-view='keyframes'] .preview");
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        expect(height <= 900, `Keyframes scrolls the page at ${width}: ${height}px`);
        const kf = await page.evaluate(() => {
          const line = document.querySelector(".scene-head .line");
          const cards = document.querySelector(".kf-row .cards");
          return {
            line: [line.scrollWidth, line.clientWidth, line.textContent],
            scrolls: cards.scrollWidth > cards.clientWidth + 1,
            mask: getComputedStyle(cards).maskImage || getComputedStyle(cards).webkitMaskImage || "none",
          };
        });
        // The scene's status is read in full: the scene pills wrap below it before it is cut.
        expect(kf.line[0] <= kf.line[1], `The scene status is cut at ${width}: ${JSON.stringify(kf.line)}`);
        // A row with cards out of view says so with a faded edge.
        expect(!kf.scrolls || /gradient/.test(kf.mask), `The card row hides cards without a sign at ${width}: ${kf.mask}`);
        // Priced actions show their price, stay inside their card or panel, and keep clear of the badge and caption.
        await pricedActionsFit(page, width);
        await cardsFit(page, width);
        await stripFits(page, width);
        expect(await page.evaluate(() => document.documentElement.scrollHeight) <= 900, `Priced actions make Keyframes scroll the page at ${width}`);
        // The inspector's rows and actions are whole; below 1100 the preview shows the whole frame.
        await inspectorWhole(page, `at ${width}`);
        if (width < 1100) await previewWholeFrame(page, `at ${width}`);
        await noSidewaysScroll(page, `priced actions at ${width}`);
        await shot(page, `next-shell-keyframes-${width}`);
      }
      // On a phone the page may scroll vertically, while every priced action remains fully readable and usable.
      await page.setViewportSize({ width: 390, height: 844 });
      await pricedActionsFit(page, 390);
      await cardsFit(page, 390);
      await stripFits(page, 390);
      await noSidewaysScroll(page, "priced actions at 390");
      await page.locator(".topbar [data-act='language']").click();
      await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
      await pricedActionsFit(page, "390 zh-CN");
      await cardsFit(page, "390 zh-CN");
      await stripFits(page, "390 zh-CN");
      await noSidewaysScroll(page, "priced actions at 390 in Chinese");
      // In Chinese at 900 px the strip is at its narrowest beside the banner's actions.
      await page.setViewportSize({ width: 900, height: 900 });
      await stripFits(page, "900 zh-CN");
      await cardsFit(page, "900 zh-CN");
    },
  },
  {
    // The inspector fits its room a step at a time (roomy, compact, then the actions pinned at its foot with the rows
    // scrolling above them): at laptop and narrow sizes, with a short and a long narration row, in both languages, no
    // row or action is ever cut mid-height and the actions are in view at rest. On a narrow stage the preview keeps the
    // whole frame; on a phone its head is one row and its caption one line.
    name: "next-shell-inspector-fit",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.waitForSelector("main.work[data-view='keyframes'] .preview .pic-img", { timeout: 20000 });
      const sizes = [[1440, 900], [1366, 768], [1280, 800], [1024, 900], [900, 900], [390, 844]];
      const fits = {};
      for (const language of ["en", "zh-CN"]) {
        if (language === "zh-CN") {
          await page.locator(".topbar [data-act='language']").click();
          await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
        }
        for (const label of ["2.1", "2.3"]) {
          await page.setViewportSize({ width: 1440, height: 900 });
          await page.click(`.card [data-act='open-shot'][data-shot='shot-${label.replace(".", "-")}']`);
          await page.waitForSelector(`.insp[data-shot='shot-${label.replace(".", "-")}']`);
          for (const [width, height] of sizes) {
            await page.setViewportSize({ width, height });
            await page.waitForTimeout(150);
            const where = `for ${label} at ${width} x ${height} (${language})`;
            if (width >= 900) {
              const scrolled = await page.evaluate(() => document.documentElement.scrollHeight);
              expect(scrolled <= height, `Keyframes scrolls the page ${where}: ${scrolled}px`);
            } else await page.locator(".insp").scrollIntoViewIfNeeded();
            const report = await inspectorWhole(page, where);
            fits[`${label} ${width}x${height} ${language}`] = report.fit;
            if (width >= 900 && width < 1100) await previewWholeFrame(page, where);
            // Pinned, a row's control that takes the focus from the keyboard is scrolled whole into view above the actions.
            if (label === "2.1" && width === 1366) {
              await page.focus(".insp [data-act='prompts']");
              await page.keyboard.press("Tab");
              const focused = await page.evaluate(() => {
                const active = document.activeElement;
                const box = active.getBoundingClientRect();
                return { act: active.getAttribute("data-act"), bottom: box.bottom, actions: document.querySelector(".insp-actions").getBoundingClientRect().top, undrawn: getComputedStyle(active.closest("dt") ?? active).clipPath !== "none" };
              });
              expect(focused.act === "narration-edit" && focused.bottom <= focused.actions + 0.5 && !focused.undrawn, `The focused row control is not in view above the pinned actions ${where}: ${JSON.stringify(focused)}`);
              await page.locator(".insp").evaluate((element) => { element.scrollTop = 0; });
              await page.locator(".insp [data-act='narration-edit']").evaluate((element) => element.blur());
            }
            // At 1024 the band under the frame has the room for 2.1's caption in full (two lines).
            if (label === "2.1" && width === 1024 && language === "en") {
              const caption = await page.locator(".preview .pv-caption").evaluate((element) => [element.scrollHeight, element.clientHeight]);
              expect(caption[0] <= caption[1] + 1 && caption[1] > 30, `2.1's caption is cut ${where}: ${JSON.stringify(caption)}`);
            }
            await noSidewaysScroll(page, where);
          }
        }
      }
      // The design's layout where it has room; a phone's inspector is as tall as it needs.
      expect(fits["2.1 1440x900 en"] === "roomy", `2.1 at 1440 is not in the design's layout: ${JSON.stringify(fits)}`);
      expect(fits["2.3 1440x900 en"] === "compact", `2.3's longer narration at 1440 does not tighten to compact: ${JSON.stringify(fits)}`);
      expect(fits["2.1 1366x768 en"] === "pinned" && fits["2.1 390x844 en"] === null, `The fits are ${JSON.stringify(fits)}`);
      // Compact puts the two edits side by side, shortened only when the words cannot fit, to words that still name the
      // duration; the name keeps them all. Chinese has the room for the whole label.
      await page.setViewportSize({ width: 1024, height: 900 });
      const readPair = () => page.evaluate(() => {
        const top = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().top);
        const motion = document.querySelector(".insp-actions [data-act='edit-motion']");
        return { fit: document.querySelector(".insp").getAttribute("data-fit"), prompt: top(".insp-actions [data-act='edit-prompt']"), motion: top(".insp-actions [data-act='edit-motion']"), text: motion.textContent, name: motion.getAttribute("aria-label") };
      });
      const zhPair = await readPair();
      expect(zhPair.fit === "compact" && zhPair.prompt === zhPair.motion && zhPair.text === "编辑运动和时长" && zhPair.name === null, `The compact edits in Chinese are ${JSON.stringify(zhPair)}`);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator(".topbar [data-act='language']").click();
      await page.waitForFunction(() => document.documentElement.lang === "en");
      const pair = await readPair();
      expect(pair.prompt === pair.motion && pair.text === "Motion & duration" && pair.name === "Edit motion & duration", `The compact edits are ${JSON.stringify(pair)}`);
      // A phone: the preview's head is one row (Previous and Next without the position), and its caption one line.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.click(".card [data-act='open-shot'][data-shot='shot-2-1']");
      await page.locator(".preview").scrollIntoViewIfNeeded();
      const head = await page.evaluate(() => {
        const box = (selector) => document.querySelector(selector).getBoundingClientRect();
        const caption = document.querySelector(".preview .pv-caption");
        return { top: box(".preview .pv-top").top, side: box(".preview .pv-side").top, caption: caption.getBoundingClientRect().height, line: parseFloat(getComputedStyle(caption).lineHeight) || parseFloat(getComputedStyle(caption).fontSize) * 1.3, position: document.querySelector(".preview .pv-pos").getAttribute("aria-label") };
      });
      expect(Math.abs(head.top - head.side) < 4, `The preview's head takes two rows at 390: ${JSON.stringify(head)}`);
      expect(head.caption <= head.line * 1.5 && head.position === "Shot 4 of 8 in the film", `The caption or the position at 390: ${JSON.stringify(head)}`);
      await shot(page, "next-shell-inspector-fit-390");
    },
  },
  {
    name: "next-shell-restart-casualties",
    query: LIVE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      // Pair the window first: a reload while the launch link is still being exchanged would lose the session.
      await ready(page);
      // The studio says which overview attempts were mid-send at its last start; give the first shot's clip that state.
      let casualty = null;
      await page.route(/\/api\/projects\/[^/]+\/generation$/, (route) => rewrite(route, (overview) => {
        const first = overview.scenes?.[0]?.shotIds?.[0];
        if (first && overview.shots[first]) {
          casualty = overview.shots[first].label;
          overview.shots[first].video = { state: "no_answer", phase: "submission_unknown", attemptId: "restart-casualty-1", startedAt: "2026-10-15T09:00:00.000Z", takeCount: 0 };
          overview.restartCasualties = ["restart-casualty-1"];
        }
      }));
      await page.reload();
      await ready(page);
      await page.waitForSelector(".film-strip[data-strip='restart']", { timeout: 10000 });
      const title = await text(page, ".film-strip[data-strip='restart'] .txt b");
      expect(title === `OpenSlate restarted while 1 clip was being sent (${casualty}).`, `The restart strip reads ${JSON.stringify(title)}`);
      expect((await text(page, ".film-strip[data-strip='restart'] .txt span")) === "The service never confirmed it. It may still arrive and be charged; nothing is resent by itself.", "The restart strip does not say what may still happen");
      await noSidewaysScroll(page);
      await inspectorWhole(page, "under the restart strip at 1440");
      // The other clips wait for the person's confirm: the screen tells one story. The scene is not "making video",
      // no card says it waits for a confirm the screen does not offer, the panel offers that confirm, and no Stop.
      const story = { head: await text(page, ".scene-head"), cards: await page.locator(".card .stl").allInnerTexts(), action: await page.locator(".vpanel").getAttribute("data-action"), stop: await page.locator(".topbar [data-act='stop-film']").count() };
      expect(!/making video/.test(story.head) && !story.cards.some((card) => /Waiting for your confirm/.test(card)) && story.action === "confirm" && story.stop === 0, `The restarted scene contradicts itself: ${JSON.stringify(story)}`);
      await shot(page, "next-shell-restart-1440");

      // Show takes the person to the shot in Keyframes, from any view.
      await tab(page, "plan").click();
      await page.waitForSelector(".app[data-view='plan'] .film-strip[data-strip='restart']");
      await page.locator("[data-act='show-casualty']").click();
      await page.waitForSelector(".app[data-view='keyframes']");
      expect((await tab(page, "keyframes").getAttribute("aria-selected")) === "true", "Show did not open Keyframes");

      await page.locator("[data-act='dismiss-restart']").click();
      await page.waitForSelector(".film-strip-slot[data-strip='none']", { state: "attached" });
    },
  },
  {
    name: "next-shell-offline",
    query: LIVE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await until(page, () => text(page, ".topbar .saved"), (value) => value === "Synced", "The live shell never connected");
      // The event stream fails from now on. Hiding and showing the tab drops the open stream and reconnects it.
      const events = /\/api\/projects\/[^/]+\/events/;
      await page.route(events, (route) => route.abort("internetdisconnected"));
      const visibility = (hidden) => page.evaluate((value) => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (value ? "hidden" : "visible") });
        document.dispatchEvent(new Event("visibilitychange"));
      }, hidden);
      await visibility(true);
      await visibility(false);
      await until(page, () => text(page, ".topbar .saved"), (value) => value === "Reconnecting…", "The pill never said Reconnecting…");
      // Only the stream is down: a plain read still answers, so edits still save and nothing says otherwise.
      await page.waitForTimeout(3500);
      expect((await page.locator(".film-strip-slot").getAttribute("data-strip")) === "none", "The offline strip showed while the studio still answered reads");

      // Now nothing reaches the studio. The strip waits a moment (a returning tab reconnects within it), then says what is off.
      const api = /\/api\//;
      await page.route(api, (route) => route.abort("internetdisconnected"));
      await page.waitForSelector(".film-strip[data-strip='offline']", { timeout: 9000 });
      await until(page, () => text(page, ".topbar .saved"), (value) => value === "Offline", "The pill never said Offline once the studio could not be reached");
      const offline = await text(page, ".film-strip[data-strip='offline'] .txt");
      expect(offline === "Can’t reach the studio. Changes can’t be saved and nothing can be made until it’s back. OpenSlate keeps trying by itself.", `The offline strip reads ${JSON.stringify(offline)}`);
      // Every write is off and says why: edits, paid makes and confirms, and Send (the draft is kept).
      const guarded = await page.evaluate(() => [...document.querySelectorAll("main.work [data-needs]")].map((node) => ({ act: node.getAttribute("data-act"), needs: node.getAttribute("data-needs"), disabled: node.disabled, title: node.getAttribute("title") })));
      const why = "Can’t reach the studio. This works again once it’s back.";
      expect(guarded.some((control) => control.needs === "run") && guarded.some((control) => control.act === "edit-prompt"), `Keyframes has no guarded paid or edit control: ${JSON.stringify(guarded)}`);
      // The narration row's Edit opens an editor like the actions under it, so it is off too.
      expect(guarded.some((control) => control.act === "narration-edit"), `The narration row's Edit is not guarded: ${JSON.stringify(guarded)}`);
      expect(guarded.every((control) => control.disabled && control.title === why), `A write stays on offline: ${JSON.stringify(guarded.filter((control) => !control.disabled || control.title !== why))}`);
      expect((await text(page, "#director [data-hint]")) === "Offline · your draft is kept", `The composer hint reads ${JSON.stringify(await text(page, "#director [data-hint]"))}`);
      await page.locator("#director [data-field='message']").fill("Keep the fog");
      expect(await page.locator("#director [data-act='send']").isDisabled(), "Send is on while offline");
      await noSidewaysScroll(page);
      await shot(page, "next-shell-offline-1440");
      await page.locator("#director [data-field='message']").fill("");

      await page.unroute(api);
      await page.unroute(events);
      // A retry already on its way may still meet the old route; press again until the studio answers.
      await until(page, async () => {
        const retry = page.locator("[data-act='retry-now']");
        if (await retry.count()) await retry.click().catch(() => {});
        await page.waitForTimeout(700);
        return page.locator(".film-strip-slot").getAttribute("data-strip");
      }, (value) => value === "none", "Try now did not bring the studio back", 12000);
      await until(page, () => text(page, ".topbar .saved"), (value) => value === "Synced", "Try now did not reconnect");
      await until(page, () => text(page, ".toast"), (value) => value.startsWith("Connected again."), "No toast once the studio was back");
    },
  },
  {
    name: "next-shell-session-expired",
    query: LIVE,
    viewport: { width: 1440, height: 900 },
    allowConsoleErrors: [
      // The session is cleared on purpose: reads are refused until the window connects again.
      /^HTTP 40[13] \/api\//,
    ],
    async run({ page }) {
      await ready(page);
      await until(page, () => text(page, ".topbar .saved"), (value) => value === "Synced", "The live shell never connected");
      const box = page.locator("[data-field='message']");
      await box.fill("Keep the fog low over the water");

      // The session ends (as after a restart or 12 hours); the next read finds out.
      const cookies = await page.context().cookies();
      await page.context().clearCookies();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const dialog = page.locator("dialog[data-dialog='expired']");
      await dialog.waitFor({ timeout: 10000 });
      expect(await dialog.evaluate((node) => node.open && node.matches(":modal")), "Session expired is not a modal dialog");
      expect((await dialog.locator("h2").innerText()) === "This window is no longer connected", "The dialog has the wrong title");
      expect((await dialog.locator("code").innerText()) === "pnpm studio", "The dialog does not show the command as code");
      expect(await page.locator(".app[data-ui='next'] .topbar").isVisible(), "The page behind the dialog was replaced");
      expect((await text(page, ".topbar .saved")) === "Not connected", "The pill does not say Not connected");
      expect((await page.evaluate(() => document.activeElement?.getAttribute("data-act"))) === "reconnect", "Focus is not on Try again");
      // Esc never dismisses it: once, twice in a row (Chrome ignores preventDefault on the second), or around a click.
      // A click on plain text leaves focus on the page body; it must never land on the page behind the dialog.
      const stillOpen = async (how) => {
        await page.waitForTimeout(200);
        expect(await dialog.evaluate((node) => node.open && node.matches(":modal")), `${how} dismissed the session-expired dialog`);
        const focus = await page.evaluate(() => {
          const active = document.activeElement;
          return { act: active?.getAttribute("data-act") ?? active?.tagName, inside: !!active?.closest("dialog[data-dialog='expired']") || active === document.body };
        });
        expect(focus.inside, `${how} left focus behind the dialog, on ${focus.act}`);
        return focus.act;
      };
      await page.keyboard.press("Escape");
      expect((await stillOpen("Esc")) === "reconnect", "Esc moved focus off Try again");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      expect((await stillOpen("Esc twice")) === "reconnect", "Esc twice moved focus off Try again");
      await page.keyboard.press("Escape");
      await dialog.locator("h2").click();
      await page.keyboard.press("Escape");
      await stillOpen("Esc, a click, Esc");
      await page.mouse.click(8, 450);
      await page.keyboard.press("Escape");
      await stillOpen("A click beside the dialog, then Esc");
      await dialog.locator("[data-act='reconnect']").focus();
      await shot(page, "next-shell-expired-1440");

      // Without a session, Try again says it is still not connected.
      await dialog.locator("[data-act='reconnect']").click();
      await until(page, () => text(page, "dialog[data-dialog='expired'] .still"), (value) => value.startsWith("Still not connected."), "Try again without a session said nothing");

      // With a session again (the person opened the new link), Try again reconnects and keeps the unsent message.
      await page.context().addCookies(cookies);
      await dialog.locator("[data-act='reconnect']").click();
      await dialog.waitFor({ state: "detached", timeout: 10000 });
      await ready(page);
      await until(page, () => page.locator("[data-field='message']").inputValue().catch(() => ""), (value) => value === "Keep the fog low over the water", "The unsent message was lost");
      await until(page, () => text(page, ".toast"), (value) => value === "Connected again. Your unsent message is still in the composer.", "No toast after reconnecting");
    },
  },
  {
    name: "next-shell-expired-new-link",
    query: LIVE,
    viewport: { width: 1440, height: 900 },
    allowConsoleErrors: [
      // The session is cleared on purpose: reads are refused until the window connects again.
      /^HTTP 40[13] \/api\//,
    ],
    async run({ page, origin }) {
      await ready(page);
      await until(page, () => text(page, ".topbar .saved"), (value) => value === "Synced", "The live shell never connected");
      // A place to come back to: the last scene, then Plan, with a message not sent yet.
      const scenes = await page.locator("[data-act='scene']").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-scene")));
      const scene = scenes.at(-1);
      if (scenes.length > 1) {
        await page.click(`[data-act='scene'][data-scene='${scene}']`);
        await page.waitForSelector(`[data-act='scene'][data-scene='${scene}'][aria-pressed='true']`);
      }
      await tab(page, "plan").click();
      await page.waitForSelector(".app[data-view='plan']");
      await page.locator("[data-field='message']").fill("Hold the last shot longer");

      const cookies = await page.context().cookies();
      await page.context().clearCookies();
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      const dialog = page.locator("dialog[data-dialog='expired']");
      await dialog.waitFor({ timeout: 10000 });

      // A launcher reuses this window with a fresh #connect= link instead of Try again. The scenario cannot mint a
      // launch code, so the pairing answers with the window's session as the studio would for a new code.
      await page.context().addCookies(cookies);
      await page.route("**/api/session", async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        const answer = await page.request.get(`${origin}/api/session`);
        await route.fulfill({ status: answer.status(), contentType: "application/json", body: await answer.body() });
      });
      await page.evaluate(() => { window.location.hash = `#connect=${"A".repeat(43)}`; });
      await dialog.waitFor({ state: "detached", timeout: 10000 });
      await ready(page);
      expect(!(await page.evaluate(() => window.location.hash)), "The launch code stayed in the address");
      await until(page, () => page.locator("[data-field='message']").inputValue().catch(() => ""), (value) => value === "Hold the last shot longer", "The unsent message was lost on a new link");
      await until(page, () => page.evaluate(() => document.querySelector(".app")?.getAttribute("data-view")), (value) => value === "plan", "The view was not kept on a new link");
      await until(page, () => text(page, ".toast"), (value) => value === "Connected again. Your unsent message is still in the composer.", "No toast after the new link connected");
      if (scenes.length > 1) {
        await tab(page, "keyframes").click();
        await page.waitForSelector(`[data-act='scene'][data-scene='${scene}'][aria-pressed='true']`, { timeout: 5000 });
      }
    },
  },
  {
    name: "next-shell-narrow-long-title",
    query: LIVE,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      // Pair the window first: a reload while the launch link is still being exchanged would lose the session.
      await ready(page);
      // A film with a long name: the title ellipsizes inside its own box instead of running under 中文 and the gear.
      await page.route(/\/api\/projects\/[^/]+$/, (route) => rewrite(route, (snapshot) => {
        snapshot.project.name = "First Light · integration review of the harbour at dawn";
      }));
      await page.reload();
      await ready(page);
      await page.waitForFunction(() => document.querySelector(".topbar .film b")?.textContent?.startsWith("First Light · integration review of the harbour"));
      for (const locale of ["en", "zh"]) {
        const box = await page.evaluate(() => {
          const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect();
          const title = rect(".topbar .film b");
          const film = rect(".topbar .film");
          const row = [".topbar .lang", ".topbar .settings-btn", ".topbar .dir-toggle"].map(rect).filter((r) => r && Math.abs(r.top - title.top) < 24);
          const node = document.querySelector(".topbar .film b");
          return { title: [title.left, title.right], film: film.right, next: Math.min(...row.map((r) => r.left)), clipped: node.scrollWidth > node.clientWidth };
        });
        expect(box.title[1] <= box.film + 0.5, `The title runs out of its box in ${locale}: ${JSON.stringify(box)}`);
        expect(box.title[1] <= box.next, `The title runs under the controls beside it in ${locale}: ${JSON.stringify(box)}`);
        expect(box.clipped, `The long title does not ellipsize in ${locale}: ${JSON.stringify(box)}`);
        await noSidewaysScroll(page, `long title in ${locale}`);
        await shot(page, `next-shell-narrow-long-title-${locale}`);
        if (locale === "en") {
          await page.locator(".topbar [data-act='language']").click();
          await page.waitForFunction(() => document.querySelector(".topbar [data-act='language']")?.textContent === "English");
        }
      }
      await page.locator(".topbar [data-act='language']").click();
    },
  },
  {
    name: "next-shell-connect",
    query: LIVE,
    allowConsoleErrors: [
      // The second load has no session on purpose.
      /^HTTP 40[13] \/api\/session$/,
      // After the cookies are cleared, a refresh or a studio event's read that was already in flight is refused:
      // the session ended on purpose.
      /^HTTP 403 \/api\/projects(\/.*)?$/,
    ],
    async run({ page, origin }) {
      // Live mode against the fixture studio: the shell shows its project and says it is saved.
      await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector(".topbar .saved")?.textContent === "Synced", null, { timeout: 10000 });
      const title = await page.evaluate(() => document.querySelector(".topbar .film b")?.textContent ?? "");
      expect(title.length > 0, "The live shell shows no film title");

      // Without a session the window cannot reach the studio: Connect offers a retry, focused.
      await page.context().clearCookies();
      await page.goto(`${origin}/?ui=next`);
      const connect = page.locator(".connect[data-state='failed']");
      await connect.waitFor({ timeout: 10000 });
      expect((await connect.locator("h1").textContent()) === "Connect to your studio", "Connect has the wrong heading");
      expect(await connect.locator("code").textContent() === "pnpm studio", "The command is not shown as code");
      // Start's reconnect note: the films are safe, and jobs cut off by a restart are never resent by themselves.
      expect((await connect.locator("[data-note='films-saved']").textContent()) === "Your films are saved on this computer.", "Connect does not say the films are saved");
      expect(/nothing is resent by itself\.$/.test(await connect.locator("[data-note='no-answer']").textContent()), "Connect does not say cut-off jobs are not resent");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-act"));
      expect(focused === "retry", `Focus is on ${focused}, not Try again`);
      await shot(page, "next-shell-connect-failed");
      await connect.locator("[data-act='retry']").click();
      await page.locator(".connect[data-state='failed']").waitFor({ timeout: 10000 });
    },
  },
];
