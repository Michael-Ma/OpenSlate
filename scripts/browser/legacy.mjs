// Classic (legacy) UI checks. They guard the two P0 hotfixes until the classic UI is deleted.
const ready = async (page) => {
  await page.waitForSelector(".workspace-grid", { timeout: 20000 });
  await page.getByRole("button", { name: "Model settings" }).waitFor();
};

export const scenarios = [
  {
    name: "legacy-model-settings-keeps-layout",
    async run({ page }) {
      await ready(page);
      // Hold the element itself: model settings also contain the word "Keyframes".
      const tab = await page.getByText("Keyframes", { exact: true }).first().elementHandle();
      const before = await tab.boundingBox();
      await page.getByRole("button", { name: "Model settings" }).click();
      await page.waitForTimeout(800);
      const scrollTop = await page.$eval(".workspace-grid", (grid) => grid.scrollTop);
      const after = await tab.boundingBox();
      if (scrollTop !== 0) throw new Error(`.workspace-grid scrolled to ${scrollTop}px after opening model settings`);
      if (!before || !after || Math.abs(before.y - after.y) > 1) throw new Error(`The view tabs moved from y=${before?.y} to y=${after?.y}`);
    },
  },
  {
    name: "legacy-idle-has-no-stop",
    async run({ page }) {
      await ready(page);
      // The fixture's fake jobs settle within a few engine ticks; after that nothing can be stopped.
      const stop = page.getByRole("button", { name: /^Stop conversation/ });
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline && (await stop.count())) await page.waitForTimeout(500);
      if (await stop.count()) throw new Error("Stop is still offered while nothing is running");
    },
  },
];
