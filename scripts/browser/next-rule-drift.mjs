// Rule-drift decisions R1-R4 (docs/ai/review/2026-10-28-rule-drift-review.md section 3) on the Last Ferry fixture film
// with the `stuck` Director preset: 3.1's Codex keyframe has no answer and Codex said why, 2.1's clip finished but its
// download expired, 2.2's clip has been reported running for two hours, and the film's local render was interrupted.
// Nothing leaves the page. Screenshots go to /tmp/openslate-rule-drift-*.png (or $OPENSLATE_SCREENSHOTS).
import { join } from "node:path";

const shot = (name) => join(process.env.OPENSLATE_SCREENSHOTS ?? "/tmp", `openslate-rule-drift-${name}.png`);
const fail = (message) => { throw new Error(message); };

const WORDS = {
  en: { reason: /What Codex reported: The Codex process stopped unexpectedly\./, discard: /Discard this finished job/, discardNote: /cannot be saved\. It stays charged\./,
    detach: /Stop waiting for this job/, film: /The film render was interrupted/, renderAgain: /^Render again$/ },
  "zh-CN": { reason: /Codex 报告：Codex 进程意外退出。/, discard: /丢弃这个已完成的任务/, discardNote: /输出无法保存。它仍会计费。/,
    detach: /不再等待这个任务/, film: /影片渲染中断了/, renderAgain: /^重新渲染$/ },
};

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
const ready = (page) => page.waitForSelector('main.work[data-view="keyframes"] .insp', { timeout: 20000 });
const openShot = async (page, id) => {
  const scene = `scene-${id.split("-")[1]}`;
  if ((await page.getAttribute('main.work[data-view="keyframes"]', "data-scene")) !== scene) {
    await page.click(`[data-act="scene"][data-scene="${scene}"]`);
    await page.waitForSelector(`main.work[data-view="keyframes"][data-scene="${scene}"]`, { timeout: 8000 });
  }
  await page.click(`.card [data-act="open-shot"][data-shot="${id}"]`);
  await expectText(page, ".insp h3", new RegExp(id.slice(5).replace("-", "\\.")));
};
/** An acknowledged action: the confirm stays off until the box is ticked, then it is pressed. */
async function acknowledge(page, scope, act) {
  await page.click(`${scope} [data-act="${act}"]`);
  if (!(await page.locator(`${scope} [data-act="${act}-confirm"]`).isDisabled())) fail(`${act} is possible before the acknowledgement`);
  await page.check(`${scope} [data-recovery="${act}"] .ack input`);
  await page.click(`${scope} [data-act="${act}-confirm"]`);
}

export const scenarios = ["en", "zh-CN"].map((lang) => ({
  name: `next-rule-drift-recovery${lang === "en" ? "" : "-zh"}`,
  query: `ui=next&fixture=last-ferry&director=stuck&lang=${lang}`,
  viewport: { width: 1440, height: 900 },
  async run({ page }) {
    const words = WORDS[lang];
    await ready(page);
    // R1: the unanswered Codex keyframe says what Codex reported, under Give up.
    await openShot(page, "shot-3-1");
    await expectText(page, '.insp [data-recovery="give-up"] .reason', words.reason);
    // R2: the finished clip with an expired download offers Discard (never Give up), acknowledged first.
    await openShot(page, "shot-2-1");
    await expectText(page, '.insp [data-recovery="discard"]', words.discardNote);
    await expectText(page, '.insp [data-act="discard"]', words.discard);
    if (await page.locator('.insp [data-act="give-up"]').count()) fail("A finished job offers Give up");
    await page.screenshot({ path: shot(`discard-${lang}`) });
    await acknowledge(page, ".insp", "discard");
    await page.locator('.insp [data-recovery="discard"]').waitFor({ state: "detached", timeout: 8000 });
    // R3: the clip the service has reported running for two hours offers Stop waiting.
    await openShot(page, "shot-2-2");
    await expectText(page, '.insp [data-act="detach"]', words.detach);
    await acknowledge(page, ".insp", "detach");
    await page.locator('.insp [data-recovery="detach"]').waitFor({ state: "detached", timeout: 8000 });
    // R4: the interrupted render waits in Needs attention; Render again is acknowledged there and the item leaves.
    await page.click('[data-act="attention"]');
    await page.waitForSelector(".attn-pop");
    await expectText(page, '.attn-pop .attn-item[data-group="film"]', words.film);
    await expectText(page, '.attn-pop [data-act="render-again"]', words.renderAgain);
    await page.screenshot({ path: shot(`render-again-${lang}`) });
    await acknowledge(page, ".attn-pop", "render-again");
    await page.locator('.attn-pop .attn-item[data-group="film"]').waitFor({ state: "detached", timeout: 8000 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) fail("The page scrolls sideways");
  },
}));
