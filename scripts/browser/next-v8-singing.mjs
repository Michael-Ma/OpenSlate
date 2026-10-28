// The singing switch and the rule-drift recovery blocks (v8 step 5) on the Last Ferry fixture film.
// `?director=song`: the film has a song and 2.2 is a singing shot; Plan links to Film's Fit shots to song.
// `?director=stuck`: the R1-R4 recovery actions after the visual pass (head line, charge tag, elapsed time).
// Nothing leaves the page. Screenshots go to $OPENSLATE_V8_SCREENS (or /tmp) as v8-*.png.
import { join } from "node:path";

const shot = (name) => join(process.env.OPENSLATE_V8_SCREENS ?? "/tmp", `v8-${name}.png`);
const fail = (message) => { throw new Error(message); };

const WORDS = {
  en: { on: /Lip sync from the keyframe and this stretch of the song: about\s\$0\.34 for\s4\ss/, off: /Lip sync costs about\s\$0\.66 for these\s8\ss/, toast: /Marked\s3\.2\sas singing/,
    fit: /Fit shots to song/, discard: /Finished, but not saved\s*Charged/i, detach: /Still reported running\s*May be charged[\s\S]*Sent 2 h ago\./i },
  "zh-CN": { on: /根据关键帧和这段歌曲对口型：\s*4\s*秒约\s*\$0\.34/, off: /对口型这\s*8\s*秒约\s*\$0\.66/, toast: /已把\s*3\.2\s*标为演唱镜头/,
    fit: /对齐歌曲/, discard: /已完成，但没有保存\s*已计费/, detach: /仍报告在运行\s*可能计费[\s\S]*已发送\s*2\s*小时。/ },
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
const openShot = async (page, id) => {
  const scene = `scene-${id.split("-")[1]}`;
  if ((await page.getAttribute('main.work[data-view="keyframes"]', "data-scene")) !== scene) {
    await page.click(`[data-act="scene"][data-scene="${scene}"]`);
    await page.waitForSelector(`main.work[data-view="keyframes"][data-scene="${scene}"]`, { timeout: 8000 });
  }
  await page.click(`.card [data-act="open-shot"][data-shot="${id}"]`);
  await page.waitForSelector(`.insp[data-shot="${id}"]`, { timeout: 8000 });
};

const singing = (lang, viewport, suffix) => ({
  name: `next-v8-singing${suffix}`,
  query: `ui=next&fixture=last-ferry&director=song&lang=${lang}`,
  viewport,
  async run({ page }) {
    const words = WORDS[lang], phone = viewport.width < 900;
    await page.waitForSelector('main.work[data-view="keyframes"]', { timeout: 20000 });
    await openShot(page, "shot-2-2");
    if (!(await page.isChecked('.insp [data-act="singing"]'))) fail("2.2 is not shown as singing");
    await expectText(page, ".insp .insp-sing", words.on);
    await page.locator(".insp .insp-sing").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`singing-on${phone ? "-phone" : ""}-${lang}`) });
    await openShot(page, "shot-3-2");
    await expectText(page, ".insp .insp-sing", words.off);
    await page.click('.insp .sing-switch');
    await page.waitForFunction(() => document.querySelector('.insp [data-act="singing"]')?.checked === true, null, { timeout: 8000 });
    await expectText(page, ".toast", words.toast);
    // Plan: the song line links to Film's Fit shots to song.
    await page.click('[data-act="tab"][data-view="plan"]');
    await expectText(page, '.panel.look [data-act="fit-song-in-film"]', words.fit);
    await page.click('.panel.look [data-act="fit-song-in-film"]');
    await page.waitForSelector('main.work[data-view="film"]', { timeout: 8000 });
  },
});

const recovery = (lang) => ({
  name: `next-v8-recovery${lang === "en" ? "" : "-zh"}`,
  query: `ui=next&fixture=last-ferry&director=stuck&lang=${lang}`,
  viewport: { width: 1440, height: 900 },
  async run({ page }) {
    const words = WORDS[lang];
    await page.waitForSelector('main.work[data-view="keyframes"] .insp', { timeout: 20000 });
    await openShot(page, "shot-3-1");
    await page.waitForSelector('.insp [data-recovery="give-up"] .gu-head', { timeout: 8000 });
    await page.locator('.insp [data-recovery="give-up"]').screenshot({ path: shot(`recovery-give-up-${lang}`) });
    await openShot(page, "shot-2-1");
    await expectText(page, '.insp [data-recovery="discard"]', words.discard);
    await page.click('.insp [data-act="discard"]');
    await page.locator('.insp [data-recovery="discard"]').screenshot({ path: shot(`recovery-discard-${lang}`) });
    await page.click('.insp [data-act="discard-cancel"]');
    await openShot(page, "shot-2-2");
    await expectText(page, '.insp [data-recovery="detach"]', words.detach);
    await page.locator('.insp [data-recovery="detach"]').screenshot({ path: shot(`recovery-detach-${lang}`) });
    await page.click('[data-act="attention"]');
    await page.waitForSelector(".attn-pop");
    await page.click('.attn-pop [data-act="render-again"]');
    await page.locator(".attn-pop").screenshot({ path: shot(`recovery-render-again-${lang}`) });
  },
});

export const scenarios = [
  singing("en", { width: 1440, height: 900 }, ""), singing("zh-CN", { width: 1440, height: 900 }, "-zh"), singing("en", { width: 390, height: 844 }, "-phone"),
  recovery("en"), recovery("zh-CN"),
];
