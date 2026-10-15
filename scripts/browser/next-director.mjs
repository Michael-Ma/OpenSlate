// Director column checks on the next UI with the Last Ferry fixture film (no server state is used).
// Screenshots go to /tmp/openslate-director-*.png (or $OPENSLATE_SCREENSHOTS) for a side-by-side look
// with docs/ai/prototypes/last-ferry/last-ferry.html at 1440 x 900.
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (name) => join(process.env.OPENSLATE_SCREENSHOTS ?? "/tmp", `openslate-director-${name}.png`);
const fail = (message) => { throw new Error(message); };

async function ready(page) {
  await page.waitForSelector(".director .thread [data-entry]", { timeout: 20000 });
  // Until the shell lands on this branch the top bar is a stub that takes the column's grid cell;
  // give it the real bar's row so the column sits where the design puts it.
  if (await page.locator('.app > [data-stub="TopBar"]').count())
    await page.addStyleTag({ content: '.app > [data-stub="TopBar"]{grid-column:1/-1;background:var(--bar);border-bottom:1px solid var(--hairline)}' });
}

const texts = (page, selector) => page.$$eval(selector, (nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, " ").trim()));
const chipTexts = (page) => texts(page, ".composer .chips .atchip").then((list) => list.map((text) => text.replace(/×$/, "")));

async function pick(page, typed, expectActive) {
  const box = page.locator('[data-field="message"]');
  await box.click();
  await box.pressSequentially(typed);
  await page.waitForSelector('.picker [role="listbox"]');
  const active = await page.$eval('.picker [aria-selected="true"]', (node) => node.firstChild.textContent);
  if (active !== expectActive) fail(`The picker's active option is ${active}, expected ${expectActive}`);
  await box.press("Enter");
  await page.waitForSelector(".picker", { state: "detached" });
}

export const scenarios = [
  {
    name: "next-director-golden-thread",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      const bylines = await texts(page, ".thread .byline");
      if (bylines.join(" | ") !== "You · 10:42 | Director · 10:44") fail(`Bylines are ${JSON.stringify(bylines)}`);
      const bubble = await texts(page, '.thread [data-who="you"] .bubble');
      if (!bubble[0]?.startsWith("@Scene 2make the harbour feel colder")) fail(`The first bubble reads ${JSON.stringify(bubble[0])}`);
      if (await page.locator('.thread [data-who="you"] .bubble .atchip').count() !== 1) fail("The first message should show exactly one @ chip");
      if (await page.locator('.thread [data-who="director"] .bubble').count()) fail("The Director's text must not sit in a bubble");
      const reply = await texts(page, '.thread [data-who="director"] .dir-text p');
      if (!reply[0]?.startsWith("I rewrote the three Scene 2 prompts")) fail(`The Director's text reads ${JSON.stringify(reply)}`);
      const head = await texts(page, ".dir-head");
      if (!/^D\s?Director\s?Scene 2/.test(head[0] ?? "")) fail(`The header reads ${JSON.stringify(head)}`);
      if (await page.locator('.dir-mode[data-mode="fake"]').count() !== 1) fail("The scripted Director's mode line is missing");
      if (await page.locator(".dir-close").isVisible()) fail("Close shows on a wide screen");
      // The column keeps the design's 392 px and the thread is anchored to the bottom, above the composer.
      const column = await page.locator(".director").boundingBox();
      if (Math.round(column.width) !== 392) fail(`The Director column is ${column.width}px wide`);
      const last = await page.locator(".thread [data-entry]").last().boundingBox();
      const composer = await page.locator(".composer").boundingBox();
      if (composer.y - (last.y + last.height) > 40) fail(`The thread is not anchored to the bottom (gap ${composer.y - (last.y + last.height)}px)`);
      if (Math.round(composer.y + composer.height) !== 900 - 16) fail(`The composer ends at ${composer.y + composer.height}`);
      const overflow = await page.$eval(".director", (node) => node.scrollWidth - node.clientWidth);
      if (overflow > 0) fail(`The Director column scrolls sideways by ${overflow}px`);
      await page.screenshot({ path: shot("golden-1440") });
    },
  },
  {
    name: "next-director-compose",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      const send = page.locator('[data-act="send"]');
      if (!(await send.isDisabled())) fail("Send is enabled with an empty message");
      // The @ button opens the same picker; arrows move, Esc closes and keeps focus in the textarea.
      await page.locator('[data-act="at"]').click();
      await page.waitForSelector('.picker [role="listbox"]');
      if (await page.$eval('[data-act="at"]', (node) => node.getAttribute("aria-expanded")) !== "true") fail("The @ button does not say the picker is open");
      const box = page.locator('[data-field="message"]');
      await box.press("ArrowDown");
      await box.press("ArrowDown");
      const third = await page.$eval('.picker [aria-selected="true"]', (node) => node.firstChild.textContent);
      if (third !== "Scene 3") fail(`ArrowDown twice lands on ${third}`);
      await page.screenshot({ path: shot("picker-1440"), clip: { x: 0, y: 300, width: 400, height: 600 } });
      await box.press("Escape");
      await page.waitForSelector(".picker", { state: "detached" });
      if (!(await page.$eval('[data-field="message"]', (node) => node === document.activeElement))) fail("Esc moved focus out of the composer");
      // Typing @ opens it too; the typed query filters; Enter picks and the "@2.2" text becomes a chip.
      await pick(page, "@2.2", "2.2");
      if ((await chipTexts(page)).join() !== "@2.2") fail(`Chips after the pick: ${await chipTexts(page)}`);
      if (await box.inputValue() !== "") fail(`The typed mention stayed in the text: ${JSON.stringify(await box.inputValue())}`);
      // Shift+Enter is a new line; Enter sends.
      await box.pressSequentially("Make the coat");
      await box.press("Shift+Enter");
      await box.pressSequentially("brighter");
      if (await box.inputValue() !== "Make the coat\nbrighter") fail(`Shift+Enter gave ${JSON.stringify(await box.inputValue())}`);
      const grown = await box.boundingBox();
      if (grown.height < 36) fail(`The textarea did not grow for two lines (${grown.height}px)`);
      if (await send.isDisabled()) fail("Send is disabled with text");
      await box.press("Enter");
      await page.waitForSelector('.thread [data-entry="working"]');
      const mine = await texts(page, '.thread [data-who="you"] .bubble');
      if (mine.at(-1) !== "@2.2Make the coat brighter") fail(`The sent bubble reads ${JSON.stringify(mine.at(-1))}`);
      if ((await chipTexts(page)).length) fail("Chips stayed in the composer after sending");
      if (await box.inputValue() !== "") fail("The composer kept the sent text");
      if (!(await page.locator('[data-act="stop"]').isVisible())) fail("Stop is missing while the Director works");
      await page.screenshot({ path: shot("working-1440"), clip: { x: 0, y: 0, width: 400, height: 900 } });
      await page.waitForSelector('.thread [data-entry="working"]', { state: "detached", timeout: 5000 });
      const reply = await texts(page, '.thread [data-who="director"]');
      if (!/^Director · \d\d:\d\d ?Noted for 2\.2\./.test(reply.at(-1) ?? "")) fail(`The reply reads ${JSON.stringify(reply.at(-1))}`);
      if (!reply.at(-1).endsWith("Scripted reply; nothing in the film was changed.")) fail("The scripted reply is not marked");
      if (await page.locator('[data-act="stop"]').count()) fail("Stop stayed after the Director finished");
      await page.screenshot({ path: shot("replied-1440"), clip: { x: 0, y: 0, width: 400, height: 900 } });
    },
  },
  {
    name: "next-director-limit-and-chips",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      const box = page.locator('[data-field="message"]');
      await box.fill("x".repeat(16001));
      if (!(await page.locator('[data-act="send"]').isDisabled())) fail("Send is enabled past 16,000 characters");
      const note = await texts(page, ".composer-note");
      if (note[0] !== "Keep the message under 16,000 characters.") fail(`The limit message reads ${JSON.stringify(note)}`);
      const height = (await box.boundingBox()).height;
      if (height > 140) fail(`The textarea grew past about six lines (${height}px)`);
      await box.fill("");
      // Two chips, one removed by its button.
      await pick(page, "@scene", "Scene 1");
      await pick(page, "@2.3", "2.3");
      if ((await chipTexts(page)).join() !== "@Scene 1,@2.3") fail(`Chips: ${await chipTexts(page)}`);
      await page.getByRole("button", { name: "Remove Scene 1" }).click();
      if ((await chipTexts(page)).join() !== "@2.3") fail(`Chips after removing: ${await chipTexts(page)}`);
    },
  },
  {
    name: "next-director-selecting-a-shot-keeps-chips",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await pick(page, "@2", "Scene 2");
      const before = await chipTexts(page);
      const cards = page.locator('[data-act="open-shot"]');
      if (!(await cards.count())) {
        // The Keyframes view is still a stub on this branch; the reducer test covers LG-3 until it lands.
        console.log("     note: no [data-act=\"open-shot\"] in the workspace yet; selection check skipped");
        return;
      }
      await cards.last().click();
      await page.waitForTimeout(300);
      const after = await chipTexts(page);
      if (after.join() !== before.join()) fail(`Selecting a shot changed the chips from ${before} to ${after}`);
    },
  },
  {
    name: "next-director-idle-has-no-stop",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Scene 3 has unmade shots, but nothing is running or queued: there is nothing to stop.
      await page.waitForTimeout(500);
      if (await page.locator('[data-act="stop"]').count()) fail("Stop is offered while nothing is running");
      if (await page.locator('[data-act="continue"]').count()) fail("Continue is offered while the film is not stopped");
    },
  },
  {
    name: "next-director-narrow-drawer",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await page.waitForSelector(".director .thread [data-entry]", { state: "attached", timeout: 20000 });
      const toggle = page.locator('[aria-controls="director"]');
      if (!(await toggle.count())) {
        console.log("     note: no Director toggle in the top bar yet; drawer check skipped");
        return;
      }
      const open = () => page.$eval(".app", (node) => node.classList.contains("dir-open"));
      await toggle.click();
      await page.waitForFunction(() => document.querySelector(".app").classList.contains("dir-open"));
      // Esc inside the @ picker closes only the picker; the next Esc closes the drawer.
      const box = page.locator('[data-field="message"]');
      await box.click();
      await box.pressSequentially("@");
      await page.waitForSelector('.picker [role="listbox"]');
      await box.press("Escape");
      await page.waitForSelector(".picker", { state: "detached" });
      if (!(await open())) fail("Esc in the @ picker closed the drawer");
      const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.querySelector(".director").scrollWidth - document.querySelector(".director").clientWidth]);
      if (widths[0] > 390 || widths[1] > 0) fail(`The drawer scrolls sideways: ${widths}`);
      await page.screenshot({ path: shot("narrow-390") });
      await box.press("Escape");
      await page.waitForFunction(() => !document.querySelector(".app").classList.contains("dir-open"));
      // Close is the way out on phones.
      await toggle.click();
      await page.waitForFunction(() => document.querySelector(".app").classList.contains("dir-open"));
      const close = page.locator(".dir-close");
      if (!(await close.isVisible())) fail("Close is missing in the narrow drawer");
      await close.click();
      await page.waitForFunction(() => !document.querySelector(".app").classList.contains("dir-open"), null, { timeout: 2000 }).catch(() => fail("Close did not close the drawer"));
    },
  },
  {
    name: "next-director-notes",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      if (!(await page.locator(".thread .note").count())) {
        console.log("     note: the fixture film has no Director notes yet; notes check skipped");
        return;
      }
      // Notes a and b sit under the Director's 10:44 reply, in letter order, amber while open.
      const reply = page.locator('.thread [data-who="director"]').filter({ hasText: "10:44" });
      const letters = await reply.locator(".note").evaluateAll((nodes) => nodes.map((node) => [node.dataset.note, node.classList.contains("done")]));
      if (JSON.stringify(letters) !== JSON.stringify([["a", false], ["b", false]])) fail(`Notes under the 10:44 reply: ${JSON.stringify(letters)}`);
      const amber = await reply.locator(".note .letter").first().evaluate((node) => getComputedStyle(node).backgroundColor);
      if (amber !== "rgb(240, 178, 74)") fail(`The open note's letter is ${amber}, not the Director's amber`);
      // No choices in the thread: Open is the only action.
      const acts = await reply.locator(".note button").evaluateAll((nodes) => [...new Set(nodes.map((node) => node.dataset.act))]);
      if (acts.join() !== "note-open") fail(`Note cards offer ${acts}`);
      await page.screenshot({ path: shot("notes-1440"), clip: { x: 0, y: 0, width: 400, height: 900 } });
      // Open 2.2 selects the shot in the Keyframes view.
      await reply.getByRole("button", { name: "Open 2.2" }).click();
      await page.waitForSelector('.card.sel[data-card="shot-2-2"]');
      // From another view, Open 2.3 comes back to Keyframes with 2.3 selected.
      await page.locator('[data-act="tab"][data-view="plan"]').click();
      await page.waitForSelector('[data-act="tab"][data-view="plan"][aria-selected="true"]');
      await reply.getByRole("button", { name: "Open 2.3" }).click();
      await page.waitForSelector('[data-act="tab"][data-view="keyframes"][aria-selected="true"]');
      await page.waitForSelector('.card.sel[data-card="shot-2-3"]');
    },
  },
  {
    name: "next-director-notes-narrow",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await page.waitForSelector(".director .thread [data-entry]", { state: "attached", timeout: 20000 });
      const toggle = page.locator('[aria-controls="director"]');
      if (!(await page.locator(".thread .note").count()) || !(await toggle.count())) {
        console.log("     note: no fixture notes or no Director toggle yet; narrow notes check skipped");
        return;
      }
      await toggle.click();
      await page.waitForFunction(() => document.querySelector(".app").classList.contains("dir-open"));
      await page.locator(".thread .note").getByRole("button", { name: "Open 2.2" }).click();
      // Opening a shot from a note closes the drawer so the shot is seen.
      await page.waitForFunction(() => !document.querySelector(".app").classList.contains("dir-open"), null, { timeout: 2000 }).catch(() => fail("Open 2.2 left the drawer open"));
      await page.waitForSelector('.card.sel[data-card="shot-2-2"]', { state: "attached" });
    },
  },
  {
    name: "next-director-chinese",
    query: `${query}&lang=zh`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      const bylines = await texts(page, ".thread .byline");
      if (bylines.join(" | ") !== "你 · 10:42 | 导演 · 10:44") fail(`Bylines are ${JSON.stringify(bylines)}`);
      const chip = await texts(page, ".thread .bubble .atchip");
      if (chip[0] !== "@第 2 场") fail(`The chip reads ${JSON.stringify(chip)}`);
      const placeholder = await page.getAttribute('[data-field="message"]', "placeholder");
      if (placeholder !== "回复导演…") fail(`The placeholder reads ${placeholder}`);
      await page.screenshot({ path: shot("golden-zh-1440"), clip: { x: 0, y: 0, width: 400, height: 900 } });
    },
  },
];
