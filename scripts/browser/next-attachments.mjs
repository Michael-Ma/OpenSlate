// Files sent with a Director message, and keyframes the Director starts when asked (sample film, nothing leaves the
// page). Attach (file chooser), drop onto the column and paste into the box; each file is saved to Assets first and
// listed on the sent message. Screenshots go to /tmp/openslate-attach-*.png (or $OPENSLATE_SCREENSHOTS).
import { join } from "node:path";

const query = "ui=next&fixture=last-ferry";
const shot = (name) => join(process.env.OPENSLATE_SCREENSHOTS ?? "/tmp", `openslate-attach-${name}.png`);
const fail = (message) => { throw new Error(message); };

// A 2 x 2 PNG, a one-page text PDF and a short MP3 header: enough for the sample film's simulated routes.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(2045, 1)]);

async function ready(page) {
  await page.waitForSelector(".director .thread [data-entry]", { timeout: 20000 });
}

async function expectText(page, selector, pattern, timeout = 8000) {
  const deadline = Date.now() + timeout;
  let last = "";
  while (Date.now() < deadline) {
    last = (await page.locator(selector).first().innerText().catch(() => "")).replaceAll(" ", " ");
    if (pattern.test(last)) return last;
    await page.waitForTimeout(100);
  }
  throw new Error(`${selector} never matched ${pattern}; last text: ${JSON.stringify(last)}`);
}

const chips = (page) => page.$$eval(".file-chip", (nodes) => nodes.map((node) => `${node.dataset.kind}:${node.dataset.state}:${node.querySelector(".file-name").textContent}`));

/** Drop or paste a file made in the page (a real DataTransfer, as the browser gives one). */
async function sendInPage(page, how, name, type, bytes) {
  await page.evaluate(({ how, name, type, bytes }) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type }));
    if (how === "paste") {
      const box = document.querySelector('[data-field="message"]');
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
      return;
    }
    const column = document.querySelector(".director");
    for (const event of ["dragenter", "dragover", "drop"]) column.dispatchEvent(new DragEvent(event, { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, { how, name, type, bytes: [...bytes] });
}

export const scenarios = [
  {
    name: "next-attachments-send",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      // Attach: the paperclip opens a chooser; several files at once.
      if (!(await page.locator('[data-act="attach"]').isVisible())) fail("The composer has no attach button");
      await page.setInputFiles('[data-act="attach-input"]', [
        { name: "harbour-reference.png", mimeType: "image/png", buffer: PNG },
        { name: "treatment.pdf", mimeType: "application/pdf", buffer: PDF },
      ]);
      await page.waitForFunction(() => document.querySelectorAll('.file-chip[data-state="ready"]').length === 2, null, { timeout: 15000 });
      // Drop onto the column, and paste into the box.
      await sendInPage(page, "drop", "foghorn.mp3", "audio/mpeg", MP3);
      await sendInPage(page, "paste", "pasted.png", "image/png", PNG);
      await page.waitForFunction(() => document.querySelectorAll('.file-chip[data-state="ready"]').length === 4, null, { timeout: 15000 });
      const listed = await chips(page);
      if (listed.join() !== "image:ready:harbour-reference.png,document:ready:treatment.pdf,audio:ready:foghorn.mp3,image:ready:pasted.png") fail(`Chips: ${listed}`);
      if (await page.locator(".dir-drop").count()) fail("The drop outline stayed after the drop");
      await expectText(page, '.file-chip[data-kind="document"] .file-status', /^Document · /);
      await page.screenshot({ path: shot("chips-1440"), clip: { x: 0, y: 420, width: 400, height: 480 } });
      // A file the studio can't take is refused on its chip, and holds Send until it is removed.
      await sendInPage(page, "drop", "animation.gif", "image/gif", PNG);
      await page.waitForSelector('.file-chip[data-state="failed"]');
      await expectText(page, '.file-chip[data-state="failed"] .file-status', /PNG, JPEG, WebP or HEIC/);
      const box = page.locator('[data-field="message"]');
      await box.click();
      await box.pressSequentially("Here are the references and the treatment.");
      if (!(await page.locator('[data-act="send"]').isDisabled())) fail("Send is on while a file failed");
      await expectText(page, ".composer-note", /Remove the file that could not be uploaded/);
      await page.click('.file-chip[data-state="failed"] [data-act="remove-file"]');
      if (await page.locator('[data-act="send"]').isDisabled()) fail("Send stays off once the failed file is removed");
      await page.click('[data-act="send"]');
      // The sent message lists its files; the composer is empty again.
      await page.waitForSelector('.thread [data-who="you"] .sent-files');
      const sent = await page.$$eval('.thread [data-who="you"] .sent-files .sent-file', (nodes) => nodes.map((node) => node.textContent.replace(/\s+/g, " ").trim()));
      if (sent.length !== 4 || !sent[1].includes("treatment.pdf")) fail(`The sent message lists ${JSON.stringify(sent)}`);
      if (await page.locator(".file-chip").count()) fail("The files stayed in the composer after sending");
      await expectText(page, '.thread [data-who="director"]:last-of-type .dir-text', /went through the 4 files/, 8000);
      await page.screenshot({ path: shot("sent-1440") });
      // They are in Assets too.
      await page.click('[data-act="tab"][data-view="assets"]');
      await page.click('[data-act="role-filter"][data-role="document"]');
      await expectText(page, "main.work", /treatment\.pdf/);
      await page.screenshot({ path: shot("assets-documents-1440") });
    },
  },
  {
    name: "next-attachments-drop-outline",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      await page.evaluate(() => {
        const transfer = new DataTransfer();
        transfer.items.add(new File(["x"], "notes.txt", { type: "text/plain" }));
        document.querySelector(".director").dispatchEvent(new DragEvent("dragenter", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      });
      await expectText(page, ".dir-drop", /Drop files to send them with your message/);
      await page.screenshot({ path: shot("drop-1440") });
      await page.evaluate(() => document.querySelector(".director").dispatchEvent(new DragEvent("dragleave", { bubbles: true, relatedTarget: document.body })));
      await page.waitForSelector(".dir-drop", { state: "detached" });
    },
  },
  {
    name: "next-attachments-director-keyframes",
    query,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      await ready(page);
      const box = page.locator('[data-field="message"]');
      await box.click();
      await box.pressSequentially("Please make the keyframes for the rest of the film now.");
      await page.click('[data-act="send"]');
      // The scripted Director starts Scene 3's keyframes and 3.2's voice line, and says what and the price.
      await expectText(page, ".gen-note", /^Started 2 keyframes and 1 voice line in Scene 3 · about \$0\.09/, 10000);
      if (!(await page.locator('.gen-note [data-act="stop-generation"]').isVisible())) fail("Stop is missing while the keyframes are made");
      await page.screenshot({ path: shot("director-keyframes-1440") });
      await page.click('[data-act="scene"][data-scene="scene-3"]');
      await expectText(page, '[data-card="shot-3-1"] .stl', /Making keyframe|Not opened/, 10000);
      // Once made, the line stays without Stop.
      await page.waitForSelector('.gen-note[data-generation="done"]', { timeout: 20000 });
    },
  },
];
