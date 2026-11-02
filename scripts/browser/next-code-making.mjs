// Next UI, what a code film is making right now: the run strip names it, and Plan shows each picture and clip that is
// on its way where it will appear. The fixture film is simulated and stays at this point: nothing is generated,
// charged, saved or sent. Set BROWSER_CHECK_SHOTS=/some/dir to save screenshots.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

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
    name: "next-code-making-shows-where-it-will-appear",
    query: "ui=next&fixture=last-ferry&codeplan=making",
    viewport: { width: 1440, height: 900 },
    async run({ page }) {
      const making = page.locator("[data-act='code-plan-show-making']");
      await making.waitFor();
      // A number and its unit are joined by a no-break space (i18n keepTogether); it reads as a space here.
      const line = (await making.innerText()).replaceAll("\u00a0", " ").trim();
      expect(line === "Making 3 keyframes and 1 clip", `the strip says ${JSON.stringify(line)}`);

      // From another view, the strip leads to Plan.
      await page.click(".topbar [data-act='tab'][data-view='assets']");
      await page.waitForSelector("main.work[data-view='assets']");
      await making.click();
      await page.waitForSelector("main.work[data-view='plan'][data-code-plan='true']");

      const refs = page.locator("[data-scene='references']");
      expect((await refs.locator("button.thumb").count()) === 1, "the shared picture is listed once under References");
      const pier = page.locator(".cp-shot-row[data-shot='1.2'] .cp-making");
      expect((await pier.count()) === 1 && /Making/.test(await pier.innerText()), "1.2's keyframe is shown as being made");
      const harbour = page.locator(".cp-shot-row[data-shot='1.1']");
      expect((await harbour.locator("button.thumb").count()) === 1, "1.1 still shows its chosen keyframe");
      expect(/Making/.test(await harbour.locator(".cp-making").innerText()), "1.1's clip is shown as being made");
      await shot(page, "code-making-plan");

      await page.click(".topbar [data-act='language']");
      await page.waitForFunction(() => document.querySelector("[data-act='code-plan-show-making']")?.textContent.includes("正在生成"));
      const zh = (await making.innerText()).replaceAll("\u00a0", " ").trim();
      expect(zh === "正在生成：关键帧 3 张和视频 1 段", `the strip in Chinese says ${JSON.stringify(zh)}`);
    },
  },
];
