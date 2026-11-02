// Next UI, Settings: Claude Code as a code-plan film's Director, on the person's Claude plan (card M2). The fixture
// computer has Claude Code installed and signed in; nothing runs, is charged or is sent.
const CODE_FILM = "ui=next&fixture=last-ferry&codeplan=waiting";
const row = "#set-models .mrow[data-job='director']";

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectText(page, selector, pattern, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    last = (await page.locator(selector).first().innerText().catch(() => "")).replaceAll(" ", " ");
    if (pattern.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} never matched ${pattern}; last text: ${JSON.stringify(last)}`);
}

async function openSettings(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  await page.click(".topbar [data-act='settings'], .topbar [aria-label='Settings']");
  await page.waitForSelector(`${row} select`, { timeout: 10000 });
}

export const scenarios = [
  {
    name: "next-settings-claude-code-director",
    query: CODE_FILM,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      const options = await page.locator(`${row} select option`).allInnerTexts();
      expect(options.includes("Claude Code · Opus 5.5") && options.includes("Claude Code · Sonnet 5.5"), `the Director choices are ${JSON.stringify(options)}`);
      await page.locator(`${row} select`).selectOption("claude:claude-opus-5-5");
      await expectText(page, `${row} .c.price`, /uses your Claude plan/);
      await expectText(page, `${row} .impact`, /Claude Code · Opus 5\.5.*Claude plan/s);
      await page.click(`${row} [data-act='model-apply']`);
      await expectText(page, ".toast", /Claude Code · Opus 5\.5/);
      await expectText(page, "#set-director [data-director='claude']", /Claude Code · Opus 5\.5[\s\S]*uses your Claude plan/);
      expect(/\/\.local\/bin\/claude/.test(await page.locator("#set-director [data-director='claude']").innerText()), "the Director panel names the Claude Code program");
    },
  },
  {
    name: "next-settings-claude-code-storyboard",
    query: "ui=next&fixture=last-ferry",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openSettings(page);
      const options = await page.locator(`${row} select option`).allInnerTexts();
      expect(!options.some((option) => option.startsWith("Claude Code")), `a storyboard film offers ${JSON.stringify(options)}`);
    },
  },
];
