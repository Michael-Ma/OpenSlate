// Next studio installation recovery checks: after a restore from backup the studio is in recovery review. The full-width
// review (backup time, counts and what happens to them, Finish recovery review), the read-only studio in every view with
// one reason, a lost reply (Retry recovery decision with the same key), a summary that changed (refused, read again),
// what happens after the review (films stay stopped, Continue), phone width, and the live path against the studio's
// own routes. The sample studio uses its `?recovery=` presets (fixtures/routes/recovery.ts).
// Set BROWSER_CHECK_SHOTS=/some/dir to also save screenshots of each scenario.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { inspectorWhole } from "./inspector-whole.mjs";

const RESTORED = "ui=next&fixture=last-ferry&recovery=quarantined";
const REASON = "This studio was restored from a backup. Finish the recovery review to make changes.";

async function shot(page, name) {
  const dir = process.env.BROWSER_CHECK_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function until(page, read, test, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`${message}; last: ${JSON.stringify(last)}`);
}

const text = (page, selector) => page.locator(selector).first().innerText().catch(() => "");
const focused = (page) => page.evaluate(() => document.activeElement?.getAttribute("data-act") ?? document.activeElement?.tagName.toLowerCase());
const tab = (page, view) => page.locator(`.topbar [data-act='tab'][data-view='${view}']`);

async function noSidewaysScroll(page, where = "") {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth <= innerWidth, `The page scrolls sideways${where ? ` (${where})` : ""}: ${scrollWidth}px content in a ${innerWidth}px window`);
}

/** The review is up in place of the view. */
async function review(page) {
  await page.waitForSelector(".app[data-ui='next'] .topbar", { timeout: 20000 });
  await page.waitForSelector(".app[data-recovery='review'] .recovery-card[data-recovery='review']", { timeout: 20000 });
}

/** A control is off and its title gives the one reason. */
async function off(page, selector, where) {
  const control = page.locator(selector).first();
  await control.waitFor({ state: "attached", timeout: 8000 });
  const state = await control.evaluate((node) => ({ disabled: node.disabled === true, title: node.getAttribute("title") }));
  expect(state.disabled && state.title === REASON, `${where}: ${selector} is ${JSON.stringify(state)}`);
}

async function counts(page) {
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".recovery-row")].map((row) => [row.getAttribute("data-count"), Number(row.querySelector(".n")?.textContent)])));
}

/** Finish the review and wait for what happens next. */
async function finish(page, act = "recovery-finish") {
  await page.locator(`.recovery-card [data-act='${act}']`).click();
  await page.waitForSelector(".recovery-card[data-recovery='released']", { timeout: 8000 });
}

export const scenarios = [
  {
    name: "next-recovery-review",
    query: RESTORED,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await review(page);
      const card = await page.evaluate(() => {
        const node = document.querySelector(".recovery-card");
        const colours = [...node.querySelectorAll("*")].flatMap((element) => {
          const style = getComputedStyle(element);
          return [style.color, style.backgroundColor, style.borderTopColor];
        });
        return {
          eyebrow: node.querySelector(".recovery-eyebrow")?.textContent,
          title: node.querySelector("h1")?.textContent,
          lead: node.querySelector(".recovery-lead")?.textContent,
          backup: node.querySelector("[data-field='backup']")?.textContent,
          labels: [...node.querySelectorAll(".recovery-row dt")].map((dt) => dt.textContent),
          notes: [...node.querySelectorAll(".recovery-row")].map((row) => [row.getAttribute("data-count"), !!row.querySelector(".what")]),
          after: node.querySelector(".recovery-after")?.textContent,
          // Amber belongs to the Director: rgb(240, 178, 74) and its hairline rgb(137, 106, 52) never appear here.
          amber: colours.some((colour) => /240, 178, 74|137, 106, 52|54, 47, 37/.test(colour)),
          finish: node.querySelector("[data-act='recovery-finish']")?.textContent,
          primary: node.querySelector("[data-act='recovery-finish']")?.classList.contains("primary"),
          tab: document.querySelector(".topbar [role='tab'][aria-selected='true']")?.getAttribute("data-view"),
          pill: document.querySelector(".topbar .saved")?.textContent,
          strip: document.querySelector(".film-strip-slot")?.getAttribute("data-strip"),
          url: location.search,
        };
      });
      expect(card.eyebrow === "Restored from a backup", `Eyebrow reads ${JSON.stringify(card.eyebrow)}`);
      expect(card.title === "Review this restored studio", `Title reads ${JSON.stringify(card.title)}`);
      expect(card.lead === "Your films and media are here to look at. Changes, making and the Director are paused until you finish this review.", `Lead reads ${JSON.stringify(card.lead)}`);
      expect(/^Backup made \d{1,2} Oct 2026, \d\d:\d\d\. Anything done after that may be missing\.$/.test(card.backup ?? ""), `The backup line reads ${JSON.stringify(card.backup)}`);
      expect(JSON.stringify(card.labels) === JSON.stringify(["Films", "Known pending jobs", "Uncertain jobs", "Local preparations, not submitted", "Saved Director requests"]), `Count labels: ${JSON.stringify(card.labels)}`);
      expect(JSON.stringify(await counts(page)) === JSON.stringify({ films: 1, known: 2, uncertain: 1, preparing: 1, requests: 1 }), `Counts: ${JSON.stringify(await counts(page))}`);
      expect(card.notes.every(([key, note]) => note === (key !== "films")), `Every kind of work says what happens to it: ${JSON.stringify(card.notes)}`);
      expect(card.after === "When you finish, every film stays stopped until you continue it. Nothing restored starts by itself.", `The decision reads ${JSON.stringify(card.after)}`);
      expect(!card.amber, "The review uses the Director's amber");
      expect(card.finish === "Finish recovery review" && card.primary, `Finish is ${JSON.stringify(card.finish)}, primary ${card.primary}`);
      expect(card.pill === "Synced", `The connection pill reads ${JSON.stringify(card.pill)}`);
      expect(card.strip === "none", `A strip shows over the review: ${card.strip}`);
      expect(new URLSearchParams(card.url).get("view") === "keyframes", `The address does not keep the view: ${card.url}`);
      // The Director column stays readable; its composer keeps a draft but cannot send, and says why.
      await page.locator("#director [data-field='message']").fill("Keep the fog");
      expect(await page.locator("#director [data-act='send']").isDisabled(), "Send is on while the studio is in review");
      expect((await text(page, "#director [data-hint]")) === "Restored · finish the recovery review first", `The composer hint reads ${JSON.stringify(await text(page, "#director [data-hint]"))}`);
      expect(await page.locator(".topbar [data-act='stop-film']").count() === 0, "Stop shows while the studio is read-only");
      await noSidewaysScroll(page);
      await shot(page, "next-recovery-review-1440");

      // Look around first: the view shows, every write is off with the one reason, and the strip brings the review back.
      await page.locator("[data-act='recovery-later']").click();
      await page.waitForSelector(".film-strip[data-strip='recovery']");
      await until(page, () => focused(page), (act) => act === "review-recovery", "Focus did not go to the strip's Review", 2000);
      expect((await text(page, ".film-strip[data-strip='recovery'] .txt")) === "Restored from a backup. You can look at everything; changes, making and the Director are paused until you finish the review.", "The recovery strip has the wrong words");
      await page.waitForSelector("main.work[data-view='keyframes'] .preview .pic-img", { timeout: 20000 });
      const guarded = await page.evaluate(() => [...document.querySelectorAll("[data-needs]")].map((node) => ({ act: node.getAttribute("data-act"), disabled: node.disabled, title: node.getAttribute("title") })));
      expect(guarded.length > 3 && guarded.some((control) => control.act === "edit-prompt"), `Keyframes has no guarded controls: ${JSON.stringify(guarded)}`);
      expect(guarded.every((control) => control.disabled && control.title === REASON), `A write stays on in Keyframes: ${JSON.stringify(guarded.filter((control) => !control.disabled || control.title !== REASON))}`);
      // Reads keep working: another shot opens in the preview.
      await page.click(".card [data-act='open-shot'][data-shot='shot-2-2']");
      await page.waitForSelector(".card.sel [data-act='open-shot'][data-shot='shot-2-2']", { state: "attached" });
      // Under the strip the inspector's rows and actions are still whole.
      await inspectorWhole(page, "under the recovery strip at 1440");
      await shot(page, "next-recovery-keyframes-1440");

      await tab(page, "plan").click();
      await page.waitForSelector("main.work[data-view='plan']");
      await off(page, "[data-act='add-scene']", "Plan");
      await off(page, "[data-act='edit-shot']", "Plan");
      await page.locator("[data-act='scene-menu']").first().click();
      for (const act of ["rename-scene", "edit-direction", "delete-scene"]) await off(page, `.menu [data-act='${act}']`, "Plan's scene menu");
      await page.keyboard.press("Escape");
      expect(await page.locator(".film-strip[data-strip='recovery']").count() === 1, "The strip is missing in Plan");

      await tab(page, "film").click();
      await page.waitForSelector("main.work[data-view='film']");
      await off(page, "[data-act='export']", "Film");
      expect((await text(page, "#fv-export-why")) === REASON, `Film's export says ${JSON.stringify(await text(page, "#fv-export-why"))}`);
      await page.locator("[data-act='sel-shot']").first().click();
      await off(page, "[data-act='len']", "Film's shot tools");
      await off(page, "[data-act='move'][data-d='1']", "Film's shot tools");
      await shot(page, "next-recovery-film-1440");

      await tab(page, "assets").click();
      await page.waitForSelector("main.work[data-view='assets']");
      await off(page, "[data-act='import']", "Assets");

      await page.locator(".topbar [data-act='settings']").click();
      await page.waitForSelector("main.work[data-view='settings']");
      await off(page, "[data-act='narrator']", "Settings");
      await off(page, "[data-act='voice-open']", "Settings");
      // This computer's Check again only reads, and reads keep working in review.
      const recheck = await page.locator("[data-act='recheck']").evaluate((node) => ({ disabled: node.disabled, title: node.getAttribute("title") }));
      expect(!recheck.disabled && recheck.title === null, `Check again is ${JSON.stringify(recheck)} in review`);
      await page.locator("[data-act='recheck']").click();
      await until(page, () => text(page, ".toast"), (value) => value.startsWith("Checked"), "Check again did not check in review");

      await page.locator(".topbar [data-act='all-films']").click();
      await page.waitForSelector(".app[data-view='start']");
      await off(page, "[data-act='new-film']", "Start");
      await page.locator("[data-act='film-menu']").first().click();
      await off(page, "[data-act='menu-rename']", "Start's film menu");
      await off(page, "[data-act='menu-archive']", "Start's film menu");
      await page.keyboard.press("Escape");
      expect(await page.locator(".film-strip[data-strip='recovery']").count() === 1, "The strip is missing on Start");
      await noSidewaysScroll(page, "Start");

      // Back to the review from the strip: focus lands on its heading.
      await page.locator("[data-act='open-film']").first().click();
      await page.waitForSelector(".app:not([data-view='start'])");
      await tab(page, "keyframes").click();
      await page.waitForSelector(".app[data-view='keyframes']");
      await page.locator("[data-act='review-recovery']").click();
      await review(page);
      await until(page, () => page.evaluate(() => document.activeElement?.id), (id) => id === "recovery-title", "Review did not put focus on the review's heading", 2000);

      // Finish: what happens next, with focus on its heading; the film stays stopped and says why.
      await finish(page);
      const done = await page.evaluate(() => ({
        title: document.querySelector(".recovery-card h1")?.textContent,
        focus: document.activeElement?.id,
        lines: [...document.querySelectorAll(".recovery-card .recovery-lead")].map((p) => p.textContent),
        mark: getComputedStyle(document.querySelector(".recovery-ok")).color,
      }));
      expect(done.title === "Recovery review finished", `The finished review reads ${JSON.stringify(done.title)}`);
      await until(page, () => page.evaluate(() => document.activeElement?.id), (id) => id === "recovery-title", "Focus is not on the heading after finishing", 2000);
      expect(done.lines[0] === "Changes work again. Every film is still stopped: nothing restored starts by itself.", `It says ${JSON.stringify(done.lines)}`);
      expect(/press Continue in the strip at the top/.test(done.lines[1] ?? ""), `It does not say how to continue: ${JSON.stringify(done.lines)}`);
      expect(done.mark === "rgb(95, 196, 138)", `The done mark is ${done.mark}, not green`);
      await shot(page, "next-recovery-finished-1440");

      await page.locator("[data-act='recovery-done']").click();
      await page.waitForSelector(".film-strip[data-strip='stopped']");
      const stopped = await text(page, ".film-strip[data-strip='stopped'] .txt");
      expect(stopped === "Stopped. Nothing new will be sent. It was stopped when the studio was restored from a backup; continue when you’re ready.", `The stopped strip reads ${JSON.stringify(stopped)}`);
      await until(page, () => focused(page), (act) => act === "tab", "Focus did not go to the selected tab after Done", 2000);
      // Writes work again; new work waits for Continue.
      const guards = await page.evaluate(() => [...document.querySelectorAll("main.work [data-needs]")].map((node) => ({ needs: node.getAttribute("data-needs"), act: node.getAttribute("data-act"), disabled: node.disabled, title: node.getAttribute("title") })));
      expect(guards.some((control) => control.act === "edit-prompt" && !control.disabled), `Edit prompt is still off: ${JSON.stringify(guards)}`);
      expect(guards.filter((control) => control.needs === "run").every((control) => control.disabled && control.title === "The film is stopped. Continue first to start new work."), `New work is not waiting for Continue: ${JSON.stringify(guards)}`);
      expect(!(await page.locator("#director [data-act='send']").isDisabled()), "Send stays off after the review");
      await shot(page, "next-recovery-stopped-1440");
      await page.locator("[data-act='continue-film']").click();
      await page.waitForSelector(".film-strip-slot[data-strip='none']", { state: "attached" });
    },
  },
  {
    name: "next-recovery-lost-reply",
    query: "ui=next&fixture=last-ferry&recovery=lost-reply",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await review(page);
      await page.locator("[data-act='recovery-finish']").click();
      await page.waitForSelector(".recovery-card [data-note='unconfirmed']");
      const lost = await page.evaluate(() => ({
        note: document.querySelector("[data-note='unconfirmed']")?.textContent,
        finish: document.querySelectorAll("[data-act='recovery-finish']").length,
        retry: document.querySelector("[data-act='recovery-retry']")?.textContent,
        focus: document.activeElement?.getAttribute("data-act"),
      }));
      expect(lost.note === "?Your decision to finish the review wasn’t confirmed. Retry it to find out what happened; it is the same decision, so it can’t count twice.", `The note reads ${JSON.stringify(lost.note)}`);
      expect(lost.finish === 0, "Finish is still offered next to Retry: a new decision would be a second one");
      expect(lost.retry === "Retry recovery decision", `Retry reads ${JSON.stringify(lost.retry)}`);
      expect(lost.focus === "recovery-retry", `Focus is on ${lost.focus}, not Retry`);
      // Still read-only: the outcome is not known here.
      await page.locator("[data-act='recovery-later']").click();
      await page.waitForSelector(".film-strip[data-strip='recovery']");
      await page.locator("[data-act='review-recovery']").click();
      await review(page);
      await shot(page, "next-recovery-lost-reply-1440");
      await finish(page, "recovery-retry");
    },
  },
  {
    name: "next-recovery-stale",
    query: "ui=next&fixture=last-ferry&recovery=stale",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await review(page);
      expect(JSON.stringify(await counts(page)) === JSON.stringify({ films: 1, known: 2, uncertain: 1, preparing: 1, requests: 1 }), "The first counts are wrong");
      await page.locator("[data-act='recovery-finish']").click();
      // A job answered while the person read: the release is refused and the review read again.
      await page.waitForSelector(".recovery-card [data-note='stale'][role='alert']");
      expect((await text(page, "[data-note='stale']")).endsWith("The summary changed while you were reading, and the review isn’t finished yet. Look over it again, then finish the review."), "The changed summary is not said");
      await until(page, () => counts(page), (value) => value.uncertain === 0 && value.known === 3, "The new counts did not show");
      expect(await page.locator(".recovery-card[data-recovery='review']").count() === 1, "The review did not stay up");
      expect((await focused(page)) === "recovery-finish", `Focus is on ${await focused(page)}`);
      await shot(page, "next-recovery-stale-1440");
      await finish(page);
    },
  },
  {
    name: "next-recovery-narrow",
    query: RESTORED,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await review(page);
      await noSidewaysScroll(page, "review, English");
      const layout = await page.evaluate(() => {
        const card = document.querySelector(".recovery-card").getBoundingClientRect();
        const finish = document.querySelector("[data-act='recovery-finish']").getBoundingClientRect();
        return { left: card.left, right: window.innerWidth - card.right, finish: finish.width };
      });
      expect(layout.left >= 16 && layout.right >= 16, `The review leaves no 16 px gutter: ${JSON.stringify(layout)}`);
      await shot(page, "next-recovery-narrow-390");
      await page.locator(".recovery-card [data-act='recovery-finish']").scrollIntoViewIfNeeded();
      await shot(page, "next-recovery-narrow-390-decision");
      await page.locator(".topbar [data-act='language']").click();
      await page.waitForFunction(() => document.querySelector(".recovery-card h1")?.textContent === "检查恢复后的工作室");
      const zh = await page.evaluate(() => ({ backup: document.querySelector("[data-field='backup']")?.textContent, finish: document.querySelector("[data-act='recovery-finish']")?.textContent }));
      expect(/^备份时间：2026年10月\d{1,2}日 \d\d:\d\d。之后做的工作可能没有恢复。$/.test(zh.backup ?? ""), `The Chinese backup line reads ${JSON.stringify(zh.backup)}`);
      expect(zh.finish === "完成恢复检查", `Finish reads ${JSON.stringify(zh.finish)}`);
      await noSidewaysScroll(page, "review, Chinese");
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot(page, "next-recovery-narrow-390-zh");
      await page.locator("[data-act='recovery-later']").click();
      await page.waitForSelector(".film-strip[data-strip='recovery']");
      await noSidewaysScroll(page, "strip, Chinese");
      await page.locator(".topbar [data-act='language']").click();
    },
  },
  {
    name: "next-recovery-live",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      // The disposable studio was not restored; its recovery routes answer as a restored one would, so this checks the
      // live client: the status read, the read-only studio, and the release request's key and body.
      const receiptDigest = "a".repeat(64), firstSummary = "b".repeat(64);
      const counts = { projects: 1, knownJobs: 0, unknownJobs: 2, nativeRequests: 0, unusedAllowances: 0, preparingJobs: 0 };
      const receipt = { restoreId: "restore-live-1", backupId: "backup-1", backupManifestSha256: "c".repeat(64), sourceDatabaseSha256: "d".repeat(64), originalDataRoot: "/data", backupCreatedAt: "2026-10-12T07:30:00.000Z", restoredAt: "2026-10-15T08:00:00.000Z", version: 1, generation: 1, projectIds: ["p"], fenceDigest: "e".repeat(64) };
      let state = "quarantined";
      const releases = [];
      const writes = [];
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (request.method() === "POST" && path.startsWith("/api/") && path !== "/api/session" && path !== "/api/installation/recovery/release") writes.push(path);
      });
      let statusReads = 0;
      await page.route("**/api/installation/recovery", (route) => { statusReads++; return route.fulfill({ json: { state, receipt, receiptDigest, summaryDigest: firstSummary, counts } }); });
      await page.route("**/api/installation/recovery/release", async (route) => {
        const request = route.request();
        releases.push({ key: request.headers()["idempotency-key"], body: request.postDataJSON(), csrf: request.headers()["x-openslate-csrf"] });
        state = "released";
        await route.fulfill({ json: { receipt: { ...request.postDataJSON(), version: 1, commandId: request.headers()["idempotency-key"], principalId: "local-user", releasedAt: "2026-10-15T09:00:00.000Z" }, recovery: { state, receipt, receiptDigest, summaryDigest: firstSummary, counts } } });
      });
      await review(page);
      // Every kind is listed, a zero included; only kinds with something in them say what happens to it.
      const rows = await page.evaluate(() => [...document.querySelectorAll(".recovery-row")].map((row) => [row.getAttribute("data-count"), Number(row.querySelector(".n")?.textContent), !!row.querySelector(".what")]));
      expect(JSON.stringify(rows) === JSON.stringify([["films", 1, false], ["known", 0, false], ["uncertain", 2, true], ["preparing", 0, false], ["requests", 0, false]]), `The rows are ${JSON.stringify(rows)}`);
      await page.locator("[data-act='recovery-later']").click();
      await page.waitForSelector(".film-strip[data-strip='recovery']");
      await page.waitForSelector("main.work [data-needs]", { timeout: 20000 });
      const guarded = await page.evaluate(() => [...document.querySelectorAll("[data-needs]")].filter((node) => !node.disabled).map((node) => node.getAttribute("data-act")));
      expect(guarded.length === 0, `Writes stay on in the live studio: ${guarded.join(", ")}`);
      await page.locator("[data-act='review-recovery']").click();
      await review(page);
      await page.waitForTimeout(300);
      const readsBeforeFinish = statusReads;
      await finish(page);
      expect(releases.length === 1, `${releases.length} releases were sent`);
      const [release] = releases;
      expect(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(release.key ?? ""), `The release has no command key: ${release.key}`);
      expect(/^[A-Za-z0-9_-]{43}$/.test(release.csrf ?? ""), "The release was sent without the session's CSRF value");
      expect(JSON.stringify(release.body) === JSON.stringify({ restoreId: "restore-live-1", expectedReceiptDigest: receiptDigest, expectedSummaryDigest: firstSummary }), `The release body is ${JSON.stringify(release.body)}`);
      expect(writes.length === 0, `Writes were sent while the studio was in review: ${writes.join(", ")}`);
      await page.locator("[data-act='recovery-done']").click();
      await page.waitForSelector(".app:not([data-recovery])");
      await until(page, () => page.locator("main.work [data-act='edit-prompt']").first().isDisabled().catch(() => true), (value) => value === false, "Edits stayed off after the review");
      // The release's answer carries the status, and once finished the film refreshes no longer read it.
      expect(statusReads === readsBeforeFinish, `The status was read ${statusReads - readsBeforeFinish} more times after the review`);
    },
  },
  {
    name: "next-recovery-live-elsewhere",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      // Another window finishes the review while this one is looking around: the strip goes, writes work again, and a
      // toast says why. Nothing is released from here.
      const receipt = { restoreId: "restore-live-2", backupCreatedAt: "2026-10-12T07:30:00.000Z", restoredAt: "2026-10-15T08:00:00.000Z" };
      const counts = { projects: 1, knownJobs: 1, unknownJobs: 0, nativeRequests: 0, unusedAllowances: 0, preparingJobs: 0 };
      let state = "quarantined";
      const releases = [];
      page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/installation/recovery/release") releases.push(request.url()); });
      await page.route("**/api/installation/recovery", (route) => route.fulfill({ json: { state, receipt, receiptDigest: "a".repeat(64), summaryDigest: "b".repeat(64), counts } }));
      await review(page);
      await page.locator("[data-act='recovery-later']").click();
      await page.waitForSelector(".film-strip[data-strip='recovery']");
      await page.waitForSelector("main.work [data-act='edit-prompt']", { timeout: 20000 });
      expect(await page.locator("main.work [data-act='edit-prompt']").first().isDisabled(), "Edits are on while the studio is in review");
      // The other window's release; this one hears of it when it reads the status again (here: coming back to it).
      state = "released";
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await until(page, () => text(page, ".toast"), (value) => value === "The recovery review was finished in another window. Changes work again; every film stays stopped until you continue it.", "No toast said the review was finished elsewhere");
      await page.waitForSelector(".film-strip-slot:not([data-strip='recovery'])", { state: "attached" });
      expect(await page.locator(".app[data-recovery]").count() === 0, "The finished review took over the view");
      await until(page, () => page.locator("main.work [data-act='edit-prompt']").first().isDisabled().catch(() => true), (value) => value === false, "Edits stayed off after the review was finished elsewhere");
      expect(releases.length === 0, "This window sent a release");
      await page.waitForTimeout(400);
      await shot(page, "next-recovery-live-elsewhere-1440");
    },
  },
];
