// Next UI, Film view, on the Last Ferry fixture film (?ui=next&fixture=last-ferry): nothing is rendered, saved or
// downloaded. Layout numbers come from docs/ai/prototypes/last-ferry/film.html at 1440 x 900. `&film=` presets open
// states the sample film cannot reach by itself (every clip made, a demo film, an interrupted export).
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (label) => `shot-${label.replace(".", "-")}`;
const shots = (() => {
  const dir = join(process.platform === "win32" ? tmpdir() : "/tmp", "p5-build", "film");
  try { mkdirSync(dir, { recursive: true }); return dir; } catch { return tmpdir(); }
})();
const screenshot = (page, name, options = {}) => page.screenshot({ path: join(shots, `next-film-${name}.png`), ...options });

async function openFilm(page) {
  await page.waitForSelector(".topbar [data-act='tab'][data-view='film']", { timeout: 20000 });
  await page.click(".topbar [data-act='tab'][data-view='film']");
  await page.waitForSelector("main.film-work[data-view='film'] .player", { timeout: 10000 });
  // The Export panel, the music and the pictures have loaded.
  await page.waitForSelector(".export[data-state]", { timeout: 10000 });
  await page.waitForSelector(".mblk, .none-music", { timeout: 10000 });
  await page.waitForFunction(() => document.querySelector(".player .fv-still")?.complete, null, { timeout: 10000 });
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

async function box(page, selector) {
  const value = await page.locator(selector).first().boundingBox();
  if (!value) throw new Error(`${selector} is not on screen`);
  return { left: value.x, top: value.y, right: value.x + value.width, bottom: value.y + value.height, width: value.width };
}

function near(name, actual, expected, tolerance = 10) {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${name} is ${Math.round(actual)}, expected ${expected} ± ${tolerance}`);
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function noSidewaysScroll(page, width) {
  const size = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(size <= width, `The page scrolls sideways: ${size}px wide at ${width}px`);
}

/** The readiness table keeps readable rows and scrolls inside itself; Export and its size line stay in the panel. */
async function readableChecks(page, { scrolls }) {
  const table = await page.locator(".export .checks").evaluate((el) => ({
    rows: [...el.querySelectorAll("[role='rowheader']")].map((b) => b.getBoundingClientRect().height),
    scroll: el.scrollHeight,
    client: el.clientHeight,
  }));
  const short = table.rows.filter((height) => height < 16);
  expect(!short.length, `Readiness rows are squeezed to ${short.map(Math.round).join(", ")} px`);
  if (scrolls) expect(table.scroll > table.client + 4, `The readiness table does not scroll: ${table.scroll} in ${table.client}`);
  expect(table.client >= 80, `The readiness table shows fewer than three rows: ${table.client} px`);
  const panel = await box(page, ".export");
  const go = await box(page, ".export [data-act='export']");
  expect(go.top >= panel.top && go.bottom <= panel.bottom, `Export is outside its panel: ${go.top}-${go.bottom} in ${panel.top}-${panel.bottom}`);
}

/** The element is inside the viewport (after any scrolling the view did by itself). */
async function inView(page, selector) {
  const value = await box(page, selector);
  const viewport = page.viewportSize();
  expect(value.top >= 0 && value.bottom <= viewport.height, `${selector} is off screen: ${Math.round(value.top)}-${Math.round(value.bottom)} in ${viewport.height}`);
}

async function time(page) {
  return page.locator(".player .scrub .num").first().innerText();
}

async function toastSays(page, pattern, timeout = 8000) {
  await expectText(page, ".toast", pattern, timeout);
}

async function undo(page) {
  await page.click(".toast [data-act='undo']");
  await toastSays(page, /^Undone\./, 15000);
}

/** Scene 2's picture blocks as "label:shot", once the studio has re-read the film. */
async function sceneTwo(page, want, message) {
  const read = () => [...document.querySelectorAll(".pics .blk")].slice(3, 6).map((el) => `${el.querySelector(".badge").textContent}:${el.dataset.shot}`).join();
  await page.waitForFunction((expected) => [...document.querySelectorAll(".pics .blk")].slice(3, 6).map((el) => `${el.querySelector(".badge").textContent}:${el.dataset.shot}`).join() === expected, want, { timeout: 8000 })
    .catch(async () => { throw new Error(`${message}: ${await page.evaluate(read)}`); });
}

export const scenarios = [
  {
    name: "next-film-golden-layout",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      const player = await box(page, ".player");
      near("player left", player.left, 414); near("player right", player.right, 1102);
      near("player top", player.top, 113); near("player bottom", player.bottom, 503);
      const panel = await box(page, ".export");
      near("export left", panel.left, 1118); near("export right", panel.right, 1418);
      const timeline = await box(page, ".timeline");
      near("timeline top", timeline.top, 519); near("timeline bottom", timeline.bottom, 882);
      const size = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: innerHeight }));
      expect(size.height <= size.viewport, `The page scrolls: ${size.height}px tall in ${size.viewport}px`);
      await noSidewaysScroll(page, 1440);
      await expectText(page, "[data-act='film-line']", /^48 s · 8 shots · 3 of 8 clips made$/);
      await expectText(page, "[data-act='last-export']", /^No export yet$/);
      // Only Scene 1 has clips: Export is off and says why.
      expect(await page.locator("[data-act='export']").isDisabled(), "Export is enabled before every shot has a clip");
      await expectText(page, "[data-act='why-not']", /^5 shots need a clip and settle the voice in 2\.3 and 3\.2$/);
      await expectText(page, "[data-act='export-size']", /^Length 48 s of 6:00 · 1280 × 720 · renders here, free$/);
      const noted = await page.getAttribute(`.blk[data-shot='${shot("2.2")}']`, "aria-label");
      expect(/^2\.2, Medium, \d+ s, .+, Director note a$/.test(noted ?? ""), `2.2's label leaves out its Director note: ${noted}`);
      await expectText(page, `.checks [data-shot='${shot("1.2")}']`, /1\.2\s+✓ clip\s+✓ 2\.1 s/);
      await expectText(page, `.checks [data-shot='${shot("3.2")}']`, /3\.2\s+no clip\s+no voice yet/);
      const done = await page.locator(`.checks [data-shot='${shot("1.1")}'] .y`).evaluate((el) => getComputedStyle(el).color);
      expect(done === "rgb(95, 196, 138)", `A made clip is not green: ${done}`);
      // Lanes: the too-long line is not placed; the keyframe-only and empty shots say what they lack.
      await expectText(page, `.vblk[data-shot='${shot("2.3")}']`, /^2\.3\s+7\.4 s, too long · not placed$/);
      expect((await page.locator(`.vblk[data-shot='${shot("1.2")}']`).getAttribute("data-state")) === "placed", "1.2's settled line is not placed");
      expect(await page.locator(`.blk.kfonly[data-shot='${shot("2.1")}']`).count() === 1, "2.1 is not drawn as keyframe only");
      await expectText(page, `.blk.empty[data-shot='${shot("3.1")}'] .lack`, /^nothing yet$/);
      await expectText(page, ".mblk", /^low-tide\.mp3 · -18 dB$/);
      await expectText(page, ".tl-tools", /^Select a shot to change its length or order, or the music to change it\.$/);
      await expectText(page, ".player .approx", /^Browser preview; the exported MP4 is exact$/);
      // Nothing app-made is amber: amber is the Director's.
      const amber = await page.evaluate(() => [...document.querySelectorAll(".film-work *")].filter((el) => !el.classList.contains("letter")).some((el) => /240, 178, 74/.test(getComputedStyle(el).color + getComputedStyle(el).backgroundColor)));
      expect(!amber, "Something in the Film view other than a Director letter is amber");
      await screenshot(page, "golden-1440");
    },
  },
  {
    name: "next-film-playback",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await page.click("[data-act='play']");
      expect((await page.getAttribute("[data-act='play']", "aria-label")) === "Pause", "Play did not start the film");
      await page.waitForTimeout(1400);
      expect(/^0:0[1-9]$/.test(await time(page)), `The clock did not move: ${await time(page)}`);
      // 1.1 has a clip; the sample film plays its keyframe with the motion preview.
      const moving = await page.locator(".player .pv-anim").evaluate((el) => el.style.transform);
      expect(moving && moving !== "none", `1.1 does not move while it plays: ${moving}`);
      await page.click("[data-act='play']");
      expect((await page.getAttribute("[data-act='play']", "aria-label")) === "Play the film", "Pause did not stop the film");
      // Next: 1.2 at 0:06, and its line is spoken as a subtitle.
      await page.click("[data-act='next']");
      expect((await page.getAttribute(".player", "data-shot")) === shot("1.2"), "Next did not go to 1.2");
      expect((await time(page)) === "0:06", `Next went to ${await time(page)}`);
      await expectText(page, ".subtitle", /NARRATION[\s\S]*“One for the morning boat\.”/i);
      expect((await page.locator(".blk .head-sel, .pics .head-sel").first().evaluate((el) => el.style.left)).endsWith("%"), "The playhead is not placed");
      // The scrubber seeks: 2.1 is keyframe only (dimmed), 3.1 has nothing yet.
      await page.locator("[data-act='scrub']").fill("18");
      await expectText(page, ".player .pv-top", /2\.1\s*Keyframe only · no clip yet/);
      expect(await page.locator(".player .pic.dim").count() === 1, "A keyframe-only shot is not dimmed");
      await expectText(page, ".subtitle", /^$/);
      await page.locator("[data-act='scrub']").fill("33");
      await expectText(page, ".player .pv-top", /3\.1\s*Nothing made yet/);
      await expectText(page, ".player .dashed-frame", /No keyframe yet[\s\S]*The ferry pulls away into the fog\./);
      // The music plays from 0:04.
      await expectText(page, "[data-act='music-on']", /low-tide\.mp3 · -18 dB/);
      await page.locator("[data-act='scrub']").fill("2");
      expect(await page.locator("[data-act='music-on']").count() === 0, "The music indicator shows before the music starts");
      // A too-long line is never heard: 2.3 at 0:28 shows no subtitle.
      await page.locator("[data-act='scrub']").fill("28");
      await expectText(page, ".subtitle", /^$/);
      // Previous: back to this shot's start, then the shot before.
      await page.click("[data-act='prev']");
      expect((await time(page)) === "0:26", `Previous went to ${await time(page)}`);
      await page.click("[data-act='prev']");
      expect((await time(page)) === "0:22", `Previous again went to ${await time(page)}`);
      // The ruler seeks too.
      const ruler = await box(page, ".ruler");
      await page.mouse.click(ruler.left + 1, ruler.top + 8);
      expect((await time(page)) === "0:00", `The ruler did not seek to the start: ${await time(page)}`);
      await screenshot(page, "playback-1440");
    },
  },
  {
    name: "next-film-length-and-order",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await page.click(`.blk[data-shot='${shot("2.1")}']`);
      expect((await page.getAttribute(`.blk[data-shot='${shot("2.1")}']`, "aria-pressed")) === "true", "2.1 is not selected");
      await expectText(page, "[data-act='tools-shot']", /^2\.1 Wide$/);
      expect((await time(page)) === "0:17", `Selecting 2.1 did not seek to it: ${await time(page)}`);
      // Length: free and undoable; the film gets longer.
      await page.click("[data-act='len'][data-d='1']");
      await toastSays(page, /^2\.1 is 6 s\. The film is 49 s\./);
      await expectText(page, "[data-act='film-line']", /^49 s · /);
      await expectText(page, ".stepper output", /^6 s$/);
      await undo(page);
      await expectText(page, "[data-act='film-line']", /^48 s · /);
      // Order: within the scene only; 2.1 is first, so it cannot move earlier.
      expect(await page.locator("[data-act='move'][data-d='-1']").isDisabled(), "The first shot of a scene can move earlier");
      expect((await page.getAttribute("[data-act='move'][data-d='-1']", "title")) === "First in its scene; reorder scenes in the Plan", "No reason for the disabled move");
      await page.click(`.blk[data-shot='${shot("2.2")}']`);
      await page.click("[data-act='move'][data-d='-1']");
      await toastSays(page, /^Moved 2\.2; it is now 2\.1\. Nothing made goes out of date\./);
      await sceneTwo(page, `2.1:${shot("2.2")},2.2:${shot("2.1")},2.3:${shot("2.3")}`, "The scene did not reorder");
      await expectText(page, "[data-act='tools-shot']", /^2\.1 Medium$/);
      // The playhead follows the moved shot to its new place.
      await page.waitForFunction(() => document.querySelector(".player .scrub .num")?.textContent === "0:17", null, { timeout: 8000 })
        .catch(async () => { throw new Error(`The playhead did not follow the moved shot: ${await time(page)}`); });
      await undo(page);
      await sceneTwo(page, `2.1:${shot("2.1")},2.2:${shot("2.2")},2.3:${shot("2.3")}`, "Undo did not restore the order");
      // 1.1 has a clip: its length note says a new length outdates it.
      await page.click(`.blk[data-shot='${shot("1.1")}']`);
      await expectText(page, ".tl-tools .hint", /^a new length outdates its clip$/);
      await page.keyboard.press("Escape");
      await expectText(page, ".tl-tools", /^Select a shot/);
      await screenshot(page, "length-order-1440");
    },
  },
  {
    name: "next-film-music",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await page.click(".mblk");
      await expectText(page, "[data-act='tools-music']", /^Music · low-tide\.mp3$/);
      expect((await time(page)) === "0:04", `Selecting the music did not seek to its start: ${await time(page)}`);
      await page.click("[data-act='mstart'][data-d='1']");
      await toastSays(page, /^Music starts at 0:05\./);
      await expectText(page, ".tl-tools .stepper output", /^0:05$/);
      await undo(page);
      await expectText(page, ".tl-tools .stepper output", /^0:04$/);
      // Volume is saved when the slider is let go.
      await page.locator("[data-act='gain']").evaluate((el) => {
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
        set.call(el, "-12");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await toastSays(page, /^Music volume -12 dB\./);
      await expectText(page, ".mblk", /^low-tide\.mp3 · -12 dB$/);
      // Arrow keys: a run of steps is saved once, after the keys rest, so one Undo takes it all back.
      await page.focus("[data-act='gain']");
      for (let n = 0; n < 3; n++) await page.keyboard.press("ArrowLeft");
      await expectText(page, ".tl-tools output.num", /^-15 dB$/);
      await toastSays(page, /^Music volume -15 dB\./);
      await expectText(page, ".mblk", /^low-tide\.mp3 · -15 dB$/);
      await undo(page);
      await expectText(page, ".mblk", /^low-tide\.mp3 · -12 dB$/);
      // Mute: the indicator goes away and the block says so.
      await page.click("[data-act='mute-switch']");
      await toastSays(page, /^Music muted\./);
      await expectText(page, ".mblk", /^low-tide\.mp3 · muted$/);
      expect((await page.getAttribute("[data-act='mute']", "aria-pressed")) === "true", "The lane's mute button does not show muted");
      expect(await page.locator("[data-act='music-on']").count() === 0, "Muted music still shows as playing");
      await undo(page);
      // Change music: only music-role recordings are offered.
      await page.click("[data-act='music-menu']");
      await page.waitForSelector(".fv-menu[role='menu']");
      const items = await page.locator(".fv-menu [data-act='pick-music']").evaluateAll((els) => els.map((el) => `${el.dataset.audio}=${el.textContent}`));
      expect(items.join("|") === "audio-low-tide=low-tide.mp31:12|audio-foghorn=foghorn-theme.wav0:58|=No music", `The music menu lists ${items}`);
      expect((await page.evaluate(() => document.activeElement?.getAttribute("aria-checked"))) === "true", "The menu does not focus the chosen music");
      await page.keyboard.press("Escape");
      expect(await page.locator(".fv-menu").count() === 0, "Esc did not close the menu");
      expect((await page.evaluate(() => document.activeElement?.dataset.act)) === "music-menu", "Focus did not return to Change music");
      await page.click("[data-act='music-menu']");
      await page.click(".fv-menu [data-audio='audio-foghorn']");
      await toastSays(page, /^Music is foghorn-theme\.wav\./);
      await expectText(page, ".mblk", /^foghorn-theme\.wav · /);
      await page.focus("[data-act='music-menu']");
      await page.keyboard.press("Enter");
      await page.waitForSelector(".fv-menu[role='menu']");
      await page.keyboard.press("End");
      await page.keyboard.press("ArrowUp");
      expect((await page.evaluate(() => document.activeElement?.dataset.audio)) === "", "ArrowUp from the end did not reach No music");
      const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
      expect(ring !== "none", "A focused music menu item shows no focus ring");
      await page.keyboard.press("Enter");
      await toastSays(page, /^No music\./);
      await expectText(page, ".none-music", /^No music\.\s*Choose music$/);
      await expectText(page, ".tl-tools", /^Select a shot/);
      // Change music went away with the music: focus moves to Choose music, not to the page.
      await page.waitForFunction(() => document.activeElement?.dataset.act === "choose-music", null, { timeout: 4000 })
        .catch(async () => { throw new Error(`Focus after No music: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`); });
      await page.keyboard.press("Enter");
      await page.waitForSelector(".fv-menu[role='menu']");
      await page.keyboard.press("Home");
      await page.keyboard.press("Enter");
      await toastSays(page, /^Music is low-tide\.mp3\./);
      await page.waitForFunction(() => document.activeElement?.dataset.act === "sel-music", null, { timeout: 4000 })
        .catch(async () => { throw new Error(`Focus after choosing music: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`); });
      await screenshot(page, "music-1440");
    },
  },
  {
    name: "next-film-export",
    query: `${query}&film=ready`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await expectText(page, "[data-act='film-line']", /^50 s · 8 shots · 8 of 8 clips made$/);
      await expectText(page, "[data-act='last-export']", /^Last export Today \d\d:\d\d · changed since: shot order, music\s*Download MP4\s*2 earlier in Assets$/);
      await expectText(page, ".export .big", /^Ready to export\s*50 s · every clip current, every voice line settled$/);
      await expectText(page, "#fv-export-why", /^MP4 of the whole film$/);
      await expectText(page, "[data-act='export-size']", /^Length 50 s of 6:00 · 1280 × 720 · renders here, free$/);
      const why = await box(page, "#fv-export-why");
      expect(why.bottom <= (await box(page, ".export")).bottom, "The export size line is hidden below the panel");
      await page.click("[data-act='export']");
      await expectText(page, ".export .big", /^Exporting…\s*MP4 · 50 s · 1280 × 720$/);
      await expectText(page, "[data-act='elapsed']", /^0:0\d elapsed$/);
      expect(await page.locator("[data-act='elapsed']").evaluate((el) => !el.closest("[role='status'], [aria-live]:not([aria-live='off'])")), "The elapsed time is inside a live region and is announced every second");
      await expectText(page, ".export .rendering [role='status']", /^Rendering on this computer$/);
      expect(await page.locator(".export [role='progressbar']").count() === 1, "No progress bar while rendering");
      expect(!/%/.test(await page.locator(".export").innerText()), "The export shows a percentage it does not have");
      await screenshot(page, "rendering-1440");
      await page.click("[data-act='cancel-export']");
      await expectText(page, "[data-act='export-cancelled']", /^Export cancelled\. Nothing was saved\.$/);
      expect(!(await page.locator("[data-act='export']").isDisabled()), "Export is off after a cancel");
      await page.click("[data-act='export']");
      await expectText(page, "[data-act='last-export']", /^Last export Today \d\d:\d\d · matches the film\s*Download MP4\s*3 earlier in Assets$/, 15000);
      await expectText(page, ".toast", /^Export finished\. The MP4 is ready to download\./);
      await page.click("[data-act='download']");
      await toastSays(page, /^This sample film has no file to download\./);
      // An edit marks the last export as changed, and it stays downloadable.
      await page.click(`.blk[data-shot='${shot("3.2")}']`);
      await page.click("[data-act='move'][data-d='-1']");
      await expectText(page, "[data-act='changed-since']", /^changed since: shot order$/);
      expect(await page.locator("[data-act='download']").count() === 1, "The last export is no longer downloadable after an edit");
      await screenshot(page, "export-done-1440");
      // "3 earlier in Assets" opens Assets on the exports: the latest and the three before it.
      await page.click("[data-act='earlier-exports']");
      await page.waitForSelector("main.work[data-view='assets'] .tile");
      expect((await page.locator("[data-act='role-filter'][data-role='export']").getAttribute("aria-pressed")) === "true", "Assets did not open on the exports");
      await page.waitForFunction(() => document.querySelectorAll("main.work[data-view='assets'] .tile").length === 4, null, { timeout: 5000 })
        .catch(async () => { throw new Error(`Assets shows ${await page.locator("main.work[data-view='assets'] .tile").count()} tiles, not the 4 exports`); });
      // The tab alone opens on everything again.
      await page.click(".topbar [data-act='tab'][data-view='film']");
      await page.click(".topbar [data-act='tab'][data-view='assets']");
      await page.waitForSelector("main.work[data-view='assets'] [data-act='role-filter'][data-role='all'][aria-pressed='true']");
    },
  },
  {
    name: "next-film-check-again",
    query: `${query}&film=interrupted`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await page.waitForSelector(".export[data-state='interrupted']", { timeout: 10000 });
      await expectText(page, ".export .big", /^Export interrupted\s*Started Today \d\d:\d\d · MP4$/);
      await expectText(page, ".export .impact", /Check again looks for the finished file; it never renders again\./);
      await screenshot(page, "interrupted-1440");
      await page.click("[data-act='check-again']");
      await expectText(page, "[data-act='check-again']", /^Checking…$/);
      await toastSays(page, /^Found the finished export\. Nothing was rendered again\./);
      await page.waitForSelector(".export[data-state='idle']");
      await expectText(page, "[data-act='last-export']", /matches the film/);
    },
  },
  {
    name: "next-film-failed-and-long",
    query: `${query}&film=failed`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await expectText(page, "[data-act='export-failed']", /The last export stopped \(RENDER_FAILED\)\./);
      await readableChecks(page, { scrolls: true });
      expect(!(await page.locator("[data-act='export']").isDisabled()), "Export is off after a failed export");
      await screenshot(page, "failed-1440");
      // A 20-shot film: the table scrolls and the page does not.
      await page.goto(page.url().replace("film=failed", "film=long"));
      await openFilm(page);
      await expectText(page, "[data-act='film-line']", /^108 s · 20 shots · 3 of 20 clips made$/);
      await readableChecks(page, { scrolls: true });
      const size = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: innerHeight }));
      expect(size.height <= size.viewport, `The page scrolls: ${size.height}px tall in ${size.viewport}px`);
      await page.locator(".export .checks").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expectText(page, `.checks [data-shot='shot-6-4']`, /6\.4\s+no clip\s+no line/);
      await screenshot(page, "long-1440");
    },
  },
  {
    name: "next-film-short-screens",
    query,
    viewport: { width: 1280, height: 720 },
    async run({ page }) {
      await openFilm(page);
      await readableChecks(page, { scrolls: true });
      await noSidewaysScroll(page, 1280);
      // The workspace scrolls when it is taller than the screen, and a selection brings its tools into view.
      const work = await page.locator(".film-work").evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight, overflow: getComputedStyle(el).overflowY }));
      expect(work.overflow === "auto", `The workspace cannot scroll: ${JSON.stringify(work)}`);
      await page.click(`.blk[data-shot='${shot("2.1")}']`);
      await expectText(page, "[data-act='tools-shot']", /^2\.1 Wide$/);
      await inView(page, ".tl-tools");
      await inView(page, "[data-act='move'][data-d='1']");
      await page.click("[data-act='len'][data-d='1']");
      await toastSays(page, /^2\.1 is 6 s\./);
      await undo(page);
      await page.click(".mblk");
      await expectText(page, "[data-act='tools-music']", /^Music · low-tide\.mp3$/);
      await inView(page, "[data-act='music-menu']");
      await inView(page, ".musicl");
      await screenshot(page, "short-1280x720");
      // 1366 x 768: readable rows, nothing cut off below the timeline.
      await page.setViewportSize({ width: 1366, height: 768 });
      await page.waitForTimeout(300);
      await readableChecks(page, { scrolls: true });
      await page.locator(".film-work").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await inView(page, ".tl-tools");
      await noSidewaysScroll(page, 1366);
      await screenshot(page, "short-1366x768");
    },
  },
  {
    // Stopped: the server refuses to start an export (MEDIA_PAUSED), so Export is off and says why until Continue.
    name: "next-film-stopped",
    query: `${query}&film=stopped`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await expectText(page, ".export .big", /^Ready to export/);
      // Exports render on this computer and spend nothing, so they stay available while the film is stopped (card B12).
      expect(!(await page.locator("[data-act='export']").isDisabled()), "Export is off while the film is stopped");
      expect(await page.locator("[data-act='export']").evaluate((el) => el.classList.contains("primary")), "A ready Export is not the white primary action while stopped");
      await expectText(page, "#fv-export-why", /^MP4 of the whole film$/);
      await screenshot(page, "stopped-1440");
      await page.click("[data-act='export']");
      await page.waitForSelector(".export[data-state='rendering']", { timeout: 8000 });
    },
  },
  {
    // An export prepared and never started (a restart came first): nothing renders it, so Export again is offered.
    name: "next-film-stalled",
    query: `${query}&film=stalled`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await page.waitForSelector(".export[data-state='idle']", { timeout: 10000 });
      await expectText(page, "[data-act='export-failed']", /The last export never started: OpenSlate restarted first\. Nothing was rendered; you can export again\.$/);
      expect(!(await page.locator("[data-act='export']").isDisabled()), "Export is off after an export that never started");
      await page.click("[data-act='export']");
      await page.waitForSelector(".export[data-state='rendering']", { timeout: 8000 });
    },
  },
  {
    // The film's music is on the second page of the music library (the server pages by 40).
    name: "next-film-music-library",
    query: `${query}&film=library`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await expectText(page, ".mblk", /^foghorn-theme\.wav · -18 dB$/);
      await page.click(".mblk");
      await page.click("[data-act='music-menu']");
      await page.waitForSelector(".fv-menu[role='menu']");
      const items = await page.locator(".fv-menu [data-act='pick-music']").count();
      expect(items === 46, `The music menu lists ${items} items, not 45 recordings and No music`);
      expect((await page.evaluate(() => document.activeElement?.dataset.audio)) === "audio-foghorn", "The menu does not focus the film's music on page two");
      await page.keyboard.press("Escape");
    },
  },
  {
    // The film's music is gone from its assets: the readiness read fails on it, and the panel offers Change music.
    name: "next-film-music-missing",
    query: `${query}&film=music-missing`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await expectText(page, "[data-act='export-unavailable']", /^The film's music is unavailable, so the film can't be checked for export\. Change music\.$/);
      await expectText(page, ".mblk", /^Music · -18 dB$/);
      await expectText(page, "[data-act='export-size']", /^Length 48 s of 6:00 · /);
      await screenshot(page, "music-missing-1440");
      await page.click("[data-act='export-music']");
      await page.waitForSelector(".fv-menu[role='menu']");
      await page.click(".fv-menu [data-audio='audio-low-tide']");
      await toastSays(page, /^Music is low-tide\.mp3\./);
      await expectText(page, "[data-act='why-not']", /^5 shots need a clip/);
      expect(await page.locator("[data-act='export-music']").count() === 0, "Change music stays in the panel once the music is back");
    },
  },
  {
    name: "next-film-demo",
    query: `${query}&film=demo`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await expectText(page, ".export .big", /^Ready · demo film\s*Every clip is a demo stand-in, so the export is stamped Demo\.$/);
      await expectText(page, "[data-act='demo-mark']", /^DEMO$/);
      await expectText(page, ".player .pv-top", /✓\s*Demo clip/);
      await expectText(page, "[data-act='export']", /^Export demo MP4$/);
      await expectText(page, "#fv-export-why", /^Stamped Demo on every frame$/);
      await expectText(page, "[data-act='export-size']", /· 1280 × 720 ·/);
      await expectText(page, `.checks [data-shot='${shot("2.2")}']`, /demo clip/);
      await screenshot(page, "demo-1440");
      await page.click("[data-act='export']");
      await expectText(page, ".export .big", /stamped Demo/);
      await expectText(page, "[data-act='last-export']", /^Last export Today \d\d:\d\d · Demo · matches the film/, 15000);
    },
  },
  {
    name: "next-film-phone",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await openFilm(page);
      await noSidewaysScroll(page, 390);
      const lanes = await page.locator(".tl-scroll").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflow: getComputedStyle(el).overflowX }));
      expect(lanes.scroll > lanes.client && lanes.overflow === "auto", `The timeline does not scroll inside itself: ${JSON.stringify(lanes)}`);
      const player = await box(page, ".player");
      near("player aspect", player.width / (player.bottom - player.top), 16 / 9, 0.05);
      await page.locator(`.blk[data-shot='${shot("3.2")}']`).scrollIntoViewIfNeeded();
      await page.click(`.blk[data-shot='${shot("3.2")}']`);
      await expectText(page, "[data-act='tools-shot']", /^3\.2 Close-up$/);
      await noSidewaysScroll(page, 390);
      const tools = await page.locator(".tl-tools").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      expect(tools, "The tool row is wider than the phone");
      await page.locator(".timeline").scrollIntoViewIfNeeded();
      await screenshot(page, "phone-390");
      await page.locator(".player").scrollIntoViewIfNeeded();
      await screenshot(page, "phone-390-top");
    },
  },
  {
    name: "next-film-chinese",
    query: `${query}&film=ready&lang=zh-CN`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openFilm(page);
      await expectText(page, "[data-act='film-line']", /^50 秒 · 8 个镜头 · 已生成 8\/8 段视频$/);
      await expectText(page, "[data-act='last-export']", /^上次导出 今天 \d\d:\d\d · 之后有改动：镜头顺序、音乐\s*下载 MP4\s*素材里还有 2 个$/);
      await expectText(page, "#fv-export-why", /^整部影片的 MP4$/);
      await expectText(page, "[data-act='export-size']", /^时长 50 秒，上限 6 分钟 · 1280 × 720 · 在本机渲染，免费$/);
      await page.click(`.blk[data-shot='${shot("2.3")}']`);
      await expectText(page, ".tl-tools", /至少 8 秒（配音） · 改时长会让视频过期/);
      const size = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, viewport: innerHeight }));
      expect(size.height <= size.viewport, "The Chinese page scrolls at 1440 x 900");
      await noSidewaysScroll(page, 1440);
      // Nothing clips in the tool row.
      const clipped = await page.locator(".tl-tools > *").evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      expect(!clipped.length, `Clipped in the tool row: ${clipped}`);
      await screenshot(page, "chinese-1440");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(300);
      await noSidewaysScroll(page, 390);
      await screenshot(page, "chinese-390");
    },
  },
  {
    name: "next-film-keyboard-and-motion",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await openFilm(page);
      // Blocks are buttons: focus, Enter selects, Escape clears.
      await page.focus(`.blk[data-shot='${shot("1.3")}']`);
      await page.keyboard.press("Enter");
      expect((await page.getAttribute(`.blk[data-shot='${shot("1.3")}']`, "aria-pressed")) === "true", "Enter did not select the block");
      const ring = await page.locator(`.blk[data-shot='${shot("1.3")}']`).evaluate((el) => getComputedStyle(el).outlineStyle);
      expect(ring !== "none", "A selected, focused block shows no outline");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Escape");
      await expectText(page, ".tl-tools", /^Select a shot/);
      // Keyboard on the length stepper keeps focus after an edit.
      await page.click(`.blk[data-shot='${shot("2.1")}']`);
      await page.focus("[data-act='len'][data-d='1']");
      await page.keyboard.press("Enter");
      await toastSays(page, /^2\.1 is 6 s\./);
      // A keyboard move that makes 2.2 last turns Move later off: focus goes to Move earlier, not to the page.
      await page.click(`.blk[data-shot='${shot("2.2")}']`);
      await page.focus("[data-act='move'][data-d='1']");
      await page.keyboard.press("Enter");
      await toastSays(page, /^Moved 2\.2; it is now 2\.3\./);
      await page.waitForFunction(() => document.activeElement?.matches("[data-act='move'][data-d='-1']"), null, { timeout: 4000 })
        .catch(async () => { throw new Error(`Focus after the move: ${await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 80))}`); });
      // Under reduced motion the picture stays still while the film plays, and the music meter does not move.
      await page.locator("[data-act='scrub']").fill("5");
      await page.focus("[data-act='play']");
      await page.keyboard.press("Space");
      await page.waitForTimeout(800);
      const still = await page.locator(".player .pv-anim").evaluate((el) => el.style.transform);
      expect(still === "none", `The picture moves under reduced motion: ${still}`);
      await expectText(page, "[data-act='music-on']", /low-tide\.mp3/);
      expect(await page.locator(".meter").count() === 0, "The music meter animates under reduced motion");
      await page.keyboard.press("Space");
      expect((await page.getAttribute("[data-act='play']", "aria-label")) === "Play the film", "Space did not pause");
    },
  },
  {
    // The real (fake-provider) fixture studio, not the sample film: the server's export, media, music-library and
    // playback reads answer, and its storyboard takes the Film view's moveShot and length edits with Undo.
    name: "next-film-live",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await page.waitForSelector(".topbar [data-act='tab'][data-view='film']", { timeout: 20000 });
      await page.click(".topbar [data-act='tab'][data-view='film']");
      await page.waitForSelector("main.film-work[data-view='film'] .player", { timeout: 15000 });
      await expectText(page, "[data-act='film-line']", /^\d+ s · \d+ shots · \d+ of \d+ clips made$/);
      await expectText(page, ".export .big", /^(Not ready to export|Ready)/, 15000);
      await page.waitForSelector(".mblk, .none-music");
      const first = page.locator(".pics .blk").first();
      const id = await first.getAttribute("data-shot");
      await first.click();
      await expectText(page, "[data-act='tools-shot']", /^1\.1 /);
      await page.click("[data-act='move'][data-d='1']");
      await toastSays(page, /^Moved 1\.1; it is now 1\.2\./, 15000);
      // The toast comes with the receipt; the moved block follows once the studio has re-read the film.
      await page.waitForFunction((shotId) => document.querySelectorAll(".pics .blk")[1]?.getAttribute("data-shot") === shotId, id, { timeout: 15000 })
        .catch(() => { throw new Error("The server did not move the shot later"); });
      await undo(page);
      await page.waitForFunction((shotId) => document.querySelector(".pics .blk")?.getAttribute("data-shot") === shotId, id, { timeout: 15000 });
      const line = await page.locator("[data-act='film-line']").innerText();
      await page.click("[data-act='len'][data-d='1']");
      await toastSays(page, /^1\.1 is \d+ s\. The film is \d+ s/, 15000);
      await page.waitForFunction((before) => document.querySelector("[data-act='film-line']")?.textContent !== before, line, { timeout: 15000 })
        .catch(() => { throw new Error("The film length did not change"); });
      await undo(page);
      if (await page.locator("[data-act='choose-music']").count()) {
        await page.click("[data-act='choose-music']");
        await page.waitForSelector(".fv-menu[role='menu']");
        await page.keyboard.press("Escape");
      }
      await screenshot(page, "live-1440");
    },
  },
];
