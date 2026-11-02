// A new clip for one saved shot (contract 7.1.0, sample film; nothing leaves the page). Asking the Director to redo
// 1.1's video puts a priced "New clip for 1.1" choice in the chat and in the Keyframes banner; it keeps the keyframe.
// Pressing it makes only 1.1's clip, and the note says so until the clip is saved.
// Screenshots go to /tmp/openslate-remake-*.png (or $OPENSLATE_SCREENSHOTS).
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (name) => join(process.env.OPENSLATE_SCREENSHOTS ?? "/tmp", `openslate-remake-${name}.png`);
const fail = (message) => { throw new Error(message); };

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
    name: "next-clip-remake-from-chat",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await page.waitForSelector(".director .thread [data-entry]", { timeout: 20000 });
      const before = await page.evaluate(() => document.querySelectorAll(".thread .note").length);
      await ask(page, "Please remake the video for 1.1, keep the keyframe.");
      const card = page.locator('.thread .note:has([data-kind="remake_clip"])');
      await card.waitFor({ timeout: 10000 });
      if ((await page.evaluate(() => document.querySelectorAll(".thread .note").length)) !== before + 1) fail("Asking for one clip wrote more than one note");
      const noteId = await card.getAttribute("data-note-id");
      const press = card.locator('[data-act="note-choice"][data-kind="remake_clip"]');
      await expectText(page, `.thread .note[data-note-id="${noteId}"] [data-act="note-choice"][data-kind="remake_clip"]`, /^New clip for 1\.1 · .*\$0\.50/);
      if (await press.isDisabled()) fail("New clip is off for a saved shot with an opened frame");
      // The frame it keeps is shown in the card, as for a confirm.
      await card.locator('[data-act="note-frame"][data-shot="shot-1-1"]').waitFor();
      if (await card.locator('[data-act="note-frame"]').count() !== 1) fail("The card shows frames other than 1.1's");
      // The same choice waits in the Keyframes banner of Scene 1.
      await page.click('[data-act="scene"][data-scene="scene-1"]');
      await page.locator(`.banner [data-act="note-choice"][data-note="${noteId}"][data-kind="remake_clip"]`).waitFor({ timeout: 10000 });
      await page.screenshot({ path: shot("ready-1440") });
      await press.click();
      // Only 1.1 is remade; the note says the clip is being made, then that it is saved.
      await expectText(page, `.thread .note[data-note-id="${noteId}"] .handled`, /^(Making a new clip for 1\.1…|✓ Settled: new clip for 1\.1 saved)$/, 10000);
      if (await page.locator(`.thread .note[data-note-id="${noteId}"] [data-act="note-choice"]`).count()) fail("The settled card still offers its choices");
      const working = await page.evaluate(() => [...document.querySelectorAll('.kf [data-shot]')].length);
      if (!working) fail("Keyframes shows no shot cards");
      await expectText(page, `.thread .note[data-note-id="${noteId}"] .handled`, /^✓ Settled: new clip for 1\.1 saved$/, 15000);
      await page.screenshot({ path: shot("done-1440") });
    },
  },
  {
    name: "next-clip-remake-narrow",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await page.waitForSelector(".director .thread [data-entry]", { state: "attached", timeout: 20000 });
      await page.click('[aria-controls="director"]');
      await page.waitForFunction(() => document.querySelector(".app").classList.contains("dir-open"));
      await ask(page, "重做 1.1 的视频");
      const card = page.locator('.thread .note:has([data-kind="remake_clip"])');
      await card.waitFor({ timeout: 10000 });
      const over = await page.evaluate(() => [...document.querySelectorAll(".thread .note button")].filter((b) => b.getBoundingClientRect().right > b.closest(".note").getBoundingClientRect().right + 0.5).length);
      if (over) fail(`${over} note buttons run past their card's edge at 390 px`);
      await card.screenshot({ path: shot("card-390") });
    },
  },
];
