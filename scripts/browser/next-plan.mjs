// Next UI, Plan view, on the Last Ferry fixture film (?ui=next&fixture=last-ferry): nothing is generated, charged or
// saved. Layout and behaviour come from docs/ai/prototypes/last-ferry/plan.html and P5-DESIGN.md (Plan).
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (label) => `shot-${label.replace(".", "-")}`;
const scene = (ordinal) => `scene-${ordinal}`;
const shots = (() => {
  const dir = existsSync("/tmp") ? "/tmp/p5-build/plan" : join(tmpdir(), "p5-build-plan");
  try { mkdirSync(dir, { recursive: true }); } catch { /* screenshots are optional */ }
  return dir;
})();
const screenshot = (page, name, fullPage = false) => page.screenshot({ path: join(shots, `next-plan-${name}.png`), fullPage });

/** Open the sample film and switch to the Plan tab. */
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

async function box(page, selector) {
  const value = await page.locator(selector).first().boundingBox();
  if (!value) throw new Error(`${selector} is not on screen`);
  return { left: value.x, top: value.y, right: value.x + value.width, bottom: value.y + value.height, width: value.width, height: value.height };
}

function near(name, actual, expected, tolerance = 10) {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${name} is ${Math.round(actual)}, expected ${expected} ± ${tolerance}`);
}

async function noSidewaysScroll(page, width) {
  const size = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
  if (size > width) throw new Error(`The page scrolls sideways: ${size}px wide at ${width}px`);
}

const rowText = (page, label) => page.locator(`[data-shot="${shot(label)}"]`).first().innerText();

const SAMPLE = `# The Last Ferry — draft 3

1. Closing time. The ticket office at closing time; Mara buys the last ticket. "One for the morning boat."
2. Harbour at dawn. Mara on the pier. Close on the ticket date. "It was the last boat of the season."
   The gangway is lowered and Mara steps aboard.
3. Departure. The ferry pulls away into the fog. "I didn't look back."`;

export const scenarios = [
  {
    name: "next-plan-golden-layout",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      // The study at 1440 x 900: the view title where the Keyframes scene title sits, Brief and Story side by side,
      // then one panel per scene with its shot rows (thumbnail 112 px).
      const title = await box(page, "#plan-title");
      near("title top", title.top, 66, 8);
      const brief = await box(page, '[data-panel="brief"]');
      const story = await box(page, '[data-panel="story"]');
      near("brief left", brief.left, 414);
      near("story right", story.right, 1418);
      expect(Math.abs(brief.top - story.top) < 1, "Brief and Story are not side by side");
      near("thumbnail width", (await box(page, `[data-shot="${shot("1.1")}"] .thumb`)).width, 112, 2);
      await expectText(page, ".view-head .line", /^3 scenes · 8 shots · 48 s of a 6:00 maximum$/);
      await expectText(page, `[data-scene="${scene(1)}"] .scene-top`, /Closing time\s*3 shots · 17 s · video saved/);
      await expectText(page, `[data-shot="${shot("1.2")}"]`, /Medium · 5 s · static[\s\S]*One for the morning boat[\s\S]*2\.1 s voice line[\s\S]*Opened[\s\S]*Clip/);
      await expectText(page, `[data-shot="${shot("3.2")}"]`, /no voice yet · about 1\.6 s \(estimate\)[\s\S]*No keyframe yet/);
      await expectText(page, '[data-act="plan-undo"]', /^Nothing to undo$/);
      expect(await page.locator('[data-act="plan-undo"]').isDisabled(), "Undo is offered before any change");
      // The too-long line is an app fact: neutral, never the Director's amber.
      const check = await page.locator(`[data-shot="${shot("2.3")}"] [data-check="narration"]`).evaluate((el) => `${getComputedStyle(el).backgroundColor} ${getComputedStyle(el).color}`);
      expect(!/240, 178, 74/.test(check), `The narration check is drawn amber: ${check}`);
      const opened = await page.locator(`[data-shot="${shot("1.1")}"] .status.ok`).first().evaluate((el) => getComputedStyle(el).color);
      expect(/95, 196, 138/.test(opened), `Opened is not green: ${opened}`);
      await noSidewaysScroll(page, 1440);
      await screenshot(page, "1440");
    },
  },
  {
    name: "next-plan-edit-outdates-and-undo",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.waitForSelector('form[data-form="shot"]');
      await expectText(page, '[data-impact] .txt', /^No changes yet\.$/);
      expect(await page.locator('[data-act="save-shot"]').isDisabled(), "Save is on with nothing changed");
      await page.fill('[data-field="purpose"]', "Mara buys the last ticket of the season.");
      await expectText(page, '[data-impact="cost"] .txt', /Purpose, action and framing are written into both prompts\. Saving outdates 1\.2's keyframe and clip; remaking both costs about \$0\.54\. The current ones stay in Assets as earlier takes\./);
      await expectText(page, '[data-note="line"]', /^Voice line 2\.1 s · fits 5 s$/);
      await page.fill('[data-field="line"]', "One for the morning boat, please.");
      await expectText(page, '[data-note="line"]', /About 1\.8 s \(estimate, 0\.3 s a word; measured once the voice line is made\) · fits 5 s/);
      await expectText(page, '[data-impact="cost"] .txt', /The voice line needs making again; until then its length is an estimate\./);
      await expectText(page, '[data-hint="multi"]', /^Saves as 2 changes; Undo reverts only the last one \(1\.2 line\)\.$/);
      await page.fill('[data-field="line"]', "One for the morning boat.");
      await screenshot(page, "editing-1440");
      await page.click('[data-act="save-shot"]');
      await expectText(page, ".toast", /Saved 1\.2\. Its keyframe and clip are out of date\./);
      await expectText(page, `[data-shot="${shot("1.2")}"]`, /Mara buys the last ticket of the season\.[\s\S]*Keyframe out of date[\s\S]*Clip out of date/);
      await expectText(page, '[data-act="plan-undo"]', /^Undo: edit 1\.2$/);
      // Focus returns to the row's Edit button.
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "edit-shot", null, { timeout: 3000 });
      await page.click('[data-act="plan-undo"]');
      await expectText(page, `[data-shot="${shot("1.2")}"]`, /Mara at the counter, sliding coins across\.[\s\S]*Opened[\s\S]*Clip/);
      await expectText(page, ".toast", /Undone: edit 1\.2\./);
      await expectText(page, '[data-act="plan-undo"]', /^Nothing to undo$/);
      await page.waitForFunction(() => document.activeElement?.id === "plan-title", null, { timeout: 3000 });
    },
  },
  {
    name: "next-plan-motion-and-length",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      // Motion on a shot without a clip outdates nothing: the keyframe stays (SB-10).
      await page.click(`[data-act="edit-shot"][data-shot="${shot("2.1")}"]`);
      await page.fill('[data-field="motion"]', "Slow pan left");
      await expectText(page, '[data-impact="none"] .txt', /^Nothing made goes out of date: 2\.1 has no clip yet and the keyframe stays\.$/);
      await page.keyboard.press("Escape");
      await page.waitForSelector('form[data-form="shot"]', { state: "detached" });
      // Length: a second at a time, 3 to 15 s; 1.1's clip goes out of date.
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.1")}"]`);
      await page.click('[data-act="len-longer"]');
      await expectText(page, '[data-field="length"]', /^7 s$/);
      await expectText(page, '[data-impact="cost"] .txt', /Saving outdates 1\.1's clip \(remaking it costs about \$0\.50\)\. The keyframe stays\./);
      for (let i = 0; i < 4; i++) await page.click('[data-act="len-shorter"]');
      await expectText(page, '[data-field="length"]', /^3 s$/);
      expect(await page.locator('[data-act="len-shorter"]').isDisabled(), "The stepper goes below 3 s");
      await page.click('[data-act="cancel-edit"]');
      // 2.3 after Make 8 s (the Director's note b, settled in Keyframes): its 7.4 s line is accepted, so the shot
      // cannot go below the whole second that holds it (SB-8).
      await page.click('.topbar [data-act="tab"][data-view="keyframes"]');
      await page.click('.banner [data-act="note-choice"][data-note="note-b"][data-kind="proposal"]', { timeout: 20000 });
      await page.waitForSelector('.banner[data-note="note-b"][data-state="settled"]');
      await openPlan(page);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("2.3")}"]`);
      await expectText(page, '[data-field="length"]', /^8 s$/);
      expect(await page.locator('[data-act="len-shorter"]').isDisabled(), "The stepper goes below the accepted voice line");
      await expectText(page, '.len-hint', /^At least 8 s: the voice line is 7\.4 s\.$/);
      await page.click('[data-act="len-longer"]');
      await expectText(page, '[data-field="length"]', /^9 s$/);
      await page.click('[data-act="len-shorter"]');
      await expectText(page, '[data-field="length"]', /^8 s$/);
      expect(await page.locator('[data-act="len-shorter"]').isDisabled(), "The stepper goes below 8 s");
      await screenshot(page, "length-floor-1440");
    },
  },
  {
    name: "next-plan-multi-field-undo",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      // The shot's fields save as one command (shotFields), so one Undo restores them all; no "only the last" hint.
      await page.click(`[data-act="edit-shot"][data-shot="${shot("3.1")}"]`);
      await page.fill('[data-field="purpose"]', "The ferry leaves the pier.");
      await page.fill('[data-field="motion"]', "Slow pan left");
      expect(!(await page.locator('[data-hint="multi"]').count()), "Two shot fields are said to save as two changes");
      await page.click('[data-act="save-shot"]');
      await expectText(page, ".toast", /^Saved 3\.1\./);
      await expectText(page, '[data-act="plan-undo"]', /^Undo: edit 3\.1$/);
      await expectText(page, `[data-shot="${shot("3.1")}"]`, /The ferry leaves the pier\.[\s\S]*slow pan left/);
      await page.click('[data-act="plan-undo"]');
      await expectText(page, ".toast", /Undone: edit 3\.1\./);
      const row = await rowText(page, "3.1");
      expect(!/The ferry leaves the pier\./.test(row) && !/slow pan left/.test(row) && /slow pull-back/.test(row), `Undo did not restore both fields: ${JSON.stringify(row)}`);
      // A quick second edit right after a save does not trip over the head version the studio has not re-read yet.
      await page.click(`[data-act="scene-down"][data-scene="${scene(1)}"]`);
      await page.click(`[data-act="scene-down"][data-scene="${scene(1)}"]`);
      await expectText(page, `[data-shot="${shot("1.1")}"] .badge`, /^3\.1$/);
      expect(!(await page.locator(".toast.error, .toast[data-tone='error']").count()), "A quick second move was refused");
    },
  },
  {
    name: "next-plan-scenes-reorder-delete-undo",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click(`[data-act="scene-up"][data-scene="${scene(3)}"]`);
      await expectText(page, ".toast", /“Departure” is now Scene 2\. Shots were renumbered; nothing made goes out of date\./);
      await expectText(page, `[data-shot="${shot("3.1")}"] .badge`, /^2\.1$/);
      await expectText(page, '[data-act="plan-undo"]', /^Undo: move “Departure”$/);
      await page.click('[data-act="plan-undo"]');
      await expectText(page, `[data-shot="${shot("3.1")}"] .badge`, /^3\.1$/);
      // Delete Scene 1 from its menu, after a confirm that says what stays.
      await page.click(`[data-act="scene-menu"][data-scene="${scene(1)}"]`);
      await page.waitForSelector('[role="menu"] [data-act="delete-scene"]');
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Escape");
      const back = await page.evaluate(() => document.activeElement?.getAttribute("data-act"));
      expect(back === "scene-menu", `Esc did not return focus to the menu button (${back})`);
      await page.click(`[data-act="scene-menu"][data-scene="${scene(1)}"]`);
      await page.click('[role="menu"] [data-act="delete-scene"]');
      await page.waitForSelector("dialog[open]");
      await expectText(page, "dialog[open]", /Delete Scene 1, “Closing time”, and its 3 shots\?[\s\S]*Its 3 keyframes, 3 clips, and 1 voice line stay in Assets\.[\s\S]*The film becomes 31 s, and later scenes move up one number\./);
      await screenshot(page, "delete-scene-1440");
      await page.click('[data-act="delete-scene-confirm"]');
      await page.waitForSelector("dialog[open]", { state: "detached" });
      await expectText(page, ".view-head .line", /^2 scenes · 5 shots · 31 s of a 6:00 maximum$/);
      await page.waitForFunction(() => document.activeElement?.id === "plan-title");
      await expectText(page, ".toast", /Deleted Scene 1, “Closing time”\. Its media is in Assets\./);
      await page.click('.toast [data-act="undo"]');
      await expectText(page, ".view-head .line", /^3 scenes · 8 shots · 48 s of a 6:00 maximum$/);
      await expectText(page, `[data-shot="${shot("1.2")}"]`, /Opened[\s\S]*Clip/);
    },
  },
  {
    name: "next-plan-delete-refused",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      // A keyframe being made in Scene 2: the server refuses to delete the scene, and the confirm says why, once.
      await page.waitForSelector('[data-card="shot-2-2"] [data-act="note-regenerate"]', { timeout: 20000 });
      await page.click('[data-card="shot-2-2"] [data-act="note-regenerate"]');
      await page.waitForSelector('[data-card="shot-2-2"] .making');
      // Note a is settled, but its new keyframe is still being made: no green "regenerated" yet.
      const making = page.locator('#director .note[data-note="a"]');
      await expectText(page, '#director .note[data-note="a"] .handled', /^Regenerating 2\.2…$/);
      expect(await making.getAttribute("data-tone") === "making" && (await making.locator(".handled").evaluate((node) => getComputedStyle(node).color)) !== "rgb(95, 196, 138)", "Note a claims its new keyframe while it is being made");
      await openPlan(page);
      await page.click(`[data-act="scene-menu"][data-scene="${scene(2)}"]`);
      await page.click('[role="menu"] [data-act="delete-scene"]');
      await page.waitForSelector("dialog[open]");
      await page.click('[data-act="delete-scene-confirm"]');
      await expectText(page, "dialog[open] .edit-error", /Not deleted: Jobs are still running here\. Wait for them to finish, then try again\.$/);
      expect(!(await page.locator(".toast.error").count()), "The refusal is also a toast");
      await screenshot(page, "delete-refused-1440");
      await page.click('[data-act="delete-cancel"]');
      await page.waitForSelector("dialog[open]", { state: "detached" });
      await expectText(page, ".view-head .line", /^3 scenes · 8 shots/);
    },
  },
  {
    name: "next-plan-text-title-add",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click('[data-act="edit-text"][data-field="story"]');
      await expectText(page, '[data-panel="story"] [data-impact="none"] .txt', /Nothing made goes out of date\./);
      await page.fill('[data-panel="story"] textarea', "At closing time Mara buys the last ticket; at dawn she boards and does not look back.");
      await page.click('[data-act="save-text"]');
      await expectText(page, '[data-panel="story"] .text-block', /does not look back/);
      await expectText(page, '[data-act="plan-undo"]', /^Undo: edit the story$/);
      // Rename a scene.
      await page.click(`[data-act="scene-menu"][data-scene="${scene(2)}"]`);
      await page.click('[role="menu"] [data-act="rename-scene"]');
      await page.fill('[data-form="title"] input', "First light");
      await page.keyboard.press("Enter");
      await expectText(page, `[data-scene="${scene(2)}"] h2`, /^First light$/);
      await expectText(page, ".toast", /Scene 2 is now “First light”\./);
      // Add a shot: it needs direction, and its editor opens.
      await page.click(`[data-act="add-shot"][data-scene="${scene(3)}"]`);
      await page.waitForSelector('[data-editing="true"] form[data-form="shot"]');
      await expectText(page, '[data-editing="true"] .thumb', /3\.3\s*Needs direction/);
      await expectText(page, ".toast", /Added 3\.3\. It needs a purpose and a picture before a keyframe can be made\./);
      await page.fill('[data-field="purpose"]', "The harbour lights go out one by one.");
      await page.fill('[data-field="framing"]', "Wide");
      await page.fill('[data-field="prompt"]', "The harbour at dawn, its lamps going dark.");
      await expectText(page, '[data-impact] .txt', /Nothing has been made for 3\.3 yet, so nothing goes out of date\./);
      await page.click('[data-act="save-shot"]');
      await page.waitForSelector('[data-editing="true"]', { state: "detached" });
      const row = page.locator(".shot-row").filter({ hasText: "The harbour lights go out one by one." });
      await row.waitFor();
      expect(/No keyframe yet/.test(await row.innerText()), "The directed shot still needs direction");
      // Add a scene: its title opens for naming.
      await page.click('[data-act="add-scene"]');
      await page.waitForSelector('[data-form="title"] input');
      await page.fill('[data-form="title"] input', "Epilogue");
      await page.click('[data-act="save-title"]');
      await expectText(page, ".scenes > .scene:last-child h2", /^Epilogue$/);
      await expectText(page, ".scenes > .scene:last-child", /No shots yet\. Add one, or ask the Director to plan this scene\./);
      // Nothing was written as its direction: the server's placeholder is not shown as one.
      await expectText(page, ".scenes > .scene:last-child .direction", /^Direction: None yet$/);
      await screenshot(page, "added-1440");
    },
  },
  {
    name: "next-plan-point-and-open",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click(`[data-act="point-scene"][data-scene="${scene(2)}"]`);
      await expectText(page, ".composer", /@Scene 2|Scene 2/);
      await expectText(page, ".toast", /Pointing the Director at Scene 2\./);
      // The header names what the message now points at, as the composer's chip does (with nothing pointed at it
      // follows the view: "Whole film" in Plan).
      await expectText(page, ".dir-head .scene", /^Points at Scene 2$/);
      // The Director's "Open 2.3" stays in Plan and brings the row into view (P5-DESIGN shell item 9).
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.locator('.thread [data-act="note-open"]').filter({ hasText: "Open 2.3" }).first().click();
      await page.waitForSelector(`.shot-row.flash[data-shot="${shot("2.3")}"]`);
      expect(await page.locator('main.work[data-view="plan"]').count() === 1, "Open 2.3 left Plan");
      await page.waitForFunction((id) => {
        const rect = document.querySelector(`.shot-row[data-shot="${id}"]`)?.getBoundingClientRect();
        return !!rect && rect.top >= 0 && rect.bottom <= window.innerHeight;
      }, shot("2.3"), { timeout: 3000 });
      // The row's own menu still opens it in Keyframes.
      await page.click(`[data-act="shot-menu"][data-shot="${shot("2.2")}"]`);
      await page.click('[role="menu"] [data-act="open-keyframes"]');
      await page.waitForSelector('main.work[data-view="keyframes"]', { timeout: 20000 });
      await expectText(page, ".insp h3", /2\.2/);
    },
  },
  {
    name: "next-plan-written-plan-confirm",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click('[data-act="import-open"]');
      await page.waitForSelector("dialog.sheet[open]");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-field") === "import-text", null, { timeout: 3000 });
      expect(await page.locator('[data-act="import-send"]').isDisabled(), "Send is on with no text");
      await page.fill('[data-field="import-name"]', "draft.docx");
      await page.fill('[data-field="import-text"]', SAMPLE);
      await expectText(page, "dialog.sheet", /Name the document with \.txt or \.md\./);
      expect(await page.locator('[data-act="import-send"]').isDisabled(), "Send is on with a .docx name");
      await page.fill('[data-field="import-name"]', "last-ferry-draft.md");
      await expectText(page, "#plan-import-count", /^[\d,]+ \/ 12,000 characters$/);
      await screenshot(page, "import-paste-1440");
      await page.click('[data-act="import-send"]');
      await expectText(page, "dialog.sheet", /The Director is reading last-ferry-draft\.md/);
      await screenshot(page, "import-reading-1440");
      // Plan edits are paused while the written plan waits (IMPORT_PENDING).
      await page.click('[data-act="import-close"]');
      await expectText(page, ".pending", /Plan edits are paused until you confirm or discard it\./);
      expect(await page.locator(`[data-act="edit-shot"][data-shot="${shot("1.1")}"]`).isDisabled(), "Edit is on while a written plan waits");
      expect(await page.locator('[data-act="add-scene"]').isDisabled(), "Add scene is on while a written plan waits");
      await page.click('[data-act="import-review"]');
      await page.waitForSelector('[data-act="import-confirm"]', { timeout: 10000 });
      // The review opens on the proposal itself, so Enter alone never replaces the outline.
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-review") === "body", null, { timeout: 3000 });
      await expectText(page, "dialog.sheet", /Now\s*3 scenes · 8 shots · 48 s[\s\S]*From last-ferry-draft\.md\s*3 scenes · 9 shots · 52 s/);
      await expectText(page, '[data-row="2.3"]', /Line: “It was the last boat of the season\.”[\s\S]*Changed/);
      await expectText(page, '[data-row="2.4"]', /The gangway is lowered; Mara steps aboard\.[\s\S]*Wide · 4 s · no narration[\s\S]*New/);
      await expectText(page, '[data-row="1.1"]', /Same/);
      await expectText(page, "dialog.sheet", /The Director's suggestions \(not in the outline\)[\s\S]*two-second hold/i);
      await screenshot(page, "import-review-1440");
      await page.click('[data-act="import-confirm"]');
      await page.waitForSelector("dialog.sheet[open]", { state: "detached" });
      await expectText(page, ".toast", /Outline replaced from last-ferry-draft\.md\./);
      await expectText(page, ".view-head .line", /^3 scenes · 9 shots · 52 s of a 6:00 maximum$/);
      await expectText(page, `[data-shot="${shot("2.3")}"]`, /It was the last boat of the season\.[\s\S]*no voice yet · about 2\.4 s \(estimate\)/);
      expect(!(await page.locator(".pending").count()), "The pending strip stays after confirming");
      expect(!(await page.locator(`[data-act="edit-shot"][data-shot="${shot("1.1")}"]`).isDisabled()), "Edits stay paused after confirming");
    },
  },
  {
    name: "next-plan-written-plan-discard",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click('[data-act="import-open"]');
      await page.fill('[data-field="import-text"]', SAMPLE);
      await page.click('[data-act="import-send"]');
      await page.waitForSelector('[data-act="import-confirm"]', { timeout: 10000 });
      await page.click('[data-act="import-discard"]');
      await page.waitForSelector("dialog.sheet[open]", { state: "detached" });
      await expectText(page, ".toast", /Discarded the written plan\. The outline did not change\./);
      await expectText(page, ".view-head .line", /^3 scenes · 8 shots · 48 s/);
      expect(!(await page.locator(".pending").count()), "The pending strip stays after discarding");
    },
  },
  {
    name: "next-plan-stopped",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      // Stop the film while the Director works: bringing a written plan starts work, so it waits for Continue.
      await page.fill(".composer textarea", "Hold the last shot a little longer.");
      await page.keyboard.press("Enter");
      // Stop is the shell's, in the top bar, and asks first.
      await page.click('.topbar [data-act="stop-film"]', { timeout: 10000 });
      await page.click('dialog[data-dialog="stop"] [data-act="confirm-stop"]');
      await page.waitForFunction(() => document.querySelector('[data-act="import-open"]')?.disabled === true, null, { timeout: 10000 });
      expect((await page.locator('[data-act="import-open"]').getAttribute("title")) === "Stopped. Continue first.", "The import button does not say why it is off");
      // Free edits still save while stopped.
      expect(!(await page.locator(`[data-act="edit-shot"][data-shot="${shot("1.1")}"]`).isDisabled()), "Edit is off while stopped");
    },
  },
  {
    name: "next-plan-phone",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await openPlan(page);
      await noSidewaysScroll(page, 390);
      expect(!(await page.locator(".director").isVisible()), "The Director drawer is open on a phone");
      // Rows: thumbnail and text, then narration and status, then the actions on their own row.
      const thumb = await box(page, `[data-shot="${shot("1.2")}"] .thumb`);
      const acts = await box(page, `[data-shot="${shot("1.2")}"] .shot-acts`);
      expect(acts.top > thumb.bottom, "The row actions are not on their own row");
      await screenshot(page, "390", true);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.fill('[data-field="purpose"]', "Mara buys the last ticket of the season.");
      await noSidewaysScroll(page, 390);
      await page.locator('[data-impact]').scrollIntoViewIfNeeded();
      await screenshot(page, "editing-390");
      await page.click('[data-act="cancel-edit"]');
      await page.click('[data-act="import-open"]');
      await page.waitForSelector("dialog.sheet[open]");
      const sheet = await box(page, "dialog.sheet[open]");
      near("sheet width", sheet.width, 390, 2);
      await noSidewaysScroll(page, 390);
    },
  },
  {
    name: "next-plan-chinese",
    query: `${query}&lang=zh`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await expectText(page, "#plan-title", /^计划$/);
      await expectText(page, ".view-head .line", /^3 场 · 8 个镜头 · 48 秒，上限 6:00$/);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.fill('[data-field="purpose"]', "Mara buys the last ticket of the season.");
      await expectText(page, '[data-impact="cost"] .txt', /目的、动作和景别会写进画面和视频描述。保存后，1\.2 的关键帧和视频会过期，重做两者约 \$0\.54。现有的会作为旧版本保留在素材里。/);
      await noSidewaysScroll(page, 1440);
      await screenshot(page, "zh-editing-1440");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      await noSidewaysScroll(page, 390);
      await screenshot(page, "zh-390", true);
    },
  },
];
