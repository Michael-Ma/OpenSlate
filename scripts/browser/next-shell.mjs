// Next studio shell checks: top bar, tabs, language, the classic-view panel, the narrow drawer and Connect.
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

/** The shell is up and the sample film's overview has been read (the counts come from it). */
async function ready(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  await page.waitForSelector(".topbar .film span", { timeout: 20000 });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const tab = (page, view) => page.locator(`.topbar [data-act='tab'][data-view='${view}']`);

async function noSidewaysScroll(page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth <= innerWidth, `The page scrolls sideways: ${scrollWidth}px content in a ${innerWidth}px window`);
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
        };
      });
      expect(layout.bar.top === 0 && layout.bar.height === 52 && layout.bar.width === 1440, `Top bar is ${JSON.stringify(layout.bar)}, expected 1440 × 52 at the top`);
      expect(layout.column.left === 0 && layout.column.width === 392 && layout.column.top === 52, `Director column is ${JSON.stringify(layout.column)}, expected 392 wide under the bar`);
      expect(layout.scroll.height <= layout.scroll.innerHeight && layout.scroll.width <= layout.scroll.innerWidth, `The page scrolls: ${JSON.stringify(layout.scroll)}`);
      expect(layout.title === "The Last Ferry", `Film title reads "${layout.title}"`);
      expect(layout.meta === "48 s · 30 fps", `Film meta reads "${layout.meta}"`);
      expect(layout.counts === "3 scenes · 8 shots", `Counts read "${layout.counts}"`);
      expect(layout.saved === "Saved locally", `Connection pill reads "${layout.saved}"`);
      expect(!layout.toggleShown, "The Director toggle shows on a wide screen");
      expect(layout.documentTitle === "The Last Ferry · OpenSlate", `Document title is "${layout.documentTitle}"`);
      expect((await tab(page, "keyframes").getAttribute("aria-selected")) === "true", "Keyframes is not the selected tab");
      expect((await page.locator(".topbar [data-act='classic']").getAttribute("href")) === "?ui=classic&view=frames", "The classic link does not open the classic Keyframes view");
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
        return { film: top(".topbar .film"), toggle: top(".topbar .dir-toggle"), tabs: top(".topbar .tabs"), position: getComputedStyle(document.querySelector(".topbar")).position };
      });
      expect(rows.position === "sticky", `Top bar position is ${rows.position}`);
      expect(rows.tabs > rows.film && rows.tabs > rows.toggle, `The tabs are not on their own row: ${JSON.stringify(rows)}`);
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
      }));
      expect(zh.lang === "zh-CN", `html lang is ${zh.lang}`);
      expect(zh.saved === "已保存在本机", `Connection pill reads "${zh.saved}"`);
      expect(zh.counts === "3 场 · 8 个镜头", `Counts read "${zh.counts}"`);
      expect(zh.language === "English", `The language switch reads "${zh.language}"`);
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
    name: "next-shell-classic",
    query: FIXTURE,
    async run({ page }) {
      await ready(page);
      await tab(page, "plan").click();
      const panel = page.locator(".classic-view[data-view='plan']");
      await panel.waitFor();
      expect((await tab(page, "plan").getAttribute("aria-selected")) === "true", "Plan is not the selected tab");
      expect((await panel.locator("h1").textContent()) === "Plan", "The panel does not name the view");
      const link = panel.locator("[data-act='open-classic']");
      expect((await link.getAttribute("href")) === "?ui=classic&view=plan", `The classic link is ${await link.getAttribute("href")}`);
      expect((await link.textContent()) === "Open Plan in the classic studio", `The classic link reads "${await link.textContent()}"`);
      const scroll = await page.evaluate(() => ({ height: document.scrollingElement.scrollHeight, inner: window.innerHeight }));
      expect(scroll.height <= scroll.inner, "The classic panel makes the page scroll");
      await shot(page, "next-shell-classic-plan");

      // Keyboard: arrows move along the tabs, Enter opens one.
      await tab(page, "plan").focus();
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      expect((await page.evaluate(() => document.activeElement?.getAttribute("data-view"))) === "assets", "ArrowRight did not move focus to Assets");
      await page.keyboard.press("Enter");
      await page.locator(".classic-view[data-view='assets']").waitFor();
      expect((await page.locator(".classic-view [data-act='open-classic']").getAttribute("href")) === "?ui=classic&view=assets", "Assets links to the wrong classic view");

      await page.locator(".classic-view [data-act='back-to-keyframes']").click();
      await page.waitForFunction(() => document.querySelector(".topbar [data-view='keyframes']")?.getAttribute("aria-selected") === "true");
      expect(await page.locator(".classic-view").count() === 0, "The classic panel stayed after going back to Keyframes");
    },
  },
  {
    name: "next-shell-connect",
    query: "ui=next",
    allowConsoleErrors: [
      // The second load has no session on purpose.
      /^HTTP 40[13] \/api\/session$/,
      // After the cookies are cleared, a refresh that was already in flight is refused: the session ended on purpose.
      /^HTTP 403 \/api\/projects(\/[^/]+(\/(generation|director|director\/proposals))?)?$/,
    ],
    async run({ page, origin }) {
      // Live mode against the fixture studio: the shell shows its project and says it is saved.
      await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
      await page.waitForFunction(() => document.querySelector(".topbar .saved")?.textContent === "Saved locally", null, { timeout: 10000 });
      const title = await page.evaluate(() => document.querySelector(".topbar .film b")?.textContent ?? "");
      expect(title.length > 0, "The live shell shows no film title");

      // Without a session the window cannot reach the studio: Connect offers a retry, focused.
      await page.context().clearCookies();
      await page.goto(`${origin}/?ui=next`);
      const connect = page.locator(".connect[data-state='failed']");
      await connect.waitFor({ timeout: 10000 });
      expect((await connect.locator("h1").textContent()) === "Connect to your studio", "Connect has the wrong heading");
      expect(await connect.locator("code").textContent() === "pnpm studio", "The command is not shown as code");
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-act"));
      expect(focused === "retry", `Focus is on ${focused}, not Try again`);
      await shot(page, "next-shell-connect-failed");
      await connect.locator("[data-act='retry']").click();
      await page.locator(".connect[data-state='failed']").waitFor({ timeout: 10000 });
    },
  },
];
