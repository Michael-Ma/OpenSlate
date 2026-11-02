// Shared checks for the Keyframes inspector's rows view and the preview's frame (no scenarios of its own).

/**
 * Every row and action of the inspector is drawn whole or not at all: none is cut mid-height by the inspector's
 * edge, a scroll fade or the stacked actions, and nothing drawn covers anything else. The actions are in view at rest:
 * the last resort that scrolls them with the rows (scroll) is only for an inspector too short for its title above
 * them, so a check meets it only when it says so (`lastResort`). In the layouts that scroll it is checked at both
 * ends of the scroll.
 */
export async function inspectorWhole(page, where, { lastResort = false } = {}) {
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
        action: element.tagName === "BUTTON" && element.parentElement.classList.contains("insp-actions"),
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
  // Edit prompt, Edit motion & duration and Regenerate keyframe are in view at rest (a phone's inspector is as tall
  // as its content, and the last resort scrolls them with the rows).
  const hidden = report.units.filter((unit) => unit.action && (unit.undrawn || unit.shown < unit.bottom - unit.top - 0.5));
  if (report.fit === "scroll" && !lastResort) throw new Error(`The inspector scrolls its actions with the rows ${where}, the last resort for a room too short for them`);
  if (report.fit && report.fit !== "scroll" && hidden.length) throw new Error(`The inspector's actions are out of view at rest ${where} (${report.fit}): ${JSON.stringify(hidden)}`);
  if (report.fit !== "pinned" && report.fit !== "scroll") return report;
  // Scrolled to the end, then back: units are drawn whole at the other end too.
  await page.locator(".insp").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  check(await read(), " (scrolled to the end)");
  await page.locator(".insp").evaluate((element) => { element.scrollTop = 0; });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  return report;
}

/**
 * The preview shows the whole 16:9 frame: where its box is taller than that, the frame keeps 16:9 and the caption
 * and the controls sit under it (only the shot's badge and status lie on the picture). There the caption sits on the
 * scrubber, and Previous and Next keep the film position between them.
 */
export async function previewWholeFrame(page, where) {
  const layout = await page.evaluate(() => {
    const rect = (element) => { if (!element) return null; const box = element.getBoundingClientRect(); return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height }; };
    const preview = document.querySelector(".preview");
    const frame = preview?.querySelector(".pv-frame");
    const image = frame?.querySelector(".pic-img");
    return {
      preview: rect(preview), frame: rect(frame), fit: image ? getComputedStyle(image).objectFit : null,
      caption: rect(preview?.querySelector(".pv-caption")), side: rect(preview?.querySelector(".pv-side")), scrub: rect(preview?.querySelector(".scrub")),
      position: rect(preview?.querySelector(".pv-pos")),
    };
  });
  const detail = JSON.stringify(layout);
  if (!layout.preview || !layout.frame) throw new Error(`No preview frame ${where}: ${detail}`);
  const ratio = layout.frame.width / layout.frame.height;
  // A frame box narrower than 16:9 would crop the picture's sides unless it is letterboxed.
  if (ratio < 16 / 9 - 0.03 && layout.fit !== "contain") throw new Error(`The preview crops the 16:9 frame ${where}: ${detail}`);
  if (layout.preview.height > layout.preview.width * 9 / 16 * 1.25) {
    // A tall box: the caption, the controls and the scrubber are under the frame, inside the preview.
    for (const part of ["caption", "side", "scrub"]) {
      const box = layout[part];
      if (box && (box.top < layout.frame.bottom - 0.5 || box.bottom > layout.preview.bottom + 0.5)) throw new Error(`The preview's ${part} is not under the frame ${where}: ${detail}`);
    }
    // The room the band does not need is under the controls, never between the caption and its scrubber.
    if (layout.caption && layout.caption.height > 0 && layout.scrub && layout.scrub.top - layout.caption.bottom > 10) throw new Error(`The preview's caption is apart from its scrubber ${where}: ${detail}`);
    if (layout.position && layout.position.width < 20) throw new Error(`The preview's film position is hidden under the frame ${where}: ${detail}`);
  }
  return layout;
}
