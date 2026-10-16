// Next UI, narration per shot (classic-UI parity, card B13): the Keyframes inspector's narration panel and the Plan
// editor's "My recording", on the Last Ferry fixture film (?ui=next&fixture=last-ferry: nothing is generated,
// charged or saved), plus one scenario against the disposable fixture studio itself (?ui=next) that adds a real
// recording through POST /shots/:shotId/narration/recording and plays it back SHA-checked.
import { existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (label) => `shot-${label.replace(".", "-")}`;
const scene = (ordinal) => `scene-${ordinal}`;
const shots = (() => {
  const dir = existsSync("/tmp") ? "/tmp/parity/narration" : join(tmpdir(), "parity-narration");
  try { mkdirSync(dir, { recursive: true }); } catch { /* screenshots are optional */ }
  return dir;
})();
const screenshot = (page, name) => page.screenshot({ path: join(shots, `${name}.png`) });

const ready = async (page) => {
  await page.waitForSelector('main.work[data-view="keyframes"] .insp', { timeout: 20000 });
};

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
  const size = await page.evaluate(() => document.documentElement.scrollWidth);
  if (size > width) throw new Error(`The page scrolls sideways: ${size}px wide at ${width}px`);
}

async function openCard(page, label) {
  await page.click(`.card [data-act="open-shot"][data-shot="${shot(label)}"]`);
  await page.waitForSelector(`.insp[data-shot="${shot(label)}"]`);
}

/** A mono 16-bit PCM WAV of `seconds`: a quiet tone (for the studio's real media check, or the browser's length read). */
function wav(seconds, rate = 48000) {
  const count = Math.round(seconds * rate);
  const buffer = Buffer.alloc(44 + count * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + count * 2, 4); buffer.write("WAVE", 8);
  buffer.write("fmt ", 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) buffer.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  return buffer;
}

const chooseFile = (page, name, mimeType, buffer) => page.setInputFiles('.insp [data-act="narr-file"]', { name, mimeType, buffer });

/** The audio element's measured length once the browser has read it. */
async function audioSeconds(page) {
  await page.waitForFunction(() => {
    const audio = document.querySelector('.insp audio[data-act="narration-audio"]');
    return audio && Number.isFinite(audio.duration) && audio.duration > 0;
  }, null, { timeout: 10000 });
  return page.locator('.insp audio[data-act="narration-audio"]').evaluate((el) => el.duration);
}

export const scenarios = [
  {
    name: "next-narration-listen-and-voice",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.3");
      // The row: Edit and Listen under its label, then the line and its measured length.
      await expectText(page, '.insp [data-row="narration"]', /^Narration\s*Edit\s*“It was the last boat[\s\S]*7\.4 s voiced · longer than the shot/);
      const listen = page.locator(`.insp [data-act="narration-listen"][data-shot="${shot("2.3")}"]`);
      expect(await listen.getAttribute("aria-label") === "Listen to the narration of 2.3" && await listen.getAttribute("title") === "Listen", "Listen has no accessible name");
      // The controls make the row no taller than its line and notes: the inspector's stacked actions keep their room.
      const [label, value] = await page.locator('.insp [data-row="narration"]').evaluate((el) => [el.querySelector("dt").getBoundingClientRect().height, el.querySelector("dd").getBoundingClientRect().height]);
      expect(label <= value + 0.5, `The narration controls make the row taller: ${label} px against ${value} px`);
      await screenshot(page, "row-1440");
      await page.click('.insp [data-act="narration-listen"]');
      await page.waitForSelector('.insp form[data-form="narration"][data-choice="line"]');
      await expectText(page, ".insp .narr-take", /^Voice line · 7\.4 s · Cedar/);
      const length = await audioSeconds(page);
      expect(Math.abs(length - 7.4) < 0.05, `The voice line plays for ${length} s, not 7.4 s`);
      // Listen hands the player the focus: native controls, keyboard operable.
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "narration-audio", null, { timeout: 3000 });
      expect(await page.locator('.insp audio[data-act="narration-audio"]').evaluate((el) => el.controls && el.getAttribute("aria-label") === "Voice line of 2.3, 7.4 s"), "The player is not the native, named one");
      await page.locator('.insp audio[data-act="narration-audio"]').evaluate((el) => el.pause());
      // Keyboard: the choices are one tab stop with arrow keys; Tab goes on to the player, then the line.
      await page.focus('.insp [data-act="narr-choice"][data-choice="line"]');
      await page.keyboard.press("ArrowRight");
      expect(await page.locator('.insp form[data-form="narration"]').getAttribute("data-choice") === "recording", "ArrowRight did not choose My recording");
      await page.keyboard.press("ArrowLeft");
      await page.waitForSelector('.insp form[data-form="narration"][data-choice="line"]');
      await page.focus('.insp [data-act="narr-choice"][data-choice="line"]');
      await page.keyboard.press("Tab");
      expect(await page.evaluate(() => document.activeElement?.getAttribute("data-act")) === "narration-audio", "Tab from the choices does not reach the player");
      // The native controls take the keys: Space plays from the keyboard.
      await page.keyboard.press("Space");
      await page.waitForFunction(() => { const audio = document.querySelector('.insp audio[data-act="narration-audio"]'); return audio && !audio.paused; }, null, { timeout: 3000 });
      await page.locator('.insp audio[data-act="narration-audio"]').evaluate((el) => el.pause());
      // A short inspector (1440 x 900 under the Director's banner): the voice and the line are both in view above
      // the sticky buttons, and a seek slider joins the native player, whose timeline has no room here.
      const box = await page.evaluate(() => {
        const r = (sel) => document.querySelector(sel)?.getBoundingClientRect();
        const body = r(".insp .insp-body"), foot = r(".insp .narr-foot"), select = r(".insp select[data-act='narr-voice']"), line = r('.insp textarea[data-field="line"]');
        return { top: body.top, footTop: foot.top, select: [select.top, select.bottom], line: [line.top, line.top + 40] };
      });
      expect(box.select[0] >= box.top && box.select[1] <= box.footTop, `The voice is out of view: ${JSON.stringify(box)}`);
      expect(box.line[0] >= box.top && box.line[1] <= box.footTop, `The line is out of view: ${JSON.stringify(box)}`);
      const seek = page.locator('.insp input[data-act="narration-seek"]');
      expect(await seek.isVisible(), "No seek slider beside a native player without its timeline");
      expect(await seek.getAttribute("aria-label") === "Position: Voice line of 2.3, 7.4 s", "The seek slider is not named");
      await seek.focus();
      await page.keyboard.press("End");
      await page.waitForFunction(() => document.querySelector('.insp audio[data-act="narration-audio"]').currentTime > 7, null, { timeout: 3000 });
      expect(/^7\.4 s of 7\.4 s$/.test(await seek.getAttribute("aria-valuetext")), `Seek position: ${await seek.getAttribute("aria-valuetext")}`);
      await page.keyboard.press("Home");
      // The voice: following the film first, the film default marked.
      const options = await page.locator(".insp select[data-act='narr-voice'] option").allInnerTexts();
      expect(options[0] === "Same as the film (Cedar)" && options.includes("Cedar · film default") && options.includes("Ash"), `Voice options: ${options.join(", ")}`);
      await page.selectOption(".insp select[data-act='narr-voice']", "ash");
      await expectText(page, '.insp form[data-form="narration"] .stale[id^="narr-impact"]', /^The voice line will be made again in this voice, with the scene's next keyframes or video\.$/);
      await screenshot(page, "panel-voice-1440");
      await page.click('.insp [data-act="save-edit"]');
      await expectText(page, ".toast", /2\.3 has a new voice for its line\./);
      await page.waitForSelector('.insp [data-row="narration"]');
      await expectText(page, '.insp [data-row="narration"]', /about [\d.]+ s \(estimate, not voiced yet\)/);
      expect(await page.locator('.insp [data-act="narration-listen"]').count() === 0, "Listen is offered for a line that is not voiced");
      await page.click('.toast [data-act="undo"]');
      await expectText(page, '.insp [data-row="narration"]', /7\.4 s voiced/);
      // Closing the panel gives the focus back to the control that opened it: Listen, or Edit.
      await page.click('.insp [data-act="narration-listen"]');
      await page.waitForSelector('.insp form[data-form="narration"]');
      await page.focus('.insp [data-act="narr-choice"][data-choice="line"]');
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "narration-listen", null, { timeout: 3000 });
      await page.keyboard.press("Enter");
      await page.waitForSelector('.insp form[data-form="narration"]');
      await page.click('.insp [data-act="cancel-edit"]');
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "narration-listen", null, { timeout: 3000 });
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="cancel-edit"]');
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "narration-edit", null, { timeout: 3000 });
    },
  },
  {
    name: "next-narration-recording",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.2");
      await expectText(page, '.insp [data-row="narration"]', /^Narration\s*Edit\s*None/);
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await expectText(page, ".insp .narr-state", /^No recording yet\. Choose one below\.$/);
      expect(await page.locator('.insp [data-act="narr-add"]').isDisabled(), "Add is on before a file is chosen");
      await chooseFile(page, "mara-take-1.wav", "audio/wav", wav(3, 16000));
      await expectText(page, ".insp .narr-file", /^mara-take-1\.wav · 94 KB · 3 s$/);
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await page.waitForSelector('.insp .narr-progress-row[data-state="sending"] [role="progressbar"]');
      await screenshot(page, "recording-sending-1440");
      await page.waitForSelector('.insp .narr-progress-row[data-state="checking"] .narr-progress.indet');
      await expectText(page, ".toast", /^2\.2 now uses your recording \(3 s\)\./, 6000);
      // The new take plays at once, with its measured length.
      await expectText(page, ".insp .narr-take", /^Your recording · 3 s/);
      const length = await audioSeconds(page);
      expect(Math.abs(length - 3) < 0.05, `The recording plays for ${length} s`);
      await expectText(page, '.insp [data-act="cancel-edit"]', /^Done$/);
      await screenshot(page, "recording-added-1440");
      await page.click('.insp [data-act="cancel-edit"]');
      await expectText(page, '.insp [data-row="narration"]', /Your recording[\s\S]*3 s/);
      expect(await page.locator('.insp [data-act="narration-listen"]').count() === 1, "A recording cannot be listened to from the row");
      // Undo from the toast: 2.2 has no narration again.
      await page.click('.toast [data-act="undo"]');
      await expectText(page, '.insp [data-row="narration"]', /^Narration\s*Edit\s*None/);
    },
  },
  {
    name: "next-narration-recording-too-long",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click(`[data-act="scene"][data-scene="${scene(1)}"]`);
      await openCard(page, "1.1");
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await chooseFile(page, "long-take.wav", "audio/wav", wav(7.4, 8000));
      await expectText(page, '.insp [data-note="long"]', /^7\.4 s is longer than the 6 s shot\. Once added, choose how to fit it\.$/);
      await page.click('.insp [data-act="narr-add"]');
      await expectText(page, ".toast", /1\.1 now uses your recording \(7\.4 s\), longer than the 6 s shot\. Choose how to fit it\./, 6000);
      await page.click('.insp [data-act="cancel-edit"]');
      await expectText(page, '.insp [data-row="narration"]', /Your recording[\s\S]*7\.4 s · longer than the shot/);
      // The existing fit choices settle it.
      await page.waitForSelector('.banner.check[data-state="open"]');
      await expectText(page, ".banner.check h2", /^Narration 7\.4 s, shot 6 s$/);
      await screenshot(page, "recording-too-long-1440");
      await page.click(`[data-act="keep-fit"][data-shot="${shot("1.1")}"]`);
      await page.waitForSelector('.banner.check[data-state="settled"]');
      await expectText(page, '.insp [data-row="narration"]', /cut at 6 s/);
    },
  },
  {
    name: "next-narration-refusals",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.2");
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      // Refused before anything is sent: not audio.
      await chooseFile(page, "notes.txt", "text/plain", Buffer.from("not audio"));
      await expectText(page, '.insp .narr-refusal[role="alert"]', /Choose an audio file \(WAV, MP3, M4A, FLAC…\)\./);
      expect(await page.locator('.insp [data-act="narr-add"]').isDisabled(), "Add is on for a text file");
      const tone = await page.locator(".insp .narr-refusal").evaluate((el) => `${getComputedStyle(el).borderColor} ${getComputedStyle(el).color}`);
      expect(!/240, 178, 74|200, 16, 46/.test(tone), `A refusal is drawn amber or red: ${tone}`);
      // Refused by the studio: a file it cannot read. No Try again for that file.
      await chooseFile(page, "broken.wav", "audio/wav", Buffer.from("RIFF0000WAVEjunkjunkjunk"));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await expectText(page, '.insp .narr-refusal[role="alert"]', /The studio could not read this recording\. Try another file\./, 6000);
      expect(await page.locator('.insp [data-act="narr-add"]').isDisabled(), "Add stays on after a final refusal");
      expect(await page.locator(".toast").count() === 0, "A refusal also showed as a toast");
      await screenshot(page, "recording-refused-1440");
      // The refused file and Choose another… stay in view with the refusal, above the buttons.
      const inView = await page.evaluate(() => {
        const body = document.querySelector(".insp .insp-body").getBoundingClientRect();
        return ['[data-field="refused-file"]', '[data-act="narr-choose"]'].map((sel) => { const box = document.querySelector(`.insp .narr-refusal ${sel}`)?.getBoundingClientRect(); return !!box && box.top >= body.top && box.bottom <= body.bottom; });
      });
      expect(inView.every(Boolean), `The refused file or Choose another… is out of view: ${inView}`);
      expect(await page.locator('.insp .narr-refusal [data-field="refused-file"]').innerText() === "broken.wav · 24 B", "The refused file is not named with its refusal");
      // Escape closes the panel; the focus goes back to Edit.
      await page.locator('.insp [data-act="narr-choose"]').focus();
      await page.keyboard.press("Escape");
      await page.waitForSelector('.insp [data-row="narration"]');
      await page.waitForFunction(() => document.activeElement?.getAttribute("data-act") === "narration-edit", null, { timeout: 3000 });
    },
  },
  {
    name: "next-narration-none-and-line",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.click(`[data-act="scene"][data-scene="${scene(1)}"]`);
      await openCard(page, "1.2");
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="none"]');
      await expectText(page, '.insp form[data-form="narration"]', /1\.2 will have no narration\. Its voice line stays in Assets\./);
      await page.click('.insp [data-act="save-edit"]');
      await expectText(page, ".toast", /1\.2 has no narration now\./);
      await expectText(page, '.insp [data-row="narration"]', /^Narration\s*Edit\s*None/);
      await page.click('.toast [data-act="undo"]');
      await expectText(page, '.insp [data-row="narration"]', /One for the morning boat\.[\s\S]*2\.1 s voiced/);
      // A shot without narration gets a line: the line, then the choice, in turn.
      await openCard(page, "1.1");
      await page.click('.insp [data-act="narration-edit"]');
      await page.waitForSelector('.insp form[data-form="narration"][data-choice="none"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="line"]');
      expect(await page.locator('.insp [data-act="save-edit"]').isDisabled(), "Save is on with an empty line");
      await expectText(page, ".insp .est", /Write the line, or choose None\./);
      await page.fill('.insp textarea[data-field="line"]', "The office closes at six.");
      await expectText(page, ".insp .est", /fits 6 s/);
      await page.click('.insp [data-act="save-edit"]');
      await expectText(page, '.insp [data-row="narration"]', /The office closes at six\.[\s\S]*estimate, not voiced yet/);
      // The line went first and choosing a line last: the toast says its Undo takes back only the choice.
      await expectText(page, ".toast", /^1\.1 has a line to voice now\. Undo takes back only that choice; the line and voice stay as saved\./);
    },
  },
  {
    name: "next-narration-plan-recording",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await page.waitForSelector(".topbar [data-act='tab'][data-view='plan']", { timeout: 20000 });
      await page.click(".topbar [data-act='tab'][data-view='plan']");
      await page.waitForSelector('main.work[data-view="plan"] .scenes .shot-row', { timeout: 20000 });
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.waitForSelector('form[data-form="shot"]');
      await page.click('[data-act="narr-recording"]');
      expect(await page.locator('[data-act="narr-recording"]').getAttribute("aria-checked") === "true", "My recording is not chosen");
      await expectText(page, '[data-note="recording"]', /^Add the recording on 1\.2 in Keyframes\.$/);
      await expectText(page, '[data-impact="cost"] .txt', /1\.2 will use your recording instead of its voice line once you add it in Keyframes \(until then the voice line plays; it stays in Assets\)\./);
      const group = await page.locator('form[data-form="shot"] .segctl').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(group.scroll <= group.client + 1, `The narration choices overflow: ${JSON.stringify(group)}`);
      // The note under the choice does not push Motion, beside it, down.
      const labels = await page.locator('form[data-form="shot"]').evaluate((form) => [form.querySelector('[data-field="motion"]'), form.querySelector(".segctl")].map((el) => Math.round(el.closest(".field").getBoundingClientRect().top)));
      expect(Math.abs(labels[0] - labels[1]) <= 1, `Motion and Narration start at ${labels.join(" and ")}`);
      await screenshot(page, "plan-recording-1440");
      await page.click('[data-act="save-shot"]');
      await page.waitForSelector('form[data-form="shot"]', { state: "detached" });
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.waitForSelector('form[data-form="shot"]');
      expect(await page.locator('[data-act="narr-recording"]').getAttribute("aria-checked") === "true", "The saved shot does not read as My recording");
      // No recording was added: the voice line is still what plays, and nothing calls it the person's recording.
      await expectText(page, '[data-note="recording"]', /^Still the voice line \(2\.1 s\): add your recording on 1\.2 in Keyframes\.$/);
      await page.click('[data-act="narr-line"]');
      await expectText(page, "[data-impact] .txt", /Nothing made goes out of date\./);
      await page.click('form[data-form="shot"] [data-act="cancel-edit"]');
      await page.click(".topbar [data-act='tab'][data-view='keyframes']");
      await ready(page);
      await page.click(`[data-act="scene"][data-scene="${scene(1)}"]`);
      await openCard(page, "1.2");
      await expectText(page, '.insp [data-row="narration"]', /Your recording[\s\S]*not added yet · the voice line plays \(2\.1 s\)/);
      await page.click('.insp [data-act="narration-edit"]');
      await page.waitForSelector('.insp form[data-form="narration"][data-choice="recording"]');
      await expectText(page, '.insp .narr-state[data-take="voice"]', /^No recording yet\. Until you add one, the voice line below plays\.$/);
      await expectText(page, ".insp .narr-take", /^Voice line · 2\.1 s · Cedar/);
      expect(!/Your recording/.test(await page.locator(".insp .narr-panel").innerText()), "The panel calls the voice line the person's recording");
      await screenshot(page, "voice-under-recording-1440");
    },
  },
  {
    name: "next-narration-words-not-added",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      // The words are saved before the bytes; a recording that is not added gives them back.
      await ready(page);
      await openCard(page, "2.3");
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await page.fill('.insp textarea[data-field="words"]', "Completely different words for my take.");
      await chooseFile(page, "broken.wav", "audio/wav", Buffer.from("RIFF0000WAVEjunkjunkjunk"));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await expectText(page, '.insp .narr-refusal[role="alert"]', /The studio could not read this recording\. Try another file\.\s*The words are back as they were\./, 8000);
      expect(await page.locator(".toast").count() === 0, "Restoring the words showed a toast");
      await screenshot(page, "words-restored-1440");
      // Stopped while sending: nothing added, the words back.
      await chooseFile(page, "mara-take-2.wav", "audio/wav", wav(3, 16000));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await page.click('.insp [data-act="narr-stop"]');
      await expectText(page, '.insp [data-state="stopped"][data-words="restored"]', /^Sending stopped\. The recording was not added\. The words are back as they were\.$/, 8000);
      await page.click('.insp [data-act="cancel-edit"]');
      // The line and its paid voice line are as they were.
      await expectText(page, '.insp [data-row="narration"]', /“It was the last boat of the season, and I nearly missed it\.”[\s\S]*7\.4 s voiced/);
      // Added with new words: the toast says its Undo leaves them.
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await page.fill('.insp textarea[data-field="words"]', "The last boat, and I nearly missed it.");
      await chooseFile(page, "mara-take-3.wav", "audio/wav", wav(5, 16000));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await expectText(page, ".toast", /^2\.3 now uses your recording \(5 s\) with its new words\. Undo takes back the recording; the words stay\./, 8000);
    },
  },
  {
    name: "next-narration-closed-while-sending",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.2");
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await chooseFile(page, "mara-take-1.wav", "audio/wav", wav(3, 16000));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await page.waitForSelector('.insp .narr-progress-row[data-state="sending"]');
      // Escape waits while bytes go out: Stop sending is the way to stop them.
      await page.focus('.insp [data-act="narr-stop"]');
      await page.keyboard.press("Escape");
      expect(await page.locator('.insp .narr-progress-row[data-state="sending"]').count() === 1, "Escape closed the panel while sending");
      // Shot cards share the inspector's hold: this unfinished edit cannot disappear through selection.
      const hold = await page.locator('.card [data-act="open-shot"][data-shot="shot-2-3"]').evaluate((button) => ({ disabled: button.disabled, title: button.title }));
      expect(hold.disabled && hold.title === "Save or cancel the edit to 2.2 first", `The other card does not explain the recording edit hold: ${JSON.stringify(hold)}`);
      // Opening another workspace still closes the sending panel: the transfer stops and a toast says so.
      // The film's inspector draft is retained across views and must be cancelled before selecting another shot.
      await page.click(".topbar [data-act='tab'][data-view='plan']");
      await page.waitForSelector('main.work[data-view="plan"]');
      await expectText(page, ".toast", /^Sending the recording for 2\.2 stopped; nothing was added\./, 6000);
      await page.click(".topbar [data-act='tab'][data-view='keyframes']");
      await page.waitForSelector('.insp[data-shot="shot-2-2"] form[data-form="narration"]');
      expect(await page.locator('.card [data-act="open-shot"][data-shot="shot-2-3"]').isDisabled(), "Returning to Keyframes dropped the retained inspector draft");
      await page.click('.insp [data-act="cancel-edit"]');
      await page.waitForSelector('.insp form[data-form="narration"]', { state: "detached" });
      expect(!(await page.locator('.card [data-act="open-shot"][data-shot="shot-2-3"]').isDisabled()), "Cancelling the retained draft did not release shot selection");
      await openCard(page, "2.3");
      await openCard(page, "2.2");
      await expectText(page, '.insp [data-row="narration"]', /^Narration\s*Edit\s*None/);
    },
  },
  {
    name: "next-narration-leave-recording",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.2");
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await chooseFile(page, "mara-take-1.wav", "audio/wav", wav(3, 16000));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await expectText(page, ".toast", /^2\.2 now uses your recording \(3 s\)\./, 6000);
      await expectText(page, ".insp .narr-take", /^Your recording · 3 s/);
      // Back to a line: the recording stops being used and a voice line will be made (priced, or no price set).
      await page.click('.insp [data-act="narr-choice"][data-choice="line"]');
      await page.fill('.insp textarea[data-field="line"]', "On the pier.");
      const lineImpact = await expectText(page, '.insp form[data-form="narration"] .stale[id^="narr-impact"]', /^Your recording stops being used \(it stays in Assets\)\. A voice line will be made/);
      expect(!/\$0\.00/.test(lineImpact) && (/about \$\d/.test(lineImpact) || /no price is set/.test(lineImpact)), `The voice line is not priced: ${lineImpact}`);
      await page.click('.insp [data-act="narr-choice"][data-choice="none"]');
      await expectText(page, '.insp form[data-form="narration"] .stale[id^="narr-impact"]', /^2\.2 will have no narration\. Your recording stops being used; it stays in Assets\.$/);
      await page.click('.insp [data-act="cancel-edit"]');
      // Plan says the same, as a cost, and its row shows the take, not the studio's stand-in words.
      await page.click(".topbar [data-act='tab'][data-view='plan']");
      await page.waitForSelector('main.work[data-view="plan"] .scenes .shot-row', { timeout: 20000 });
      const row = await page.locator(`.shot-row[data-shot="${shot("2.2")}"] .shot-say`).innerText();
      expect(/My recording chosen · 3 s take/.test(row) && !/Uploaded narration recording|voice line/.test(row), `Plan's row for the recording: ${row}`);
      await page.click(`[data-act="edit-shot"][data-shot="${shot("2.2")}"]`);
      await page.waitForSelector('form[data-form="shot"]');
      await expectText(page, '[data-note="recording"]', /^Your recording, 3 s\. Replace it in Keyframes\.$/);
      await page.click('[data-act="narr-line"]');
      await page.fill('form[data-form="shot"] [data-field="line"]', "On the pier.");
      await expectText(page, '[data-impact="cost"] .txt', /2\.2 stops using your recording \(it stays in Assets\); a voice line will be made/);
      expect(!/Nothing made goes out of date/.test(await page.locator("[data-impact] .txt").innerText()), "Leaving the recording reads as free");
      await page.click('[data-act="narr-none"]');
      await expectText(page, '[data-impact="cost"] .txt', /2\.2 will have no narration: your recording stops being used \(it stays in Assets\)\./);
      await screenshot(page, "plan-leave-recording-1440");
    },
  },
  {
    name: "next-narration-narrow-390",
    query,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      await ready(page);
      await page.locator(".cards").evaluate((el) => { el.scrollLeft = el.scrollWidth; });
      await openCard(page, "2.3");
      await page.click('.insp [data-act="narration-listen"]');
      await page.waitForSelector('.insp audio[data-act="narration-audio"]');
      await noSidewaysScroll(page, 390);
      await page.locator(".insp .narr-panel").scrollIntoViewIfNeeded();
      await screenshot(page, "panel-narrow-390");
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await noSidewaysScroll(page, 390);
      await screenshot(page, "panel-recording-narrow-390");
      // Plan's three narration choices fit a phone too.
      await page.click(".topbar [data-act='tab'][data-view='plan']");
      await page.waitForSelector('main.work[data-view="plan"] .scenes .shot-row', { timeout: 20000 });
      await page.click(`[data-act="edit-shot"][data-shot="${shot("1.2")}"]`);
      await page.click('[data-act="narr-recording"]');
      const group = await page.locator('form[data-form="shot"] .segctl').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(group.scroll <= group.client + 1, `Plan's narration choices overflow at 390 px: ${JSON.stringify(group)}`);
      await noSidewaysScroll(page, 390);
      await page.locator('[data-note="recording"]').scrollIntoViewIfNeeded();
      await screenshot(page, "plan-recording-narrow-390");
    },
  },
  {
    name: "next-narration-chinese",
    query: `${query}&lang=zh-CN`,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await openCard(page, "2.3");
      await expectText(page, '.insp [data-row="narration"]', /^旁白\s*编辑/);
      expect(await page.locator('.insp [data-act="narration-listen"]').getAttribute("aria-label") === "试听 2.3 的旁白", "Listen is not named in Chinese");
      await page.click('.insp [data-act="narration-listen"]');
      await expectText(page, ".insp .narr-take", /^配音 · 7\.4 秒 · Cedar/);
      await expectText(page, ".insp .segctl", /无\s*一句旁白\s*我的录音/);
      const group = await page.locator(".insp .segctl").evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(group.scroll <= group.client + 1, `The choices overflow in Chinese: ${JSON.stringify(group)}`);
      await screenshot(page, "panel-zh-1440");
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await screenshot(page, "panel-recording-zh-1440");
      await page.click('.insp [data-act="cancel-edit"]');
      // A recording without words: Plan's row never shows the studio's English stand-in.
      await openCard(page, "2.2");
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await chooseFile(page, "take.wav", "audio/wav", wav(3, 16000));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await expectText(page, ".toast", /2\.2 现在使用你的录音（3 秒）/, 6000);
      await page.click(".topbar [data-act='tab'][data-view='plan']");
      await page.waitForSelector('main.work[data-view="plan"] .scenes .shot-row', { timeout: 20000 });
      const row = await page.locator(`.shot-row[data-shot="${shot("2.2")}"] .shot-say`).innerText();
      expect(row.trim() === "已选“我的录音” · 3 秒音频", `Plan's row in Chinese: ${JSON.stringify(row)}`);
      await page.locator(`.shot-row[data-shot="${shot("2.2")}"]`).scrollIntoViewIfNeeded();
      await screenshot(page, "plan-row-recording-zh-1440");
    },
  },
  {
    name: "next-narration-live-recording",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      // The disposable fixture studio (fake providers, a temporary database): a real recording through the route.
      await ready(page);
      const target = await page.locator(".insp").getAttribute("data-shot");
      await page.click('.insp [data-act="narration-edit"]');
      await page.waitForSelector('.insp form[data-form="narration"]');
      // The stock voices come from GET /api/narration/voices.
      await page.click('.insp [data-act="narr-choice"][data-choice="line"]');
      await page.waitForFunction(() => document.querySelectorAll(".insp select[data-act='narr-voice'] option").length > 10, null, { timeout: 8000 });
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      const sent = page.waitForRequest((request) => request.method() === "POST" && /\/shots\/[^/]+\/narration\/recording\?expectedHeadVersion=\d+$/.test(request.url()));
      await chooseFile(page, "live-take.wav", "audio/wav", wav(2));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      const request = await sent;
      const headers = request.headers();
      expect(headers["content-type"] === "application/octet-stream" && /^[\w-]{8,}$/.test(headers["idempotency-key"] ?? ""), `Recording request headers: ${JSON.stringify(headers)}`);
      const content = page.waitForResponse((response) => /\/narration\/audio\/[^/]+\/content$/.test(response.url()) && response.status() === 200, { timeout: 20000 });
      await expectText(page, ".toast", /now uses your recording \(2 s\)\./, 20000);
      // The pointer rests on the toast, so its Undo stays while the recording is checked.
      await page.hover(".toast");
      // Played back from GET /narration/audio/:audioId/content, checked against its SHA-256.
      await expectText(page, ".insp .narr-take", /^Your recording · 2 s/, 8000);
      const served = await content;
      expect(/^[0-9a-f]{64}$/.test(served.headers()["x-content-sha256"] ?? ""), "The recording was not served with its SHA-256");
      const length = await audioSeconds(page);
      expect(Math.abs(length - 2) < 0.05, `The live recording plays for ${length} s`);
      await screenshot(page, "live-recording-1440");
      // Undo through the toast with the route's command id: the shot goes back to how it was.
      const undone = page.waitForRequest((request) => request.method() === "POST" && /\/storyboard$/.test(request.url()) && request.postDataJSON()?.kind === "undo");
      await page.click('.toast [data-act="undo"]');
      expect(typeof (await undone).postDataJSON().commandId === "string", "Undo did not send the recording's command id");
      await page.waitForSelector(".insp .narr-take", { state: "detached", timeout: 10000 });
      await page.click('.insp [data-act="cancel-edit"]');
      await expectText(page, `.insp[data-shot="${target}"] [data-row="narration"]`, /^Narration\s*Edit\s*(None|Not decided)/, 10000);
    },
  },
  {
    name: "next-narration-live-words-restored",
    query: "ui=next",
    viewport: { width: 1440, height: 900 },
    // The studio's refusal of an unreadable recording is an expected 4xx.
    allowConsoleErrors: [/HTTP 4\d\d \/api\/projects\/[^/]+\/shots\/[^/]+\/narration\/recording/],
    async run({ page }) {
      // The disposable fixture studio: words saved for a recording the studio refuses are undone through the real route.
      await ready(page);
      const target = await page.locator(".insp").getAttribute("data-shot");
      const before = await page.locator(`.insp[data-shot="${target}"] [data-row="narration"]`).innerText();
      const edits = [];
      page.on("request", (request) => { if (request.method() === "POST" && /\/storyboard$/.test(request.url())) edits.push(request.postDataJSON()); });
      await page.click('.insp [data-act="narration-edit"]');
      await page.click('.insp [data-act="narr-choice"][data-choice="recording"]');
      await page.fill('.insp textarea[data-field="words"]', "Words for a take that never lands.");
      await chooseFile(page, "broken.wav", "audio/wav", Buffer.from("RIFF0000WAVEjunkjunkjunk"));
      await page.waitForFunction(() => !document.querySelector('.insp [data-act="narr-add"]')?.disabled, null, { timeout: 5000 });
      await page.click('.insp [data-act="narr-add"]');
      await page.waitForSelector('.insp .narr-refusal[role="alert"] [data-words]', { timeout: 20000 });
      const words = await page.locator(".insp .narr-refusal [data-words]").getAttribute("data-words");
      expect(words === "restored", `The words were not given back (${words}): ${await page.locator(".insp .narr-refusal").innerText()}`);
      expect(edits.length === 2 && edits[0].kind === "narration" && edits[0].field === "text" && edits[1].kind === "undo", `Storyboard commands: ${JSON.stringify(edits)}`);
      await page.click('.insp [data-act="cancel-edit"]');
      await expectText(page, `.insp[data-shot="${target}"] [data-row="narration"]`, new RegExp(`^${before.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), 8000);
    },
  },
];
