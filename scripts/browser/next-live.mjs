// The next UI against a real (fake-provider) fixture studio, not the in-browser sample film.
export const scenarios = [{
  name: "next-live-overview-and-idle",
  query: "ui=next",
  async run({ page }) {
    await page.waitForSelector(".topbar", { timeout: 20000 });
    await page.waitForFunction(() => /scenes? ·/.test(document.querySelector(".topbar")?.textContent ?? ""), null, { timeout: 15000 });
    // Clips waiting for a person's confirm are not running work: no Stop while idle (GR-13).
    if (await page.locator('[data-act="stop-film"]').count()) throw new Error("Stop is offered while nothing is running");
  },
}];
