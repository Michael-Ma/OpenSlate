// Next UI, Settings: a code-plan film's video resolution (card G1). The fixture film starts at 1080p; a switch
// shows its cost first, saves only on Switch and reprices the video row. Nothing runs, is charged or is sent.
const CODE_FILM = "ui=next&fixture=last-ferry&codeplan=waiting";
const row = "#set-models .mrow[data-job='resolution']";

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectText(page, selector, pattern, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    last = (await page.locator(selector).first().innerText().catch(() => "")).replace(/[\u00a0\u202f]/g, " ").replace(/[\u200b-\u200d\u2060\ufeff]/g, "");
    if (pattern.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} never matched ${pattern}; last text: ${JSON.stringify(last)}`);
}

async function openSettings(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  await page.click(".topbar [data-act='settings'], .topbar [aria-label='Settings']");
  await page.waitForSelector("#set-models .mrow[data-job='video']", { timeout: 10000 });
}

export const scenarios = [
  {
    name: "next-settings-resolution-switch",
    query: CODE_FILM,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      await page.waitForSelector(`${row} select`, { timeout: 10000 });
      const order = await page.$$eval("#set-models .mrow", (rows) => rows.map((r) => r.getAttribute("data-job")));
      expect(order.indexOf("resolution") === order.indexOf("video") + 1, `the resolution row follows the video row: ${JSON.stringify(order)}`);
      const options = await page.locator(`${row} select option`).allInnerTexts();
      expect(JSON.stringify(options) === JSON.stringify(["480p", "768p", "1080p", "2K"]), `the resolutions are ${JSON.stringify(options)}`);
      expect(await page.locator(`${row} select`).inputValue() === "1080p", "a new code film starts at 1080p");
      await expectText(page, `${row} .c.price`, /about \$0\.05–\$0\.06 a second/);
      await expectText(page, `${row} .c.ready-c`, /New clips only/);

      // Choosing shows the cost and keeps the saved value until Switch.
      await page.locator(`${row} select`).selectOption("2k");
      await expectText(page, `${row} .c.price`, /about \$0\.06–\$0\.07 a second/);
      await expectText(page, `${row} .impact`, /Make new clips at 2K\?.*\$0\.06–\$0\.07 a second.*nothing is made again.*charges nothing/s);
      await expectText(page, "#set-models .mrow[data-job='video'] .c.price", /\$0\.05–\$0\.06 a second/);
      await page.click(`${row} [data-act='model-cancel']`);
      expect(await page.locator(`${row} .impact`).count() === 0 && await page.locator(`${row} select`).inputValue() === "1080p", "Cancel keeps 1080p");

      await page.locator(`${row} select`).selectOption("2k");
      await page.click(`${row} [data-act='model-apply']`);
      await expectText(page, ".toast", /New clips are made at 2K\./);
      await page.waitForFunction((selector) => !document.querySelector(`${selector} .impact`), row, { timeout: 8000 });
      expect(await page.locator(`${row} select`).inputValue() === "2k", "the saved resolution is 2K");
      await expectText(page, "#set-models .mrow[data-job='video'] .c.price", /\$0\.06–\$0\.07 a second/);
    },
  },
  {
    name: "next-settings-resolution-phone",
    query: CODE_FILM,
    viewport: { width: 375, height: 812 },
    async run({ page }) {
      await openSettings(page);
      await page.waitForSelector(`${row} select`, { timeout: 10000 });
      await page.locator(`${row} select`).selectOption("480p");
      await expectText(page, `${row} .impact`, /Make new clips at 480p\?/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow <= 0, `the page scrolls sideways by ${overflow}px at phone width`);
      const box = await page.locator(`${row} [data-act='model-apply']`).boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= 375, `Switch is off screen: ${JSON.stringify(box)}`);
    },
  },
  {
    name: "next-settings-resolution-storyboard",
    query: "ui=next&fixture=last-ferry",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      expect(await page.locator(row).count() === 0, "a storyboard film shows no resolution row");
    },
  },
];
