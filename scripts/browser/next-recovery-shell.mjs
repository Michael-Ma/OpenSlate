// Next studio shell details from the recovery card: the view kept in the address (?view=) so a reload or a link
// reopens it.
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

async function ready(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  await page.waitForSelector(".topbar .counts", { timeout: 20000, state: "attached" });
}

const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-act"));
const view = (page) => page.evaluate(() => document.querySelector(".app")?.getAttribute("data-view"));
const asked = (page) => page.evaluate(() => new URLSearchParams(location.search).get("view"));
const tab = (page, name) => page.locator(`.topbar [data-act='tab'][data-view='${name}']`);

export const scenarios = [
  {
    name: "next-recovery-shell-view-url",
    query: `${FIXTURE}&view=plan`,
    viewport: { width: 1440, height: 900 },
    async run({ page, origin }) {
      // A link opens the view it names.
      await ready(page);
      await until(page, () => view(page), (value) => value === "plan", "?view=plan did not open Plan");
      expect((await tab(page, "plan").getAttribute("aria-selected")) === "true", "Plan is not the selected tab");
      // Every view the person opens goes into the address; everything else in it stays.
      for (const name of ["film", "assets", "keyframes"]) {
        await tab(page, name).click();
        await until(page, () => asked(page), (value) => value === name, `The address did not follow ${name}`);
      }
      await page.locator(".topbar [data-act='settings']").click();
      await until(page, () => asked(page), (value) => value === "settings", "The address did not follow Settings");
      await page.locator(".topbar [data-act='all-films']").click();
      await until(page, () => asked(page), (value) => value === "start", "The address did not follow All films");
      const search = new URLSearchParams(await page.evaluate(() => location.search));
      expect(search.get("ui") === "next" && search.get("fixture") === "last-ferry", `The address lost its other parts: ${search}`);

      // A reload reopens the view on screen.
      await page.locator("[data-act='open-film']").first().click();
      await page.waitForSelector(".app:not([data-view='start'])");
      await tab(page, "film").click();
      await until(page, () => asked(page), (value) => value === "film", "The address did not follow Film");
      await page.reload();
      await ready(page);
      await until(page, () => view(page), (value) => value === "film", "A reload did not reopen Film");
      await page.waitForSelector("main.work[data-view='film']");

      // The classic studio's names open the same views, and the address then uses this studio's own.
      await page.goto(`${origin}/?${FIXTURE}&view=cut`);
      await ready(page);
      await until(page, () => view(page), (value) => value === "film", "?view=cut did not open Film");
      await page.goto(`${origin}/?${FIXTURE}&view=frames`);
      await ready(page);
      await until(page, () => view(page), (value) => value === "keyframes", "?view=frames did not open Keyframes");
      await until(page, () => asked(page), (value) => value === "keyframes", "The address kept the classic name");
      // An unknown view opens the studio as usual.
      await page.goto(`${origin}/?${FIXTURE}&view=nowhere`);
      await ready(page);
      await until(page, () => view(page), (value) => value === "keyframes", "An unknown view did not open Keyframes");
    },
  },
  {
    name: "next-recovery-shell-view-url-live",
    query: "ui=next&view=assets",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      // Live: the launch link is exchanged and stripped, and the view it named still opens and stays in the address.
      await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
      await until(page, () => view(page), (value) => value === "assets", "?view=assets did not open Assets");
      await page.waitForSelector("main.work[data-view='assets']");
      expect(!(await page.evaluate(() => location.hash)), "The launch code stayed in the address");
      expect((await asked(page)) === "assets", "The address lost the view");
      await page.reload();
      await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
      await until(page, () => view(page), (value) => value === "assets", "A reload did not reopen Assets");
    },
  },
];
