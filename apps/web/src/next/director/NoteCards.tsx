import { useI18n } from "../i18n/I18n.tsx";
import type { NoteOpen, ThreadNote } from "../model/director.ts";
import { useOpenTarget } from "./useOpenTarget.ts";

/**
 * The Director's lettered notes under the reply that wrote them (DC-18): an amber card per open note,
 * neutral once settled (a green "✓ …" line; a plain line while a regenerate it chose is still being made) or out of date. The only action here is Open: the note's
 * choices live in the banner, so they are never offered twice. Open acts in the current view when it shows
 * shots (Plan scrolls to the row, Film selects and seeks, Assets scrolls to the shot's set, Keyframes selects
 * the card); from Settings and Start it goes to Keyframes (P5-DESIGN shell item 9).
 */
export function NoteCards({ notes }: { notes: ThreadNote[] }) {
  const { t, tm } = useI18n();
  const openTarget = useOpenTarget();
  if (!notes.length) return null;

  // On narrow screens the Director is a drawer over the workspace: opening gets out of the way (the shell returns focus).
  const open = (target: NoteOpen) => openTarget({ kind: target.kind, id: target.id });

  return (
    <div className="notes">
      {notes.map(({ view, tone, opens }) => (
        <article key={view.noteId} className={`note${tone === "open" ? "" : " done"}`} data-note={view.letter} data-state={view.state} data-tone={tone}>
          <span className="letter" aria-hidden="true">{view.letter}</span>
          <span className="sr">{t("note.thread.label", { letter: view.letter })}</span>
          <div className="note-text">{view.text}</div>
          {opens.length > 0 && (
            <div className="row">
              {opens.map((target) => (
                <button type="button" key={`${target.kind}:${target.id}`} className="pill sm" data-act="note-open" data-target={`${target.kind}:${target.id}`} onClick={() => open(target)}>
                  {tm(target.label)}
                </button>
              ))}
            </div>
          )}
          {view.settled && <span className="handled">{tone === "done" ? "✓ " : ""}{tm(view.settled)}</span>}
        </article>
      ))}
    </div>
  );
}
