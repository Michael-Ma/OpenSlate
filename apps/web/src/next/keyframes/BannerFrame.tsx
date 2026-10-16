import { Fragment, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { TimelineSegment } from "../model/checks.ts";
import { fitStrip, sameStripFit, STRIP_PX_PER_SECOND, unitRuns, type StripFit, type StripRowInput } from "../model/keyframes-layout.ts";

/** Text with every number kept on one line with its unit ("6 s" never splits). */
function Units({ text }: { text: string }) {
  return <>{unitRuns(text).map((run, index) => (run.keep ? <span key={index} className="keep">{run.text}</span> : run.text))}</>;
}

/** One row of the Now / After strip: shots as wide as they are long, the dashed tail after them. */
function Segments({ segments, fit }: { segments: TimelineSegment[]; fit: StripFit["rows"][number] | null }) {
  const { tm } = useI18n();
  let shot = -1;
  return (
    <div className="segs">
      {segments.map((segment, index) => {
        const text = tm(segment.text);
        if (segment.kind !== "shot") return <span key={index} className="seg dash" title={text} style={fit?.tail != null ? { width: fit.tail } : undefined}>{text}</span>;
        shot += 1;
        const placed = fit?.shots[shot];
        const label = placed?.label ?? "full";
        const className = `seg${segment.hot ? " hot" : ""}`;
        const width = placed?.width ?? segment.seconds * STRIP_PX_PER_SECOND;
        // Too narrow for its seconds: the shot's label alone, the whole label for screen readers and the tooltip.
        if (label === "full" || !segment.label) return <span key={index} className={className} style={{ width }}>{text}</span>;
        return (
          <span key={index} className={className} style={{ width }} title={text} data-fit={label}>
            <span aria-hidden="true">{segment.label}</span>
            <span className="sr-only">{text}</span>
          </span>
        );
      })}
    </div>
  );
}

/**
 * The Now / After strip. It is measured on the page and fitted to its row: 15 px a second where there is room,
 * a smaller shared scale where there is not, so no label is ever cut through a glyph (keyframes-layout.ts).
 */
function Strip({ now, after }: { now: TimelineSegment[]; after: TimelineSegment[] | null }) {
  const { t, tm } = useI18n();
  const strip = useRef<HTMLDivElement>(null);
  const sizer = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<StripFit | null>(null);
  const rows = after ? [now, after] : [now];
  // Measure again whenever any label changes (a new change, the language).
  const texts = rows.map((row) => row.map((segment) => `${segment.seconds}:${tm(segment.text)}`).join("|")).join("/");

  useLayoutEffect(() => {
    const element = strip.current;
    const measures = sizer.current;
    if (!element || !measures) return;
    const measure = () => {
      const segs = element.querySelector<HTMLElement>(".segs");
      if (!segs) return;
      const widthOf = (row: number, index: number, part: string) =>
        measures.querySelector<HTMLElement>(`[data-row="${row}"][data-index="${index}"][data-part="${part}"]`)?.getBoundingClientRect().width ?? 0;
      const input: StripRowInput[] = rows.map((row, r) => ({
        shots: row.flatMap((segment, index) => (segment.kind === "shot" ? [{ seconds: segment.seconds, full: widthOf(r, index, "full"), short: widthOf(r, index, "short") }] : [])),
        tail: row.some((segment) => segment.kind !== "shot") ? Math.max(...row.map((segment, index) => (segment.kind === "shot" ? 0 : widthOf(r, index, "tail")))) : null,
      }));
      const next = fitStrip(input, segs.clientWidth, parseFloat(getComputedStyle(segs).columnGap) || 0);
      setFit((previous) => (sameStripFit(previous, next) ? previous : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // The row's width, and the labels' widths once the font has loaded.
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(measures);
    return () => observer.disconnect();
    // `texts` stands for the rows' content: the rows themselves are new objects on every render.
  }, [texts]);

  return (
    <div className="tl" ref={strip} aria-label={t("check.timeline.label")}>
      <span className="k">{t("check.timeline.now")}</span>
      <Segments segments={now} fit={fit?.rows[0] ?? null} />
      {after ? <><span className="k">{t("check.timeline.after")}</span><Segments segments={after} fit={fit?.rows[1] ?? null} /></> : null}
      {/* Every label at its natural width, out of sight, for the fit. */}
      <div className="tl-sizer" aria-hidden="true">
        <div ref={sizer}>
          {rows.map((row, r) => row.map((segment, index) => (segment.kind === "shot" ? (
            <Fragment key={`${r}-${index}`}>
              <span className="seg" data-row={r} data-index={index} data-part="full">{tm(segment.text)}</span>
              <span className="seg" data-row={r} data-index={index} data-part="short">{segment.label ?? tm(segment.text)}</span>
            </Fragment>
          ) : <span key={`${r}-${index}`} className="seg dash" data-row={r} data-index={index} data-part="tail">{tm(segment.text)}</span>)))}
        </div>
      </div>
    </div>
  );
}

export interface BannerFrameProps {
  /**
   * check: something the app computed (neutral grey; plan decision D4).
   * director: a Director note or recommendation (amber, the Director's colour only).
   */
  tone: "check" | "director";
  state: "open" | "settled";
  letter: string;
  eyebrow: string;
  title: string;
  sub?: ReactNode;
  /** The Now row, and the After row when there is a change to preview. */
  timeline?: { now: TimelineSegment[]; after?: TimelineSegment[] | null } | null;
  /** Under the timeline, e.g. the coat swatches of a Director note. */
  extra?: ReactNode;
  /** The stacked options: the chosen one white (`pill chosen`), an alternative outlined, a ghost last. */
  actions: ReactNode;
  /** data-check or data-note value, for tests and the card callouts. */
  anchor: { attribute: "data-check" | "data-note"; value: string };
}

/**
 * The full-width banner above the stage. It shows one thing at a time with its stacked options; the
 * Keyframes view uses it for app checks, and the Director's notes can use it with tone "director".
 * Once settled it is only as tall as what it says.
 */
export function BannerFrame({ tone, state, letter, eyebrow, title, sub, timeline, extra, actions, anchor }: BannerFrameProps) {
  const attributes = { [anchor.attribute]: anchor.value };
  return (
    <section className={`banner${tone === "check" ? " check" : ""}${state === "settled" ? " done" : ""}`} aria-label={eyebrow} data-state={state} {...attributes}>
      <div className="banner-main">
        <div className="eyebrow"><span className="letter">{letter}</span>{eyebrow}</div>
        <h2><Units text={title} /></h2>
        {sub ? <div className="sub">{typeof sub === "string" ? <Units text={sub} /> : sub}</div> : null}
        {timeline ? <Strip now={timeline.now} after={timeline.after ?? null} /> : null}
        {extra}
      </div>
      <div className="banner-actions">{actions}</div>
    </section>
  );
}
