import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { keepTogether } from "../i18n/typeset.ts";
import type { TimelineSegment } from "../model/checks.ts";

const PX_PER_SECOND = 15;

/** One row of the Now / After strip: shots are as wide as they are long (15 px a second); tails are dashed. */
export function Segments({ segments }: { segments: TimelineSegment[] }) {
  const { tm } = useI18n();
  return (
    <div className="segs">
      {segments.map((segment, index) =>
        segment.kind === "shot"
          ? <span key={index} className={`seg${segment.hot ? " hot" : ""}`} style={{ width: segment.seconds * PX_PER_SECOND }}>{tm(segment.text)}</span>
          : <span key={index} className="seg dash">{tm(segment.text)}</span>,
      )}
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
 */
export function BannerFrame({ tone, state, letter, eyebrow, title, sub, timeline, extra, actions, anchor }: BannerFrameProps) {
  const { t } = useI18n();
  const attributes = { [anchor.attribute]: anchor.value };
  return (
    <section className={`banner${tone === "check" ? " check" : ""}${state === "settled" ? " done" : ""}`} aria-label={eyebrow} data-state={state} {...attributes}>
      <div className="banner-main">
        <div className="eyebrow"><span className="letter">{letter}</span>{eyebrow}</div>
        {/* A Director note's title is its own words, not a catalog message, so it is kept together here ("6 s"). */}
        <h2>{keepTogether(title)}</h2>
        {sub ? <div className="sub">{sub}</div> : null}
        {timeline ? (
          <div className="tl" aria-label={t("check.timeline.label")}>
            <span className="k">{t("check.timeline.now")}</span>
            <Segments segments={timeline.now} />
            {timeline.after ? <><span className="k">{t("check.timeline.after")}</span><Segments segments={timeline.after} /></> : null}
          </div>
        ) : null}
        {extra}
      </div>
      <div className="banner-actions">{actions}</div>
    </section>
  );
}
