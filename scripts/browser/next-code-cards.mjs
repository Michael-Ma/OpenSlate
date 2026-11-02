// Next UI, a code film's cards in the Director's thread. A card stays in the reply that asked it, the conversation
// moves on past it, and one whose dependencies changed retires where it is. The fixture film is simulated: nothing is
// generated, charged, saved or sent. Set BROWSER_CHECK_SHOTS=/some/dir to save screenshots.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const RETIRED = "ui=next&fixture=last-ferry&codeplan=retired";

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function shot(page, name) {
  const dir = process.env.BROWSER_CHECK_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

/** What the thread shows, top to bottom: "you" and "director" for messages, and each card's state. */
const threadOrder = (page) => page.locator("#director .thread-body").evaluate((body) =>
  [...body.querySelectorAll(":scope > .entry, .cp-choice")].map((node) => {
    if (!node.classList.contains("cp-choice")) return node.querySelector(".byline.you") ? "you" : "director";
    return node.dataset.stale === "true" ? "retired" : node.dataset.answered === "true" ? "answered" : "waiting";
  }));

export const scenarios = [
  {
    name: "next-code-cards-stay-in-their-reply",
    query: RETIRED,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await page.locator("#director .cp-choice[data-stale='true']").waitFor();
      const order = (await threadOrder(page)).join(" ");
      expect(order === "you director retired you director waiting you director", `thread order: ${order}`);
      await shot(page, "cards-in-place");

      const retired = page.locator("#director .cp-choice[data-stale='true']");
      expect(/No longer applies/.test(await retired.innerText()), "a retired card says so");
      expect((await retired.locator("[data-act='code-plan-choose']").count()) === 0, "a retired card offers nothing to choose");
      await retired.locator("[data-act='code-plan-retired-look']").click();
      await page.keyboard.press("Escape");

      // The card has scrolled up with the conversation; the strip still leads to it.
      const show = page.locator("[data-act='code-plan-show-choice']");
      expect(/1/.test(await show.innerText()), "the strip counts the one card still waiting");
      await show.click();
      await page.waitForFunction(() => document.activeElement?.closest(".cp-choice")?.dataset.answered === "false");

      await page.locator("#director .cp-choice[data-answered='false'] [data-input='first_frame']").click();
      await page.locator("#director .cp-choice[data-answered='true']").waitFor();
      const after = (await threadOrder(page)).join(" ");
      expect(after === "you director retired you director answered you director", `answering must not move the card: ${after}`);
      expect((await show.count()) === 0, "nothing is waiting any more");
    },
  },
  {
    name: "next-code-cards-fit-a-phone",
    query: RETIRED,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await page.locator("[data-act='toggle-director']").click();
      await page.locator("#director .cp-choice[data-stale='true']").waitFor();
      await shot(page, "cards-phone");
      const box = await page.locator("#director .cp-choice[data-stale='true']").boundingBox();
      const list = await page.locator("#director .thread").boundingBox();
      expect(box && list && box.x + box.width <= list.x + list.width + 1, "a retired card stays inside the thread");
      expect(box.height < 80, `a retired card is one quiet line, not ${box.height}px`);
    },
  },
];
