// Contract 7.0.0 confirmation cards and the style proposal in the Director chat (v8 step 5), on the Last Ferry fixture
// film. `?director=cards`: delete 2.3, delete Scene 3, use 1.2's first keyframe. `?director=resume`: the film is
// stopped and the Director asks to continue. `?director=style`: three looks to choose from. Plan's Change asks the
// scripted Director for looks through the composer. Nothing leaves the page.
// Screenshots go to $OPENSLATE_V8_SCREENS (or /tmp) as v8-*.png.
import { join } from "node:path";

const shot = (name) => join(process.env.OPENSLATE_V8_SCREENS ?? "/tmp", `v8-${name}.png`);
const fail = (message) => { throw new Error(message); };

const WORDS = {
  en: { del: /Paid work leaves the timeline: 1 keyframe and 1 voice line/, deleted: /Deleted 1 shot/, kept: /Kept\. Nothing was deleted\./,
    take: /Making the clip again costs\s+about\s+\$0\.50/, film: /Whole film/i, resume: /2 unsent jobs start again/, resumed: /Continued/,
    look: /Vintage 16mm/, chosen: /Chosen: Vintage 16mm/, ask: /Suggest two or three visual styles/ },
  "zh-CN": { del: /已付费的内容会离开时间线：\s*1\s*张关键帧和\s*1\s*条配音/, deleted: /已删除\s*1\s*个镜头/, kept: /已保留，没有删除任何内容。/,
    take: /重新生成视频需要\s*约\s*\$0\.50/, film: /整部影片/, resume: /2\s*个未发送的任务会重新开始/, resumed: /已继续/,
    look: /Vintage 16mm/, chosen: /已选择：\s*Vintage 16mm/, ask: /为这部影片推荐两到三种视觉风格/ },
};

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
const card = (kind) => `.confirm-card[data-card="${kind}"]`;
const openDirector = async (page, phone) => { if (phone) { await page.click('[data-act="toggle-director"]'); await page.waitForTimeout(300); } };
const noSideScroll = async (page) => { if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) fail("The page scrolls sideways"); };

const cards = (lang, viewport, suffix) => ({
  name: `next-v8-cards${suffix}`,
  query: `ui=next&fixture=last-ferry&director=cards&lang=${lang}`,
  viewport,
  async run({ page }) {
    const words = WORDS[lang], phone = viewport.width < 900;
    await page.waitForSelector('main.work[data-view="keyframes"]', { timeout: 20000 });
    await openDirector(page, phone);
    await expectText(page, card("delete_shots"), words.del);
    await expectText(page, card("use_take"), words.take);
    await page.locator(card("delete_shots")).scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`card-delete${phone ? "-phone" : ""}-${lang}`) });
    await page.locator(card("use_take")).scrollIntoViewIfNeeded();
    await page.waitForSelector(`${card("use_take")} .dc-frame[data-role="chosen"] .pic-img`, { timeout: 8000 });
    await page.screenshot({ path: shot(`card-use-take${phone ? "-phone" : ""}-${lang}`) });
    // Keep settles the scene card; nothing is deleted.
    await page.click(`${card("delete_scene")} [data-act="card-keep"]`);
    await expectText(page, card("delete_scene"), words.kept);
    // Confirm deletes 2.3 with the person's own command.
    await page.click(`${card("delete_shots")} [data-act="card-confirm"]`);
    await expectText(page, card("delete_shots"), words.deleted);
    if (phone) await page.click('[data-act="close-director"]');
    if (await page.locator('.card [data-act="open-shot"][data-shot="shot-2-3"]').count()) fail("2.3 is still in Keyframes");
    await noSideScroll(page);
  },
});

const resume = (lang, viewport, suffix) => ({
  name: `next-v8-resume${suffix}`,
  query: `ui=next&fixture=last-ferry&director=resume&lang=${lang}`,
  viewport,
  async run({ page }) {
    const words = WORDS[lang], phone = viewport.width < 900;
    await page.waitForSelector('main.work[data-view="keyframes"]', { timeout: 20000 });
    await openDirector(page, phone);
    await expectText(page, card("resume"), words.film);
    await expectText(page, card("resume"), words.resume);
    await page.locator(card("resume")).scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`card-resume${phone ? "-phone" : ""}-${lang}`) });
    await page.click(`${card("resume")} [data-act="card-confirm"]`);
    await expectText(page, card("resume"), words.resumed);
    await noSideScroll(page);
  },
});

const style = (lang, viewport, suffix) => ({
  name: `next-v8-style${suffix}`,
  query: `ui=next&fixture=last-ferry&director=style&lang=${lang}`,
  viewport,
  async run({ page }) {
    const words = WORDS[lang], phone = viewport.width < 900;
    await page.waitForSelector('main.work[data-view="keyframes"]', { timeout: 20000 });
    await openDirector(page, phone);
    await page.waitForSelector('.style-card[data-state="open"] .style-opt', { timeout: 8000 });
    if ((await page.locator(".style-card .style-opt").count()) !== 3) fail("The proposal does not show three looks");
    await page.locator(".style-card").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`style-card${phone ? "-phone" : ""}-${lang}`) });
    await page.click('.style-card [data-act="style-choose"][data-style="vintage-film-16mm"]');
    await expectText(page, ".style-card", words.chosen);
    if (await page.locator('.style-card [data-act="style-choose"]').count()) fail("A settled proposal still offers Choose");
    if (phone) await page.click('[data-act="close-director"]');
    // Plan shows the chosen look; Change asks the Director for new options in the composer, and sending it brings a card.
    await page.click('[data-act="tab"][data-view="plan"]');
    await expectText(page, ".panel.look", words.look);
    await page.screenshot({ path: shot(`plan-look${phone ? "-phone" : ""}-${lang}`) });
    await page.click('[data-act="change-look"]');
    await page.waitForTimeout(300);
    const text = await page.inputValue(".composer textarea");
    if (!/two or three other visual styles|两到三种其他视觉风格/.test(text)) fail(`Change did not ask for other looks: ${text}`);
    await page.click(".composer .send");
    await page.waitForSelector('.style-card[data-state="open"]', { timeout: 10000 });
    await noSideScroll(page);
  },
});

export const scenarios = [
  cards("en", { width: 1440, height: 900 }, ""), cards("zh-CN", { width: 1440, height: 900 }, "-zh"), cards("en", { width: 390, height: 844 }, "-phone"),
  resume("en", { width: 1440, height: 900 }, ""), resume("zh-CN", { width: 390, height: 844 }, "-phone-zh"),
  style("en", { width: 1440, height: 900 }, ""), style("zh-CN", { width: 1440, height: 900 }, "-zh"), style("en", { width: 390, height: 844 }, "-phone"),
];
