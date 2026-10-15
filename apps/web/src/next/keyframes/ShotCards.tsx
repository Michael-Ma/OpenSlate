import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { checkCallout } from "../model/checks.ts";
import type { ShotCard } from "../model/keyframes.ts";
import { Picture, StatusPill } from "./parts.tsx";

/** Columns the wide layout shows at once; more cards scroll inside the row, fewer leave a dashed placeholder. */
const VISIBLE = 3;

/**
 * One card per shot: picture (or the dashed prompt), badge, prompt over the picture, title and seconds,
 * status pill and motion. Checks attach as neutral chips. Work in progress shows an indeterminate bar
 * (plan item GR-17: providers report no percentage).
 */
export function ShotCards({ cards, sceneOrdinal, onOpen }: { cards: ShotCard[]; sceneOrdinal: number; onOpen(shotId: string): void }) {
  const { t, tm, locale } = useI18n();
  const row = useRef<HTMLDivElement>(null);
  const selectedId = cards.find((card) => card.selected)?.shotId;

  // Keep the selected card in view when the row scrolls sideways (many shots, or the narrow layout).
  // Only the row scrolls; the page never moves.
  useEffect(() => {
    const container = row.current;
    const element = selectedId ? container?.querySelector<HTMLElement>(`[data-card="${CSS.escape(selectedId)}"]`) : null;
    if (!container || !element || container.scrollWidth <= container.clientWidth) return;
    const outer = container.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    if (inner.left < outer.left) container.scrollLeft -= outer.left - inner.left + 8;
    else if (inner.right > outer.right) container.scrollLeft += inner.right - outer.right + 8;
  }, [selectedId]);

  return (
    <div className={`cards${cards.length > VISIBLE ? " scrolls" : ""}`} ref={row} role="list" aria-label={t("cards.label", { scene: sceneOrdinal })} data-count={cards.length}>
      {cards.map((card) => {
        const motion = card.motion ? card.motion.charAt(0).toLocaleLowerCase(locale) + card.motion.slice(1) : "";
        return (
          <article key={card.shotId} className={`card${card.selected ? " sel" : ""}`} role="listitem" data-card={card.shotId} data-tone={card.tone}>
            <button
              type="button"
              className="hit"
              data-act="open-shot"
              data-shot={card.shotId}
              aria-pressed={card.selected}
              aria-label={t("card.select", { shot: card.label, framing: card.framing })}
              onClick={() => onOpen(card.shotId)}
            />
            <div className={`pic${card.pictureDimmed ? " dim" : ""}${card.workingOn === "video" ? " vp" : ""}`}>
              {card.picture ? (
                <>
                  <Picture artifact={card.picture} alt="" />
                  <span className="ptxt">{card.prompt}</span>
                </>
              ) : card.workingOn !== "keyframe" ? <div className="dashed-frame">{card.prompt}</div> : null}
              {card.workingOn === "keyframe" ? (
                <div className={`making${card.picture ? " over" : ""}`}>
                  <div>{t("card.making")}<div className="bar indeterminate"><i /></div></div>
                </div>
              ) : null}
              <span className="badge">{card.label}</span>
              {card.workingOn === "video" ? <div className="vprog indeterminate" role="progressbar" aria-label={t("card.progress", { shot: card.label })}><i /></div> : null}
            </div>
            {card.callouts.length ? (
              <div className="callout">
                {card.callouts.map(({ letter, check }) => (
                  <span key={letter} className="anno check" data-check={check.shotId}>
                    <span className="letter">{letter}</span>
                    {tm(checkCallout(check))}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="ttl"><b>{card.label} {card.framing}</b><span>{t("card.seconds", { seconds: card.seconds })}</span></div>
            <div className="stl"><StatusPill status={card.status} tone={card.tone} /><span>{motion}</span></div>
          </article>
        );
      })}
      {cards.length < VISIBLE ? (
        <div className="card empty" aria-hidden="true" style={{ gridColumn: `span ${VISIBLE - cards.length}` }}>{t(cards.length ? "card.empty" : "kf.empty_scene")}</div>
      ) : null}
    </div>
  );
}
