// Shared checks for the Keyframes inspector's rows view (no scenarios of its own).

/**
 * Every row and action of the inspector is drawn whole or not at all: none is cut mid-height by the inspector's
 * edge, a scroll fade or the stacked actions, and nothing drawn covers anything else. In the layout that scrolls as one
 * unit it is checked at both ends of the scroll.
 */
export async function inspectorWhole(page, where) {
  const read = () => page.evaluate(() => {
    const insp = document.querySelector(".insp");
    if (!insp) return null;
    const UNITS = ".insp-title, .insp > .st, .insp-stop > p, .insp .rows dt, .insp .rows dd, .insp-notes > p, .insp-body > .insp-alert, .insp-actions > *";
    // What a unit is drawn in: every box between it and the page that clips, less the fades of a masked one.
    const clipOf = (element) => {
      let clip = { top: -Infinity, bottom: Infinity };
      for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowY === "visible" && style.overflowX === "visible") continue;
        const box = node.getBoundingClientRect();
        const top = box.top + node.clientTop;
        const masked = style.maskImage && style.maskImage !== "none";
        const fadeTop = masked ? parseFloat(style.getPropertyValue("--kf-fade-t")) || 0 : 0;
        const fadeBottom = masked ? parseFloat(style.getPropertyValue("--kf-fade-b")) || 0 : 0;
        clip = { top: Math.max(clip.top, top + fadeTop), bottom: Math.min(clip.bottom, top + node.clientHeight - fadeBottom) };
      }
      return clip;
    };
    const units = [...insp.querySelectorAll(UNITS)].filter((element) => element.getClientRects().length).map((element) => {
      const box = element.getBoundingClientRect();
      const clip = clipOf(element);
      const row = element.closest("[data-row]")?.getAttribute("data-row");
      return {
        name: element.getAttribute("data-act") ?? (row ? `${element.tagName.toLowerCase()} ${row}` : element.className || element.tagName.toLowerCase()),
        top: box.top, bottom: box.bottom, left: box.left, right: box.right,
        shown: Math.max(0, Math.min(box.bottom, clip.bottom) - Math.max(box.top, clip.top)),
        // A unit the scrolling inspector leaves undrawn until it is scrolled fully in.
        undrawn: getComputedStyle(element).clipPath !== "none",
      };
    });
    return { fit: insp.getAttribute("data-fit"), units };
  });
  const check = (report, at) => {
    if (!report) throw new Error(`No inspector ${where}`);
    const cut = report.units.filter((unit) => !unit.undrawn && unit.shown > 0.5 && unit.shown < unit.bottom - unit.top - 0.5);
    if (cut.length) throw new Error(`An inspector row or action is cut mid-height ${where}${at} (${report.fit}): ${JSON.stringify(cut)}`);
    const drawn = report.units.filter((unit) => !unit.undrawn && unit.shown > 0.5);
    for (const [index, a] of drawn.entries()) {
      for (const b of drawn.slice(index + 1)) {
        const overlap = Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
        if (overlap) throw new Error(`Inspector units overlap ${where}${at} (${report.fit}): ${JSON.stringify([a, b])}`);
      }
    }
    return report;
  };
  // The layout settles first (a fade that follows the scroll updates on the next frame).
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const report = check(await read(), "");
  if (report.fit !== "scroll") return report;
  // Scrolled to the end, then back: units are drawn whole at the other end too.
  await page.locator(".insp").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  check(await read(), " (scrolled to the end)");
  await page.locator(".insp").evaluate((element) => { element.scrollTop = 0; });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return report;
}
