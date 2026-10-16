// Next studio shell details from the recovery card: the top bar's menu with Disconnect this studio (its confirm, the
// logout, and the Connect screen after it), the view kept in the address (?view=) so a reload or a link reopens it, and
// the connection pill's words.
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
    name: "next-recovery-shell-disconnect",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    allowConsoleErrors: [
      // After the logout the window has no session on purpose: Try again is refused until a fresh link is opened.
      /^HTTP 40[13] \/api\//,
    ],
    async run({ page }) {
      await ready(page);
      await until(page, () => page.locator(".topbar .saved").innerText(), (value) => value === "Synced", "The live shell never connected");
      const logouts = [];
      page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/session/logout") logouts.push({ method: request.method(), csrf: request.headers()["x-openslate-csrf"] }); });

      // The menu opens from the keyboard and closes with Esc, giving focus back to its button.
      const button = page.locator(".topbar [data-act='studio-menu']");
      expect((await button.getAttribute("aria-label")) === "Studio menu", "The menu button has no name");
      await button.focus();
      await page.keyboard.press("Enter");
      await page.waitForSelector(".menu.studio-menu[role='menu']");
      expect((await button.getAttribute("aria-expanded")) === "true", "The menu button does not say it is open");
      await until(page, () => focused(page), (act) => act === "disconnect", "Focus is not on the first item", 2000);
      expect((await page.locator(".studio-menu [data-act='disconnect']").innerText()) === "Disconnect this studio…", "The item has the wrong words");
      await shot(page, "next-recovery-shell-menu-1440");
      await page.keyboard.press("Escape");
      await page.waitForSelector(".menu.studio-menu", { state: "detached" });
      await until(page, () => focused(page), (act) => act === "studio-menu", "Esc did not give focus back to the menu button", 2000);

      // The confirm says what happens; Stay connected (or Esc) leaves everything as it was.
      await button.click();
      await page.locator(".studio-menu [data-act='disconnect']").click();
      const dialog = page.locator("dialog[data-dialog='disconnect']");
      await dialog.waitFor();
      expect(await dialog.evaluate((node) => node.open && node.matches(":modal")), "The confirm is not a modal dialog");
      expect((await dialog.locator("h2").innerText()) === "Disconnect this studio?", "The confirm has the wrong title");
      expect((await dialog.locator("code").innerText()) === "pnpm studio", "The confirm does not show how to come back");
      expect(/anything already running carries on/.test(await dialog.locator("#disconnect-body").innerText()), "The confirm does not say running work carries on");
      await shot(page, "next-recovery-shell-disconnect-1440");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await until(page, () => focused(page), (act) => act === "studio-menu", "Focus did not go back to the menu button after Esc", 2000);
      expect(logouts.length === 0, "Esc disconnected the studio");

      // Disconnect: the session ends and the page becomes the Connect screen, which says so.
      await button.click();
      await page.locator(".studio-menu [data-act='disconnect']").click();
      await dialog.waitFor();
      await dialog.locator("[data-act='confirm-disconnect']").click();
      const connect = page.locator(".connect[data-state='disconnected']");
      await connect.waitFor({ timeout: 10000 });
      expect(logouts.length === 1 && logouts[0].method === "POST" && /^[A-Za-z0-9_-]{43}$/.test(logouts[0].csrf ?? ""), `The logout was ${JSON.stringify(logouts)}`);
      expect((await connect.locator("h1").innerText()) === "Disconnected", "Connect does not say Disconnected");
      expect((await connect.locator(".connect-reason").innerText()) === "You disconnected this window. Your films are saved on this computer.", "Connect has the wrong reason");
      await until(page, () => focused(page), (act) => act === "retry", "Focus is not on Try again", 2000);
      await shot(page, "next-recovery-shell-disconnected-1440");
      // The session really ended: without a fresh link, Try again says it is still not connected.
      await connect.locator("[data-act='retry']").click();
      await until(page, () => connect.locator("[data-note='still']").innerText().catch(() => ""), (value) => value === "Still not connected. Open a fresh link first, then try again.", "Try again without a link said nothing");
      expect(await page.locator(".connect[data-state='disconnected']").count() === 1, "Try again lost the disconnected screen");
    },
  },
  {
    name: "next-recovery-shell-disconnect-fixture",
    query: FIXTURE,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      // On a phone the menu sits beside Settings on the first row, and the sample studio connects again on Try again.
      await ready(page);
      const rows = await page.evaluate(() => {
        const top = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().top);
        return { menu: top(".topbar [data-act='studio-menu']"), settings: top(".topbar [data-act='settings']"), scroll: document.documentElement.scrollWidth - window.innerWidth };
      });
      expect(Math.abs(rows.menu - rows.settings) < 8 && rows.scroll <= 0, `The menu is out of place on a phone: ${JSON.stringify(rows)}`);
      await page.locator(".topbar [data-act='studio-menu']").click();
      const menu = await page.locator(".menu.studio-menu").boundingBox();
      expect(menu && menu.x >= 8 && menu.x + menu.width <= 390 - 8, `The menu runs off the screen: ${JSON.stringify(menu)}`);
      await shot(page, "next-recovery-shell-menu-390");
      await page.locator(".studio-menu [data-act='disconnect']").click();
      await page.locator("dialog[data-dialog='disconnect'] [data-act='confirm-disconnect']").click();
      await page.waitForSelector(".connect[data-state='disconnected']");
      await page.locator(".connect [data-act='retry']").click();
      await ready(page);
    },
  },
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
