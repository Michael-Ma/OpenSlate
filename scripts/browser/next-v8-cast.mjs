// Plan › Cast (v8 step 5) on the Last Ferry fixture film with the `?cast=on` preset: Mara has one sheet take to
// review, Tomas none. Edit an outfit and a shot's cast, review and approve Mara's sheet (it says which keyframes go
// out of date and nothing is remade), then see her face on the Keyframes cards and the cast check leave Scene 3.
// Nothing leaves the page. Screenshots go to $OPENSLATE_V8_SCREENS (or /tmp) as v8-cast-*.png.
import { join } from "node:path";

const shot = (name) => join(process.env.OPENSLATE_V8_SCREENS ?? "/tmp", `v8-${name}.png`);
const fail = (message) => { throw new Error(message); };

const WORDS = {
  en: { review: /Ready to review/, impact: /Keyframes of 1\.2, 2\.2, and 2\.3 go out of date/, done: /Now out of date: 1\.2, 2\.2, and 2\.3\. Nothing was remade\./,
    check: /Mara appears in 4 shots and has no approved character sheet/, approved: /Approved/, base: /Base outfit: Plain grey knit jumper/ },
  "zh-CN": { review: /待审/, impact: /1\.2、2\.2\s*和\s*2\.3\s*的关键帧会过期/, done: /已过期：\s*1\.2、2\.2\s*和\s*2\.3。没有自动重做。/,
    check: /Mara\s*出现在\s*4\s*个镜头里，还没有已批准的角色设定图/, approved: /已批准/, base: /基础服装：\s*Plain grey knit jumper/ },
};

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
const noSideScroll = async (page) => { if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) fail("The page scrolls sideways"); };

function scenario(lang, viewport, suffix) {
  return {
    name: `next-v8-cast${suffix}`,
    query: `ui=next&fixture=last-ferry&cast=on&director=song&lang=${lang}`,
    viewport,
    async run({ page }) {
      const words = WORDS[lang];
      const phone = viewport.width < 900;
      await page.waitForSelector('main.work[data-view="keyframes"]', { timeout: 20000 });
      // The cast check leads Scene 3 (Mara's sheet waits for review) and opens her review in Plan.
      await page.click('[data-act="scene"][data-scene="scene-3"]');
      await expectText(page, '[data-check="cast:char-mara"]', words.check);
      if (!phone) await page.screenshot({ path: shot(`keyframes-cast-check-${lang}`) });
      await page.click('[data-act="cast-review"][data-character="char-mara"]');
      await page.waitForSelector('main.work[data-view="plan"] .sheet-review[open]', { timeout: 8000 });
      await page.click('[data-act="sheet-close"]');
      await page.locator(".sheet-review").waitFor({ state: "detached", timeout: 8000 });

      // The cast: rows, sheet states, the wardrobe grid with a base-outfit fallback.
      await expectText(page, '.cast-row[data-character="char-mara"]', words.review);
      await expectText(page, '.wd-row[data-character="char-mara"] .wd-cell[data-scene="scene-3"]', words.base);
      if (await page.locator('.wd-row[data-character="char-clerk"] .wd-cell[data-scene="scene-2"] [data-act="edit-outfit"]').count()) fail("An absent character's cell offers an edit");
      await page.locator(".panel.look").scrollIntoViewIfNeeded();
      await page.screenshot({ path: shot(`plan-cast${phone ? "-phone" : ""}-${lang}`), fullPage: false });

      // Edit Mara's Scene 3 outfit (PUT /characters).
      await page.click('[data-act="edit-outfit"][data-character="char-mara"][data-scene="scene-3"]');
      await page.fill("#outfit-text", "Red coat, hood up against the spray");
      await page.click('[data-act="outfit-save"]');
      await expectText(page, '.wd-row[data-character="char-mara"] .wd-cell[data-scene="scene-3"]', /hood up against the spray/);

      // Cast Tomas in 2.1 from its row: his Scene 2 cell now needs an outfit.
      await page.click('[data-act="edit-cast"][data-shot="shot-2-1"]');
      await page.check('.cast-choice[data-character="char-clerk"] input');
      if (!phone) await page.screenshot({ path: shot(`plan-shot-cast-${lang}`) });
      await page.click('[data-act="shot-cast-save"]');
      await page.waitForSelector('.shot-row[data-shot="shot-2-1"] .cast-chip[data-character="char-clerk"]', { timeout: 8000 });
      await page.waitForSelector('.wd-row[data-character="char-clerk"] .wd-cell[data-scene="scene-2"][data-state="missing"]', { timeout: 8000 });

      // Review Mara's sheet: what approving changes, then approve; nothing is remade.
      await page.click('[data-act="open-sheet"][data-character="char-mara"]');
      await page.waitForSelector(".sheet-review[open]");
      await expectText(page, '[data-act="sheet-impact"]', words.impact);
      await page.screenshot({ path: shot(`sheet-review${phone ? "-phone" : ""}-${lang}`) });
      await page.click('[data-act="sheet-approve"]');
      await expectText(page, '[data-act="sheet-approved"]', words.done);
      await page.screenshot({ path: shot(`sheet-approved${phone ? "-phone" : ""}-${lang}`) });
      if (await page.locator('[data-act="sheet-approve"]').count()) fail("The approved take still offers Approve");
      await page.click('[data-act="sheet-open-keyframes"]');
      await page.waitForSelector('main.work[data-view="keyframes"][data-scene="scene-1"]', { timeout: 8000 });
      // Her face is on the cards; 1.2's keyframe is out of date and waits (nothing started).
      await page.waitForSelector('.card .cast-stack[data-cast~="char-mara"]', { timeout: 8000 });
      const state = await page.getAttribute('.card [data-act="open-shot"][data-shot="shot-1-2"]', "data-state").catch(() => null);
      if (state === "running") fail("Approval started work");
      await page.click('[data-act="scene"][data-scene="scene-3"]');
      if (await page.locator('[data-check="cast:char-mara"]').count()) fail("The cast check stays after approval");
      if (!phone) await page.screenshot({ path: shot(`keyframes-cast-faces-${lang}`) });
      await noSideScroll(page);
    },
  };
}

export const scenarios = [
  scenario("en", { width: 1440, height: 900 }, ""),
  scenario("zh-CN", { width: 1440, height: 900 }, "-zh"),
  scenario("en", { width: 390, height: 844 }, "-phone"),
  scenario("zh-CN", { width: 390, height: 844 }, "-phone-zh"),
];
