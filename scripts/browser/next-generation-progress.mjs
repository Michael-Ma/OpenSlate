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
  {
    name: "next-generation-progress-lost-reply",
    query: "ui=next&fixture=last-ferry&director=lost&lang=zh-CN",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // The transcription that got no reply says it may be charged and how to retry, with a failure mark and no Stop.
      const note = page.locator('.thread .gen-note[data-outcome="failed"]');
      await note.waitFor({ timeout: 8000 });
      await expectText(page, '.thread .gen-note[data-outcome="failed"]', /^!\s*转写没有收到服务的返回结果，可能已经扣费。想重试就再发一次录音，需要再付一次费用。$/);
      if (await note.locator('[data-act="stop-generation"]').count()) fail("A finished transcription still offers Stop");
      // 2.3's lost voice line is in Needs attention with what it cost and how it is made again.
      await page.click('[data-act="attention"]');
      await page.waitForSelector(".attn-pop");
      await expectText(page, '.attn-pop .attn-item[data-item="shot-2-3:voice"]', /2\.3 配音失败[\s\S]*服务没有返回结果，可能已计费。/);
      await page.screenshot({ path: shot("lost-reply-1440") });
      // 1.2's unanswered voice line opens with Give up; letting it go clears it from the list.
      await expectText(page, '[data-act="attention"]', /^2\s*需要处理$/);
      await page.click('.attn-pop [data-act="attention-open"][data-shot="shot-1-2"]');
      await expectText(page, ".insp h3", /^镜头 1\.2$/);
      await page.click('.insp [data-act="give-up"]');
      await page.check('.insp .ack input');
      await page.click('.insp [data-act="give-up-confirm"]');
      await expectText(page, '[data-act="attention"]', /^1\s*需要处理$/);
      if (await page.locator('.insp [data-act="give-up"]').count()) fail("Give up stayed after the voice line was let go");
    },
  },
];

// Voice lines, queues that will not run, and an unanswered transcription (X1 review items 3, 4 and 7), in both languages.
const label = (page, selector) => page.locator(selector).first().getAttribute("aria-label");
const VOICES = {
  en: { head: /^Scene 3 · 0\/1 voice lines back · about/, next: /^3\.2's voice line failed\. Open the shot to see why\.\s*Open 3\.2$/, chip: "Open 3.2: failed · not charged", shot: /^Shot 3\.2$/ },
  "zh-CN": { head: /^第\s3\s场\s·\s配音\s0\/1\s完成\s·\s约/, next: /^3\.2 的配音失败了，打开这个镜头看原因。\s*打开 3\.2$/, chip: "打开 3.2：失败 · 未计费", shot: /^镜头 3\.2$/ },
};
const QUEUE = { en: ["Open 3.1: waiting", "Open 3.2: given up", /^Scene 3 · 0\/2 keyframes back/], "zh-CN": ["打开 3.1：等待中", "打开 3.2：已放弃", /^第\s3\s场\s·\s关键帧\s0\/2\s完成/] };
const WAITING = { en: /^The transcription is waiting for the service's answer/, "zh-CN": /^转写还在等服务的回应/ };

for (const lang of ["en", "zh-CN"]) {
  const suffix = lang === "en" ? "" : "-zh";
  scenarios.push({
    name: `next-generation-progress-voices${suffix}`,
    query: `ui=next&fixture=last-ferry&director=voices&lang=${lang}`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await ask(page, "Please make the keyframes.");
      // Scene 3's keyframes are back: the turn makes only 3.2's voice line, and the line counts voice lines.
      const live = page.locator(".thread .gen-live").last();
      await live.waitFor({ timeout: 10000 });
      await expectText(page, ".thread .gen-live .gl-head", VOICES[lang].head);
      if (!(await live.locator('[data-act="stop-generation"]').count())) fail("Stop is missing while the voice line is being made");
      await page.screenshot({ path: shot(`voices-running${suffix}-1440`), clip: { x: 0, y: 0, width: 400, height: 900 } });
      // The service refuses it: the chip, the next step and no Stop.
      const chip = '.thread .gen-live .shot-chip[data-shot="shot-3-2"]';
      await page.waitForSelector(`${chip}[data-state="failed"]`, { timeout: 10000 });
      if ((await label(page, chip)) !== VOICES[lang].chip) fail(`Chip says ${await label(page, chip)}`);
      await expectText(page, ".thread .gen-live .gl-next", VOICES[lang].next);
      if (await live.locator('[data-act="stop-generation"]').count()) fail("Stop stayed after the voice line settled");
      if (await overflow(page, ".thread .gen-live")) fail("Buttons run past their line's edge");
      await page.screenshot({ path: shot(`voices-failed${suffix}-1440`), clip: { x: 0, y: 0, width: 400, height: 900 } });
      await page.click('.thread .gen-live [data-act="progress-open"][data-shot="shot-3-2"]');
      await expectText(page, ".insp h3", VOICES[lang].shot);
    },
  });
  scenarios.push({
    name: `next-generation-progress-queue${suffix}`,
    query: `ui=next&fixture=last-ferry&director=queue&lang=${lang}`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // 3.1 waits in a queue the studio has not explained and 3.2 was given up: nothing is on its way, so no Stop.
      const live = page.locator(".thread .gen-live").last();
      await live.waitFor({ timeout: 10000 });
      await expectText(page, ".thread .gen-live .gl-head", QUEUE[lang][2]);
      await page.waitForSelector('.thread .gen-live .shot-chip[data-shot="shot-3-1"][data-state="waiting"]');
      await page.waitForSelector('.thread .gen-live .shot-chip[data-shot="shot-3-2"][data-state="given_up"]');
      const said = [await label(page, '.thread .gen-live .shot-chip[data-shot="shot-3-1"]'), await label(page, '.thread .gen-live .shot-chip[data-shot="shot-3-2"]')];
      if (said.join("|") !== QUEUE[lang].slice(0, 2).join("|")) fail(`Chips say ${said.join(" | ")}`);
      if (await live.locator('[data-act="stop-generation"]').count()) fail("Stop is offered while nothing is on its way");
      if ((await live.getAttribute("data-generation")) === "running") fail("The line says it is running");
      await page.screenshot({ path: shot(`queue${suffix}-1440`), clip: { x: 0, y: 0, width: 400, height: 900 } });
    },
  });
  scenarios.push({
    name: `next-generation-progress-transcription-give-up${suffix}`,
    query: `ui=next&fixture=last-ferry&director=unanswered&lang=${lang}`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // The transcription got no answer: its line offers Give up, with the inspector's acknowledgement first.
      const note = page.locator('.thread .gen-note[data-outcome="no_answer"]');
      await note.waitFor({ timeout: 8000 });
      await expectText(page, '.thread .gen-note[data-outcome="no_answer"]', WAITING[lang]);
      if (await note.locator('[data-act="stop-generation"]').count()) fail("An unanswered transcription offers Stop");
      await note.locator('[data-act="give-up"]').click();
      // A person reads the acknowledgement before ticking it; the thread follows the grown line meanwhile.
      await page.waitForTimeout(300);
      if (!(await note.locator('[data-act="give-up-confirm"]').isDisabled())) fail("Give up is possible before the acknowledgement");
      await note.locator(".ack input").check();
      if (await overflow(page, ".thread .gen-note")) fail("Buttons run past their line's edge");
      // The thread stays at its bottom as the line grows, so the confirm is in view.
      await page.waitForFunction(() => { const box = document.querySelector('.thread .gen-note [data-act="give-up-confirm"]')?.getBoundingClientRect(); const thread = document.querySelector(".thread")?.getBoundingClientRect(); return !!box && !!thread && box.bottom <= thread.bottom + 0.5; }, null, { timeout: 3000 })
        .catch(() => fail("The give-up confirm is out of view"));
      await page.screenshot({ path: shot(`transcription-give-up${suffix}-1440`), clip: { x: 0, y: 0, width: 400, height: 900 } });
      await note.locator('[data-act="give-up-confirm"]').click();
      await note.locator(".give-up").waitFor({ state: "detached", timeout: 8000 });
      // Given up, it is still unanswered (a late reply may arrive) and offers no second Give up.
      await expectText(page, '.thread .gen-note[data-outcome="no_answer"]', WAITING[lang]);
      await page.screenshot({ path: shot(`transcription-given-up${suffix}-1440`), clip: { x: 0, y: 0, width: 400, height: 900 } });
    },
  });
}
