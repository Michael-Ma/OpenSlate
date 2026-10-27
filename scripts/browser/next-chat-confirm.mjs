// Answering the Director in the chat (card N1, sample film; nothing leaves the page). An open note offers its choices
// under the reply as well as in the Keyframes banner, and whichever place is pressed first settles it: the other then
// shows it settled. Asking for video puts the scene's confirm in the chat, with its frames to open there.
// Screenshots go to /tmp/openslate-confirm-*.png (or $OPENSLATE_SCREENSHOTS).
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (name) => join(process.env.OPENSLATE_SCREENSHOTS ?? "/tmp", `openslate-confirm-${name}.png`);
const fail = (message) => { throw new Error(message); };

async function ready(page) {
  await page.waitForSelector(".director .thread [data-entry]", { timeout: 20000 });
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

async function ask(page, words) {
  const box = page.locator('[data-field="message"]');
  await box.click();
  await box.pressSequentially(words);
  await page.click('[data-act="send"]');
}

export const scenarios = [
  {
    name: "next-chat-confirm-video",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await ask(page, "Please make the video for scene 2.");
      // The scripted Director asks for Scene 2's confirm in the chat; it starts nothing itself.
      const card = page.locator('.thread .note:has([data-kind="confirm_video"])');
      await card.waitFor({ timeout: 10000 });
      const noteId = await card.getAttribute("data-note-id");
      const confirm = card.locator('[data-act="note-choice"][data-kind="confirm_video"]');
      if (!(await confirm.isDisabled())) fail("Confirm is on before the frames are opened and 2.3's line is settled");
      await expectText(page, '.thread .note:has([data-kind="confirm_video"]) .note-why', /^Open 2\.2 and 2\.3 and settle 2\.3 first$/);
      // Note b's change is answered in the chat too: Make 2.3 8 s.
      await page.click('.thread .note[data-note-id="note-b"] [data-act="note-choice"][data-kind="proposal"]');
      await expectText(page, '.thread .note[data-note-id="note-b"] .handled', /^✓ Settled: change applied$/, 10000);
      // A thumbnail alone is not opened; shown large in the card, it is.
      for (const id of ["shot-2-2", "shot-2-3"]) {
        if ((await card.locator(`[data-act="note-frame"][data-shot="${id}"]`).getAttribute("data-opened")) === "true") fail(`${id} counts as opened from its thumbnail`);
        await card.locator(`[data-act="note-frame"][data-shot="${id}"]`).click();
        await card.locator(`.note-large[data-shot="${id}"] img`).waitFor();
        await page.waitForSelector(`.thread .note [data-act="note-frame"][data-shot="${id}"][data-opened="true"]`, { timeout: 10000 });
      }
      await page.waitForFunction(() => !document.querySelector('.thread .note [data-act="note-choice"][data-kind="confirm_video"]')?.disabled, null, { timeout: 10000 });
      await expectText(page, '.thread .note:has([data-kind="confirm_video"]) [data-act="note-choice"][data-kind="confirm_video"]', /^Confirm frames & generate Scene 2 video · .*\$/);
      const over = await page.evaluate(() => [...document.querySelectorAll(".thread .note button")].filter((b) => b.getBoundingClientRect().right > b.closest(".note").getBoundingClientRect().right + 0.5).length);
      if (over) fail(`${over} note buttons run past their card's edge`);
      await page.screenshot({ path: shot("ready-1440"), clip: { x: 0, y: 0, width: 400, height: 900 } });
      await confirm.click();
      // The note settles, and Scene 2 makes its clips, exactly as the Keyframes press would.
      await expectText(page, `.thread .note[data-note-id="${noteId}"] .handled`, /^✓ Settled: Scene 2 video confirmed$/, 10000);
      if (await page.locator(`.thread .note[data-note-id="${noteId}"] [data-act="note-choice"]`).count()) fail("The settled card still offers its choices");
      await page.click('[data-act="scene"][data-scene="scene-2"]');
      await expectText(page, '.kf', /Making video|Making clips|clip/i, 10000);
      await page.screenshot({ path: shot("confirmed-1440") });
    },
  },
  {
    name: "next-chat-confirm-first-wins",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Note b's change accepted in the Keyframes banner: the same note in the chat turns settled, with nothing left to press.
      await page.click('[data-act="scene"][data-scene="scene-2"]');
      await page.click('.banner [data-act="note-choice"][data-note="note-b"][data-kind="proposal"]', { timeout: 10000 });
      await page.waitForSelector('.banner[data-note="note-b"][data-state="settled"]');
      await expectText(page, '.thread .note[data-note-id="note-b"] .handled', /^✓ Settled: change applied$/, 10000);
      if (await page.locator('.thread .note[data-note-id="note-b"] [data-act="note-choice"]').count()) fail("The chat still offers choices on a note settled in Keyframes");
      // The other way round: Keep maroon in the chat, and the banner has no note a left to answer.
      await page.click('.banner [data-act="note-next"]');
      await page.waitForSelector('.banner[data-note="note-a"]');
      await page.click('.thread .note[data-note-id="note-a"] [data-act="note-choice"][data-kind="accept"]');
      await expectText(page, '.thread .note[data-note-id="note-a"] .handled', /^✓ Settled: Keep maroon$/, 10000);
      await page.waitForSelector('.banner[data-note="note-a"][data-state="open"]', { state: "detached", timeout: 10000 });
      await page.screenshot({ path: shot("first-wins-1440") });
    },
  },
  {
    name: "next-chat-confirm-undo",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // A change accepted in the chat can be undone there, as from the banner; the note is open again.
      await page.click('.thread .note[data-note-id="note-b"] [data-act="note-choice"][data-kind="proposal"]');
      await expectText(page, '.thread .note[data-note-id="note-b"] .handled', /^✓ Settled: change applied$/, 10000);
      await page.click('.thread .note[data-note-id="note-b"] [data-act="undo"]');
      await page.waitForSelector('.thread .note[data-note-id="note-b"][data-tone="open"] [data-act="note-choice"][data-kind="proposal"]', { timeout: 10000 });
      if (await page.locator('.thread .note[data-note-id="note-b"] [data-act="undo"]').count()) fail("Undo stayed after undoing");
    },
  },
  {
    name: "next-chat-confirm-edit",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Edit narration chosen in the chat, from Plan: Keyframes opens with 2.3's line in the editor; saving it settles the note.
      await page.click('[data-act="tab"][data-view="plan"]');
      await page.click('.thread .note[data-note-id="note-b"] [data-act="note-choice"][data-kind="edit"]');
      await page.waitForSelector('[data-act="tab"][data-view="keyframes"][aria-selected="true"]');
      await page.waitForSelector('.insp form[data-form="narration"]', { timeout: 10000 });
      await page.fill(".insp textarea", "The last boat, and I nearly missed it.");
      await page.click('.insp [data-act="save-edit"]');
      await expectText(page, '.thread .note[data-note-id="note-b"] .handled', /^✓ Settled: 2\.3 edited$/, 10000);
    },
  },
  {
    name: "next-chat-confirm-narrow",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await page.waitForSelector(".director .thread [data-entry]", { state: "attached", timeout: 20000 });
      await page.click('[aria-controls="director"]');
      await page.waitForFunction(() => document.querySelector(".app").classList.contains("dir-open"));
      await ask(page, "生成第 2 场的视频");
      const card = page.locator('.thread .note:has([data-kind="confirm_video"])');
      await card.waitFor({ timeout: 10000 });
      // The choices wrap inside their card: nothing runs off its edge, priced or not.
      const over = await page.evaluate(() => [...document.querySelectorAll(".thread .note button")].filter((b) => b.getBoundingClientRect().right > b.closest(".note").getBoundingClientRect().right + 0.5).length);
      if (over) fail(`${over} note buttons run past their card's edge`);
      await page.screenshot({ path: shot("narrow-390") });
    },
  },
];
