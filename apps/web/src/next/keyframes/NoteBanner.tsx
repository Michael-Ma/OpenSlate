import { useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { Label, NoteBannerAction, NoteBannerView, ProposalChangeRow } from "../model/note-banner.ts";
import { BannerFrame } from "./BannerFrame.tsx";
import { useGuarded } from "../app/useWriteGuard.ts";

interface Props {
  view: NoteBannerView;
  busy: boolean;
  nextLetter: string | null;
  canUndo: boolean;
  onChoose(action: NoteBannerAction): void;
  onNext(): void;
  onUndo(): void;
}

/**
 * The Director's note in amber, as the design's DIRECTOR RECOMMENDS banner: the note's letter and text, where it
 * applies, the Now / After strip of a held proposal, and the choices in the Director's order (the recommended one
 * white). Once settled it says how, with Next and, where the change can be reverted, Undo.
 * A regenerate choice is a paid make and follows the shell's run guard; other choices and Undo write and follow
 * its server guard; a reply only points the composer.
 */
export function NoteBanner({ view, busy, nextLetter, canUndo, onChoose, onNext, onUndo }: Props) {
  const { t, tm } = useI18n();
  const server = useGuarded("server");
  const run = useGuarded("run");
  const guardOf = (action: NoteBannerAction) => (action.action.kind === "regenerate" || action.action.kind === "confirm_video" ? run : action.action.kind === "reply" ? null : server);
  const label = (value: Label) => ("text" in value ? value.text : tm(value));
  // Why a choice is off (a video confirm with frames still to make, or a scene already saved), under the choices' text.
  const reasons = view.state === "open" ? view.actions.flatMap((action) => (action.reason && !action.enabled ? [action.reason] : [])) : [];
  const style = (action: NoteBannerAction) => (action.style === "chosen" ? "pill chosen" : action.style === "ghost" ? "pill ghost" : "pill");
  return (
    <BannerFrame
      tone="director"
      state={view.state}
      letter={view.letter}
      eyebrow={tm(view.eyebrow)}
      title={view.title}
      sub={view.sub.map(tm).join(" · ")}
      timeline={view.timeline}
      extra={view.changes.length || reasons.length ? (
        <>
          {view.changes.length ? <Changes rows={view.changes} label={label} /> : null}
          {reasons.map((reason, index) => <p key={index} className="note-why" data-why="confirm_video">{tm(reason)}</p>)}
        </>
      ) : null}
      anchor={{ attribute: "data-note", value: view.noteId }}
      actions={view.state === "open" ? (
        view.actions.map((action, index) => {
          const guard = guardOf(action);
          return (
          <button
            key={index}
            type="button"
            className={style(action)}
            data-act="note-choice"
            data-note={view.noteId}
            data-kind={action.action.kind}
            data-choice={index}
            {...(guard ?? {})}
            disabled={!action.enabled || busy || !!guard?.disabled}
            onClick={() => onChoose(action)}
          >
            {label(action.label)}{action.price ? ` · ${tm(action.price)}` : ""}
          </button>
          );
        })
      ) : (
        <>
          <button type="button" className="pill chosen" data-act="note-next" data-note={view.noteId} onClick={onNext}>
            {nextLetter ? t("note.next", { letter: nextLetter }) : t("note.done")}
          </button>
          {canUndo ? <button type="button" className="pill" data-act="undo" data-note={view.noteId} {...server} disabled={busy || server.disabled} onClick={onUndo}>{t("note.undo")}</button> : null}
        </>
      )}
    />
  );
}

/** Closed, the banner names this many changes inline; the rest wait behind "Show all N changes". */
const INLINE_CHANGES = 2;
/** Not inline while closed: a length is drawn by the Now / After strip, and model prompts are long. */
const CLOSED_HIDDEN = new Set(["desiredFrames", "imagePrompt", "videoPrompt"]);

/**
 * Every field the proposal changes, Now → After, from the server's own preview: the person accepts exactly this.
 * Closed, the first direction changes read one line each and the button counts every change, rewritten model
 * prompts included, so the banner stays short; opened, every value is whole. A cut value stays whole in the page
 * for screen readers and in its tooltip.
 */
export function Changes({ rows, label }: { rows: ProposalChangeRow[]; label: (value: Label) => string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const inline = rows.filter((row) => !CLOSED_HIDDEN.has(row.field)).slice(0, INLINE_CHANGES);
  const shown = open ? rows : inline;
  const hidden = rows.filter((row) => !inline.includes(row));
  const unseen = hidden.some((row) => row.field !== "desiredFrames");
  const more = unseen || inline.some((row) => row.stacked);
  // A lone length is the strip itself: nothing to add under it.
  if (!shown.length && !more) return null;
  return (
    <div className={`chg-wrap${open ? " open" : ""}`}>
      {shown.length ? (
        <dl className="chg" aria-label={t("note.change.label")}>
          {shown.map((row, index) => {
            const before = label(row.before), after = label(row.after);
            return (
              <div key={index} className={`chg-row${open && row.stacked ? " stacked" : ""}`} data-chg={index}>
                <dt>{row.key.map(label).join(" · ")}</dt>
                <dd title={`${before} → ${after}`}>
                  <span className="chg-was"><span className="sr-only">{t("note.change.before")}: </span>{before}</span>
                  <span className="chg-arrow" aria-hidden="true">→</span>
                  <span className="chg-now"><span className="sr-only">{t("note.change.after")}: </span>{after}</span>
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      {more ? (
        <button type="button" className="chg-more" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {open ? t("note.change.less") : unseen ? t("note.change.all", { count: rows.length }) : t("note.change.more")}
        </button>
      ) : null}
    </div>
  );
}
