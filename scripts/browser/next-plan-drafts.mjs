// Next UI, Plan view: no draft is lost and no lost reply goes unsaid, on the Last Ferry fixture film
// (?ui=next&fixture=last-ferry). Nothing is generated, charged or saved. Presets (fixtures/routes/plan.ts): `plan=lost`
// loses the reply to the first storyboard command; `plan=director-moves` has the Director, 3 s after the Plan opens,
// rewrite 1.2's purpose and move 1.2 to the start of Scene 2 (it becomes 2.1), and delete 3.1.
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

const head = async (page) => Number(await page.locator('main.work[data-view="plan"]').getAttribute("data-head"));
const active = (page) => page.evaluate(() => {
  const el = document.activeElement;
  return el ? el.getAttribute("data-field") ?? el.getAttribute("data-act") ?? el.id ?? el.tagName : null;
});
const noErrorToast = async (page, what) => expect(!(await page.locator(".toast.error, .toast[data-tone='error']").count()), `${what} showed an error toast`);
const GUARD = /^A change is not confirmed yet: retry it or dismiss it first\.$/;

export const scenarios = [
  {
    // The reviewer's case: a lost reply's retry acts only on its own press. An editor open elsewhere keeps its text.
    name: "next-plan-lost-keeps-other-editor",
    query: `${query}&plan=lost`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      const before = await head(page);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.fill('[data-field="purpose"]', "A draft the person is still writing.");
      await page.click(`[data-act="scene-up"][data-scene="${scene(3)}"]`);
      await page.waitForSelector(".lost-strip .strip-note", { timeout: 8000 });
      await expectText(page, ".lost-strip", /Not confirmed: move “Departure”\./);
      // Until it is retried or dismissed, nothing else is edited: the head version is unknown.
      expect(await page.locator('[data-act="save-shot"]').isDisabled(), "Save is on while a change is unconfirmed");
      const otherEdit = page.locator(`[data-act="edit-shot"][data-shot="${shot("2.1")}"]`);
      expect(await otherEdit.isDisabled(), "Another editor can be opened while a change is unconfirmed");
      expect(GUARD.test((await otherEdit.getAttribute("title")) ?? ""), "The turned-off Edit does not say why");
      expect(await page.locator('[data-act="edit-text"][data-field="brief"]').isDisabled(), "The brief can be opened while a change is unconfirmed");
      await screenshot(page, "lost-keeps-editor-1440");
      await page.click('.lost-strip [data-act="retry-same"]');
      await page.waitForSelector(".lost-strip", { state: "detached" });
      await expectText(page, ".toast", /“Departure” is now Scene 2\./);
      // The 1.2 editor is still open with the person's text, and can be saved now.
      expect(await page.locator(`form[data-form="shot"]`).count() === 1, "The retry closed the open editor");
      expect((await page.inputValue('[data-field="purpose"]')) === "A draft the person is still writing.", "The retry threw away the open draft");
      expect(!(await page.locator('[data-act="save-shot"]').isDisabled()), "Save stays off after the retry");
      await page.click('[data-act="save-shot"]');
      await page.waitForSelector('form[data-form="shot"]', { state: "detached" });
      await expectText(page, `.shot-row[data-shot="${shot("1.2")}"]`, /A draft the person is still writing\./);
      expect((await head(page)) === before + 2, "The move was applied twice, or the save not at all");
      await noErrorToast(page, "The retry");
    },
  },
  {
    // A save whose reply is lost: other editors stay shut; text typed while waiting outlives the retry.
    name: "next-plan-lost-save-then-type",
    query: `${query}&plan=lost`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      const before = await head(page);
      await page.click('[data-act="edit-text"][data-field="brief"]');
      await page.fill('[data-panel="brief"] textarea', "Brief from the reviewer.");
      await page.click('[data-panel="brief"] [data-act="save-text"]');
      await page.waitForSelector('[data-panel="brief"] [data-notice="unconfirmed"]', { timeout: 8000 });
      expect(!(await page.locator(".lost-strip").count()), "The editor's notice is also in the strip");
      const otherEdit = page.locator(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      expect(await otherEdit.isDisabled(), "Another editor can be opened over a lost save");
      expect(GUARD.test((await otherEdit.getAttribute("title")) ?? ""), "The turned-off Edit does not say why");
      // The person types on while the outcome is unknown; the retry's answer keeps that newer text open.
      await page.fill('[data-panel="brief"] textarea', "Brief from the reviewer. And a second thought.");
      await page.click('[data-panel="brief"] [data-act="retry-same"]');
      await page.waitForSelector('[data-panel="brief"] [data-notice="unconfirmed"]', { state: "detached" });
      await expectText(page, ".toast", /^Saved the brief\./);
      expect((await page.inputValue('[data-panel="brief"] textarea')) === "Brief from the reviewer. And a second thought.", "The retry threw away the newer text");
      expect(!(await page.locator('[data-panel="brief"] [data-notice="conflict"]').count()), "The saved brief was taken for someone else's change");
      expect(!(await otherEdit.isDisabled()), "Edits stay off after the retry");
      expect((await head(page)) === before + 1, "The retry applied the save twice");
      await page.click('[data-panel="brief"] [data-act="save-text"]');
      await page.waitForSelector('[data-panel="brief"] form', { state: "detached" });
      await expectText(page, '[data-panel="brief"] .text-block', /^Brief from the reviewer\. And a second thought\.$/);
      expect((await head(page)) === before + 2, "The newer text was not saved");
      await noErrorToast(page, "The saves");
    },
  },
  {
    name: "next-plan-lost-dismiss",
    query: `${query}&plan=lost`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      const before = await head(page);
      await page.click(`[data-act="scene-up"][data-scene="${scene(3)}"]`);
      await page.waitForSelector(".lost-strip .strip-note", { timeout: 8000 });
      expect(await page.locator('[data-act="add-scene"]').isDisabled(), "Add scene is on while a change is unconfirmed");
      await page.click('.lost-strip [data-act="retry-dismiss"]');
      await page.waitForSelector(".lost-strip", { state: "detached" });
      // The studio is read again: the move had been applied, and edits are on again.
      await expectText(page, `[data-scene="${scene(3)}"] .sno`, /^2$/);
      expect((await head(page)) === before + 1, "The dismissed move is not shown as it is");
      expect(!(await page.locator('[data-act="add-scene"]').isDisabled()), "Edits stay off after Dismiss");
    },
  },
  {
    // The Director moves the shot being edited to another scene: the draft, its conflict and the focus go with it.
    name: "next-plan-moved-underneath",
    query: `${query}&plan=director-moves`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.fill('[data-field="purpose"]', "Mara buys the last ticket of the season.");
      await page.fill('[data-field="action"]', "She slides three coins across.");
      await page.focus('[data-field="action"]');
      await page.waitForSelector('[data-note="moved"]', { timeout: 10000 });
      await expectText(page, '[data-note="moved"]', /^↕?\s*Moved from 1\.2 to 2\.1 while you were editing\. Your text is kept\.$/);
      expect(await page.locator(`[data-scene="${scene(2)}"] form[data-form="shot"]`).count() === 1, "The editor is not in Scene 2");
      expect((await page.inputValue('[data-field="purpose"]')) === "Mara buys the last ticket of the season.", "The purpose was reset by the move");
      expect((await page.inputValue('[data-field="action"]')) === "She slides three coins across.", "The action was reset by the move");
      expect((await active(page)) === "action", `Focus did not come back to the action (${await active(page)})`);
      // The Director's purpose is a conflict, said on the field itself too.
      await expectText(page, '[data-notice="conflict"]', /\(Purpose\)/);
      const conflictId = await page.locator('[data-notice="conflict"]').getAttribute("id");
      const purpose = page.locator('[data-field="purpose"]');
      expect((await purpose.getAttribute("aria-invalid")) === "true", "The conflicting field is not marked invalid");
      expect(((await purpose.getAttribute("aria-describedby")) ?? "").split(" ").includes(conflictId), "The conflicting field does not point at the notice");
      expect(!(await page.locator('[data-field="action"]').getAttribute("aria-invalid")), "A field without a conflict is marked invalid");
      const save = page.locator('[data-act="save-shot"]');
      expect(await save.isDisabled(), "A stale draft can be saved");
      const hintId = await save.getAttribute("aria-describedby");
      await expectText(page, `[id="${hintId}"]`, /^Choose Keep my text or Use saved text first\.$/);
      await screenshot(page, "moved-underneath-1440");
      await page.click('[data-act="conflict-keep"]');
      await page.waitForSelector('[data-notice="conflict"]', { state: "detached" });
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-field") === "purpose", null, { timeout: 3000 });
      expect(!(await purpose.getAttribute("aria-invalid")), "The field stays invalid after Keep my text");
      await save.click();
      await page.waitForSelector('form[data-form="shot"]', { state: "detached" });
      await expectText(page, `.shot-row[data-shot="${shot("1.2")}"]`, /Mara buys the last ticket of the season\.[\s\S]*Action: She slides three coins across\./);
      await expectText(page, `.shot-row[data-shot="${shot("1.2")}"] .badge`, /^2\.1$/);
      await noErrorToast(page, "The save");
    },
  },
  {
    // The Director deletes the shot being edited: the person's text stays on screen to copy.
    name: "next-plan-deleted-underneath",
    query: `${query}&plan=director-moves`,
    viewport: { width: 1440, height: 900 },
    async run({ page, origin }) {
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
      await openPlan(page);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("3.1")}"]`);
      await page.fill('[data-field="purpose"]', "The ferry slips its moorings.");
      await page.fill('[data-field="video-prompt"]', "The ferry pulls away; the pier recedes into fog.");
      await page.waitForSelector('[data-notice="kept"]', { timeout: 10000 });
      expect(!(await page.locator('form[data-form="shot"]').count()), "An editor stays open on a deleted shot");
      await expectText(page, '[data-notice="kept"] [role="alert"]', /^!?\s*3\.1 was deleted while you were editing it\. Your text is kept here so you can copy it\.$/);
            // (The labels are set in capitals by the stylesheet.)
      await expectText(page, '[data-kept="purpose"]', /^Purpose\s*The ferry slips its moorings\.$/i);
      await expectText(page, '[data-kept="videoPrompt"]', /^Video prompt\s*The ferry pulls away; the pier recedes into fog\.$/i);
      expect(!(await page.locator('[data-kept="motion"]').count()), "An untouched field is listed as kept");
      // Kept text is to copy: it is not drawn as an input (no fill, no box around it).
      const look = await page.locator('[data-kept="purpose"] dd').evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.borderTopWidth, s.borderRightWidth]; });
      expect(look[0] === "rgba(0, 0, 0, 0)" && look[1] === "0px" && look[2] === "0px", `The kept text looks like an input: ${look}`);
      expect((await active(page)) === "kept-copy", `Focus was not given to Copy (${await active(page)})`);
      await screenshot(page, "kept-draft-1440");
      await page.click('[data-act="kept-copy"]');
      await expectText(page, '[data-act="kept-copy"]', /^Copied$/);
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied === "Purpose: The ferry slips its moorings.\n\nVideo prompt: The ferry pulls away; the pier recedes into fog.", `Copied ${JSON.stringify(copied)}`);
      // Edits are open meanwhile (nothing is unconfirmed); Close lets it go.
      await page.click('[data-act="kept-close"]');
      await page.waitForSelector('[data-notice="kept"]', { state: "detached" });
      await page.waitForFunction(() => document.activeElement?.id === "plan-title", null, { timeout: 3000 });
      await noErrorToast(page, "The kept draft");
    },
  },
  {
    // Opening another editor, or adding a shot, asks before unsaved text is thrown away.
    name: "next-plan-discard-ask",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await openPlan(page);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.fill('[data-field="purpose"]', "Mara buys the last ticket of the season.");
      await page.click(`[data-act="edit-shot"][data-shot="${shot("2.1")}"]`);
      await page.waitForSelector("dialog.plan-dialog[open]");
      await expectText(page, "dialog[open] h2", /^Discard your changes to 1\.2\?$/);
      expect((await active(page)) === "discard-keep", "Keep editing is not the default");
      await screenshot(page, "discard-dialog-1440");
      await page.click('[data-act="discard-keep"]');
      await page.waitForSelector("dialog.plan-dialog[open]", { state: "detached" });
      expect((await page.inputValue('[data-field="purpose"]')) === "Mara buys the last ticket of the season.", "Keep editing lost the text");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-field") === "purpose", null, { timeout: 3000 });
      // Esc is Keep editing too.
      await page.click(`[data-act="edit-shot"][data-shot="${shot("2.1")}"]`);
      await page.waitForSelector("dialog.plan-dialog[open]");
      await page.keyboard.press("Escape");
      await page.waitForSelector("dialog.plan-dialog[open]", { state: "detached" });
      expect(await page.locator(`.shot-edit[data-shot="${shot("1.2")}"]`).count() === 1, "Esc closed the editor");
      // Discard changes: 2.1 opens, 1.2 is as saved.
      await page.click(`[data-act="edit-shot"][data-shot="${shot("2.1")}"]`);
      await page.click('[data-act="discard-confirm"]');
      await page.waitForSelector(`.shot-edit[data-shot="${shot("2.1")}"]`);
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-field") === "purpose", null, { timeout: 3000 });
      await expectText(page, `.shot-row[data-shot="${shot("1.2")}"]`, /Mara at the counter, sliding coins across\./);
      // Nothing typed: another editor opens without asking.
      await page.click(`[data-act="edit-shot"][data-shot="${shot("2.2")}"]`);
      await page.waitForSelector(`.shot-edit[data-shot="${shot("2.2")}"]`);
      expect(!(await page.locator("dialog.plan-dialog[open]").count()), "An untouched editor asked before closing");
      // Adding a shot opens its editor, so it asks too.
      await page.fill('[data-field="purpose"]', "The pier, empty.");
      await page.click(`[data-act="add-shot"][data-scene="${scene(1)}"]`);
      await page.waitForSelector("dialog.plan-dialog[open]");
      await expectText(page, "dialog[open] h2", /^Discard your changes to 2\.2\?$/);
      await page.click('[data-act="discard-confirm"]');
      await expectText(page, ".toast", /1\.4/);
      await page.waitForSelector(`[data-scene="${scene(1)}"] .shot-edit`);
      await noErrorToast(page, "The editors");
    },
  },
  {
    name: "next-plan-drafts-phone",
    query: `${query}&plan=director-moves&lang=zh`,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await openPlan(page);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("3.1")}"]`);
      await page.fill('[data-field="purpose"]', "渡轮解缆离港。");
      await page.waitForSelector('[data-notice="kept"]', { timeout: 10000 });
      await expectText(page, '[data-notice="kept"] [role="alert"]', /3\.1 已被删除/);
      await noSidewaysScroll(page, 390);
      await page.locator('[data-notice="kept"]').scrollIntoViewIfNeeded();
      await screenshot(page, "zh-kept-draft-390");
      await page.click('[data-act="kept-close"]');
      // The moved shot's editor, and the discard question, in Chinese on a phone.
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.fill('[data-field="action"]', "她把三枚硬币推过去。");
      await page.click(`[data-act="edit-shot"][data-shot="${shot("2.2")}"]`);
      await page.waitForSelector("dialog.plan-dialog[open]");
      await expectText(page, "dialog[open] h2", /^放弃对“2\.1”的修改？$/);
      await noSidewaysScroll(page, 390);
      await screenshot(page, "zh-discard-dialog-390");
      await page.click('[data-act="discard-keep"]');
    },
  },
];
