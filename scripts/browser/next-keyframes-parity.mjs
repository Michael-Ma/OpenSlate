// Next UI, Keyframes view: what the classic studio had and the new one lacked (parity audit, area "keyframes").
// Moving through the whole film (buttons, counter, arrow keys), the Keyframe / Video toggle, the takes strip with
// "Use this take" and its Undo, the prompts in the inspector with Edit in Plan, a scene confirm's voice steps and
// why it stopped, and a paid press whose reply was lost. The sample film (?ui=next&fixture=last-ferry) unless a
// scenario says otherwise; the lost reply runs against the disposable fake-provider studio.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatMicros } from "../../apps/web/src/next/model/price.ts";
import { inspectorWhole } from "./inspector-whole.mjs";

const query = "ui=next&fixture=last-ferry";
const shot = (label) => `shot-${label.replace(".", "-")}`;
const shots = "/tmp/parity/keyframes";
mkdirSync(shots, { recursive: true });
const screenshot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });

const ready = async (page) => {
  await page.waitForSelector('main.work[data-view="keyframes"] .preview .pic-img', { timeout: 20000 });
  await page.waitForFunction(() => document.querySelector(".preview .pic-img")?.complete);
};

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

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

async function until(read, check, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (check(last)) return last;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`${message}; last: ${JSON.stringify(last)}`);
}

const shown = (page) => page.locator(".preview").getAttribute("data-shot");
const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-act") ?? document.activeElement?.tagName.toLowerCase());

async function noSideScroll(page, width) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth <= width, `The page scrolls sideways: ${scrollWidth}px wide at ${width}px`);
}

/** The preview head's two groups never overlap. */
async function headClear(page) {
  const boxes = await page.evaluate(() => {
    const rect = (selector) => { const r = document.querySelector(selector)?.getBoundingClientRect(); return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null; };
    return { top: rect(".preview .pv-top"), side: rect(".preview .pv-side"), preview: rect(".preview") };
  });
  const { top, side, preview } = boxes;
  expect(top && side && preview, `The preview head is missing: ${JSON.stringify(boxes)}`);
  const overlap = top.left < side.right && side.left < top.right && top.top < side.bottom && side.top < top.bottom;
  expect(!overlap, `The preview head's groups overlap: ${JSON.stringify(boxes)}`);
  expect(side.right <= preview.right + 0.5 && top.left >= preview.left - 0.5, `The preview head leaves the preview: ${JSON.stringify(boxes)}`);
}

/** The element is wholly inside the container's box (on screen, not scrolled or cut off). */
async function inView(page, selector, container) {
  const [box, outer] = await Promise.all([page.locator(selector).first().boundingBox(), page.locator(container).first().boundingBox()]);
  expect(box && outer && box.height > 0 && box.y >= outer.y - 0.5 && box.y + box.height <= outer.y + outer.height + 0.5,
    `${selector} is not in view inside ${container}: ${JSON.stringify({ box, outer })}`);
}

/** Everything in the video panel (segments, headline, stop, button, the reason under it) stays inside its box. */
async function panelFits(page) {
  const out = await page.evaluate(() => {
    const panel = document.querySelector(".vpanel");
    const outer = panel.getBoundingClientRect();
    const parts = [...panel.children].map((child) => { const r = child.getBoundingClientRect(); return { part: child.className || child.tagName, top: r.top, bottom: r.bottom }; });
    return { top: outer.top, bottom: outer.bottom, parts };
  });
  const outside = out.parts.filter((part) => part.bottom > out.bottom + 0.5 || part.top < out.top - 0.5);
  expect(!outside.length, `The video panel overflows: ${JSON.stringify({ panel: [out.top, out.bottom], outside })}`);
}

/** Scene 3 of the sample film with 3.2's line made longer in Plan, its keyframes made and both opened. */
async function scene3ToConfirm(page) {
  // 3.2 gets a longer line in Plan: estimated at 7.6 s, it fits its 8 s shot on paper.
  await page.click('[data-act="tab"][data-view="plan"]');
  await page.click(`[data-act="edit-shot"][data-shot="${shot("3.2")}"]`);
  await page.fill('[data-field="line"]', "I stood at the rail until the town was only a line of lights, and then not even that.");
  await page.click('[data-act="save-shot"]');
  await expectText(page, ".toast", /Saved 3\.2/);
  await page.click('[data-act="tab"][data-view="keyframes"]');
  await page.click('[data-act="scene"][data-scene="scene-3"]');
  await page.click('[data-act="make-keyframes"]');
  await page.waitForSelector('[data-card="shot-3-2"] .pic-img', { timeout: 10000 });
  await page.click('.card [data-act="open-shot"][data-shot="shot-3-1"]');
  await expectText(page, '[data-card="shot-3-1"] .stl', /Opened/);
  await page.click('.card [data-act="open-shot"][data-shot="shot-3-2"]');
  await expectText(page, '[data-card="shot-3-2"] .stl', /Opened/);
  await expectText(page, '[data-act="confirm-video"]', /^Confirm frames & generate video · about \$1\.00$/);
}

/**
 * page.route whose handler goes quiet once the scenario has ended: a late request (the studio's events keep the film
 * reading) would otherwise read a response the closing page already disposed of, and crash the whole run.
 */
function routeQuietly(page, pattern, handler) {
  return page.route(pattern, async (request) => {
    try { await handler(request); } catch (error) { if (!/disposed|closed/i.test(String(error))) throw error; }
  });
}

/** The integration film's clips all wait for a confirm; read them as unbound, so the scene's presses are offered. */
function unbindClips(overview) {
  for (const item of Object.values(overview.shots)) if (item.video.state === "queued") item.video = { state: "none", takeCount: item.video.takeCount };
  for (const scene of overview.scenes) if (scene.state === "making_video" && !scene.confirmation) scene.state = "keyframes_back";
}

export const scenarios = [
  {
    name: "next-keyframes-parity-film-navigation",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // The golden state opens on 2.1, the fourth of eight shots in the film.
      await expectText(page, ".preview .pv-pos", /^4 \/ 8$/);
      expect((await page.locator('.preview [data-act="prev-shot"]').getAttribute("aria-label")) === "Previous shot, 1.3", "Previous does not name 1.3");
      await headClear(page);
      await screenshot(page, "navigation-1440");
      // Previous crosses into Scene 1.
      await page.click('.preview [data-act="prev-shot"]');
      await until(() => shown(page), (id) => id === shot("1.3"), "Previous did not go to 1.3");
      await expectText(page, ".scene-head h1", /^Closing time$/);
      await expectText(page, ".preview .pv-pos", /^3 \/ 8$/);
      // Arrow keys on the focused stage move through the film.
      await page.locator(".preview").focus();
      await page.keyboard.press("ArrowRight");
      await until(() => shown(page), (id) => id === shot("2.1"), "ArrowRight did not go to 2.1");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await until(() => shown(page), (id) => id === shot("3.1"), "ArrowRight did not cross into Scene 3");
      await expectText(page, ".scene-head h1", /^Departure$/);
      // A modifier key leaves the arrows to the browser.
      await page.keyboard.press("Alt+ArrowLeft");
      await page.keyboard.press("Shift+ArrowLeft");
      expect((await shown(page)) === shot("3.1"), "An arrow with a modifier moved the shot");
      await page.keyboard.press("ArrowRight");
      await until(() => shown(page), (id) => id === shot("3.2"), "ArrowRight did not reach the last shot");
      await expectText(page, ".preview .pv-pos", /^8 \/ 8$/);
      expect(await page.locator('.preview [data-act="next-shot"]').isDisabled(), "Next is on at the last shot");
      await page.keyboard.press("ArrowRight");
      expect((await shown(page)) === shot("3.2"), "ArrowRight moved past the last shot");
      // Inside a field the arrows stay with the field.
      await page.click('[data-act="edit-motion"]');
      await page.locator('form[data-form="motion"] input').first().press("ArrowLeft");
      expect((await shown(page)) === shot("3.2"), "ArrowLeft in the motion field moved the shot");
      // The open edit keeps its shot: Previous is off and says why, and the arrows on the stage do not move.
      const prev = page.locator('.preview [data-act="prev-shot"]');
      expect(await prev.isDisabled(), "Previous is on while an edit is open");
      expect((await prev.getAttribute("title")) === "Save or cancel the edit to 3.2 first", `Previous does not say why: ${await prev.getAttribute("title")}`);
      await page.locator(".preview").focus();
      await page.keyboard.press("ArrowLeft");
      await page.waitForTimeout(150);
      expect((await shown(page)) === shot("3.2"), "ArrowLeft on the stage dropped the open edit");
      expect(await page.locator('form[data-form="motion"]').count(), "The edit closed");
      await screenshot(page, "navigation-held-1440");
      await page.click('[data-act="cancel-edit"]');
      expect(!(await prev.isDisabled()), "Previous stays off after the edit was cancelled");
      // The button that turns off hands focus to the stage, so the keys keep working from there.
      await page.click('.preview [data-act="prev-shot"]');
      await until(() => shown(page), (id) => id === shot("3.1"), "Previous did not go to 3.1");
      for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
      await until(() => shown(page), (id) => id === shot("1.2"), "ArrowLeft did not walk back to 1.2");
      await page.click('.preview [data-act="prev-shot"]');
      await until(() => shown(page), (id) => id === shot("1.1"), "Previous did not reach the first shot");
      expect(await page.locator('.preview [data-act="prev-shot"]').isDisabled(), "Previous is on at the first shot");
      expect((await focused(page)) === "section", `Focus did not move to the stage at the first shot: ${await focused(page)}`);
      await page.keyboard.press("ArrowRight");
      await until(() => shown(page), (id) => id === shot("1.2"), "ArrowRight from the stage did not move on");
    },
  },
  {
    name: "next-keyframes-parity-video-toggle",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Scene 2 has no clips yet: no toggle.
      expect(!(await page.locator('.preview [data-act="media-video"]').count()), "The Video toggle shows for a shot with no clip");
      await page.click('[data-act="scene"][data-scene="scene-1"]');
      await until(() => shown(page), (id) => id === shot("1.1"), "Scene 1 did not open on 1.1");
      await page.click('.preview [data-act="media-video"]');
      await page.waitForSelector('.preview[data-media="video"]');
      expect((await page.locator('.preview [data-act="media-video"]').getAttribute("aria-pressed")) === "true", "Video is not pressed");
      await expectText(page, ".preview .pv-top", /1\.1\s*✓\s*Current clip/);
      // The sample film has no clip files: the keyframe's motion stands in, and says so.
      await expectText(page, '.preview [data-act="clip-stand-in"]', /The sample film has no clip files/);
      await headClear(page);
      await screenshot(page, "video-toggle-sample-1440");
      // The side is kept while moving through the film, and a shot with no clip shows its keyframe.
      await page.locator(".preview").focus();
      await page.keyboard.press("ArrowRight");
      await until(() => shown(page), (id) => id === shot("1.2"), "ArrowRight did not move on in Video");
      expect((await page.locator(".preview").getAttribute("data-media")) === "video", "Moving on left the Video side");
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowRight");
      await until(() => shown(page), (id) => id === shot("2.1"), "ArrowRight did not reach 2.1");
      expect((await page.locator(".preview").getAttribute("data-media")) === "keyframe", "A shot with no clip is not shown as its keyframe");
      // Back on a clip, Keyframe switches back.
      await page.keyboard.press("ArrowLeft");
      await until(() => shown(page), (id) => id === shot("1.3"), "ArrowLeft did not go back to 1.3");
      expect((await page.locator(".preview").getAttribute("data-media")) === "video", "The Video side was not kept");
      await page.click('.preview [data-act="media-keyframe"]');
      await page.waitForSelector('.preview[data-media="keyframe"]');
      await expectText(page, ".preview .pv-top", /1\.3\s*✓\s*Video saved/);
    },
  },
  {
    name: "next-keyframes-parity-takes",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click('.card [data-act="open-shot"][data-shot="shot-2-2"]');
      expect(!(await page.locator('.insp [data-act="takes"]').count()), "A shot with one take offers takes");
      await page.click('.insp [data-act="regen"]');
      await expectText(page, '.insp [data-row="takes"]', /Takes\s*2 · Compare/, 10000);
      await page.click('.insp [data-act="takes"]');
      await page.waitForSelector('.insp .takes .take[data-take="1"] .pic-img');
      expect((await focused(page)) === "h4", "The strip did not take focus");
      await expectText(page, ".insp .takes", /Takes of 2\.2[\s\S]*Take 2[\s\S]*In use[\s\S]*Take 1[\s\S]*Use this take/);
      await expectText(page, '.insp [data-act="takes-impact"]', /^Using an earlier take is free\. The take in use now is kept\.$/);
      expect(!(await page.locator(".insp .insp-actions").count()), "The actions stay under the open strip");
      await screenshot(page, "takes-strip-1440");
      // Esc goes back to the rows, with focus on the Takes button.
      await page.keyboard.press("Escape");
      await page.waitForSelector(".insp .rows");
      expect((await focused(page)) === "takes", `Focus did not return to Takes: ${await focused(page)}`);
      await page.click('.insp [data-act="takes"]');
      const before = await page.locator(".preview .pic-img").getAttribute("src");
      await page.click('.insp [data-act="use-take"][data-take="1"]');
      await expectText(page, '.toast[data-tone="info"]', /2\.2 now uses take 1\.\s*Undo/);
      await page.waitForSelector('.insp .take[data-take="1"][data-current="true"]');
      await until(() => page.locator(".preview .pic-img").getAttribute("src"), (src) => src && src !== before, "The preview did not show take 1");
      await screenshot(page, "takes-used-1440");
      await page.click('.toast [data-act="undo"]');
      await page.waitForSelector('.insp .take[data-take="2"][data-current="true"]');
      await page.click('.insp [data-act="takes-close"]');
      await page.waitForSelector(".insp .rows");
    },
  },
  {
    name: "next-keyframes-parity-prompts",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click('.card [data-act="open-shot"][data-shot="shot-2-3"]');
      await page.click('.insp [data-act="prompts"]');
      await page.waitForSelector(".insp section.insp-prompts");
      expect((await focused(page)) === "h4", "The prompts did not take focus");
      await expectText(page, '.insp [data-prompt="image"]', /^The ticket’s printed date, “Sunday 31 March”, under Mara’s thumb\.$/);
      await expectText(page, '.insp [data-prompt="video"]', /^The ticket’s printed date, “Sunday 31 March”, under Mara’s thumb\. Slow tilt down\.$/);
      // The video prompt has no editor of its own: it says how it changes. Edit in Plan names the shot.
      await expectText(page, '.insp [data-act="video-prompt-note"]', /^Rewritten when the shot's purpose, framing or motion changes\.$/);
      await expectText(page, '.insp [data-act="edit-in-plan"]', /^Edit 2\.3 in Plan$/);
      // Read-only prompts are quoted with a rule, never boxed like a field that could be typed in.
      for (const kind of ["image", "video"]) {
        const look = await page.locator(`.insp [data-prompt="${kind}"]`).evaluate((element) => { const style = getComputedStyle(element); return [style.borderTopWidth, style.borderLeftWidth, style.backgroundColor]; });
        expect(look[0] === "0px" && look[1] !== "0px" && look[2] === "rgba(0, 0, 0, 0)", `The ${kind} prompt looks like a text field: ${look}`);
      }
      await screenshot(page, "prompts-1440");
      // Both prompts, the note and Edit in Plan are on screen inside the inspector.
      const insp = await page.locator(".insp").boundingBox();
      for (const selector of ['.insp [data-prompt="video"]', '.insp [data-act="video-prompt-note"]', '.insp [data-act="edit-in-plan"]']) {
        const box = await page.locator(selector).boundingBox();
        expect(box && insp && box.y + box.height <= insp.y + insp.height + 1, `${selector} is cut off`);
      }
      // Esc goes back to the rows, with focus on the Prompts button.
      await page.keyboard.press("Escape");
      await page.waitForSelector(".insp .rows");
      expect((await focused(page)) === "prompts", `Focus did not return to Prompts: ${await focused(page)}`);
      await page.click('.insp [data-act="prompts"]');
      await page.click('.insp [data-act="edit-in-plan"]');
      await page.waitForSelector('.app[data-view="plan"]');
      await page.waitForSelector('#plan-row-shot-2-3.flash', { timeout: 5000 });
      await until(() => page.locator("#plan-row-shot-2-3").boundingBox(), (row) => row && row.y >= 52 && row.y + row.height <= 900, "Plan did not bring 2.3 into view");
      await screenshot(page, "edit-in-plan-1440");
    },
  },
  {
    name: "next-keyframes-parity-confirm-steps-and-stop",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await scene3ToConfirm(page);
      await page.click('[data-act="confirm-video"]');
      // The confirm voices 3.2's line first, step by step, before any clip.
      await expectText(page, '[data-card="shot-3-2"] .stl', /Making voice line…/);
      await expectText(page, ".vpanel p", /^Making the voice line for 3\.2; the clips follow\.$/);
      await expectText(page, '[data-card="shot-3-1"] .stl', /Waiting for the voice line/);
      await screenshot(page, "confirm-step-speech-1440");
      await expectText(page, '[data-card="shot-3-2"] .stl', /Saving voice line…/);
      await expectText(page, ".vpanel p", /^Saving the voice line for 3\.2; the clips follow\.$/);
      await expectText(page, '[data-card="shot-3-2"] .stl', /Fitting voice line…/);
      await expectText(page, ".vpanel p", /^Fitting the voice line to 3\.2; the clips follow\.$/);
      // Voiced, the line runs 8.4 s: the confirm stops there and says why and what to do.
      await page.waitForSelector('.vpanel[data-stopped="NARRATION_CUE_OUT_OF_RANGE"]', { timeout: 6000 });
      await expectText(page, ".vpanel .vcount", /^Stopped\s*at 3\.2$/);
      await expectText(page, ".vpanel .vstop", /^The 3\.2 voice line came out at 8\.4 s, longer than its shot\. Choose how to fit it, then confirm again\.$/);
      expect(!(await page.locator(".vpanel .vstop-act").count()), "A too-long line offers another view; its choices are in the check");
      // The line is the stop's own blocker: nothing to add under the button. The opened frames still show.
      expect((await page.locator(".vpanel .why").innerText()) === "", "The reason under the button repeats the stop's next step");
      expect((await page.locator(".vpanel .vsegs i.on").count()) === 2, "The opened-frame segments are hidden while stopped");
      expect(await page.locator('[data-act="confirm-video"]').isDisabled(), "Confirm is on while the line is too long");
      await panelFits(page);
      // The inspector says it in one line, so its rows stay in view, the narration row too.
      await expectText(page, '.insp [data-act="stopped-here"]', /^The video stopped here\.\s*Why$/);
      await expectText(page, ".banner.check", /Narration 8\.4 s, shot 8 s/);
      await screenshot(page, "confirm-stopped-1440");
      // (A row's label stretches to its row's height, so the narration row is checked by its line.)
      for (const selector of ['[data-row="motion"] dd', '[data-row="duration"] dd', '[data-row="narration"] dd .quote']) await inView(page, `.insp ${selector}`, ".insp .insp-body");
      // Nothing is cut mid-height: the line's length note is read in full, and no row is half under the actions.
      await inspectorWhole(page, "with the stop line at 1440");
      // Why opens the reason and the next step in place, and closes again.
      const why = page.locator('.insp [data-act="stopped-why"]');
      expect((await why.getAttribute("aria-label")) === "Why the scene's video stopped at 3.2", `Why is not labelled: ${await why.getAttribute("aria-label")}`);
      await why.click();
      expect((await why.getAttribute("aria-expanded")) === "true", "Why is not expanded");
      await expectText(page, ".insp .insp-stop-why", /^The 3\.2 voice line came out at 8\.4 s, longer than its shot\. Choose how to fit it, then confirm again\.$/);
      // The reason is read-only words, quoted with a rule, not boxed like a field; the rows below it stay whole.
      const quote = await page.locator(".insp .insp-stop-why").evaluate((element) => { const style = getComputedStyle(element); return [style.borderTopWidth, style.borderLeftWidth, style.backgroundColor]; });
      expect(quote[0] === "0px" && quote[1] !== "0px" && quote[2] === "rgba(0, 0, 0, 0)", `The reason looks like a text field: ${quote}`);
      await inspectorWhole(page, "with Why open at 1440");
      await screenshot(page, "confirm-stopped-why-1440");
      await why.click();
      expect(!(await page.locator(".insp .insp-stop-why").count()), "Why did not close");
      // Lengthen the shot (free), then confirm again: the clips are made.
      await page.click('.banner.check [data-act="make-fit"]');
      await expectText(page, '[data-act="confirm-video"]', /^Confirm frames & generate video · about \$1\.00$/);
      // The stop stays until the scene is confirmed again: it still explains the last confirm, and says it fits now.
      await expectText(page, ".vpanel .vstop", /The 3\.2 voice line came out at 8\.4 s, longer than its shot\. It fits now: confirm again\.$/);
      await screenshot(page, "confirm-stopped-fitted-1440");
      await page.click('[data-act="confirm-video"]');
      await expectText(page, ".vpanel", /Video saved/, 15000);
      expect(!(await page.locator(".vpanel .vstop").count()), "The stop is still shown after the video was saved");
    },
  },
  {
    // A phone, in Chinese: the stage's head (badge, Keyframe / Video, Previous, "4 / 8", Next) wraps instead of
    // covering itself, nothing scrolls sideways, and the takes strip and the prompts fit the inspector.
    name: "next-keyframes-parity-narrow-zh",
    query: `${query}&lang=zh-CN`,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await ready(page);
      await expectText(page, ".preview .pv-pos", /^4 \/ 8$/);
      expect((await page.locator('.preview [data-act="next-shot"]').getAttribute("aria-label")) === "下一个镜头：2.2", "Next is not labelled in Chinese");
      await headClear(page);
      await noSideScroll(page, 390);
      await screenshot(page, "narrow-390-zh");
      await page.click('.preview [data-act="prev-shot"]');
      await until(() => shown(page), (id) => id === shot("1.3"), "Previous did not go to 1.3");
      await page.click('.preview [data-act="media-video"]');
      await expectText(page, '.preview [data-act="media-video"]', /^视频$/);
      await expectText(page, ".preview .pv-top", /1\.3\s*✓\s*当前视频/);
      await headClear(page);
      await noSideScroll(page, 390);
      await screenshot(page, "narrow-390-zh-video");
      await page.click('.insp [data-act="prompts"]');
      await expectText(page, ".insp .insp-prompts h4", /^1\.3 的描述$/);
      await noSideScroll(page, 390);
      await screenshot(page, "narrow-390-zh-prompts");
      await page.click('.insp [data-act="prompts-close"]');
      await page.click('.insp [data-act="regen"]');
      await page.waitForSelector('.insp [data-act="takes"]', { timeout: 10000 });
      await page.click('.insp [data-act="takes"]');
      await page.waitForSelector('.insp .takes .take[data-take="1"] .pic-img');
      await expectText(page, ".insp .takes", /1\.3 的版本[\s\S]*版本 2[\s\S]*使用中[\s\S]*版本 1[\s\S]*使用这个版本/);
      await expectText(page, '.insp [data-act="takes-impact"]', /^使用旧版本是免费的/);
      await noSideScroll(page, 390);
      await screenshot(page, "narrow-390-zh-takes");
    },
  },
  {
    // A phone: a confirm running its voice steps, then stopped, with the panel and the inspector's one line and Why.
    // Scene 3 is prepared at 1440 (the Plan tab), then the phone takes over before the confirm.
    name: "next-keyframes-parity-confirm-narrow",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await scene3ToConfirm(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.click('[data-act="confirm-video"]');
      await expectText(page, ".vpanel p", /^Making the voice line for 3\.2; the clips follow\.$/);
      await page.locator(".vpanel").scrollIntoViewIfNeeded();
      await noSideScroll(page, 390);
      await screenshot(page, "confirm-running-390");
      await page.waitForSelector('.vpanel[data-stopped="NARRATION_CUE_OUT_OF_RANGE"]', { timeout: 8000 });
      await expectText(page, ".vpanel .vstop", /^The 3\.2 voice line came out at 8\.4 s, longer than its shot\. Choose how to fit it, then confirm again\.$/);
      await page.locator(".vpanel").scrollIntoViewIfNeeded();
      await noSideScroll(page, 390);
      await screenshot(page, "confirm-stopped-390");
      await page.locator(".insp").scrollIntoViewIfNeeded();
      await page.click('.insp [data-act="stopped-why"]');
      await expectText(page, ".insp .insp-stop-why", /^The 3\.2 voice line came out at 8\.4 s/);
      await noSideScroll(page, 390);
      await screenshot(page, "confirm-stopped-390-why");
    },
  },
  {
    // Against the disposable fake-provider studio: the Idempotency-Key, the resend, the studio's replay and the takes
    // routes are real. The integration film's clips all wait for a confirm, which keeps Regenerate off; the overview
    // is read as if no clip were bound, so the paid press is offered (the studio itself accepts it). The studio takes
    // one regenerate per film here (a second is refused as SCENE_REVIEW_STALE), so one real job carries the whole
    // story: the reply is lost before the request leaves, then after it landed, then the studio replays it.
    name: "next-keyframes-parity-live-lost-reply-and-takes",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    allowConsoleErrors: [/net::ERR_|Failed to fetch/],
    async run({ page }) {
      // While `freeze` is on, the film is read as it last was (as if its events were slow).
      let latest = null;
      let freeze = false;
      await routeQuietly(page, /\/api\/projects\/[^/]+\/generation$/, async (route) => {
        if (freeze && latest) { await route.fulfill({ json: latest }); return; }
        const response = await route.fetch();
        const overview = await response.json();
        unbindClips(overview);
        latest = overview;
        await route.fulfill({ response, json: overview });
      });
      const keys = [];
      const purchases = [];
      const answers = [];
      let mode = "drop";
      await routeQuietly(page, /\/api\/projects\/[^/]+\/scenes\/[^/]+\/generate$/, async (route) => {
        keys.push(route.request().headers()["idempotency-key"]);
        purchases.push(route.request().postDataJSON());
        const fate = mode;
        mode = "pass";
        if (fate === "drop") { await route.abort("connectionreset"); return; }
        const response = await route.fetch();
        answers.push({ status: response.status(), body: await response.json() });
        if (fate === "land") { await route.abort("connectionreset"); return; }
        await route.fulfill({ response });
      });
      await page.waitForSelector('main.work[data-view="keyframes"] .preview .pic-img', { timeout: 30000 });
      // A fast first load may have finished before the routes above were installed. Pair first, then reload so
      // the displayed quote and unbound-clip projection are definitely the exact response this scenario captured.
      if (!latest) {
        await page.reload();
        await page.waitForSelector('main.work[data-view="keyframes"] .preview .pic-img', { timeout: 30000 });
      }
      const target = await page.locator(".insp").getAttribute("data-shot");
      const overview = await until(() => Promise.resolve(latest), (value) => !!value?.shots[target]?.quotes?.regenerateKeyframe, "The shot's exact regeneration quote was not read", 15000);
      const quote = overview.shots[target].quotes.regenerateKeyframe;
      // The button keeps its name; the exact price is the note right under it, which describes the button.
      const pricedPattern = (value) => {
        expect(value && !value.priceUnknown && BigInt(value.micros) > 0n, `The integration film has no exact price: ${JSON.stringify(value)}`);
        const note = `A new take costs about ${formatMicros(value.micros, "en-US")}.`;
        return new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      };
      await expectText(page, '.insp [data-act="regen"]:not([disabled])', /^Regenerate keyframe$/, 15000);
      await expectText(page, `#regen-note-${target}`, pricedPattern(quote), 15000);
      expect(await page.locator('.insp [data-act="regen"]').getAttribute("aria-describedby") === `regen-note-${target}`, "The price note does not describe the Regenerate button");
      // 1. The reply is lost before the request leaves: the toast and the note under the button say a press again
      //    checks, without paying twice.
      await page.click('.insp [data-act="regen"]');
      await expectText(page, '.toast[data-tone="error"]', /^Not confirmed\. Press again to check; it will not charge twice\./);
      await expectText(page, '.insp .insp-note[data-unconfirmed="true"]', /^Not confirmed\. Press again to check; it will not charge twice\. A new take costs about \$/);
      await screenshot(page, "live-lost-reply-1440");
      // 2. Pressed again, the same request goes with the same key and lands, but its reply is lost too. The film is
      //    held still meanwhile (as if its events were slow), so the press is still offered.
      freeze = true;
      mode = "land";
      await page.click('.insp [data-act="regen"]');
      await until(() => Promise.resolve(answers.length), (n) => n === 1, "The second press did not reach the studio");
      expect(keys[1] === keys[0], `The second press used another key: ${JSON.stringify(keys)}`);
      expect(answers[0].status === 200, `The studio refused the press: ${JSON.stringify(answers[0])}`);
      await expectText(page, '.toast[data-tone="error"]', /^Not confirmed\./);
      await expectText(page, '.insp .insp-note[data-unconfirmed="true"]', /^Not confirmed\./);
      // 3. Pressed a third time: the same key again, and the studio replays its receipt instead of buying again.
      //    Answered, the note and the toast go.
      await page.click('.insp [data-act="regen"]');
      await until(() => Promise.resolve(answers.length), (n) => n === 2, "The third press did not reach the studio");
      expect(keys.length === 3 && keys[2] === keys[0], `The third press used another key: ${JSON.stringify(keys)}`);
      expect(purchases.every((body) => body.kind === "image" && body.regenerate === true && body.targetShotIds?.length === 1 && body.targetShotIds[0] === target && body.expectedEstimateMicros === quote.micros),
        `The regeneration requests differ from the displayed shot and exact price: ${JSON.stringify(purchases)}`);
      expect(answers[1].status === 200 && answers[1].body.requestId === answers[0].body.requestId, `The studio did not replay its receipt: ${JSON.stringify(answers)}`);
      await until(() => page.locator('.insp [data-unconfirmed="true"]').count(), (n) => n === 0, "The note stayed after the studio answered");
      await until(() => page.locator('.toast[data-tone="error"]').count(), (n) => n === 0, "The toast stayed after the studio answered");
      // 4. The film moves again: exactly one new take was made.
      freeze = false;
      await expectText(page, `.insp[data-shot="${target}"] [data-row="takes"]`, /Takes\s*2 · Compare/, 20000);
      await expectText(page, `.insp[data-shot="${target}"] [data-act="regen"]:not([disabled])`, /^Regenerate keyframe$/, 20000);
      await expectText(page, `#regen-note-${target}`, pricedPattern(latest.shots[target].quotes?.regenerateKeyframe), 20000);
      // 5. The takes strip on the studio's own routes: use the first take, then Undo from the toast.
      const uses = [];
      page.on("request", (request) => { if (/\/takes\/[^/]+\/use$/.test(new URL(request.url()).pathname)) uses.push(request.headers()["idempotency-key"]); });
      await page.click('.insp [data-act="takes"]');
      await page.waitForSelector('.insp .take[data-take="1"] .pic-img', { timeout: 15000 });
      await expectText(page, ".insp .takes", /Take 2[\s\S]*In use[\s\S]*Take 1[\s\S]*Use this take/);
      await page.click('.insp [data-act="use-take"][data-take="1"]');
      await expectText(page, '.toast[data-tone="info"]', /now uses take 1\.\s*Undo/, 10000);
      expect(uses.length === 1 && uses[0], `"Use this take" was not sent with an Idempotency-Key: ${JSON.stringify(uses)}`);
      await page.waitForSelector('.insp .take[data-take="1"][data-current="true"]', { timeout: 10000 });
      await screenshot(page, "live-take-used-1440");
      await page.click('.toast [data-act="undo"]');
      await page.waitForSelector('.insp .take[data-take="2"][data-current="true"]', { timeout: 10000 });
      expect(keys.length === 3, `Reading, using or undoing a take bought another generation: ${JSON.stringify(keys)}`);
    },
  },
  {
    // A real clip (a two-second test video made here) on the Video side, with the browser's own controls, and an
    // earlier clip marked out of date. The overview is read as if 1.1 had a saved clip and 1.2 an outdated one.
    name: "next-keyframes-parity-live-clip-player",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      const dir = mkdtempSync(join(tmpdir(), "parity-clip-"));
      let bytes;
      try {
        const file = join(dir, "clip.mp4");
        execFileSync(process.env.OPENSLATE_FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=duration=2:size=320x180:rate=24", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-movflags", "+faststart", file]);
        bytes = readFileSync(file);
      } finally { rmSync(dir, { recursive: true, force: true }); }
      const clip = { artifactId: "parity-clip", sha256: createHash("sha256").update(bytes).digest("hex"), kind: "video" };
      await routeQuietly(page, /\/api\/projects\/[^/]+\/generation$/, async (route) => {
        const response = await route.fetch();
        const overview = await response.json();
        unbindClips(overview);
        const [first, second] = overview.scenes[0].shotIds;
        overview.shots[first].video = { state: "ready", artifact: clip, takeCount: 1 };
        overview.shots[second].video = { state: "outdated", previous: clip, takeCount: 1, outdatedFields: ["motion"] };
        await route.fulfill({ response, json: overview });
      });
      await routeQuietly(page, /\/artifacts\/parity-clip\/content$/, (route) => route.fulfill({ status: 200, contentType: "video/mp4", body: bytes }));
      await page.waitForSelector('main.work[data-view="keyframes"] .preview .pic-img', { timeout: 30000 });
      await page.click('.preview [data-act="media-video"]');
      const player = page.locator('.preview video[data-act="clip-player"]');
      await player.waitFor({ timeout: 15000 });
      expect(await player.evaluate((video) => video.controls), "The clip has no native controls");
      expect((await player.getAttribute("aria-label")) === "Clip 1.1", `The clip is not labelled: ${await player.getAttribute("aria-label")}`);
      await expectText(page, ".preview .pv-top", /1\.1\s*✓\s*Current clip/);
      const duration = await until(() => player.evaluate((video) => video.duration), (d) => d > 1.5 && d < 2.5, "The clip's metadata did not load", 15000);
      // Seeking is the browser's own: the clip is a real, seekable video.
      await player.evaluate((video) => new Promise((done) => { video.addEventListener("seeked", done, { once: true }); video.currentTime = 1; }));
      expect(Math.abs((await player.evaluate((video) => video.currentTime)) - 1) < 0.1, "The clip did not seek");
      expect(duration > 0, "No duration");
      await headClear(page);
      // The head has its own row above the clip: the clip's top edge never runs through the badges and the toggle.
      const seam = await page.evaluate(() => ({ head: document.querySelector(".preview .pv-head").getBoundingClientRect().bottom, clip: document.querySelector('.preview video[data-act="clip-player"]').getBoundingClientRect().top }));
      expect(seam.head <= seam.clip + 0.5, `The preview head straddles the clip: ${JSON.stringify(seam)}`);
      await screenshot(page, "live-clip-player-1440");
      // The arrow keys stay with the player while it has focus.
      const first = await page.locator(".preview").getAttribute("data-shot");
      await player.focus();
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(200);
      expect((await page.locator(".preview").getAttribute("data-shot")) === first, "ArrowRight in the player moved the shot");
      // Next shot: its clip was replaced by an edit, so it is the earlier one, said so.
      await page.click('.preview [data-act="next-shot"]');
      await expectText(page, ".preview .pv-top", /1\.2\s*Earlier clip · out of date/);
      await page.locator('.preview video[data-act="clip-player"]').waitFor({ timeout: 15000 });
      await screenshot(page, "live-clip-earlier-1440");
      // A shot with no clip shows its keyframe, and Keyframe goes back.
      await page.click('.preview [data-act="next-shot"]');
      await page.waitForSelector('.preview[data-media="keyframe"] .pic-img');
      expect(!(await page.locator('.preview [data-act="media-video"]').count()), "A shot with no clip offers Video");
    },
  },
  {
    // A stopped confirm whose next step is in another view: Settings for a missing narrator voice, Plan for a failed
    // line. The overview is read as if Scene 1's last confirm had stopped there.
    name: "next-keyframes-parity-live-stop-actions",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await routeQuietly(page, /\/api\/projects\/[^/]+\/generation$/, async (route) => {
        const response = await route.fetch();
        const overview = await response.json();
        unbindClips(overview);
        const [one, two] = overview.scenes;
        one.confirmation = { confirmationId: "c-parity-1", state: "blocked", blocker: { code: "NARRATION_SPEECH_UNAVAILABLE", shotId: one.shotIds[1] } };
        two.confirmation = { confirmationId: "c-parity-2", state: "blocked", blocker: { code: "NARRATION_SPEECH_FAILED", shotId: two.shotIds[0] } };
        await route.fulfill({ response, json: overview });
      });
      await page.waitForSelector('main.work[data-view="keyframes"] .preview .pic-img', { timeout: 30000 });
      await page.waitForSelector('.vpanel[data-stopped="NARRATION_SPEECH_UNAVAILABLE"]', { timeout: 15000 });
      await expectText(page, ".vpanel .vcount", /^Stopped\s*at 1\.2$/);
      await expectText(page, ".vpanel .vstop", /^No narrator voice is set up for the line in 1\.2\. Choose a narrator voice in Settings, then confirm again\.$/);
      await panelFits(page);
      await screenshot(page, "live-stop-settings-1440");
      await page.click('.vpanel [data-act="stop-open-settings"]');
      await page.waitForSelector('.app[data-view="settings"]', { timeout: 10000 });
      await page.click('[data-act="tab"][data-view="keyframes"]');
      await page.locator('[data-act="scene"]').nth(1).click();
      await page.waitForSelector('.vpanel[data-stopped="NARRATION_SPEECH_FAILED"]', { timeout: 10000 });
      await expectText(page, ".vpanel .vstop", /^The voice line for 2\.1 failed\. Check the line in Plan, then confirm again\.$/);
      await expectText(page, '.vpanel [data-act="stop-edit-in-plan"]', /^Edit 2\.1 in Plan$/);
      // Confirm is still off for a reason the stop does not say: it is said under the button, with the segments.
      await expectText(page, ".vpanel .why", /^Open 2\.1 and 2\.2 first$/);
      expect((await page.locator(".vpanel .vsegs i").count()) === 2, "The opened-frame segments are hidden while stopped");
      await panelFits(page);
      const shotId = await page.locator('.vpanel [data-act="stop-edit-in-plan"]').getAttribute("data-shot");
      await screenshot(page, "live-stop-plan-1440");
      // An open edit on another shot holds Edit 2.1 in Plan (it would select 2.1 and drop the edit), and says why.
      const other = await page.locator('.card [data-act="open-shot"]').nth(1).getAttribute("data-shot");
      await page.click(`.card [data-act="open-shot"][data-shot="${other}"]`);
      await page.click('.insp [data-act="edit-motion"]');
      const editInPlan = page.locator('.vpanel [data-act="stop-edit-in-plan"]');
      expect(await editInPlan.isDisabled(), "Edit 2.1 in Plan is on while 2.2 is being edited");
      expect((await editInPlan.getAttribute("title")) === "Save or cancel the edit to 2.2 first", `Edit in Plan does not say why: ${await editInPlan.getAttribute("title")}`);
      await screenshot(page, "live-stop-plan-held-1440");
      await page.click('.insp [data-act="cancel-edit"]');
      expect(!(await editInPlan.isDisabled()), "Edit 2.1 in Plan stays off after the edit was cancelled");
      await page.click('.vpanel [data-act="stop-edit-in-plan"]');
      await page.waitForSelector('.app[data-view="plan"]');
      await page.waitForSelector(`[id="plan-row-${shotId}"].flash`, { timeout: 5000 });
    },
  },
];
