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
    // A number and its unit are joined by a no-break space (i18n keepTogether); it reads as a space here.
    last = (await page.locator(selector).first().innerText().catch(() => "")).replaceAll("\u00a0", " ");
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

/**
 * The toast sits over the top of the preview, under its pills (DESIGN.md), opaque from its first frame: never on the
 * shot cards or the video panel at the foot of the workspace, where it hid a card's seconds and title.
 */
async function toastOverPreview(page) {
  const spot = await page.evaluate(async () => {
    const rect = (element) => { const r = element.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; };
    const toast = document.querySelector(".toast");
    await Promise.all(toast.getAnimations().map((a) => a.finished));
    return {
      toast: rect(toast),
      preview: rect(document.querySelector(".preview")),
      head: rect(document.querySelector(".preview .pv-head")),
      below: [...document.querySelectorAll(".card, .vpanel")].map(rect),
      opacity: getComputedStyle(toast).opacity,
    };
  });
  const { toast, preview, head } = spot;
  const covers = (r) => toast.bottom > r.top && toast.top < r.bottom && toast.right > r.left && toast.left < r.right;
  if (spot.opacity !== "1" || covers(head) || spot.below.some(covers) || toast.top < preview.top || toast.bottom > preview.bottom || toast.left < preview.left || toast.right > preview.right)
    throw new Error(`The toast is not over the top of the preview: ${JSON.stringify(spot)}`);
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

/** Reuse the provider bridge used by next-settings: exercise the in-browser fixture's own command routes. */
async function inspectorFixtureState(page, change = null) {
  return page.evaluate(async (edit) => {
    const app = document.querySelector(".app");
    const key = app && Object.keys(app).find((name) => name.startsWith("__reactFiber$"));
    let store = null;
    for (let fiber = key ? app[key] : null; fiber; fiber = fiber.return) {
      const value = fiber.memoizedProps?.value;
      if (value?.mode === "fixture" && value.store?.getState) { store = value.store; break; }
    }
    if (!store) throw new Error("The in-browser fixture store was not found");
    await store.refresh();
    const before = store.getState();
    if (!before.snapshot || before.snapshot.project.id !== before.projectId || before.overview?.projectId !== before.projectId)
      throw new Error("The fixture projections do not belong to its selected film");
    if (edit) {
      const target = Object.values(before.overview.shots).find((item) => item.label === edit.label);
      if (!target) throw new Error(`The fixture has no shot ${edit.label}`);
      const body = { kind: "shot", id: target.shotId, field: "imagePrompt", value: edit.value, expectedHeadVersion: before.snapshot.project.headVersion };
      const receipt = await store.command(`b18-other-edit:${target.shotId}:${body.expectedHeadVersion}`, body,
        () => ({ path: `/api/projects/${encodeURIComponent(before.projectId)}/storyboard`, body }));
      if (!receipt?.commandId) throw new Error(`The fixture refused the storyboard edit to ${edit.label}`);
      await store.refresh();
    }
    const state = store.getState();
    if (state.snapshot.project.headVersion !== state.overview.headVersion || state.snapshot.project.revisionId !== state.overview.revisionId)
      throw new Error("The fixture's displayed projections have not caught up");
    return {
      projectId: state.projectId,
      headVersion: state.snapshot.project.headVersion,
      prompts: Object.fromEntries(Object.values(state.overview.shots).map((item) => {
        const saved = state.snapshot.project.shots.find((row) => row.id === item.shotId);
        if (!saved || saved.imagePrompt !== item.imagePrompt) throw new Error(`The saved prompt differs from the displayed ${item.label}`);
        return [item.label, saved.imagePrompt];
      })),
      draft: state.edit ? { shotId: state.edit.shotId, value: state.edit.value } : null,
    };
  }, change);
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
      const banner = await box(page, ".banner");
      near("banner top", banner.top, 112); near("banner bottom", banner.bottom, 266);
      await noPageScroll(page, 1440);
      // The golden state: Scene 2, the Director's blocking note b first and in amber (as the design's banner),
      // 2.1 opened, the confirm disabled with its reason. The app's own check on 2.3 waits behind the note.
      await expectText(page, ".scene-head", /Harbour at dawn[\s\S]*Scene 2 · 3 shots · keyframes back, no video yet/);
      const amber = await page.locator('.banner[data-note="note-b"]').evaluate((el) => ({ border: getComputedStyle(el).borderColor, eyebrow: getComputedStyle(el.querySelector(".eyebrow")).color }));
      if (!/137, 106, 52/.test(amber.border) || !/240, 178, 74/.test(amber.eyebrow)) throw new Error(`The Director's note is not amber: ${JSON.stringify(amber)}`);
      await expectText(page, ".banner .eyebrow", /^b\s*Director recommends$/i);
      await expectText(page, ".banner h2", /^The 2\.3 line runs 7\.4 s but the shot is 6 s\.$/);
      await expectText(page, ".banner .sub", /2\.3 · Settle before making video · Film 48 s → 50 s · Keeps the keyframe/);
      await expectText(page, ".banner .tl", /Now[\s\S]*2\.3 · 6 s[\s\S]*After[\s\S]*2\.3 · 8 s[\s\S]*Scene 3 · 2 s later/);
      await expectText(page, '.banner [data-act="note-choice"][data-kind="proposal"]', /^Make 2\.3 8 s$/);
      if (await page.locator(".banner.check").count()) throw new Error("The app check is shown while a Director note is open");
      // Card callouts: amber chips with the note letters; the app check's chip on 2.3 gives way to note b.
      await expectText(page, '[data-card="shot-2-2"] .anno[data-note="note-a"]', /a\s*Mara's coat came out maroon/);
      // The card's link is one short line with its price; its tooltip and spoken name still say which shot.
      await expectText(page, '[data-card="shot-2-2"] [data-act="note-regenerate"]', /^New take · about \$0\.04\s*· 2\.2$/);
      if (await page.locator('[data-card="shot-2-2"] [data-act="note-regenerate"]').getAttribute("title") !== "Regenerate 2.2 · about\u00a0$0.04") throw new Error("The card link's tooltip does not name the full purchase");
      await expectText(page, '[data-card="shot-2-3"] .anno[data-note="note-b"]', /b\s*The 2\.3 line/);
      if (await page.locator('[data-card="shot-2-3"] .anno.check').count()) throw new Error("The app check's chip repeats note b on 2.3");
      await expectText(page, '[data-card="shot-2-1"] .stl', /Opened/);
      await expectText(page, ".vpanel", /1 of 3\s*frames opened/);
      if (!(await page.locator('[data-act="confirm-video"]').isDisabled())) throw new Error("Confirm is enabled before the frames are opened");
      await expectText(page, ".vpanel .why", /^Open 2\.2 and 2\.3 and settle 2\.3 first$/);
      await screenshot(page, "golden-1440");
    },
  },
  {
    name: "next-keyframes-note-make-8s-and-confirm",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.2");
      await openCard(page, "2.3");
      await expectText(page, ".vpanel", /3 of 3\s*frames opened/);
      // Every frame is opened, but the Director's blocking note b is still open: no video yet.
      const confirm = page.locator('[data-act="confirm-video"]');
      if (!(await confirm.isDisabled())) throw new Error("Confirm is enabled while note b is open");
      await expectText(page, ".vpanel .why", /^Settle the narration in 2\.3 first$/);
      await page.click('.banner [data-act="note-choice"][data-note="note-b"][data-kind="proposal"]');
      await page.waitForSelector('.banner[data-note="note-b"][data-state="settled"] [data-act="undo"]');
      await expectText(page, ".banner .eyebrow", /Director recommends · done/i);
      await expectText(page, ".banner .sub", /Settled: change applied/);
      await expectText(page, ".banner .tl", /2\.3 · 8 s/);
      await expectText(page, '[data-card="shot-2-3"] .ttl', /8 s/);
      await expectText(page, '[data-card="shot-2-3"] .anno[data-note="note-b"]', /✓ Make 2\.3 8 s/);
      // Note a is an observation: it does not gate the video.
      await expectText(page, '[data-act="confirm-video"]', /^Confirm frames & generate video · about \$1\.50$/);
      if (await confirm.isDisabled()) throw new Error("Confirm is still disabled after note b was settled");
      await expectText(page, ".vpanel .why", /^3 clips at about \$0\.50$/);
      await expectText(page, '.banner [data-act="note-next"]', /Next: note a/);
      await screenshot(page, "note-b-settled-1440");
      await confirm.click();
      await page.waitForSelector('[data-card="shot-2-1"] .vprog');
      // Paying used the change: its Undo is gone from the banner.
      if (await page.locator('.banner [data-act="undo"]').count()) throw new Error("Undo is still offered after paying for video");
      await expectText(page, ".vpanel", /Video saved/, 15000);
      await expectText(page, '[data-act="scene"][data-scene="scene-2"]', /Harbour at dawn · video saved/);
      await screenshot(page, "video-saved-1440");
    },
  },
  {
    name: "next-keyframes-note-undo",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click('.banner [data-act="note-choice"][data-kind="proposal"]');
      await page.waitForSelector('.banner[data-state="settled"] [data-act="undo"]');
      await page.click('.banner [data-act="undo"]');
      await page.waitForSelector('.banner[data-note="note-b"][data-state="open"]');
      await expectText(page, '[data-card="shot-2-3"] .ttl', /6 s/);
      // An undone proposal cannot be accepted again; the note's other choice remains.
      if (!(await page.locator('.banner [data-act="note-choice"][data-kind="proposal"]').isDisabled())) throw new Error("An undone proposal is offered again");
      await expectText(page, '.banner [data-act="note-choice"][data-kind="edit"]', /Edit narration/);
    },
  },
  {
    name: "next-keyframes-note-keep-maroon",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click('.banner [data-act="note-choice"][data-kind="proposal"]');
      await page.click('.banner [data-act="note-next"]');
      await page.waitForSelector('.banner[data-note="note-a"][data-state="open"]');
      await expectText(page, ".banner .eyebrow", /Director's note/i);
      await expectText(page, ".banner h2", /^Mara's coat came out maroon, not red\.$/);
      await expectText(page, '.banner [data-act="note-choice"][data-kind="regenerate"]', /^Regenerate 2\.2 · about \$0\.04$/);
      await screenshot(page, "note-a-1440");
      await page.click('.banner [data-act="note-choice"][data-kind="accept"]');
      await page.waitForSelector('.banner[data-note="note-a"][data-state="settled"]');
      await expectText(page, ".banner .sub", /Settled: Keep maroon/);
      await expectText(page, '[data-card="shot-2-2"] .anno[data-note="note-a"]', /✓ Keep maroon/);
      if (await page.locator('.banner [data-act="undo"]').count()) throw new Error("Keep maroon offers an Undo the server does not have");
      await page.click('.banner [data-act="note-next"]');
      await expectText(page, '.quiet', /Every Director note in this scene is settled\./);
    },
  },
  {
    name: "next-keyframes-note-regenerate",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Regenerate 2.2 through note a, from the link under its chip on the card.
      await page.click('[data-card="shot-2-2"] [data-act="note-regenerate"]');
      await page.waitForSelector('[data-card="shot-2-2"] .making');
      await expectText(page, '[data-card="shot-2-2"] .stl', /Making keyframe/);
      await page.click('.card [data-act="open-shot"][data-shot="shot-2-2"]');
      await page.waitForSelector('.insp [data-row="takes"]', { timeout: 10000 });
      await expectText(page, '.insp [data-row="takes"]', /Takes\s*2/);
      await expectText(page, '[data-card="shot-2-2"] .anno[data-note="note-a"]', /✓ Regenerate 2\.2/);
      await expectText(page, '[data-card="shot-2-2"] .stl', /Opened|Not opened/);
      await screenshot(page, "note-a-regenerated-1440");
    },
  },
  {
    name: "next-keyframes-keep-and-cut",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Settle note b by editing the line (still too long) and note a with Keep maroon: once no Director note
      // is open, the app's own check on 2.3 takes the banner.
      await page.click('.banner [data-act="note-choice"][data-kind="edit"]');
      await page.waitForSelector('.insp form[data-form="narration"]');
      await page.fill(".insp textarea", "It was the very last boat of the whole season, and I so nearly missed it.");
      await page.click('.insp [data-act="save-edit"]');
      await page.waitForSelector('.banner[data-note="note-b"][data-state="settled"]');
      await expectText(page, ".banner .sub", /Settled: 2\.3 edited/);
      await page.click('.banner [data-act="note-next"]');
      await page.click('.banner[data-note="note-a"] [data-act="note-choice"][data-kind="accept"]');
      await page.click('.banner[data-note="note-a"][data-state="settled"] [data-act="note-next"]');
      await page.waitForSelector('.banner.check[data-state="open"]');
      await expectText(page, ".banner.check h2", /^Narration about [\d.]+ s, shot 6 s$/);
      // New words are only an estimate: fitting needs the measured voice line, so the check offers no Make or Keep yet.
      await expectText(page, ".banner.check .sub", /2\.3's line looks longer than the shot\. Make its voice line to measure it/);
      if (await page.locator('[data-act="keep-fit"][data-shot="shot-2-3"]').count()) throw new Error("An estimated line offers Keep");
      await expectText(page, '[data-act="make-keyframes"]', /^Make 1 voice line/);
      await page.click('[data-act="make-keyframes"]');
      await expectText(page, ".banner.check h2", /^Narration [\d.]+ s, shot 6 s$/, 15000);
      await page.click('[data-act="keep-fit"][data-shot="shot-2-3"]');
      await page.waitForSelector('.banner.check[data-state="settled"] [data-act="undo"]');
      await expectText(page, ".banner", /2\.3 stays 6 s; the line is cut there/);
      await expectText(page, '.insp [data-row="narration"]', /cut at 6 s/);
      await screenshot(page, "kept-1440");
      await page.click('.banner [data-act="undo"]');
      await page.waitForSelector('.banner.check[data-state="open"]');
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
      await expectText(page, ".insp .st .status", /^Not opened$/);
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
    name: "next-keyframes-edit-while-generating",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.3");
      const baseline = await inspectorFixtureState(page);
      await page.click('.insp [data-act="edit-prompt"]');
      const prompt = page.locator('.insp form[data-form="prompt"] textarea');
      const firstDraft = "The ticket's date in sharp focus, cold dawn light across Mara's thumb.";
      await prompt.fill(firstDraft);
      // An unrelated storyboard save advances the same head as a keyframe landing, without touching 2.3.
      const otherPrompt = "The empty harbour at dawn, with a new curl of fog beside the moored ferry.";
      const advanced = await inspectorFixtureState(page, { label: "2.1", value: otherPrompt });
      if (advanced.projectId !== baseline.projectId || advanced.headVersion <= baseline.headVersion || advanced.prompts["2.3"] !== baseline.prompts["2.3"])
        throw new Error(`The unrelated fixture save did not preserve 2.3: ${JSON.stringify({ baseline, advanced })}`);
      if ((await prompt.inputValue()) !== firstDraft) throw new Error("The unrelated save replaced the person's prompt draft");
      if (await page.locator('[data-act="edit-conflict"]').count()) throw new Error("An unrelated head change produced an inspector conflict");
      await page.click('.insp [data-act="save-edit"]');
      await expectText(page, '.toast[data-tone="info"]', /^Saved\.\s*Undo$/);
      await toastOverPreview(page);
      await page.waitForSelector('.insp form[data-form="prompt"]', { state: "detached" });
      if (await page.locator('[data-act="edit-conflict"]').count()) throw new Error("Saving the rebased prompt produced a conflict");
      const saved = await inspectorFixtureState(page);
      if (saved.prompts["2.3"] !== firstDraft || saved.prompts["2.1"] !== otherPrompt || saved.headVersion <= advanced.headVersion || saved.draft !== null)
        throw new Error(`The rebased inspector save did not persist both edits: ${JSON.stringify(saved)}`);
      await page.click('.toast [data-act="toast-close"]');
      await page.waitForSelector(".toast", { state: "detached" });

      await page.click('.insp [data-act="edit-prompt"]');
      const secondDraft = "My close-up keeps the Sunday date, with the ticket edge visible against the coat.";
      const savedElsewhere = "The saved close-up shows the ferry ticket beside the pier railing.";
      await prompt.fill(secondDraft);
      const changed = await inspectorFixtureState(page, { label: "2.3", value: savedElsewhere });
      await expectText(page, '[data-act="edit-conflict"][role="alert"]', /Saved value:\s*The saved close-up shows the ferry ticket beside the pier railing\./);
      if ((await prompt.inputValue()) !== secondDraft) throw new Error("The true conflict lost the person's prompt text");
      // The in-browser port is private, so compare its saved head/value instead of counting network requests it never sends.
      const save = page.locator('.insp [data-act="save-edit"]');
      if (!(await save.isDisabled())) await save.click();
      const blocked = await inspectorFixtureState(page);
      if (blocked.headVersion !== changed.headVersion || blocked.prompts["2.3"] !== savedElsewhere || blocked.draft?.value !== secondDraft)
        throw new Error(`Save overwrote the conflicting prompt before the person chose: ${JSON.stringify({ changed, blocked })}`);
      await expectText(page, '[data-act="edit-conflict"]', /Saved value:\s*The saved close-up shows the ferry ticket beside the pier railing\./);
      await page.click('[data-act="edit-keep-text"]');
      await page.waitForSelector('[data-act="edit-conflict"]', { state: "detached" });
      if ((await prompt.inputValue()) !== secondDraft) throw new Error("Keep my text replaced the person's prompt draft");
      const chosen = await inspectorFixtureState(page);
      if (chosen.headVersion !== changed.headVersion || chosen.prompts["2.3"] !== savedElsewhere)
        throw new Error("Choosing Keep my text saved before the person pressed Save");
      await save.click();
      await expectText(page, '.toast[data-tone="info"]', /^Saved\.\s*Undo$/);
      await page.waitForSelector('.insp form[data-form="prompt"]', { state: "detached" });
      const kept = await inspectorFixtureState(page);
      if (kept.prompts["2.3"] !== secondDraft || kept.prompts["2.1"] !== otherPrompt || kept.headVersion <= changed.headVersion || kept.draft !== null)
        throw new Error(`The chosen prompt was not saved at the new displayed head: ${JSON.stringify(kept)}`);
      if (await page.locator('[data-act="edit-conflict"]').count()) throw new Error("The resolved prompt conflict stayed visible after saving");
    },
  },
  {
    name: "next-keyframes-note-edit-narration",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click('.banner [data-act="note-choice"][data-note="note-b"][data-kind="edit"]');
      await page.waitForSelector('.insp form[data-form="narration"]');
      // Unchanged, the line shows its measured length and nothing about saving (an estimate only once it changes).
      await expectText(page, ".insp .est", /^7\.4 s voiced · longer than 6 s$/);
      if ((await page.locator('.insp [id^="narr-impact-"]').innerText()).trim()) throw new Error("The unchanged line says what saving would remake");
      await page.fill(".insp textarea", "The last boat, and I nearly missed it.");
      await expectText(page, ".insp .est", /About 4\.6 s .*an estimate.* · fits 6 s/);
      await expectText(page, '.insp form[data-form="narration"]', /Nothing visual changes/);
      await page.click('.insp [data-act="save-edit"]');
      await page.waitForSelector('.banner[data-note="note-b"][data-state="settled"] [data-act="undo"]');
      await expectText(page, ".banner .sub", /Settled: 2\.3 edited/);
      await expectText(page, '.insp [data-row="narration"]', /estimate/);
      // Undoing the edit brings the line back and reopens the note.
      await page.click('.banner [data-act="undo"]');
      await page.waitForSelector('.banner[data-note="note-b"][data-state="open"]');
      await expectText(page, '.insp [data-row="narration"]', /It was the last boat/);
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
      // Two keyframes and 3.2's voice line, priced together as the server quotes the press.
      await expectText(page, '[data-act="make-keyframes"]', /^Make 2 keyframes · about \$0\.09$/);
      // "about" stays on the line of its price, and the seconds on a card stay with their unit.
      if (!(await page.locator('[data-act="make-keyframes"]').textContent()).includes("about\u00a0$0.09")) throw new Error("The price can break away from its about");
      if (!(await page.locator('.card .ttl').first().textContent()).includes("\u00a0s")) throw new Error("A card's seconds can break away from their unit");
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
      await page.click('.banner [data-act="note-choice"][data-kind="edit"]');
      await page.waitForSelector('.insp form[data-form="narration"]');
      const line = page.locator('.insp form[data-form="narration"] textarea[data-field="line"]');
      const words = "Keep these unsaved words while I review the scene controls.";
      await line.fill(words);
      await noPageScroll(page, 390, { vertical: false });
      const departure = page.locator(`[data-act="scene"][data-scene="${scene(3)}"]`);
      if (!(await departure.isDisabled())) throw new Error("Scene 3 is available while 2.3 has an unsaved narration edit");
      if ((await departure.getAttribute("title")) !== "Save or cancel the edit to 2.3 first") throw new Error("The scene pill does not explain the inspector edit hold");
      if ((await line.inputValue()) !== words) throw new Error("The scene edit hold lost the person's unsaved words");
      if ((await page.locator(".preview").getAttribute("data-shot")) !== shot("2.3")) throw new Error("The scene edit hold changed the selected shot");
      await page.click('.insp [data-act="cancel-edit"]');
      await page.waitForSelector('.insp form[data-form="narration"]', { state: "detached" });
      if (await departure.isDisabled()) throw new Error("Scene 3 stays disabled after the person cancelled the edit");
      await departure.click();
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
      await expectText(page, ".banner .eyebrow", /导演建议/);
      await expectText(page, '.banner [data-act="note-choice"][data-kind="proposal"]', /把 2\.3 改为 8 秒/);
      await expectText(page, '[data-card="shot-2-1"] .stl', /已查看/);
      await expectText(page, '[data-card="shot-2-2"] .stl', /未查看/);
      await expectText(page, ".insp", /重新生成关键帧/);
      await noPageScroll(page, 1440);
    },
  },
];
