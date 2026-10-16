import { useEffect, useId, useRef } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { chipParts } from "../model/chip-fit.ts";
import { checkCallout } from "../model/checks.ts";
import type { ShotCard } from "../model/keyframes.ts";
import { revealScroll } from "../model/keyframes-layout.ts";
import type { Label, NoteCallout } from "../model/note-banner.ts";
import type { Msg } from "../model/types.ts";
import { Picture, StatusPill } from "./parts.tsx";
import { useChipFit } from "./useChipFit.ts";
import { useGuarded } from "../app/useWriteGuard.ts";

/** Columns the wide layout shows at once; more cards scroll inside the row, fewer leave a dashed placeholder. */
const VISIBLE = 3;

/**
 * A chip's words on one line, as many as its room holds (useChipFit): all of them, the first ones up to a word and
 * "…" before the last word ("Mara's coat… maroon"), the last word alone, or none. Screen readers get the chip's text
 * whole.
 */
function ChipWords({ text }: { text: string }) {
  const { head, tail, cuts } = chipParts(text);
  return (
    <span className="anno-words" aria-hidden="true">
      <span className="anno-head" data-cuts={cuts.join(",")}>{head}</span>
      {tail ? <span className="anno-tail">{tail}</span> : null}
    </span>
  );
}

/**
 * One card per shot: picture (or the dashed prompt), badge, prompt over the picture, title and seconds,
 * status pill and motion. Checks attach as neutral chips. Work in progress shows an indeterminate bar
 * (plan item GR-17: providers report no percentage). The footer never grows: the title and the pills end with "…",
 * and the card's tooltip and description carry the full title and notes.
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
  const idBase = useId();

  // Each chip shows what its room holds; it fits again when the words change (a settled note, the language).
  const chipWords = cards.map((card) => [
    card.shotId,
    ...(notes[card.shotId] ?? []).map((note) => `${note.noteId}:${note.done && note.doneLabel ? label(note.doneLabel) : note.text}`),
    ...card.callouts.map(({ check }) => tm(checkCallout(check))),
  ].join("|")).join("/");
  useChipFit(row, chipWords);

  // Keep the selected card in view when the row scrolls sideways (many shots, or the narrow layout).
  // Only the row scrolls; the page never moves.
  useEffect(() => {
    const container = row.current;
    const element = selectedId ? container?.querySelector<HTMLElement>(`[data-card="${CSS.escape(selectedId)}"]`) : null;
    if (!container || !element || container.scrollWidth <= container.clientWidth) return;
    container.scrollLeft = revealScroll(container.scrollLeft, container.getBoundingClientRect(), element.getBoundingClientRect());
  }, [selectedId]);

  return (
    <div className={`cards${cards.length > VISIBLE ? " scrolls" : ""}`} ref={row} role="list" aria-label={t("cards.label", { scene: sceneOrdinal })} data-count={cards.length}>
      {cards.map((card) => {
        const motion = card.motion ? card.motion.charAt(0).toLocaleLowerCase(locale) + card.motion.slice(1) : "";
        // A clip, or the voice line the scene's confirm is making for this shot: a bar over the picture.
        const bar = card.workingOn === "video" || card.workingOn === "voice";
        const cardNotes = notes[card.shotId] ?? [];
        const title = `${card.label} ${card.framing}`;
        const state = [tm(card.status), motion].filter(Boolean).join(" · ");
        const reason = card.statusReason ? tm(card.statusReason) : "";
        // An open inspector edit holds every other card, its note link included, until Save or Cancel.
        const isHeld = !!held && !card.selected;
        // The footer and the chips show one line each; the card's tooltip carries them whole, and its description
        // each note in full.
        const describedBy = cardNotes.length ? `${idBase}-${card.shotId}-notes` : undefined;
        const fullNotes = cardNotes.map((note) => `${note.letter} · ${note.full}`).join("\n");
        return (
          <article key={card.shotId} className={`card${card.selected ? " sel" : ""}${isHeld ? " held" : ""}`} role="listitem" data-card={card.shotId} data-tone={card.tone}>
            <button
              type="button"
              className="hit"
              data-act="open-shot"
              data-shot={card.shotId}
              aria-pressed={card.selected}
              aria-label={t("card.select", { shot: card.label, framing: card.framing })}
              aria-describedby={describedBy}
              disabled={isHeld}
              title={held && isHeld ? tm(held) : [title, state, reason, fullNotes].filter(Boolean).join("\n")}
              onClick={() => onOpen(card.shotId)}
            />
            {describedBy ? <span id={describedBy} hidden>{fullNotes}</span> : null}
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
              {/* The badge and the chips share one row at the picture's top: the chips start after the badge. */}
              <div className="pic-head">
                <span className="badge">{card.label}</span>
                {cardNotes.length || card.callouts.length ? (
                  <div className="callout">
                    {cardNotes.map((note) => {
                      const settled = note.done && note.doneLabel ? label(note.doneLabel) : null;
                      return (
                        <span key={note.noteId} className="callout-note">
                          {/* Settled, the chip keeps its letter and check even where none of its words fit. */}
                          <span className={`anno${note.done ? " done" : ""}`} data-note={note.noteId} data-state={note.done ? "settled" : "open"}>
                            <span className="letter">{note.letter}</span>
                            <span className="sr-only">{settled !== null ? t("note.callout.done", { choice: settled }) : note.text}</span>
                            {settled !== null ? <span className="anno-check" aria-hidden="true">✓</span> : null}
                            <ChipWords text={settled ?? note.text} />
                          </span>
                          {note.regenerate ? (
                            <button
                              type="button"
                              className="link"
                              data-act="note-regenerate"
                              data-note={note.noteId}
                              data-shot={card.shotId}
                              {...run}
                              title={held && isHeld ? tm(held) : run.title ?? (note.regenerate.wait ? tm(note.regenerate.wait) : label(note.regenerate.label))}
                              disabled={isHeld || busy || run.disabled || !note.regenerate.enabled}
                              onClick={() => onNoteChoice(note.noteId, note.regenerate!.choiceIndex)}
                            >
                              {/* One line with its price where the card has room; on a narrow card the price wraps under it. */}
                              <span className="link-words">{tm(note.regenerate.take)} ·</span>{" "}
                              <span className="link-price">{note.regenerate.price ? tm(note.regenerate.price) : null}</span>
                              <span className="sr-only"> · {note.regenerate.shots}</span>
                            </button>
                          ) : null}
                        </span>
                      );
                    })}
                    {card.callouts.map(({ letter, check }) => (
                      <span key={check.shotId} className="anno check" data-check={check.shotId}>
                        <span className="letter">{letter}</span>
                        <span className="sr-only">{tm(checkCallout(check))}</span>
                        <ChipWords text={tm(checkCallout(check))} />
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
              {bar ? <div className="vprog indeterminate" role="progressbar" aria-label={t("card.progress", { shot: card.label })} data-working={card.workingOn ?? undefined}><i /></div> : null}
            </div>
            <div className="ttl"><b>{title}</b><span>{t("card.seconds", { seconds: card.seconds })}</span></div>
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
