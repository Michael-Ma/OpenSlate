// Next UI, Keyframes view, on the Last Ferry fixture film (?ui=next&fixture=last-ferry): nothing is generated,
// charged or saved. Layout numbers come from docs/ai/prototypes/last-ferry/DESIGN.md (1440 x 900).
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (label) => `shot-${label.replace(".", "-")}`;
const scene = (ordinal) => `scene-${ordinal}`;
const shots = existsSync("/tmp") ? "/tmp" : tmpdir();
const screenshot = (page, name) => page.screenshot({ path: join(shots, `openslate-next-keyframes-${name}.png`) });

const ready = async (page) => {
  await page.waitForSelector('main.work[data-view="keyframes"] .preview .pic-img', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector(".preview .pic-img")?.complete);
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

async function box(page, selector) {
  const value = await page.locator(selector).first().boundingBox();
  if (!value) throw new Error(`${selector} is not on screen`);
  return { left: value.x, top: value.y, right: value.x + value.width, bottom: value.y + value.height, width: value.width };
}

function near(name, actual, expected, tolerance = 10) {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${name} is ${Math.round(actual)}, expected ${expected} ± ${tolerance}`);
}

async function noPageScroll(page, width, { vertical = true } = {}) {
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, viewport: innerHeight }));
  if (size.width > width) throw new Error(`The page scrolls sideways: ${size.width}px wide at ${width}px`);
  if (vertical && size.height > size.viewport) throw new Error(`The page scrolls: ${size.height}px tall in ${size.viewport}px`);
}

async function openCard(page, label) {
  await page.click(`.card [data-act="open-shot"][data-shot="${shot(label)}"]`);
  await expectText(page, `[data-card="${shot(label)}"] .stl`, /Opened/);
}

export const scenarios = [
  {
    name: "next-keyframes-golden-layout",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      const preview = await box(page, ".preview");
      near("preview left", preview.left, 414); near("preview right", preview.right, 1152);
      near("preview top", preview.top, 280); near("preview bottom", preview.bottom, 672);
      const inspector = await box(page, ".insp");
      near("inspector left", inspector.left, 1168); near("inspector right", inspector.right, 1418);
      const row = await box(page, ".kf-row");
      near("bottom row top", row.top, 686); near("bottom row bottom", row.bottom, 882);
      near("card width", (await box(page, ".card")).width, 246);
      near("panel width", (await box(page, ".vpanel")).width, 230);
      near("banner top", (await box(page, ".banner")).top, 112);
      await noPageScroll(page, 1440);
      // The golden state: Scene 2, one check drawn neutral, 2.1 opened, confirm disabled with its reason.
      await expectText(page, ".scene-head", /Harbour at dawn[\s\S]*Scene 2 · 3 shots · keyframes back, no video yet/);
      const banner = await page.locator(".banner.check").evaluate((el) => ({ border: getComputedStyle(el).borderColor, eyebrow: getComputedStyle(el.querySelector(".eyebrow")).color }));
      if (/240, 178, 74|137, 106, 52/.test(`${banner.border} ${banner.eyebrow}`)) throw new Error(`The app check is drawn in the Director's amber: ${JSON.stringify(banner)}`);
      await expectText(page, ".banner.check h2", /^Narration 7\.4 s, shot 6 s$/);
      await expectText(page, '[data-card="shot-2-1"] .stl', /Opened/);
      await expectText(page, ".vpanel", /1 of 3\s*frames opened/);
      if (!(await page.locator('[data-act="confirm-video"]').isDisabled())) throw new Error("Confirm is enabled before the frames are opened");
      await expectText(page, ".vpanel .why", /^Open 2\.2 and 2\.3 and settle 2\.3 first$/);
      await screenshot(page, "golden-1440");
    },
  },
  {
    name: "next-keyframes-open-extend-confirm",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.2");
      await openCard(page, "2.3");
      await expectText(page, ".vpanel", /3 of 3\s*frames opened/);
      await expectText(page, ".vpanel .why", /^Settle the narration in 2\.3 first$/);
      await page.click('[data-act="make-fit"][data-shot="shot-2-3"]');
      await page.waitForSelector('.banner[data-state="settled"] [data-act="undo"]');
      await expectText(page, ".banner", /2\.3 is now 8 s; the line fits[\s\S]*The film is now 50 s/);
      await expectText(page, '[data-card="shot-2-3"] .ttl', /8 s/);
      const confirm = page.locator('[data-act="confirm-video"]');
      await expectText(page, '[data-act="confirm-video"]', /^Confirm frames & generate video · about \$1\.50$/);
      if (await confirm.isDisabled()) throw new Error("Confirm is still disabled");
      await expectText(page, ".vpanel .why", /^3 clips at about \$0\.50$/);
      await screenshot(page, "extended-1440");
      await confirm.click();
      await page.waitForSelector('[data-card="shot-2-1"] .vprog');
      await expectText(page, ".vpanel", /Making video/);
      await expectText(page, '[data-card="shot-2-2"] .stl', /Queued/);
      // Paying used the edit: its Undo is gone from the banner.
      if (await page.locator('.banner [data-act="undo"]').count()) throw new Error("Undo is still offered after paying for video");
      await expectText(page, ".vpanel", /Video saved/, 15000);
      await expectText(page, ".scene-head .line", /video saved/);
      await expectText(page, '[data-act="scene"][data-scene="scene-2"]', /Harbour at dawn · video saved/);
      await expectText(page, '[data-act="play-scene"]', /Play Scene 2/);
      await screenshot(page, "video-saved-1440");
    },
  },
  {
    name: "next-keyframes-undo-extend",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click('[data-act="make-fit"]');
      await page.waitForSelector('.banner[data-state="settled"]');
      await page.click('.banner [data-act="undo"]');
      await page.waitForSelector('.banner[data-state="open"]');
      await expectText(page, '[data-card="shot-2-3"] .ttl', /6 s/);
      await expectText(page, ".banner.check h2", /^Narration 7\.4 s, shot 6 s$/);
    },
  },
  {
    name: "next-keyframes-keep-and-cut",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.2");
      await openCard(page, "2.3");
      await page.click('[data-act="keep-fit"][data-shot="shot-2-3"]');
      await page.waitForSelector('.banner[data-state="settled"] [data-act="undo"]');
      await expectText(page, ".banner", /2\.3 stays 6 s; the line is cut there[\s\S]*The last 1\.4 s of the line will not be heard/);
      await expectText(page, '.insp [data-row="narration"]', /7\.4 s voiced · cut at 6 s/);
      await expectText(page, '[data-card="shot-2-3"] .ttl', /6 s/);
      await expectText(page, '[data-act="confirm-video"]', /about \$1\.50/);
      await screenshot(page, "kept-1440");
      await page.click('.banner [data-act="undo"]');
      await page.waitForSelector('.banner[data-state="open"]');
      await expectText(page, ".vpanel .why", /^Settle the narration in 2\.3 first$/);
    },
  },
  {
    name: "next-keyframes-regenerate",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.2");
      await expectText(page, ".insp", /A new take costs about \$0\.04/);
      await page.click('.insp [data-act="regen"][data-shot="shot-2-2"]');
      await page.waitForSelector(".preview .making");
      await expectText(page, '[data-card="shot-2-2"] .stl', /Making keyframe/);
      await expectText(page, ".vpanel", /1 of 3\s*frames opened/);
      await screenshot(page, "regenerating-1440");
      await page.waitForSelector('.insp [data-row="takes"]', { timeout: 10000 });
      await expectText(page, '.insp [data-row="takes"]', /Takes\s*2/);
      await expectText(page, ".insp .st", /^Not opened$/);
      await expectText(page, '[data-card="shot-2-2"] .stl', /Not opened/);
      // The new take stays not opened until the person opens it.
      await page.waitForTimeout(800);
      await expectText(page, '[data-card="shot-2-2"] .stl', /Not opened/);
      await page.click('[data-act="open-frame"][data-shot="shot-2-2"]');
      await expectText(page, '[data-card="shot-2-2"] .stl', /Opened/);
      await screenshot(page, "regenerated-1440");
    },
  },
  {
    name: "next-keyframes-edit-prompt-outdates",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Motion and duration keep the keyframe; no clip exists yet.
      await page.click('.insp [data-act="edit-motion"]');
      await expectText(page, '.insp form[data-form="motion"]', /The keyframe stays\. No clip exists yet/);
      await page.click('.insp [data-act="cancel-edit"]');
      await page.click('.insp [data-act="edit-prompt"]');
      await expectText(page, '.insp form[data-form="prompt"]', /Saving outdates this keyframe; it will need regenerating\./);
      await page.fill(".insp textarea", "The empty harbour at first light, the ferry moored, thick fog.");
      await page.click('.insp [data-act="save-edit"]');
      await page.waitForSelector('[data-card="shot-2-1"] .pic.dim');
      await expectText(page, '[data-card="shot-2-1"] .stl', /Keyframe out of date/);
      await expectText(page, ".preview .pv-top", /Earlier take/);
      const regen = page.locator('.insp [data-act="regen"]');
      if (!(await regen.evaluate((el) => el.classList.contains("primary")))) throw new Error("Regenerate is not the primary action for an outdated keyframe");
      await expectText(page, ".insp", /The prompt changed; the earlier keyframe is shown\. A new take costs about \$0\.04\./);
      await screenshot(page, "outdated-1440");
    },
  },
  {
    name: "next-keyframes-edit-narration",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click('.banner [data-act="edit-narration"]');
      await page.waitForSelector('.insp form[data-form="narration"]');
      await expectText(page, ".insp .est", /About 7\.4 s at the recorded voice's pace \(an estimate\) · still longer than 6 s/);
      await page.fill(".insp textarea", "The last boat, and I nearly missed it.");
      await expectText(page, ".insp .est", /About 4\.6 s .*an estimate.* · fits 6 s/);
      await expectText(page, '.insp form[data-form="narration"]', /Nothing visual changes/);
      await page.click('.insp [data-act="save-edit"]');
      await page.waitForSelector('.banner[data-state="settled"]');
      await expectText(page, ".banner", /New 2\.3 line, about 4\.6 s, fits 6 s/);
      await expectText(page, '.insp [data-row="narration"]', /estimate/);
    },
  },
  {
    name: "next-keyframes-scene-3",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click(`[data-act="scene"][data-scene="${scene(3)}"]`);
      await page.waitForSelector('.preview .dashed-frame');
      await expectText(page, '[data-act="make-keyframes"]', /^Make 2 keyframes · about \$0\.08$/);
      await expectText(page, ".kf-row", /No more shots in this scene/);
      await screenshot(page, "scene-3-1440");
      await page.click('[data-act="make-keyframes"]');
      await page.waitForSelector('[data-card="shot-3-1"] .making');
      await expectText(page, ".vpanel", /Making keyframes/);
      await page.waitForSelector('[data-card="shot-3-2"] .pic-img', { timeout: 10000 });
      await expectText(page, '[data-card="shot-3-1"] .stl', /Not opened/);
      await expectText(page, '[data-card="shot-3-2"] .stl', /Not opened/);
      await expectText(page, ".vpanel .why", /^Open 3\.1 and 3\.2 first$/);
    },
  },
  {
    name: "next-keyframes-motion-preview",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click('.preview [data-act="play"]');
      await page.waitForTimeout(1200);
      const moving = await page.$eval(".pv-anim", (el) => el.style.transform);
      if (!/^scale\(1\.0\d+\)$/.test(moving)) throw new Error(`2.1 (slow push-in) is not pushing in: ${moving}`);
      await page.click('.preview [data-act="play"]');
      // Reduced motion: the picture stays still and only the scrubber moves.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.click('.preview [data-act="play"]');
      await page.waitForTimeout(1200);
      const still = await page.$eval(".pv-anim", (el) => el.style.transform);
      const progress = await page.$eval(".preview .track i", (el) => parseFloat(el.style.width));
      if (still !== "none") throw new Error(`The picture moves under reduced motion: ${still}`);
      if (!(progress > 5)) throw new Error(`The scrubber does not move under reduced motion: ${progress}%`);
      // Scene 1 plays each shot in turn (fixture clips are not media, so each keyframe's motion preview).
      await page.click(`[data-act="scene"][data-scene="${scene(1)}"]`);
      await page.click('[data-act="play-scene"]');
      await page.waitForFunction(() => document.querySelector(".preview")?.dataset.shot === "shot-1-2", null, { timeout: 9000 });
      await page.click('[data-act="play-scene"]');
      await expectText(page, '[data-act="play-scene"]', /Play Scene 1/);
    },
  },
  {
    name: "next-keyframes-narrow",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await ready(page);
      await noPageScroll(page, 390, { vertical: false });
      const cards = await page.locator(".cards").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, overflow: getComputedStyle(el).overflowX }));
      if (!(cards.scroll > cards.client) || !/auto|scroll/.test(cards.overflow)) throw new Error(`The card row does not scroll inside itself: ${JSON.stringify(cards)}`);
      await screenshot(page, "narrow-390");
      // Scroll the card row, open 2.3 from it, and the page still has no sideways scroll.
      await page.locator(".cards").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await openCard(page, "2.3");
      await noPageScroll(page, 390, { vertical: false });
      await page.click('.banner [data-act="edit-narration"]');
      await page.waitForSelector('.insp form[data-form="narration"]');
      await noPageScroll(page, 390, { vertical: false });
      await page.click(`[data-act="scene"][data-scene="${scene(3)}"]`);
      await page.waitForSelector('[data-act="make-keyframes"]');
      await noPageScroll(page, 390, { vertical: false });
      await screenshot(page, "narrow-390-scene-3");
    },
  },
  {
    name: "next-keyframes-chinese",
    query: `${query}&lang=zh-CN`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await expectText(page, ".banner.check .eyebrow", /检查/);
      await expectText(page, '[data-card="shot-2-1"] .stl', /已查看/);
      await expectText(page, '[data-card="shot-2-2"] .stl', /未查看/);
      await expectText(page, ".insp", /重新生成关键帧/);
      await noPageScroll(page, 1440);
    },
  },
];
