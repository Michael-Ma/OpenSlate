import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { checkCallout } from "../model/checks.ts";
import type { ShotCard } from "../model/keyframes.ts";
import type { Label, NoteCallout } from "../model/note-banner.ts";
import type { Msg } from "../model/types.ts";
import { Picture, StatusPill } from "./parts.tsx";
import { useGuarded } from "../app/useWriteGuard.ts";

/** Columns the wide layout shows at once; more cards scroll inside the row, fewer leave a dashed placeholder. */
const VISIBLE = 3;

/**
 * One card per shot: picture (or the dashed prompt), badge, prompt over the picture, title and seconds,
 * status pill and motion. Checks attach as neutral chips. Work in progress shows an indeterminate bar
 * (plan item GR-17: providers report no percentage).
 */
interface Props {
  cards: ShotCard[];
  /** The Director's notes on each shot (amber chips), by shot id. */
  notes: Record<string, NoteCallout[]>;
  sceneOrdinal: number;
  busy: boolean;
  /** An inspector draft keeps the selected card until it is saved or cancelled. */
  held: Msg | null;
  onOpen(shotId: string): void;
  onNoteChoice(noteId: string, choiceIndex: number): void;
}

export function ShotCards({ cards, notes, sceneOrdinal, busy, held, onOpen, onNoteChoice }: Props) {
  const { t, tm, locale } = useI18n();
  const label = (value: Label) => ("text" in value ? value.text : tm(value));
  const row = useRef<HTMLDivElement>(null);
  // A note's regenerate link is a paid make: off while offline, expired or stopped, with the reason.
  const run = useGuarded("run");
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
        // A clip, or the voice line the scene's confirm is making for this shot: a bar over the picture.
        const bar = card.workingOn === "video" || card.workingOn === "voice";
        return (
          <article key={card.shotId} className={`card${card.selected ? " sel" : ""}`} role="listitem" data-card={card.shotId} data-tone={card.tone}>
            <button
              type="button"
              className="hit"
              data-act="open-shot"
              data-shot={card.shotId}
              aria-pressed={card.selected}
              aria-label={t("card.select", { shot: card.label, framing: card.framing })}
              disabled={!!held && !card.selected}
              title={held && !card.selected ? tm(held) : undefined}
              onClick={() => onOpen(card.shotId)}
            />
            <div className={`pic${card.pictureDimmed ? " dim" : ""}${bar ? " vp" : ""}`}>
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
              {bar ? <div className="vprog indeterminate" role="progressbar" aria-label={t("card.progress", { shot: card.label })} data-working={card.workingOn ?? undefined}><i /></div> : null}
            </div>
            {notes[card.shotId]?.length || card.callouts.length ? (
              <div className="callout">
                {(notes[card.shotId] ?? []).map((note) => (
                  <span key={note.noteId} className="callout-note">
                    <span className={`anno${note.done ? " done" : ""}`} data-note={note.noteId} data-state={note.done ? "settled" : "open"}>
                      <span className="letter">{note.letter}</span>
                      <span className="anno-text">{note.done && note.doneLabel ? t("note.callout.done", { choice: label(note.doneLabel) }) : note.text}</span>
                    </span>
                    {note.regenerate ? (
                      <button type="button" className="link" data-act="note-regenerate" data-note={note.noteId} data-shot={card.shotId} {...run} title={run.title ?? label(note.regenerate.label)} disabled={busy || run.disabled || !note.regenerate.enabled} onClick={() => onNoteChoice(note.noteId, note.regenerate!.choiceIndex)}>
                        {/* One line with its price where the card has room; on a narrow card the price wraps under it. */}
                        <span className="link-words">{tm(note.regenerate.take)} ·</span>{" "}
                        <span className="link-price">{note.regenerate.price ? tm(note.regenerate.price) : null}</span>
                        <span className="sr-only"> · {note.regenerate.shots}</span>
                      </button>
                    ) : null}
                  </span>
                ))}
                {card.callouts.map(({ letter, check }) => (
                  <span key={check.shotId} className="anno check" data-check={check.shotId}>
                    <span className="letter">{letter}</span>
                    <span className="anno-text">{tm(checkCallout(check))}</span>
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
