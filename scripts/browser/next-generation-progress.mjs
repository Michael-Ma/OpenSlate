// Generation progress, blocked requests and Needs attention (design study docs/ai/prototypes/failure-display; sample
// film with the `jobs` Director preset: 1.2's clip never got an answer and the service refuses 3.2's next keyframe).
// Nothing leaves the page. Screenshots go to /tmp/openslate-progress-*.png (or $OPENSLATE_SCREENSHOTS).
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry&director=jobs";
const shot = (name) => join(process.env.OPENSLATE_SCREENSHOTS ?? "/tmp", `openslate-progress-${name}.png`);
const fail = (message) => { throw new Error(message); };

async function ready(page) {
  await page.waitForSelector(".director .thread [data-entry]", { state: "attached", timeout: 20000 });
}

async function ask(page, words) {
  const box = page.locator('[data-field="message"]');
  await box.click();
  await box.pressSequentially(words);
  await page.click('[data-act="send"]');
}

async function expectText(page, selector, pattern, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    last = (await page.locator(selector).first().innerText().catch(() => "")).replaceAll(" ", " ");
    if (pattern.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} never matched ${pattern}; last text: ${JSON.stringify(last)}`);
}

const overflow = (page, selector) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)]
  .filter((b) => b.getBoundingClientRect().right > b.closest(sel).getBoundingClientRect().right + 0.5).length, selector);

export const scenarios = [
  {
    name: "next-generation-progress",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Before asking: 1.2's unanswered clip already needs the person.
      await expectText(page, '[data-act="attention"]', /^1\s*Needs attention$/);
      await ask(page, "Please make the keyframes.");
      // Scene 3 starts live; Scene 1 is refused with the job in its way.
      const live = page.locator(".thread .gen-live").last();
      await live.waitFor({ timeout: 10000 });
      await expectText(page, ".thread .gen-live", /^Scene 3 · 0\/2 keyframes back · about/);
      if (!(await live.locator('[data-act="stop-generation"]').count())) fail("Stop is missing while keyframes are on their way");
      await expectText(page, '.thread .blocked[data-blocked="ATTEMPT_EXISTS"] .b-title', /^Scene 1 waits for 1\.2's earlier video job$/);
      await page.screenshot({ path: shot("running-1440"), clip: { x: 0, y: 0, width: 400, height: 900 } });
      // 3.1 comes back, 3.2 is refused: the chip, the next step and the count all say so.
      await page.waitForSelector('.thread .gen-live .shot-chip[data-shot="shot-3-2"][data-state="failed"]', { timeout: 10000 });
      await expectText(page, ".thread .gen-live", /Scene 3 · 1\/2 keyframes back/);
      await expectText(page, ".thread .gen-live .gl-next", /^3\.2 failed\. Open it to see why, then make it again\.\s*Open 3\.2$/);
      if (await live.locator('[data-act="stop-generation"]').count()) fail("Stop stayed after everything settled");
      await expectText(page, '[data-act="attention"]', /^2\s*Needs attention$/);
      if (await overflow(page, ".thread .gen-live") || await overflow(page, ".thread .blocked")) fail("Buttons run past their line's edge");
      await page.screenshot({ path: shot("settled-1440"), clip: { x: 0, y: 0, width: 400, height: 900 } });
      // The list: waiting first, then failed; an item opens its shot and closes the list.
      await page.click('[data-act="attention"]');
      await page.waitForSelector(".attn-pop");
      const order = await page.locator(".attn-pop .attn-item").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-item")));
      if (order.join() !== "shot-1-2:video,shot-3-2:keyframe") fail(`List order ${order}`);
      await page.screenshot({ path: shot("attention-1440") });
      await page.keyboard.press("Escape");
      await page.waitForSelector(".attn-pop", { state: "detached" });
      await page.click('[data-act="attention"]');
      await page.click('.attn-pop [data-act="attention-open"][data-shot="shot-3-2"]');
      await page.waitForSelector(".attn-pop", { state: "detached" });
      await expectText(page, ".insp h3", /^Shot 3\.2$/);
      // The blocked line's Open goes to 1.2, where Give up leads (a settled job turns the line into "can be made now",
      // covered in generation-progress.test.mjs).
      await page.click('.thread .blocked [data-act="blocked-open"][data-shot="shot-1-2"]');
      await expectText(page, ".insp h3", /^Shot 1\.2$/);
    },
  },
  {
    name: "next-generation-progress-narrow-zh",
    query: `${query}&lang=zh-CN`,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await ready(page);
      // The pill is the count alone; the list opens from the bottom and wraps inside the screen.
      await page.click('[data-act="attention"]');
      await page.waitForSelector(".attn-pop");
      const box = await page.locator(".attn-pop").boundingBox();
      if (!box || box.x !== 0 || Math.abs(box.y + box.height - 844) > 1) fail(`The list is not a bottom sheet: ${JSON.stringify(box)}`);
      const clash = await page.evaluate(() => [...document.querySelectorAll(".attn-item")].some((row) =>
        row.querySelector(".t").getBoundingClientRect().right > row.querySelector(".pill").getBoundingClientRect().left));
      if (clash) fail("A line runs under its Open button");
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail("The page scrolls sideways");
      await expectText(page, ".attn-pop h3", /^需要处理 · 1$/);
      await page.screenshot({ path: shot("narrow-390") });
    },
  },
];
