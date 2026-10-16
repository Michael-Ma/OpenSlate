// Director column parity checks (classic UI removal): pictures for the Director, the unsent draft, Markdown replies,
// chips and references that open their shot, failed replies, "View new messages" and Let it go. All against the
// Last Ferry sample film in the browser (no server state); `?director=` presets are in fixtures/fixture-director.ts.
// Screenshots go to /tmp/parity/director (or $OPENSLATE_SCREENSHOTS).
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const base = "ui=next&fixture=last-ferry";
const dir = process.env.OPENSLATE_SCREENSHOTS ?? "/tmp/parity/director";
mkdirSync(dir, { recursive: true });
const shot = (name) => join(dir, `${name}.png`);
const fail = (message) => { throw new Error(message); };
const column = { x: 0, y: 0, width: 400, height: 900 };

async function ready(page) {
  await page.waitForSelector(".director .thread [data-entry]", { timeout: 20000 });
}
const texts = (page, selector) => page.$$eval(selector, (nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, " ").trim()));
const pictureNames = (page) => texts(page, ".composer .pic-chip .pic-name");
async function toast(page, pattern) {
  await page.waitForFunction((source) => new RegExp(source).test(document.querySelector(".toast")?.textContent ?? ""), pattern.source, { timeout: 4000 })
    .catch(async () => fail(`The toast reads ${JSON.stringify(await page.locator(".toast").textContent().catch(() => null))}, expected ${pattern}`));
}
async function closeToast(page) {
  if (await page.locator('.toast [data-act="toast-close"]').count()) await page.locator('.toast [data-act="toast-close"]').click();
  await page.waitForSelector(".toast", { state: "detached" });
}
async function openAssets(page) {
  await page.locator('[data-act="tab"][data-view="assets"]').click();
  await page.waitForSelector('main.work[data-view="assets"][data-state="ready"]');
}
async function showAsset(page, key) {
  await page.locator(`[data-asset*="${key}"]`).first().click();
  await page.locator('.detail [data-act="show-director"]').click();
}
/** Every × in the composer is at least 24 px square (WCAG 2.5.8). */
async function removeTargets(page) {
  const sizes = await page.$$eval('.composer [data-act="remove-picture"], .composer [data-act="unpoint"]', (nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return [Math.round(box.width), Math.round(box.height)]; }));
  if (!sizes.length || sizes.some(([w, h]) => w < 24 || h < 24)) fail(`Remove targets: ${JSON.stringify(sizes)}`);
}
/** No image role without a name (decorative thumbnails and their placeholders are hidden instead). */
async function noNamelessImages(page) {
  const nameless = await page.$$eval('.director [role="img"]', (nodes) => nodes.filter((node) => !(node.getAttribute("aria-label") ?? "").trim()).length);
  if (nameless) fail(`${nameless} image role(s) without a name in the Director column`);
}
async function noSidewaysScroll(page, width) {
  const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector(".director").scrollWidth - document.querySelector(".director").clientWidth]);
  if (widths[0] > width || widths[1] > 0) fail(`The page scrolls sideways: ${widths}`);
}
/** The picture action and the newer media/navigation controls share the preview head without covering each other. */
async function previewActionsReachable(page) {
  await page.locator('.preview [data-act="show-director"]').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => {
    const preview = document.querySelector(".preview");
    const show = preview?.querySelector('[data-act="show-director"]');
    if (!show) return false;
    const controls = [...preview.querySelectorAll('.pv-head button, [data-act="show-director"]')];
    const bounds = controls.map((button) => button.getBoundingClientRect());
    return controls.every((button, index) => {
      const rect = bounds[index];
      if (!rect.width || !rect.height) return false;
      const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      if (!target || !button.contains(target)) return false;
      return bounds.every((other, otherIndex) => otherIndex === index
        || Math.min(rect.right, other.right) - Math.max(rect.left, other.left) <= 1
        || Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) <= 1);
    });
  }, null, { timeout: 4000 }).catch(() => fail("The preview's Add to message, media or navigation controls cover each other or cannot be reached"));
}

export const scenarios = [
  {
    name: "next-director-pictures",
    query: `${base}&director=codex`,
    async run({ page }) {
      await ready(page);
      // The Keyframes preview shows its current keyframe to the Director.
      await previewActionsReachable(page);
      await page.locator('.preview [data-act="show-director"]').click();
      await toast(page, /^Added to your message/);
      if ((await pictureNames(page)).join() !== "2.1 keyframe") fail(`Pictures after the preview: ${await pictureNames(page)}`);
      await page.waitForFunction(() => document.activeElement?.matches('[data-field="message"]'), null, { timeout: 2000 }).catch(() => fail("Focus did not move to the reply box"));
      // A keyframe is shown by pointing the message at its shot; with no @ target that replaces the whole film, and the composer says so.
      const scope = await texts(page, '[data-note="points-at"] p');
      if (scope[0] !== "This message now points only at 2.1, not the whole film, so the Director sees its keyframe and can change only 2.1.") fail(`The scope line reads ${JSON.stringify(scope)}`);
      if (!(await page.locator('[data-field="message"]').getAttribute("aria-describedby"))?.includes(await page.locator('[data-note="points-at"] p').getAttribute("id"))) fail("The scope line does not describe the reply box");
      if (await page.locator('[data-act="keep-whole-film"]').textContent() !== "Keep the whole film (remove the keyframe)") fail("The way back to the whole film is missing");
      // Assets: an imported picture joins it; the same one again is refused.
      await openAssets(page);
      await showAsset(page, "art-ref");
      await toast(page, /^Added to your message/);
      await page.locator('.detail [data-act="show-director"]').click();
      await toast(page, /already in your message/);
      if ((await pictureNames(page)).join() !== "2.1 keyframe,Imported image") fail(`Pictures: ${await pictureNames(page)}`);
      // An earlier take cannot be shown: the Director only sees a shot's current keyframe (2.2 is made again first).
      await page.waitForFunction(() => [...document.querySelectorAll(".composer .pic-chip img")].length === 2, null, { timeout: 4000 }).catch(() => fail("The picture chips have no thumbnails"));
      const box = page.locator('[data-field="message"]');
      await box.fill("Use the red from this reference for Mara's coat");
      await removeTargets(page);
      await noNamelessImages(page);
      await page.screenshot({ path: shot("pictures-composer-1440"), clip: column });
      // Removing a picture by its button.
      await page.getByRole("button", { name: "Remove picture 2.1 keyframe" }).click();
      if ((await pictureNames(page)).join() !== "Imported image") fail(`After removing: ${await pictureNames(page)}`);
      if (await page.locator('[data-note="points-at"]').count()) fail("The scope line stayed without a keyframe");
      await page.locator('[data-act="tab"][data-view="keyframes"]').click();
      await page.locator('.preview [data-act="show-director"]').click();
      await box.press("Enter");
      await page.waitForSelector('.thread [data-entry="working"]');
      if (await page.locator(".composer .pic-chip").count()) fail("Pictures stayed in the composer after sending");
      const sent = page.locator('.thread [data-who="you"]').last();
      if (await sent.locator(".bubble-picture img").count() !== 2) fail("The sent bubble does not show its two pictures");
      const alts = await sent.locator(".bubble-picture img").evaluateAll((nodes) => nodes.map((node) => node.alt));
      if (alts.join("|") !== "Picture shown to the Director: Imported image|Picture shown to the Director: 2.1 keyframe") fail(`Picture names: ${alts}`);
      await page.waitForSelector('.thread [data-entry="working"]', { state: "detached", timeout: 5000 });
      const reply = await texts(page, '.thread [data-who="director"] .md');
      if (!/I looked at the 2 pictures you showed me/.test(reply.at(-1) ?? "")) fail(`The reply reads ${JSON.stringify(reply.at(-1))}`);
      // The message went to 2.1 alone, as the composer said; its bubble shows that.
      const chips = await sent.locator(".atchip").allTextContents();
      if (chips.join() !== "@2.1") fail(`The sent message points at ${chips}`);
      await noNamelessImages(page);
      await page.screenshot({ path: shot("pictures-sent-1440"), clip: column });
      // A shot with a clip adds Keyframe / Video to the same row; it must keep every control reachable too.
      await page.locator('.scene-pills [aria-pressed]').first().click();
      await page.waitForSelector('.preview[data-shot="shot-1-1"] .pv-media');
      await previewActionsReachable(page);
    },
  },
  {
    name: "next-director-pictures-scope",
    query: `${base}&director=codex`,
    async run({ page }) {
      await ready(page);
      const box = page.locator('[data-field="message"]');
      // No @ target: the keyframe narrows the message; "Keep the whole film" takes the keyframe out again.
      await page.locator('.preview [data-act="show-director"]').click();
      await page.waitForSelector('[data-note="points-at"][data-scope="narrowed"]');
      await page.screenshot({ path: shot("pictures-narrowed-1440"), clip: column });
      await page.locator('[data-act="keep-whole-film"]').click();
      if (await page.locator('.composer .pic-chip').count() || await page.locator('[data-note="points-at"]').count()) fail("Keep the whole film left the keyframe or the line");
      if (!(await page.evaluate(() => document.activeElement?.matches('[data-field="message"]')))) fail("Focus did not go back to the reply box");
      // With an @ target the keyframe's shot joins it: "also", and no way back is offered (nothing was replaced).
      await box.pressSequentially("@2.3");
      await page.waitForSelector('.picker [role="listbox"]');
      await box.press("Enter");
      await page.locator('.preview [data-act="show-director"]').click();
      await page.waitForSelector('[data-note="points-at"][data-scope="added"]');
      const line = await texts(page, '[data-note="points-at"] p');
      if (line[0] !== "This message also points at 2.1, so the Director sees its keyframe.") fail(`The scope line reads ${JSON.stringify(line)}`);
      if (await page.locator('[data-act="keep-whole-film"]').count()) fail("Keep the whole film is offered when the message has a target");
      await removeTargets(page);
      await page.screenshot({ path: shot("pictures-also-1440"), clip: column });
      await box.fill("Match 2.3 to this frame");
      await box.press("Enter");
      await page.waitForSelector('.thread [data-entry="working"]');
      const chips = await page.locator('.thread [data-who="you"]').last().locator(".atchip").allTextContents();
      if (chips.join() !== "@2.3,@2.1") fail(`The sent message points at ${chips}`);
    },
  },
  {
    name: "next-director-pictures-refused",
    query: base,
    async run({ page }) {
      await ready(page);
      // The scripted Director cannot look at pictures: a toast says why and nothing is added.
      await page.locator('.preview [data-act="show-director"]').click();
      await toast(page, /^The scripted Director can't look at pictures\. To show one, choose the Codex Director in Settings › Director\.$/);
      if (await page.locator(".composer .pic-chip").count()) fail("A picture was added for the scripted Director");
      await page.screenshot({ path: shot("pictures-refused-1440") });
      // Clips and audio are not offered; a demo-free imported picture is, and refused for the same reason.
      await openAssets(page);
      await page.locator('[data-asset*="art-music-low-tide"]').first().click();
      if (await page.locator('.detail [data-act="show-director"]').count()) fail("Add to message is offered for music");
      await closeToast(page);
      await showAsset(page, "art-timetable");
      await toast(page, /scripted Director/);
    },
  },
  {
    name: "next-director-pictures-limit-and-ffmpeg",
    query: `${base}&director=codex`,
    async run({ page }) {
      await ready(page);
      // Four at most: 2.1, 2.2 and 2.3's keyframes and one import; a fifth is refused.
      for (const card of ["shot-2-1", "shot-2-2", "shot-2-3"]) {
        await page.locator(`.card[data-card="${card}"] [data-act="open-shot"]`).click();
        await page.waitForSelector(`.preview[data-shot="${card}"] [data-act="show-director"]`);
        await page.locator('.preview [data-act="show-director"]').click();
      }
      await openAssets(page);
      await showAsset(page, "art-ref");
      await closeToast(page);
      await showAsset(page, "art-timetable");
      await toast(page, /up to 4 pictures/);
      if ((await pictureNames(page)).length !== 4) fail(`Pictures: ${await pictureNames(page)}`);
      await page.screenshot({ path: shot("pictures-four-1440"), clip: column });
    },
  },
  {
    name: "next-director-pictures-no-ffmpeg",
    query: `${base}&director=no-ffmpeg`,
    async run({ page }) {
      await ready(page);
      await page.locator('.preview [data-act="show-director"]').click();
      await toast(page, /^Showing pictures to the Director needs FFmpeg on this computer\.$/);
    },
  },
  {
    name: "next-director-pictures-narrow",
    query: `${base}&director=codex`,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await page.waitForSelector(".director .thread [data-entry]", { state: "attached", timeout: 20000 });
      await openAssets(page);
      await page.locator('[data-asset*="art-ref"]').first().click();
      await page.waitForSelector('[data-act="asset-sheet"], .av-detail-sheet');
      await page.locator('.av-detail-sheet [data-act="show-director"]').click();
      // The sheet closes and the Director's drawer opens with the picture in the message.
      await page.waitForFunction(() => document.querySelector(".app").classList.contains("dir-open"));
      await page.waitForSelector(".av-detail-sheet", { state: "detached" });
      if ((await pictureNames(page)).join() !== "Imported image") fail(`Pictures: ${await pictureNames(page)}`);
      await page.waitForTimeout(300);
      // No toast over the reply box being typed in: the chip shows the picture, and the box's description names it.
      if (await page.locator(".toast").count()) fail(`A toast covers the reply box: ${await page.locator(".toast").textContent()}`);
      await page.waitForFunction(() => document.activeElement?.matches('[data-field="message"]'), null, { timeout: 2000 }).catch(() => fail("Focus did not move to the reply box"));
      const described = await page.locator('[data-field="message"]').evaluate((node) => (node.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" | "));
      if (!described.includes("Pictures in this message: Imported image")) fail(`The reply box is described as ${JSON.stringify(described)}`);
      await removeTargets(page);
      await noSidewaysScroll(page, 390);
      await page.screenshot({ path: shot("pictures-narrow-390") });
      // The Keyframes preview has the button at phone width too.
      await page.locator(".dir-close").click();
      await page.locator('[data-act="tab"][data-view="keyframes"]').click();
      await page.waitForSelector('.preview [data-act="show-director"]');
      await previewActionsReachable(page);
      await page.screenshot({ path: shot("preview-narrow-390") });
      await page.locator('.scene-pills [aria-pressed]').first().click();
      await page.waitForSelector('.preview[data-shot="shot-1-1"] .pv-media');
      await previewActionsReachable(page);
    },
  },
  {
    name: "next-director-draft",
    query: `${base}&director=codex`,
    async run({ page }) {
      await ready(page);
      const box = page.locator('[data-field="message"]');
      await box.click();
      await box.pressSequentially("@2.2");
      await page.waitForSelector('.picker [role="listbox"]');
      await box.press("Enter");
      await box.pressSequentially("Keep the fog, lose the gulls");
      await page.locator('.preview [data-act="show-director"]').click();
      if (await page.locator('[data-draft="restored"]').count()) fail("The Unsent draft line shows while typing");
      // A reload brings the draft back, with the quiet line.
      await page.reload();
      await ready(page);
      await page.waitForSelector('[data-draft="restored"]');
      if (await box.inputValue() !== "Keep the fog, lose the gulls") fail(`The draft text came back as ${JSON.stringify(await box.inputValue())}`);
      if ((await texts(page, ".composer .chips .atchip")).join() !== "@2.2") fail("The draft's @2.2 did not come back");
      if ((await pictureNames(page)).join() !== "2.1 keyframe") fail("The draft's picture did not come back");
      const line = await texts(page, '[data-draft="restored"]');
      if (line[0] !== "Unsent draft, kept in this browser until you send it.") fail(`The draft line reads ${line}`);
      await page.screenshot({ path: shot("draft-restored-1440"), clip: column });
      // Another film has its own (empty) composer; coming back restores this one.
      await page.locator('[data-act="all-films"]').click();
      await page.locator(".film-row[data-film='night-bus'] [data-act='open-film']").click();
      await page.waitForFunction(() => document.querySelector('[data-field="message"]')?.value === "" && !document.querySelector(".composer .pic-chip"));
      await box.fill("A note for the night bus");
      await page.locator('[data-act="all-films"]').click();
      await page.locator(".film-row[data-film='last-ferry'] [data-act='open-film']").click();
      await page.waitForFunction(() => document.querySelector('[data-field="message"]')?.value === "Keep the fog, lose the gulls");
      await page.waitForSelector('[data-draft="restored"]');
      // Sending clears it, here and after a reload.
      await box.press("Enter");
      await page.waitForSelector('.thread [data-entry="working"]');
      if (await page.locator('[data-draft="restored"]').count()) fail("The draft line stayed after sending");
      await page.reload();
      await ready(page);
      await page.waitForTimeout(300);
      if (await box.inputValue() !== "" || await page.locator(".composer .pic-chip").count()) fail("A sent draft came back after a reload");
      // A long pasted script survives a reload too; the composer says it is too long and holds Send.
      const script = "The ferry leaves at dawn. ".repeat(1400);
      await box.fill(script);
      await page.waitForTimeout(200);
      await page.reload();
      await ready(page);
      await page.waitForFunction((length) => document.querySelector('[data-field="message"]')?.value.length === length, script.length, { timeout: 4000 })
        .catch(async () => fail(`The long draft came back with ${(await box.inputValue()).length} characters, not ${script.length}`));
      if ((await texts(page, ".composer-note"))[0] !== "Keep the message under 16,000 characters.") fail("The too-long note is missing");
      if (!(await page.locator('[data-act="send"]').isDisabled())) fail("Send is on for a message that is too long");
    },
  },
  {
    name: "next-director-markdown",
    query: `${base}&director=markdown`,
    async run({ page }) {
      await ready(page);
      const reply = page.locator('[data-entry="m-markdown"] .md');
      if (await reply.locator("ol > li").count() !== 2) fail("The numbered list is missing");
      if (await reply.locator("li ul > li code").count() !== 1) fail("The nested bullet with inline code is missing");
      if (await reply.locator(".md-table table th").count() !== 3) fail("The table is missing");
      if (await reply.locator(".md-table").getAttribute("tabindex") !== "0") fail("The table's scroll box cannot be reached by keyboard");
      if (await reply.locator("pre.md-pre code").count() !== 1) fail("The code block is missing");
      const scroll = await reply.locator("pre.md-pre").evaluate((node) => node.scrollWidth > node.clientWidth && getComputedStyle(node).overflowX === "auto");
      if (!scroll) fail("The long code line does not scroll inside its box");
      const links = await reply.locator("a").evaluateAll((nodes) => nodes.map((node) => [node.getAttribute("href"), node.target, node.rel]));
      if (JSON.stringify(links) !== JSON.stringify([["https://example.com/ferry-timetables", "_blank", "noopener noreferrer"]])) fail(`Links: ${JSON.stringify(links)}`);
      if (await reply.locator("b, script, img").count()) fail("Raw HTML or a picture got into the reply");
      if (!/<b>Raw tags<\/b> stay as text, and this is not a link\./.test(await reply.textContent())) fail("The raw tags are not shown as text");
      await page.evaluate(() => document.querySelector('[data-entry="m-markdown"]').scrollIntoView({ block: "start" }));
      await page.evaluate(() => { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; });
      await page.screenshot({ path: shot("markdown-1440"), clip: column });
      // A reference in a reply opens its shot.
      await reply.getByRole("button", { name: "Open 3.2" }).click();
      await page.waitForSelector('.card.sel[data-card="shot-3-2"]');
      await noSidewaysScroll(page, 1440);
    },
  },
  {
    name: "next-director-chips-open",
    query: base,
    async run({ page }) {
      await ready(page);
      // The sent message's @Scene 2 chip opens Scene 2; in Plan it stays in Plan.
      await page.locator('.scene-pills [aria-pressed]').first().click();
      const chip = page.locator('.thread [data-who="you"] .bubble button.atchip').first();
      if (await chip.textContent() !== "@Scene 2") fail(`The bubble chip reads ${await chip.textContent()}`);
      await chip.click();
      await page.waitForFunction(() => document.querySelector('.scene-pills [aria-pressed="true"]')?.textContent?.includes("Harbour at dawn"));
      // A composer chip opens its shot.
      const box = page.locator('[data-field="message"]');
      await box.click();
      await box.pressSequentially("@2.3");
      await page.waitForSelector('.picker [role="listbox"]');
      await box.press("Enter");
      await page.locator('.composer .chips button.atchip').click();
      await page.waitForSelector('.card.sel[data-card="shot-2-3"]');
      if ((await texts(page, ".composer .chips .atchip")).join() !== "@2.3") fail("Opening the chip changed the chips");
    },
  },
  {
    name: "next-director-failed-reply",
    query: `${base}&director=failed`,
    async run({ page }) {
      await ready(page);
      const marker = page.locator('[data-entry="request-failed"] .dir-attention');
      await marker.waitFor();
      // A generic failure carries no words from the server: the catalog says it.
      const words = [await marker.locator("b").textContent(), await marker.locator("b + span").textContent()];
      if (words.join("|") !== "This reply needs attention|The Director stopped with an error. Send a message to try again.") fail(`The marker reads ${JSON.stringify(words)}`);
      if (await marker.locator(".words").count()) fail("The marker shows words the server never sends");
      if (await page.locator('[data-entry="ending"]').count()) fail("The ending line repeats the marker");
      await page.screenshot({ path: shot("failed-reply-1440"), clip: column });
    },
  },
  {
    name: "next-director-new-messages",
    query: `${base}&director=markdown`,
    async run({ page }) {
      await ready(page);
      const box = page.locator('[data-field="message"]');
      await box.fill("One more thing about Scene 3");
      await box.press("Enter");
      await page.waitForSelector('.thread [data-entry="working"]');
      // Scrolled up while the Director works: its reply does not pull the reader down, a button says it arrived.
      await page.locator(".thread").evaluate((node) => { node.scrollTop = 0; node.dispatchEvent(new Event("scroll")); });
      await page.waitForSelector('[data-act="view-new"]', { timeout: 5000 });
      const top = await page.locator(".thread").evaluate((node) => node.scrollTop);
      if (top > 5) fail(`The thread moved to ${top} while scrolled up`);
      await page.screenshot({ path: shot("new-messages-1440"), clip: column });
      await page.locator('[data-act="view-new"]').click();
      await page.waitForSelector('[data-act="view-new"]', { state: "detached" });
      await page.waitForFunction(() => { const node = document.querySelector(".thread"); return node.scrollHeight - node.scrollTop - node.clientHeight < 40; }, null, { timeout: 3000 });
      // At the bottom, new content follows on its own.
      await box.fill("And the gulls");
      await box.press("Enter");
      await page.waitForSelector('.thread [data-entry="working"]', { state: "detached", timeout: 5000 });
      if (await page.locator('[data-act="view-new"]').count()) fail("View new messages shows at the bottom");
    },
  },
  {
    name: "next-director-let-it-go",
    query: `${base}&director=held`,
    async run({ page }) {
      await ready(page);
      const card = page.locator('[data-entry="held"]');
      await card.waitFor();
      const title = (await card.locator("b").textContent()).trim();
      if (title !== "An unfinished Director edit is holding 3.1 and 3.2") fail(`The card reads ${title}`);
      if (!(await card.locator("p").textContent()).includes("their waiting keyframes and clips start right away, as already approved")) fail("The card does not say letting go starts the waiting work");
      // How the edit's turn ended reads right under the message, then the card says what that leaves waiting.
      const order = await page.$$eval('.thread-body > [data-entry]', (nodes) => nodes.slice(-3).map((node) => node.getAttribute("data-entry")));
      if (order.join() !== "request-held,ending,held") fail(`The thread ends ${order}`);
      await page.locator('.scene-pills [aria-pressed]').nth(2).click();
      await page.waitForSelector('.card[data-card="shot-3-1"]');
      await page.screenshot({ path: shot("held-1440") });
      await card.locator('[data-act="release-holds"]').click();
      await toast(page, /^Let go\. 3\.1 and 3\.2 can go ahead\.$/);
      await page.waitForSelector('[data-entry="held"]', { state: "detached" });
      await page.screenshot({ path: shot("held-released-1440") });
    },
  },
  {
    name: "next-director-parity-chinese",
    query: `${base}&director=held,failed&lang=zh`,
    async run({ page }) {
      await ready(page);
      const held = (await page.locator('[data-entry="held"] b').textContent()).trim();
      // The shots are set apart from 和 as the catalogs write "第 2 场".
      if (held !== "导演有一项未完成的修改占用着 3.1 和 3.2") fail(`The held card reads ${held}`);
      if (!(await page.locator('[data-entry="held"] [data-act="release-holds"]').textContent()).includes("放弃这项修改")) fail("Let it go is not in Chinese");
      const marker = (await page.locator(".dir-attention b").textContent()).trim();
      if (marker !== "这条回复需要处理") fail(`The marker reads ${marker}`);
      const detail = (await page.locator(".dir-attention b + span").textContent()).trim();
      if (detail !== "导演出错停止了。发送一条消息重试。") fail(`The failure reads ${detail}`);
      await page.locator('.preview [data-act="show-director"]').click();
      await toast(page, /^示例导演看不了图片/);
      await page.screenshot({ path: shot("parity-zh-1440"), clip: column });
    },
  },
];
