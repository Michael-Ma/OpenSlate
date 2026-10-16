// Next UI, Plan view: what the classic plan editor could do that the Plan view now does too, on the Last Ferry
// fixture film (?ui=next&fixture=last-ferry). Nothing is generated, charged or saved. Presets: `plan=lost` loses the
// reply to the first storyboard command; `plan=director-edits` has the Director change 1.2 and the story 3 s after the
// Plan opens (fixtures/routes/plan.ts).
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (label) => `shot-${label.replace(".", "-")}`;
const scene = (ordinal) => `scene-${ordinal}`;
const shots = "/tmp/parity/plan";
try { mkdirSync(shots, { recursive: true }); } catch { /* screenshots are optional */ }
const screenshot = (page, name, fullPage = false) => page.screenshot({ path: join(shots, `${name}.png`), fullPage });

async function openPlan(page) {
  await page.waitForSelector(".topbar [data-act='tab'][data-view='plan']", { timeout: 20000 });
  await page.click(".topbar [data-act='tab'][data-view='plan']");
  await page.waitForSelector('main.work[data-view="plan"] .scenes .shot-row', { timeout: 20000 });
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

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function noSidewaysScroll(page, width) {
  const size = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  if (size > width) throw new Error(`The page scrolls sideways: ${size}px wide at ${width}px`);
}

const head = (page) => page.locator('main.work[data-view="plan"]').getAttribute("data-head");
const badge = (page, label) => page.locator(`.shot-row[data-shot="${shot(label)}"] .badge`).first().innerText();
const noErrorToast = async (page, what) => expect(!(await page.locator(".toast.error, .toast[data-tone='error']").count()), `${what} showed an error toast`);

const SAMPLE = `# The Last Ferry — draft 3

1. Closing time. The ticket office at closing time; Mara buys the last ticket. "One for the morning boat."
2. Harbour at dawn. Mara on the pier. Close on the ticket date. "It was the last boat of the season."
   The gangway is lowered and Mara steps aboard.
3. Departure. The ferry pulls away into the fog. "I didn't look back."`;

export const scenarios = [
  {
    name: "next-plan-action-and-prompts",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      // The row keeps both prompts in full, behind a disclosure.
      const toggle = page.locator(`[data-act="toggle-prompts"][data-shot="${shot("2.1")}"]`);
      expect((await toggle.getAttribute("aria-expanded")) === "false", "Prompts start open");
      await toggle.click();
      await expectText(page, `[data-shot="${shot("2.1")}"] [data-prompt="video"]`, /The empty harbour at dawn, the ferry moored, fog over the water\. Slow push-in\./);
      expect((await toggle.getAttribute("aria-expanded")) === "true", "aria-expanded did not follow");
      await toggle.click();

      // A video prompt alone outdates only the clip.
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.1")}"]`);
      await page.waitForSelector('form[data-form="shot"] [data-field="action"]');
      expect(await page.locator('[data-field="framing"]').evaluate((el) => el.tagName === "INPUT" && !!el.getAttribute("list")), "Framing is not free text with suggestions");
      await page.fill('[data-field="video-prompt"]', "The shutter slides down; the lamp flickers once.");
      await expectText(page, '[data-impact="cost"] .txt', /^Saving outdates 1\.1's clip \(remaking it costs about \$0\.50\)\. The keyframe stays\./);
      // What happens, a framing in the film's own words: both prompts take the new direction; one command.
      await page.fill('[data-field="action"]', "The clerk pulls the shutter halfway down.");
      await page.fill('[data-field="framing"]', "Low-angle wide over the counter");
      await expectText(page, '[data-impact="cost"] .txt', /^Purpose, action and framing are written into both prompts\. Saving outdates 1\.1's keyframe and clip; remaking both costs about \$0\.54\./);
      expect(!(await page.locator('[data-hint="multi"]').count()), "One command is said to be several");
      await page.locator('[data-act="saved-prompts"] summary').click();
      await expectText(page, '[data-act="saved-prompts"] [data-prompt="image"]', /The ticket office at closing time, shutters half down, one lamp on\./);
      await screenshot(page, "editor-action-prompts-1440");
      const before = Number(await head(page));
      await page.click('[data-act="save-shot"]');
      await expectText(page, ".toast", /Saved 1\.1\. Its keyframe and clip are out of date\./);
      await expectText(page, '[data-act="plan-undo"]', /^Undo: edit 1\.1$/);
      expect(Number(await head(page)) === before + 1, "Three fields were not one command");
      await expectText(page, `[data-shot="${shot("1.1")}"]`, /Low-angle wide over the counter · 6 s[\s\S]*Action: The clerk pulls the shutter halfway down\./);
      await page.click(`[data-act="toggle-prompts"][data-shot="${shot("1.1")}"]`);
      await expectText(page, `[data-shot="${shot("1.1")}"] [data-prompt="image"]`, /^OpenSlate current direction:\nThe ticket office[\s\S]*The clerk pulls the shutter halfway down\.\. Low-angle wide over the counter\nReference details/);
      // The video prompt was written in the same save as the new direction: the direction (with the camera movement)
      // goes in front of the words, as the server writes it.
      await expectText(page, `[data-shot="${shot("1.1")}"] [data-prompt="video"]`, /^OpenSlate current direction:\n[\s\S]*Low-angle wide over the counter\. Camera movement: Slow pan right\nReference details \(retain only where consistent\):\nThe shutter slides down; the lamp flickers once\.$/);
      await screenshot(page, "row-full-prompts-1440");
      // One Undo restores all three.
      await page.click('[data-act="plan-undo"]');
      await expectText(page, ".toast", /Undone: edit 1\.1\./);
      const row = await page.locator(`.shot-row[data-shot="${shot("1.1")}"]`).innerText();
      expect(/Wide · 6 s/.test(row) && !/Action:/.test(row) && /Opened[\s\S]*Clip/.test(row), `Undo did not restore every field: ${JSON.stringify(row)}`);
      await noErrorToast(page, "The edit");
    },
  },
  {
    name: "next-plan-move-to-scene",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click(`[data-act="shot-menu"][data-shot="${shot("1.2")}"]`);
      await page.click('[role="menu"] [data-act="shot-move-scene"]');
      await page.waitForSelector("dialog.move-dialog[open]");
      // The next scene, at its start, keeps the film's order: 1.2 becomes 2.1.
      await expectText(page, "dialog[open] h2", /^Move 1\.2 to another scene$/);
      await expectText(page, '[data-move="becomes"]', /^1\.2 becomes 2\.1\. Nothing made goes out of date; shots after it are renumbered\.$/);
      const focused = await page.evaluate(() => document.activeElement?.getAttribute("value"));
      expect(focused === scene(2), `Focus did not start on the chosen scene (${focused})`);
      await page.click(`[data-choice="${scene(3)}"]`);
      await page.click('[data-act="move-last"]');
      await expectText(page, '[data-move="becomes"]', /^1\.2 becomes 3\.3\./);
      await screenshot(page, "move-dialog-1440");
      await page.click('[data-act="move-confirm"]');
      await page.waitForSelector("dialog.move-dialog[open]", { state: "detached" });
      await expectText(page, ".toast", /Moved 1\.2; it is now 3\.3\. Nothing made goes out of date\./);
      await expectText(page, `.shot-row[data-shot="${shot("1.2")}"] .badge`, /^3\.3$/);
      await expectText(page, `[data-scene="${scene(3)}"] .scene-top`, /3 shots/);
      await expectText(page, `.shot-row[data-shot="${shot("1.2")}"]`, /One for the morning boat[\s\S]*Opened[\s\S]*Clip/);
      await expectText(page, '[data-act="plan-undo"]', /^Undo: move 1\.2$/);
      await page.click('[data-act="plan-undo"]');
      await expectText(page, `.shot-row[data-shot="${shot("1.2")}"] .badge`, /^1\.2$/);
      // Esc closes the dialog, focus back on the menu button; with one scene left there is nowhere to go.
      await page.click(`[data-act="shot-menu"][data-shot="${shot("2.2")}"]`);
      await page.click('[role="menu"] [data-act="shot-move-scene"]');
      await page.waitForSelector("dialog.move-dialog[open]");
      await page.keyboard.press("Escape");
      await page.waitForSelector("dialog.move-dialog[open]", { state: "detached" });
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "shot-menu", null, { timeout: 3000 });
      await noErrorToast(page, "The move");
    },
  },
  {
    name: "next-plan-drag-to-scene",
    query,
    // Tall enough that Scene 2 and Scene 3 are on screen together, so the pointer can carry a row between them.
    viewport: { width: 1440, height: 1500 },
    async run({ page }) {
      await openPlan(page);
      // Drag 3.1 by its thumbnail onto the upper half of 2.2: it lands before 2.2, as 2.2.
      const source = page.locator(`[data-act="drag-shot"][data-shot="${shot("3.1")}"]`);
      expect((await source.getAttribute("draggable")) === "true", "The thumbnail is not a drag handle");
      const target = page.locator(`.shot-row[data-shot="${shot("2.2")}"]`);
      await target.scrollIntoViewIfNeeded();
      const from = await source.boundingBox();
      const to = await target.boundingBox();
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(to.x + 200, to.y + 8, { steps: 8 });
      await page.waitForSelector(`.shot-row.drop-before[data-shot="${shot("2.2")}"]`, { timeout: 3000 });
      await screenshot(page, "drag-drop-line-1440");
      await page.mouse.up();
      await expectText(page, ".toast", /Moved 3\.1; it is now 2\.2\. Nothing made goes out of date\./);
      expect((await badge(page, "3.1")) === "2.2", "The dropped shot did not land before 2.2");
      expect((await badge(page, "2.2")) === "2.3", "2.2 was not renumbered");
      // Onto a scene's end (its Add shot row).
      await page.dragAndDrop(`[data-act="drag-shot"][data-shot="${shot("2.3")}"]`, `[data-scene="${scene(1)}"] .add-row`);
      await expectText(page, ".toast", /Moved 2\.4; it is now 1\.4\./);
      expect((await badge(page, "2.3")) === "1.4", "The shot dropped on Scene 1 is not its last");
      expect(!(await page.locator(".drop-before, .drop-end").count()), "A drop line stays after the drop");
      await noErrorToast(page, "The drags");
    },
  },
  {
    name: "next-plan-changed-underneath-shot",
    query: `${query}&plan=director-edits`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      // The draft is opened before the Director's alongside edit lands (3 s after the Plan opens).
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      expect((await page.inputValue('[data-field="purpose"]')) === "Mara at the counter, sliding coins across.", "The Director's edit landed before the draft was opened");
      await page.fill('[data-field="purpose"]', "Mara buys the last ticket of the season.");
      // The Director changes 1.2's purpose and motion: the purpose is a conflict, the untouched motion follows.
      await page.waitForSelector('[data-notice="conflict"]', { timeout: 10000 });
      await expectText(page, '[data-notice="conflict"]', /The saved film changed while you were editing \(Purpose\)\. Your text is kept: keep it to save it over the new version, or use the saved text\./);
      expect((await page.inputValue('[data-field="purpose"]')) === "Mara buys the last ticket of the season.", "The person's text was not kept");
      expect((await page.inputValue('[data-field="motion"]')) === "Slow push-in", "The untouched motion did not follow the saved film");
      expect(await page.locator('[data-act="save-shot"]').isDisabled(), "A stale draft can be saved");
      await expectText(page, ".edit-foot .hint", /^Choose Keep my text or Use saved text first\.$/);
      await page.locator('[data-notice="conflict"]').scrollIntoViewIfNeeded();
      await screenshot(page, "conflict-shot-1440");
      await page.click('[data-act="conflict-keep"]');
      await page.waitForSelector('[data-notice="conflict"]', { state: "detached" });
      await page.click('[data-act="save-shot"]');
      await page.waitForSelector('form[data-form="shot"]', { state: "detached" });
      // Saved over the new version, and the Director's motion was not reverted.
      await expectText(page, `.shot-row[data-shot="${shot("1.2")}"]`, /Mara buys the last ticket of the season\.[\s\S]*slow push-in/);
      await noErrorToast(page, "The save");
    },
  },
  {
    name: "next-plan-changed-underneath-story",
    query: `${query}&plan=director-edits`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click('[data-act="edit-text"][data-field="story"]');
      await page.fill('[data-panel="story"] textarea', "At closing time Mara buys the last ticket.");
      await page.waitForSelector('[data-panel="story"] [data-notice="conflict"]', { timeout: 10000 });
      await expectText(page, '[data-panel="story"] [data-notice="conflict"]', /The saved film changed while you were editing\. Your text is kept/);
      expect(await page.locator('[data-panel="story"] [data-act="save-text"]').isDisabled(), "A stale story can be saved");
      await screenshot(page, "conflict-story-1440");
      await page.click('[data-panel="story"] [data-act="conflict-saved"]');
      expect((await page.inputValue('[data-panel="story"] textarea')) === "Mara leaves her town on the season's last ferry: the ticket office, the harbour at dawn, the departure.", "Use saved text did not take the saved story");
      await page.waitForSelector('[data-panel="story"] [data-notice="conflict"]', { state: "detached" });
      await page.click('[data-panel="story"] [data-act="cancel-edit"]');
      await expectText(page, '[data-panel="story"] .text-block', /season's last ferry/);
    },
  },
  {
    name: "next-plan-lost-reply-editor",
    query: `${query}&plan=lost`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      const before = Number(await head(page));
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.fill('[data-field="purpose"]', "Mara buys the last ticket of the season.");
      await page.click('[data-act="save-shot"]');
      // The reply is lost: said in the editor, with the retry; no error toast, and Save waits for the retry.
      await page.waitForSelector('form[data-form="shot"] [data-notice="unconfirmed"]', { timeout: 8000 });
      await page.locator('[data-notice="unconfirmed"]').scrollIntoViewIfNeeded();
      await expectText(page, '[data-notice="unconfirmed"]', /Not confirmed: edit 1\.2\. The studio did not answer, so it may or may not have been saved\. Retry the same request to check its outcome; it is never applied twice\./);
      await noErrorToast(page, "The lost reply");
      expect(await page.locator('[data-act="save-shot"]').isDisabled(), "Save is on while the outcome is unknown");
      await screenshot(page, "lost-reply-editor-1440");
      await page.click('[data-act="retry-same"]');
      await page.waitForSelector('form[data-form="shot"]', { state: "detached" });
      await expectText(page, ".toast", /Saved 1\.2\. Its keyframe and clip are out of date\./);
      await expectText(page, '[data-act="plan-undo"]', /^Undo: edit 1\.2$/);
      expect(Number(await head(page)) === before + 1, "The retry applied the edit twice");
    },
  },
  {
    name: "next-plan-lost-reply-strip",
    query: `${query}&plan=lost`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      const before = Number(await head(page));
      await page.click(`[data-act="scene-up"][data-scene="${scene(3)}"]`);
      await page.waitForSelector('.unconfirmed.strip-note', { timeout: 8000 });
      await expectText(page, '.strip-note', /Not confirmed: move “Departure”\. The studio did not answer/);
      // Turned off meanwhile, the Add buttons look quieter than when on: no fill.
      const fills = await page.$$eval('[data-act="add-shot"], [data-act="add-scene"]', (els) => els.map((el) => [el.disabled, getComputedStyle(el).backgroundColor]));
      expect(fills.length > 1 && fills.every(([off, fill]) => off && fill === "rgba(0, 0, 0, 0)"), `Turned-off Add buttons: ${JSON.stringify(fills)}`);
      // Scrolled, the strip sits flush under the top bar: above it and just below it is its own ground, not the rows.
      await page.locator('main.work[data-view="plan"]').evaluate((el) => { el.scrollTop = 420; });
      await page.waitForTimeout(100);
      const flush = await page.evaluate(() => {
        const work = document.querySelector('main.work[data-view="plan"]').getBoundingClientRect();
        const note = document.querySelector(".strip-note").getBoundingClientRect();
        const strip = document.querySelector(".lost-strip");
        return [work.top + 2, note.top - 3, note.bottom + 4].map((y) => strip.contains(document.elementFromPoint(note.left + 60, y)));
      });
      expect(flush.every(Boolean), `Rows show around the stuck strip (above, at its edge, below): ${flush}`);
      await screenshot(page, "lost-reply-strip-1440");
      await page.click('.strip-note [data-act="retry-same"]');
      await page.waitForSelector('.strip-note', { state: "detached" });
      await expectText(page, ".toast", /“Departure” is now Scene 2\./);
      expect(Number(await head(page)) === before + 1, "The retry applied the move twice");
      await expectText(page, '[data-act="plan-undo"]', /^Undo: move “Departure”$/);
    },
  },
  {
    name: "next-plan-import-review-texts",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click('[data-act="import-open"]');
      await page.fill('[data-field="import-name"]', "last-ferry-draft.md");
      await page.fill('[data-field="import-text"]', SAMPLE);
      await page.click('[data-act="import-send"]');
      // The source can be read while the Director reads it.
      await page.waitForSelector('[data-source="import"]');
      await page.waitForSelector('[data-act="import-confirm"]', { timeout: 10000 });
      await expectText(page, '[data-text="brief"]', /^Brief\s*Same/);
      await expectText(page, '[data-text="story"]', /^Story\s*Changed[\s\S]*at dawn she boards the last ferry of the season[\s\S]*Was: Closing time at the ticket office; the harbour at dawn; the ferry departs\./);
      await expectText(page, '[data-text="script"]', /^Narration script\s*Changed[\s\S]*It was the last boat of the season\.[\s\S]*Was: not written/);
      await expectText(page, '[data-row="2.4"]', /Action: A deckhand lowers the gangway[\s\S]*Picture prompt: The ferry's gangway lowered onto the pier[\s\S]*Video prompt:/);
      await page.click('[data-act="import-source"]');
      await expectText(page, '[data-source="import"] pre', /# The Last Ferry — draft 3[\s\S]*I didn't look back\./);
      await screenshot(page, "import-review-texts-1440");
      await page.click('[data-act="import-confirm"]');
      await page.waitForSelector("dialog.sheet[open]", { state: "detached" });
      await expectText(page, '[data-panel="story"] .text-block', /at dawn she boards the last ferry of the season/);
    },
  },
  {
    name: "next-plan-parity-phone",
    query: `${query}&lang=zh`,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await openPlan(page);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.fill('[data-field="action"]', "She slides three coins across.");
      await noSidewaysScroll(page, 390);
      await expectText(page, '[data-impact="cost"] .txt', /^目的、动作和景别会写进画面和视频描述。/);
      await page.locator('[data-field="video-prompt"]').scrollIntoViewIfNeeded();
      await screenshot(page, "zh-editor-390");
      await page.click('[data-act="cancel-edit"]');
      await page.click(`[data-act="shot-menu"][data-shot="${shot("1.2")}"]`);
      await page.click('[role="menu"] [data-act="shot-move-scene"]');
      await page.waitForSelector("dialog.move-dialog[open]");
      await expectText(page, '[data-move="becomes"]', /^1\.2 会变成 2\.1。/);
      await noSidewaysScroll(page, 390);
      await screenshot(page, "zh-move-dialog-390");
    },
  },
];
