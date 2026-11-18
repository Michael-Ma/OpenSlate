// Next UI, a code film's idea. Plan shows what the Director chose before planning any shot (its take, the reading,
// the visual rule) above the storyboard, with the takes it passed on, the fixed points and the cut list folded; the
// keyframe card says which video input the Director would pick and why, and the person still picks. The fixture film
// is simulated: nothing is generated, charged, saved or sent. Set BROWSER_CHECK_SHOTS=/some/dir to save screenshots.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const CONFIRM = "ui=next&fixture=last-ferry&codeplan=confirm&view=plan";

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

async function shot(page, name) {
  const dir = process.env.BROWSER_CHECK_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${name}.png`) });
}

export const scenarios = [
  {
    name: "next-code-idea-sits-above-the-storyboard",
    query: CONFIRM,
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      const idea = page.locator("[data-scene='idea']");
      await idea.waitFor();
      const order = await page.locator(".scenes > [data-scene]").evaluateAll((nodes) => nodes.map((node) => node.dataset.scene));
      expect(order[0] === "idea" && order.includes("harbour"), `the idea comes first: ${order.join(" ")}`);
      expect((await idea.locator("[data-idea='format']").innerText()) === "Short film" && (await idea.locator("[data-idea='aim']").innerText()) === "Calm, then Bittersweet", "the format and the aim come first");
      expect((await idea.locator("[data-idea='take'] b").innerText()) === "The ferry is the only warm light", "the chosen take is named");
      expect(/Bent from: Mood first, object last/.test(await idea.locator("[data-idea='take']").innerText()), "the take says which template it bends");
      expect(/^The viewer first reads this as/.test(await idea.locator("[data-idea='reading']").innerText()), "the reading is shown");
      expect(/every warm light belongs to the ferry/.test(await idea.locator("[data-idea='rule']").innerText()), "the visual rule is shown");

      // The rest is there but folded, so the idea stays three lines.
      const folded = await idea.locator("details").evaluateAll((nodes) => nodes.map((node) => `${node.dataset.idea}:${node.open}`));
      expect(folded.join(" ") === "others:false fixed:false cuts:false", `folded parts: ${folded.join(" ")}`);
      expect(/2 other takes it considered/.test(await idea.locator("[data-idea='others'] summary").innerText()), "the other takes are counted");
      await idea.locator("[data-idea='others'] summary").click();
      const others = await idea.locator("[data-idea='others'] li").allInnerTexts();
      expect(others.length === 2 && /Template: Trace of someone/.test(others[0]) && /The Director's own/.test(others[1]), `other takes: ${others.join(" | ")}`);
      await idea.locator("[data-idea='cuts'] summary").click();
      expect((await idea.locator(".cp-cuts tbody tr").count()) === 4, "the cut list has its four cuts");
      const cutsLine = await idea.locator("[data-idea='cuts'] summary").innerText();
      expect(/Cut list:\s4\scuts\s.\s10\ss/.test(cutsLine), `the cut list says its length: ${JSON.stringify(cutsLine)}`);
      await shot(page, "idea-open");

      // The keyframe card: the Director's suggestion is said in words and marked on its option; nothing is chosen for the person.
      const card = page.locator("#director .cp-choice[data-answered='false']").first();
      await card.waitFor();
      const line = await card.locator("[data-act='code-plan-suggest']").innerText();
      expect(/The Director suggests “Keyframe as first frame”: The next cut matches this framing/.test(line), `suggestion line: ${line}`);
      const marks = await card.locator(".cp-input").evaluateAll((nodes) => nodes.map((node) => `${node.dataset.input}:${node.classList.contains("primary")}:${!!node.querySelector(".cp-input-badge")}:${node.getAttribute("aria-pressed")}`));
      expect(marks.join(" ") === "keyframe_and_references:false:false:false references_only:false:false:false first_frame:true:true:false", `options: ${marks.join(" ")}`);
      await shot(page, "idea-suggestion");
    },
  },
  {
    name: "next-code-idea-fits-a-phone",
    query: CONFIRM,
    viewport: { width: 390, height: 844 },
    async run({ page }) {
      const idea = page.locator("[data-scene='idea']");
      await idea.waitFor();
      await idea.locator("[data-idea='cuts'] summary").click();
      const fit = await idea.evaluate((node) => ({ wide: node.scrollWidth, box: node.clientWidth, page: document.documentElement.scrollWidth, view: window.innerWidth }));
      expect(fit.wide <= fit.box + 1 && fit.page <= fit.view + 1, `the idea fits the phone: ${JSON.stringify(fit)}`);
      await shot(page, "idea-phone");
    },
  },
];
