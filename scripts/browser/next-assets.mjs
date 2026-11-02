// Next UI, Assets view (docs/ai/prototypes/last-ferry/assets.html). The fixture scenarios use the Last Ferry
// sample film (?ui=next&fixture=last-ferry): nothing is generated, charged, saved or sent. The live scenario
// imports a real PNG and WAV through the studio's upload routes on the disposable fixture studio.
// Set BROWSER_CHECK_SHOTS=/some/dir to save screenshots.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

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
    // A number and its unit are joined by a no-break space (i18n keepTogether); it reads as a space here.
    last = (await page.locator(selector).first().innerText().catch(() => "")).replaceAll("\u00a0", " ");
    if (pattern.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} never matched ${pattern}; last text: ${JSON.stringify(last)}`);
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
}

/** Open the Assets tab and wait for the library. */
async function openAssets(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  // The film's meta line has been read (the top bar hides it between 900 and 1099 px, so attached is enough).
  await page.waitForSelector(".topbar .film span", { timeout: 20000, state: "attached" });
  await page.locator(".topbar [data-act='tab'][data-view='assets']").click();
  await page.waitForSelector("main[data-view='assets'][data-state='ready']", { timeout: 15000 });
}

const tile = (page, selector) => page.locator(`main[data-view='assets'] .tile${selector}`);
const named = (page, name) => page.locator("main[data-view='assets'] .tile").filter({ hasText: name });
const roleButton = (page, role) => page.locator(`[data-act='role-filter'][data-role='${role}']`);

// A tile opens the shared media viewer: the title in its head, the picture or player on its stage, details and actions beside them.
const VIEWER = "dialog.media-viewer";
const VIEWER_TITLE = "#media-viewer-title";
const DETAIL = `${VIEWER} aside.mv-side .detail`;

/** Open a tile in the viewer and wait for its details. */
async function openTile(page, locator, title) {
  await locator.scrollIntoViewIfNeeded();
  await locator.click();
  await page.waitForSelector(DETAIL);
  if (title) await expectText(page, VIEWER_TITLE, title);
}

async function closeViewer(page) {
  await page.locator(`${VIEWER} [data-act='viewer-close']`).click();
  await page.waitForSelector(VIEWER, { state: "detached" });
}

/** The viewer's stage shows the picture itself. */
async function pictureShown(page, timeout) {
  await page.waitForFunction((selector) => { const img = document.querySelector(selector); return img?.complete && img.naturalWidth > 0; }, `${VIEWER} .mv-stage img`, { timeout })
    .catch(async () => { throw new Error(`The viewer shows no picture: ${JSON.stringify(await page.locator(`${VIEWER} .mv-stage`).innerText())}`); });
}

/** The toast is on top of the page: in the top layer over an open dialog, else what the pointer hits at its centre. */
async function toastOnTop(page) {
  const hit = await page.locator(".toast").evaluate((el) => {
    // A modal dialog makes the page behind it inert, and hit testing skips inert elements, so ask the browser instead.
    if (document.querySelector("dialog[open]")) return el.matches(":popover-open") ? null : "the open dialog";
    const box = el.getBoundingClientRect();
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return el.contains(top) ? null : `${top?.tagName.toLowerCase()}.${top?.className}`;
  });
  expect(hit === null, `The toast is covered by ${hit}`);
}

/** Focus reached the reply box and stayed there (a few frames later nothing has taken it back). */
async function replyBoxKeepsFocus(page) {
  await page.waitForFunction(() => document.activeElement?.matches("#director textarea[data-field='message']"), null, { timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(250);
  const now = await focused(page);
  expect(now?.field === "message", `Focus is on ${JSON.stringify(now)}, not the reply box`);
}

/**
 * Run a check and keep its failure for the end of the scenario (see `settle`), so a product bug it finds does not stop
 * the checks after it from running. The scenario still fails.
 */
const keep = (failures, check) => check().catch((error) => { failures.push(error.message); });
const settle = (failures) => expect(!failures.length, failures.join("; "));

/** A small valid PNG (solid colour), built here so nothing is read from disk. */
function png(width, height, rgb) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3).map((_, i) => rgb[i % 3])]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

/** Just the start of a PNG (signature and IHDR) claiming the given size, padded to `length` bytes. */
function pngStart(width, height, length = 30) {
  const bytes = Buffer.alloc(length);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8); bytes.write("IHDR", 12, "ascii"); bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** Silence of the given length, 8 kHz 8-bit mono: small enough to build here, long enough for the 6-minute limit. */
function longWav(seconds) {
  const rate = 8000, data = Buffer.alloc(rate * seconds, 128), header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate, 28); header.writeUInt16LE(1, 32); header.writeUInt16LE(8, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** The element that has focus, as data-act / data-role / data-field / tag. */
const focused = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? { act: el.getAttribute("data-act"), role: el.getAttribute("data-role"), field: el.getAttribute("data-field"), tag: el.tagName.toLowerCase(), id: el.id } : null;
});

/** One second of a quiet 440 Hz tone, 48 kHz 16-bit stereo. */
function wav(seconds = 1) {
  const rate = 48000, channels = 2, frames = Math.round(rate * seconds);
  const data = Buffer.alloc(frames * channels * 2);
  for (let i = 0; i < frames; i++) {
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 3000);
    data.writeInt16LE(value, i * 4); data.writeInt16LE(value, i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + data.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

async function chooseFile(page, file) {
  await page.locator("dialog[data-act='import-sheet'] input[type='file']").setInputFiles(file);
}

export const scenarios = [
  {
    name: "next-assets-golden-layout",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openAssets(page);
      expect((await page.locator(".topbar [data-view='assets']").getAttribute("aria-selected")) === "true", "Assets is not the selected tab");
      await expectText(page, "main[data-view='assets'] .view-head", /Assets[\s\S]*16 items in this film, each on the shot it belongs to/);
      const counts = await page.locator("[data-act='role-filter']").allInnerTexts();
      expect(counts.map((text) => text.replace(/\s+/g, " ").trim()).join(" | ") === "All 16 | Keyframes 6 | Clips 3 | Voice lines 3 | Music 2 | Uploads 2 | Documents 0 | Exports 0", `Role filters read ${JSON.stringify(counts)}`);
      await expectText(page, ".filters .count", /^Showing 16 of 16$/);
      const groups = await page.locator("main[data-view='assets'] .group > h2").allInnerTexts();
      expect(groups.map((g) => g.replace(/\s+/g, " ").trim()).join(" / ") === "Whole film music, uploads and exports / 1 Closing time Scene 1 / 2 Harbour at dawn Scene 2 / 3 Departure Scene 3", `Groups read ${JSON.stringify(groups)}`);
      await expectText(page, "[data-group='film'] [data-empty='exports']", /No exports yet/);
      await expectText(page, "#av-set-shot-3-1", /Nothing made yet/);
      expect(await page.locator(`main[data-view='assets'] .detail, ${VIEWER}`).count() === 0, "An asset is open before a tile was pressed");
      // Pictures load near the screen first (a few at a time); scrolling the groups loads the rest. Keyframes, the two
      // sample uploads and the clips (which show their keyframe): 11 pictures.
      await page.waitForFunction(() => [...document.querySelectorAll("main[data-view='assets'] .tile img")].length >= 6, null, { timeout: 10000 });
      await page.locator("main[data-view='assets'] .groups").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForFunction(() => [...document.querySelectorAll("main[data-view='assets'] .tile img")].length >= 11 && [...document.querySelectorAll("main[data-view='assets'] .tile img")].every((img) => img.complete && img.naturalWidth > 0), null, { timeout: 10000 });
      await page.locator("main[data-view='assets'] .groups").evaluate((el) => { el.scrollTop = 0; });
      // A tile is named once: its picture is decorative inside the named button.
      const naming = await page.evaluate(() => ({
        alts: [...document.querySelectorAll("main[data-view='assets'] .tile img")].map((img) => img.getAttribute("alt")),
        roleImg: document.querySelectorAll("main[data-view='assets'] .tile [role='img']").length,
      }));
      expect(naming.alts.every((alt) => alt === ""), `Tile pictures have alt text ${JSON.stringify(naming.alts)}`);
      expect(naming.roleImg === 0, "A tile holds a named image");
      // At 1440 × 900: header row, filters, and the groups across the whole workspace; the page does not scroll.
      const head = await box(page, "main[data-view='assets'] .view-head h1");
      near("title left", head.left, 414); near("title top", head.top, 67, 8);
      const groupsBox = await box(page, "main[data-view='assets'] .groups");
      near("groups left", groupsBox.left, 414, 2); near("groups right", groupsBox.right, 1418, 2); near("groups top", groupsBox.top, 156, 8); near("groups bottom", groupsBox.bottom, 882, 4);
      near("tile width", (await box(page, "[data-group='film'] .tile")).width, 256, 8);
      const scroll = await page.evaluate(() => ({ height: document.scrollingElement.scrollHeight, inner: window.innerHeight }));
      expect(scroll.height <= scroll.inner, `The page scrolls: ${JSON.stringify(scroll)}`);
      await noSidewaysScroll(page);
      // Green only for in use / current; no amber anywhere in the view.
      const colours = await page.evaluate(() => {
        const current = getComputedStyle(document.querySelector(".tile .cur")).color;
        const amber = [...document.querySelectorAll("main[data-view='assets'] *")].some((el) => /240, 178, 74|137, 106, 52/.test(getComputedStyle(el).color + getComputedStyle(el).backgroundColor + getComputedStyle(el).borderColor));
        return { current, amber };
      });
      expect(colours.current === "rgb(95, 196, 138)", `Current reads in ${colours.current}, expected the green role`);
      expect(!colours.amber, "The Assets view uses the Director's amber");
      // The dot between a tile's status and its source has the same space on both sides.
      const spacing = await page.evaluate(() => [...document.querySelectorAll("main[data-view='assets'] .tile .sub")].map((sub) => {
        const [use, dot, source] = [...sub.children].map((el) => el.getBoundingClientRect());
        return dot && source ? Math.abs((dot.left - use.right) - (source.left - dot.right)) : 99;
      }).filter((delta) => delta > 1));
      expect(!spacing.length, `The separator dot sits off-centre on ${spacing.length} tiles`);
      await shot(page, "next-assets-1440");
    },
  },
  {
    name: "next-assets-filter-select-point",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openAssets(page);
      const failures = [];
      // Filters by role and scene.
      await roleButton(page, "voice").click();
      expect((await roleButton(page, "voice").getAttribute("aria-pressed")) === "true", "The Voice lines filter is not pressed");
      await expectText(page, ".filters .count", /^Showing 3 of 16$/);
      expect(await page.locator("[data-group='film']").count() === 0, "The whole-film group shows with nothing in it");
      await roleButton(page, "export").click();
      await expectText(page, "[data-group='film'] [data-empty='exports']", /No exports yet/);
      await roleButton(page, "all").click();
      await page.locator("[data-act='scene-filter']").selectOption("scene-2");
      await expectText(page, ".filters .count", /^Showing 4 of 16$/);
      expect(await page.locator(".group").count() === 1, "Scene 2 shows other groups");
      await page.locator("[data-act='scene-filter']").selectOption("film");
      await roleButton(page, "keyframe").click();
      await expectText(page, "[data-empty='filters']", /Nothing matches these filters/);
      await page.locator("[data-act='show-all']").focus();
      await page.keyboard.press("Enter");
      await expectText(page, ".filters .count", /^Showing 16 of 16$/);
      await page.waitForFunction(() => document.activeElement?.matches("[data-act='role-filter'][data-role='all']"), null, { timeout: 2000 });

      // Open the earlier voice line of 1.2.
      const earlier = tile(page, "[data-role='voice'][data-current='false']");
      await openTile(page, earlier, /^Voice line 1\.2$/);
      const rows = (await page.locator(`${DETAIL} dl`).innerText()).replace(/\s+/g, " ").trim();
      // The sample library is dated in the past (the study's 10:20 is two hours and 24 minutes ago).
      expect(/^Kind Voice line Shot 1\.2 Medium Closing time In use No, an earlier take Source Generated Made (Today|\d{1,2} [A-Z][a-z]{2}) \d\d:\d\d Length 2\.6 s$/.test(rows), `Detail rows read ${JSON.stringify(rows)}`);
      await expectText(page, `${VIEWER} .av-note`, /No sound in the sample film/);
      await shot(page, "next-assets-1440-selected");
      // Play moves the clock and its label says what the next press does (no pressed state).
      const play = page.locator(`${VIEWER} [data-act='play-asset']`);
      expect((await play.getAttribute("aria-label")) === "Play" && (await play.getAttribute("aria-pressed")) === null, "The play button reads as a toggle");
      await play.click();
      await page.waitForFunction((selector) => document.querySelector(selector)?.textContent !== "0:00", `${VIEWER} .playrow span`, { timeout: 4000 });
      expect((await play.getAttribute("aria-label")) === "Pause", "The play button does not offer Pause while playing");
      // Download says what the studio would do in the sample film, and that has to be seen from the viewer it is pressed in.
      await page.locator(`${DETAIL} [data-act='download']`).click();
      await expectText(page, ".toast", /The sample film has no files to download/);
      await keep(failures, () => toastOnTop(page));
      // Point the Director at the asset's shot (assets cannot be named in a message yet): the viewer closes so the composer can be used.
      await expectText(page, `${DETAIL} [data-act='point-director']`, /^Point the Director at 1\.2$/);
      await page.locator(`${DETAIL} [data-act='point-director']`).click();
      await page.waitForSelector(VIEWER, { state: "detached" });
      await expectText(page, ".toast", /Pointing the Director at 1\.2\. Write your message in the composer\./);
      // Assets has no picture to sit over, so the toast sits at the top of the workspace, centred in it (never at the
      // foot, over the tiles).
      await page.locator(".toast").evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
      const toastBox = await box(page, ".toast");
      near("toast top", toastBox.top, 64, 4);
      near("toast centre", toastBox.left + toastBox.width / 2, 916, 4);
      await toastOnTop(page);
      const composer = await page.locator("#director").innerText();
      expect(/1\.2/.test(composer), "The composer does not show the shot it points at");
      await keep(failures, () => replyBoxKeepsFocus(page));
      // Whole-film assets cannot be pointed at.
      await openTile(page, tile(page, "[data-role='music']").first());
      expect(await page.locator(`${DETAIL} [data-act='point-director']`).count() === 0, "Music offers Point the Director");
      await expectText(page, `${DETAIL} [data-act='open-in']`, /^Open the music lane in Film$/);
      await closeViewer(page);
      // Open a keyframe in Keyframes: the viewer closes, the tab and the shot follow.
      await openTile(page, tile(page, "[data-role='keyframe']").nth(4));
      await expectText(page, `${DETAIL} [data-act='open-in']`, /^Open 2\.2 in Keyframes$/);
      await page.locator(`${DETAIL} [data-act='open-in']`).click();
      await page.waitForFunction(() => document.querySelector(".topbar [data-view='keyframes']")?.getAttribute("aria-selected") === "true");
      await page.waitForSelector("main[data-view='keyframes'] .preview[data-shot='shot-2-2']", { timeout: 8000 });
      expect(await page.locator(VIEWER).count() === 0, "The viewer stayed open over Keyframes");
      settle(failures);
    },
  },
  {
    name: "next-assets-import",
    query: FIXTURE,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openAssets(page);
      const failures = [];
      const opener = page.locator("[data-act='import']");
      await opener.click();
      const sheet = page.locator("dialog[data-act='import-sheet']");
      await sheet.waitFor();
      await expectText(page, "dialog[data-act='import-sheet'] .sheet-foot", /Importing is free\./);
      expect(await page.locator("[data-act='import-go']").isDisabled(), "Import is on before a file is chosen");
      await shot(page, "next-assets-1440-import");
      // Refused before sending: an SVG, and a file of no kind the studio takes.
      await chooseFile(page, { name: "pier-sketch.svg", mimeType: "image/svg+xml", buffer: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>") });
      await expectText(page, "dialog[data-act='import-sheet'] .av-refusal", /This picture format cannot be read here\. Export it as PNG or JPEG and try again\. SVG pictures must be exported first\./);
      expect(await page.locator("[data-act='import-go']").isDisabled(), "Import is on for a refused file");
      await chooseFile(page, { name: "cut-list.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
      await expectText(page, "dialog[data-act='import-sheet'] .av-refusal", /This kind of file can’t be imported\. Choose a picture, video, audio, PDF or text file\./);
      expect(await page.locator("[data-act='import-go']").isDisabled(), "Import is on for a file of an unknown kind");
      // GIF, BMP, TIFF and AVIF pictures are not refused here: Import turns on, and the studio reads them.
      for (const [name, mimeType] of [["pier-sketch.gif", "image/gif"], ["pier-sketch.bmp", "image/bmp"], ["pier-sketch.tiff", "image/tiff"], ["pier-sketch.avif", "image/avif"]]) {
        await chooseFile(page, { name, mimeType, buffer: Buffer.alloc(64, 1) });
        await page.waitForFunction(() => !document.querySelector("[data-act='import-go']")?.disabled, null, { timeout: 2000 });
        expect((await page.locator("dialog[data-act='import-sheet'] .file-opt").getAttribute("data-kind")) === "image", `${name} is not taken as a picture`);
        expect(await page.locator("dialog[data-act='import-sheet'] .av-refusal").count() === 0, `${name} is refused before sending`);
      }
      // Refused before sending, from a PNG's first bytes: a damaged header, or more pixels than the studio takes.
      // (Bytes that don't start like a PNG are left to the studio: the browser's type is not always right.)
      await chooseFile(page, { name: "broken.png", mimeType: "image/png", buffer: pngStart(0, 0) });
      await expectText(page, "dialog[data-act='import-sheet'] .av-refusal", /This is not a PNG image the studio can read\./);
      expect(await page.locator("[data-act='import-go']").isDisabled(), "Import is on for a PNG with a damaged header");
      await chooseFile(page, { name: "panorama.png", mimeType: "image/png", buffer: pngStart(20000, 6000, 64) });
      await expectText(page, "dialog[data-act='import-sheet'] .av-refusal", /This picture is 20000 × 6000 pixels, over the 100 million pixel limit\. Export a smaller copy and try again\./);
      expect(await page.locator("[data-act='import-go']").isDisabled(), "Import is on for a PNG over the pixel limit");
      // Refused by the (simulated) studio: the refusal is final for this file, so there is no Try again and
      // the file loses its white "chosen" border until another file is chosen.
      await chooseFile(page, { name: "stub.png", mimeType: "image/png", buffer: pngStart(16, 9) });
      await page.locator("[data-act='import-go']").click();
      await expectText(page, "dialog[data-act='import-sheet'] .av-refusal", /This picture could not be read\. Export it again as PNG or JPEG, up to 100 million pixels\./);
      expect(await page.locator(".toast").count() === 0, "A refusal also showed as a toast");
      await expectText(page, "[data-act='import-go']", /^Import$/);
      expect(await page.locator("[data-act='import-go']").isDisabled(), "Import is on again after a final refusal");
      expect((await page.locator("dialog[data-act='import-sheet'] .file-opt").getAttribute("data-kind")) === "refused", "The refused file still looks chosen");
      // Longer than 6 minutes: refused in place before anything is sent.
      await chooseFile(page, { name: "night-ferry.wav", mimeType: "audio/wav", buffer: longWav(361) });
      await expectText(page, "dialog[data-act='import-sheet'] .av-refusal", /This file is 6:01 long; the studio takes video and audio up to 6 minutes\./);
      expect(await page.locator("[data-act='import-go']").isDisabled(), "Import is on for a file over 6 minutes");
      // Audio, as other audio; progress shows while sending.
      await chooseFile(page, { name: "harbour-ambience.wav", mimeType: "audio/wav", buffer: wav(1) });
      await expectText(page, "dialog[data-act='import-sheet'] .file-opt", /harbour-ambience\.wav[\s\S]*audio · /);
      expect((await page.locator("[data-act='import-use'][data-use='music']").getAttribute("aria-checked")) === "true", "Audio does not default to Music");
      await page.locator("[data-act='import-use'][data-use='upload']").click();
      await page.locator("[data-act='import-go']").click();
      await page.waitForSelector("dialog[data-act='import-sheet'] .av-progress", { timeout: 3000 });
      await shot(page, "next-assets-1440-import-sending");
      await expectText(page, ".toast", /Imported harbour-ambience\.wav as other audio\./, 8000);
      expect(await sheet.count() === 0, "The import sheet stayed open");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-act")) === "import", "Focus did not return to Import");
      await expectText(page, ".filters .count", /^Showing 17 of 17$/);
      await openTile(page, named(page, "harbour-ambience.wav"), /^harbour-ambience\.wav$/);
      await expectText(page, `${DETAIL} dl`, /Upload[\s\S]*Not on a shot[\s\S]*Not in use[\s\S]*Imported[\s\S]*Length\s*1 s/);
      await closeViewer(page);
      // A PNG: it shows up as an imported image, with its picture, and the library scrolls to it.
      await page.locator("main[data-view='assets'] .groups").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await opener.click();
      await sheet.waitFor();
      await chooseFile(page, { name: "pier.png", mimeType: "image/png", buffer: png(32, 18, [80, 110, 150]) });
      await page.locator("[data-act='import-go']").click();
      await expectText(page, ".toast", /Imported pier\.png\./, 8000);
      await page.waitForFunction(() => {
        const shown = [...document.querySelectorAll("main[data-view='assets'] .tile")].find((el) => el.textContent.includes("pier.png"))?.getBoundingClientRect();
        const groups = document.querySelector("main[data-view='assets'] .groups").getBoundingClientRect();
        return shown && shown.top >= groups.top && shown.bottom <= groups.bottom;
      }, null, { timeout: 3000 });
      // An imported picture keeps the name it was imported with.
      await openTile(page, named(page, "pier.png"), /^pier\.png$/);
      await keep(failures, () => pictureShown(page, 6000));
      await closeViewer(page);
      await expectText(page, ".filters .count", /^Showing 18 of 18$/);
      // Once everything is sent, the sheet can be closed: the studio's check goes on in the background.
      await opener.click();
      await sheet.waitFor();
      await chooseFile(page, { name: "gangway.png", mimeType: "image/png", buffer: png(32, 18, [150, 110, 80]) });
      await page.locator("[data-act='import-go']").click();
      await page.waitForSelector("dialog[data-act='import-sheet'] .av-progress[data-state='checking']", { timeout: 4000 });
      await page.locator("[data-act='import-background']").click();
      await page.waitForFunction(() => !document.querySelector("dialog[data-act='import-sheet']"));
      await expectText(page, ".toast", /Still checking gangway\.png\. It shows up in Assets when it’s done\./, 2000);
      await expectText(page, ".toast", /Imported gangway\.png\./, 8000);
      await expectText(page, ".filters .count", /^Showing 19 of 19$/);
      // Esc twice while the studio checks: the browser closes the dialog on the second Esc, and the sheet goes
      // with it (never a closed dialog left behind). The import goes on; Import… opens a working sheet again.
      await opener.click();
      await sheet.waitFor();
      await chooseFile(page, { name: "bollard.png", mimeType: "image/png", buffer: png(32, 18, [60, 60, 60]) });
      await page.locator("[data-act='import-go']").click();
      await page.waitForSelector("dialog[data-act='import-sheet'] .av-progress[data-state='checking']", { timeout: 4000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(60);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog[data-act='import-sheet']"), null, { timeout: 2000 });
      await expectText(page, ".toast", /Imported bollard\.png\./, 8000);
      await expectText(page, ".filters .count", /^Showing 20 of 20$/);
      // The browser can also close the dialog without an Esc we can hold; the sheet follows it.
      await opener.click();
      await sheet.waitFor();
      await chooseFile(page, { name: "stub.png", mimeType: "image/png", buffer: pngStart(16, 9) });
      await page.locator("[data-act='import-go']").click();
      await page.waitForSelector("dialog[data-act='import-sheet'] .av-progress[data-state='checking']", { timeout: 4000 });
      await page.evaluate(() => document.querySelector("dialog[data-act='import-sheet']").close());
      await page.waitForFunction(() => !document.querySelector("dialog[data-act='import-sheet']"), null, { timeout: 2000 });
      // Refused after the sheet closed: said in a toast that stays until dismissed.
      await expectText(page, ".toast", /stub\.png was not imported\. This picture could not be read\./, 8000);
      expect((await page.locator(".toast").getAttribute("data-tone")) === "error", "A refusal after closing is not kept on screen");
      await page.locator("[data-act='toast-close']").click();
      await opener.click();
      await sheet.waitFor();
      expect(await sheet.evaluate((el) => el.open), "Import… opened a closed sheet");
      await page.locator("[data-act='import-cancel']").click();
      await page.waitForFunction(() => !document.querySelector("dialog[data-act='import-sheet']"));
      // Closing while the bytes are still going out stops the transfer, and says so; nothing is imported.
      await opener.click();
      await sheet.waitFor();
      await chooseFile(page, { name: "mooring.png", mimeType: "image/png", buffer: png(32, 18, [20, 90, 60]) });
      await page.locator("[data-act='import-go']").click();
      await page.waitForSelector("dialog[data-act='import-sheet'] .av-progress[data-state='sending']", { timeout: 2000 });
      await page.locator("[data-act='import-close']").click();
      await page.waitForFunction(() => !document.querySelector("dialog[data-act='import-sheet']"));
      await expectText(page, ".toast", /Sending stopped\. Nothing was imported\./, 2000);
      await page.waitForTimeout(1200);
      await expectText(page, ".filters .count", /^Showing 20 of 20$/);
      // Esc closes the sheet.
      await opener.click();
      await sheet.waitFor();
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => !document.querySelector("dialog[data-act='import-sheet']"));
      // Every imported file has a name of its own: the tiles are not told apart by their pictures only.
      const uploads = await page.locator("main[data-view='assets'] .tile[data-role='upload'] b").allInnerTexts();
      expect(uploads.length === 6 && new Set(uploads).size === uploads.length, `Imported files share a name: ${JSON.stringify(uploads)}`);
      await shot(page, "next-assets-1440-imported");
      settle(failures);
    },
  },
  {
    name: "next-assets-phone",
    query: FIXTURE,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await openAssets(page);
      await noSidewaysScroll(page);
      expect(await page.locator(`main[data-view='assets'] .detail, ${VIEWER}`).count() === 0, "An asset is open before a tile was pressed");
      // Two tiles a row.
      const tiles = page.locator("[data-group='film'] .tile");
      const [a, b] = [await tiles.nth(0).boundingBox(), await tiles.nth(1).boundingBox()];
      expect(Math.abs(a.y - b.y) < 2 && b.x > a.x, "Tiles are not two to a row");
      // The role filters scroll inside their own row.
      const seg = await page.evaluate(() => { const el = document.querySelector("main[data-view='assets'] .segctl"); return { scroll: el.scrollWidth, client: el.clientWidth, right: el.getBoundingClientRect().right }; });
      expect(seg.right <= 390 - 15, `The filters reach ${seg.right}px`);
      await shot(page, "next-assets-390");
      // A tile opens the viewer, inside the window with its actions in reach; Close returns focus to the tile.
      const voice = tile(page, "[data-role='voice']").first();
      await openTile(page, voice, /^Voice line 1\.2$/);
      await noSidewaysScroll(page);
      const opened = await box(page, VIEWER);
      expect(opened.left >= 0 && opened.right <= 390, `The viewer reaches from ${opened.left} to ${opened.right}px`);
      for (const act of ["download", "point-director", "open-in"]) await page.locator(`${DETAIL} [data-act='${act}']`).click({ trial: true, timeout: 3000 });
      await shot(page, "next-assets-390-sheet");
      await closeViewer(page);
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-role") === "voice", null, { timeout: 2000 });
      // Point the Director from the viewer opens the Director drawer.
      await openTile(page, voice);
      await page.locator(`${DETAIL} [data-act='point-director']`).click();
      await page.waitForFunction((viewer) => !document.querySelector(viewer) && document.querySelector(".app")?.classList.contains("dir-open"), VIEWER);
      await replyBoxKeepsFocus(page);
      await noSidewaysScroll(page);
    },
  },
  {
    name: "next-assets-medium",
    query: FIXTURE,
    viewport: { width: 1024, height: 768 },
    async run({ page }) {
      await openAssets(page);
      await noSidewaysScroll(page);
      // Between 900 and 1239 px shot names sit above their tiles.
      const set = await page.locator("#av-set-shot-1-1").evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" ").length);
      expect(set === 1, `Shot sets use ${set} columns`);
      // Tiles stay at least 150 px wide, so no title loses its take and the status stays on one line.
      const cut = await page.evaluate(() => [...document.querySelectorAll("main[data-view='assets'] .tile")].filter((el) => {
        const title = el.querySelector("b"), sub = el.querySelector(".sub");
        return el.getBoundingClientRect().width < 150 || title.scrollWidth > title.clientWidth + 1 || sub.getBoundingClientRect().height > 20;
      }).map((el) => el.querySelector("b").textContent));
      expect(!cut.length, `Cut-off tiles at 1024 px: ${cut.join(", ")}`);
      await openTile(page, tile(page, "[data-role='keyframe']").first(), /^Keyframe 1\.1 · take 1$/);
      // The two Director actions say what each acts on: this picture, or the shot.
      const director = await page.locator(`${DETAIL} [data-act='show-director'], ${DETAIL} [data-act='point-director']`).allInnerTexts();
      expect(director.join(" | ") === "Show the Director this picture | Point the Director at 1.1", `The Director actions read ${JSON.stringify(director)}`);
      // Pictures on screen (and the viewer's) load; the ones further down wait until they are near.
      await page.waitForFunction((viewer) => {
        const view = document.querySelector("main[data-view='assets'] .groups").getBoundingClientRect();
        const onScreen = [...document.querySelectorAll("main[data-view='assets'] .tile[data-role='keyframe'], main[data-view='assets'] .tile[data-role='clip']")]
          .filter((el) => { const b = el.getBoundingClientRect(); return b.bottom > view.top && b.top < view.bottom; });
        const loaded = (img) => img?.complete && img.naturalWidth > 0;
        return onScreen.length > 0 && onScreen.every((el) => loaded(el.querySelector("img"))) && loaded(document.querySelector(`${viewer} .mv-stage img`));
      }, VIEWER, { timeout: 6000 });
      await noSidewaysScroll(page);
      await shot(page, "next-assets-1024");
    },
  },
  {
    name: "next-assets-chinese",
    query: `${FIXTURE}&lang=zh-CN`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openAssets(page);
      await expectText(page, "main[data-view='assets'] .view-head", /素材[\s\S]*这部影片共 16 个素材，各自归在所属的镜头下[\s\S]*导入…/);
      await expectText(page, ".filters .count", /^显示 16\/16$/);
      await expectText(page, "#av-set-shot-2-2", /关键帧 2\.2 · 版本 1[\s\S]*当前/);
      await openTile(page, tile(page, "[data-role='clip']").first(), /^视频 1\.1 · 版本 1$/);
      await expectText(page, DETAIL, /类型[\s\S]*视频[\s\S]*在成片里打开 1\.1/);
      const clipped = await page.evaluate(() => [...document.querySelectorAll("main[data-view='assets'] .segctl button, main[data-view='assets'] .detail .pill")].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
      expect(!clipped.length, `Clipped labels: ${clipped.join(", ")}`);
      await shot(page, "next-assets-1440-zh");
      await page.setViewportSize({ width: 390, height: 844 });
      await noSidewaysScroll(page);
      await shot(page, "next-assets-390-zh");
    },
  },
  {
    name: "next-assets-live-import",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openAssets(page);
      // The fake-provider studio made keyframes for its shots; they are listed on their shots.
      await page.waitForFunction(() => document.querySelectorAll("main[data-view='assets'] .tile[data-role='keyframe']").length > 0, null, { timeout: 20000 });
      const before = Number((await page.locator("[data-act='role-filter'][data-role='all'] .n").innerText()).trim());
      // A PNG through POST /images/uploads (raw bytes, CSRF and an Idempotency-Key).
      await page.locator("[data-act='import']").click();
      await chooseFile(page, { name: "pier.png", mimeType: "image/png", buffer: png(64, 36, [40, 70, 110]) });
      await page.locator("[data-act='import-go']").click();
      await expectText(page, ".toast", /Imported pier\.png\./, 20000);
      await openTile(page, named(page, "pier.png"), /^pier\.png$/);
      await pictureShown(page, 10000);
      // Download loads and checks the file when pressed, then saves it.
      const savedImage = page.waitForEvent("download", { timeout: 15000 });
      await page.locator(`${DETAIL} [data-act='download']`).click();
      expect((await savedImage).suggestedFilename() === "pier.png", "The PNG downloads under the wrong name");
      await closeViewer(page);
      // A WAV as music through POST /audio-library/uploads?role=music; it plays from the narration audio route.
      await page.locator("[data-act='import']").click();
      await chooseFile(page, { name: "low-tide.wav", mimeType: "audio/wav", buffer: wav(1) });
      await page.locator("[data-act='import-go']").click();
      // The film has no music yet, so imported music becomes its soundtrack.
      await expectText(page, ".toast", /Imported low-tide\.wav\. It is now the film's music\./, 30000);
      await openTile(page, named(page, "low-tide.wav"), /^low-tide\.wav$/);
      await expectText(page, `${DETAIL} dl`, /Music[\s\S]*Not on a shot[\s\S]*Imported/);
      // Opening it loads nothing yet; Play loads the recording from the narration audio route and plays it.
      expect((await page.locator(`${DETAIL} [data-act='download']`).getAttribute("data-state")) === "idle", "Opening the audio loaded its file");
      await page.locator(`${VIEWER} [data-act='play-asset']`).click();
      await page.waitForSelector(`${VIEWER} .big-pic audio[src^='blob:']`, { state: "attached", timeout: 15000 });
      // Download finds the file Play loaded (one shared, checked copy) and saves it.
      const savedAudio = page.waitForEvent("download", { timeout: 15000 });
      await page.locator(`${DETAIL} [data-act='download']`).click();
      expect((await savedAudio).suggestedFilename() === "low-tide.wav", "The recording downloads under the wrong name");
      await expectText(page, "[data-act='role-filter'][data-role='all'] .n", new RegExp(`^${before + 2}$`), 10000);
      await expectText(page, "[data-act='role-filter'][data-role='music'] .n", /^1$/);
      await shot(page, "next-assets-live");
    },
  },
  {
    // A lost reply is resent exactly as first sent (same key, same film version), so the studio replays its
    // receipt instead of importing twice; an out-of-date resend means the first try never arrived.
    name: "next-assets-live-lost-reply",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    // The out-of-date resend in the second half is refused by the studio, as it should be.
    allowConsoleErrors: [/^HTTP 409 \/api\/projects\/[^/]+\/images\/uploads$/],
    async run({ page }) {
      await openAssets(page);
      const uploads = async () => Number((await page.locator("[data-act='role-filter'][data-role='upload'] .n").innerText()).trim());
      const before = await uploads();
      const sent = [];
      let plan = [];
      await page.route("**/images/uploads**", async (route) => {
        const request = route.request();
        sent.push({ search: new URL(request.url()).search, key: request.headers()["idempotency-key"] });
        const step = plan.shift() ?? "pass";
        if (step === "lose-after-commit") { await route.fetch(); await route.abort("failed"); return; }
        if (step === "lose-before") { await route.abort("failed"); return; }
        await route.continue();
      });

      // 1. The studio imports the file, but the reply is lost.
      plan = ["lose-after-commit"];
      await page.locator("[data-act='import']").click();
      await chooseFile(page, { name: "pier.png", mimeType: "image/png", buffer: png(64, 36, [40, 70, 110]) });
      await page.locator("[data-act='import-go']").click();
      await expectText(page, "dialog[data-act='import-sheet'] .av-refusal", /The studio did not answer\. Try again: the same import is checked, not made twice\./, 20000);
      // The studio's event moves the film on (the import is in the library behind the sheet).
      await page.waitForFunction((n) => Number(document.querySelector("[data-act='role-filter'][data-role='upload'] .n")?.textContent) === n, before + 1, { timeout: 15000 });
      await page.locator("[data-act='import-go']").click();
      await expectText(page, ".toast", /Imported pier\.png\./, 20000);
      await page.waitForTimeout(1500);
      expect(await uploads() === before + 1, `Uploads went from ${before} to ${await uploads()}: the resend imported again`);
      expect(sent.length === 2 && sent[1].key === sent[0].key && sent[1].search === sent[0].search, `The resend differs: ${JSON.stringify(sent)}`);

      // 2. The first try never arrives, and the film moves on before Try again: the saved request is out of date,
      //    so a new one is sent once, and the file is imported once.
      sent.length = 0;
      plan = ["lose-before"];
      await page.locator("[data-act='import']").click();
      await chooseFile(page, { name: "dock.png", mimeType: "image/png", buffer: png(48, 27, [90, 60, 30]) });
      await page.locator("[data-act='import-go']").click();
      await expectText(page, "dialog[data-act='import-sheet'] .av-refusal", /The studio did not answer/, 20000);
      // Something else changes the film meanwhile (another import, straight through the route).
      const side = await page.evaluate(async ({ bytes }) => {
        const projectId = new URLSearchParams(location.search).get("project") ?? (await (await fetch("/api/projects", { headers: { "x-openslate-client": "studio" } })).json()).projects[0].id;
        const session = await (await fetch("/api/session", { headers: { "x-openslate-client": "studio" } })).json();
        const project = await (await fetch(`/api/projects/${projectId}`, { headers: { "x-openslate-client": "studio" } })).json();
        const response = await fetch(`/api/projects/${projectId}/images/uploads?expectedHeadVersion=${project.project.headVersion}`, {
          method: "POST", body: new Uint8Array(bytes),
          headers: { "content-type": "application/octet-stream", "x-openslate-client": "studio", "x-openslate-csrf": session.csrf, "idempotency-key": crypto.randomUUID() },
        });
        return response.status;
      }, { bytes: [...png(16, 9, [200, 200, 200])] });
      expect(side === 200, `The side import answered ${side}`);
      await page.waitForFunction((n) => Number(document.querySelector("[data-act='role-filter'][data-role='upload'] .n")?.textContent) === n, before + 2, { timeout: 15000 });
      await page.locator("[data-act='import-go']").click();
      await expectText(page, ".toast", /Imported dock\.png\./, 20000);
      await page.waitForTimeout(1500);
      expect(await uploads() === before + 3, `Uploads went from ${before} to ${await uploads()}, expected ${before + 3}`);
      expect(sent.length === 4, `Expected the lost try, the side import, the out-of-date resend and a new request: ${JSON.stringify(sent)}`);
      const [lost, , resend, fresh] = sent;
      expect(resend.key === lost.key && resend.search === lost.search, `The resend differs from the lost try: ${JSON.stringify(sent)}`);
      expect(fresh.key !== lost.key && fresh.search !== lost.search, `The new request reused the old key or version: ${JSON.stringify(sent)}`);
      await shot(page, "next-assets-live-lost-reply");
    },
  },
];
