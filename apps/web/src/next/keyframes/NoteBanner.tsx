import { useI18n } from "../i18n/I18n.tsx";
import type { Label, NoteBannerAction, NoteBannerView } from "../model/note-banner.ts";
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
  const guardOf = (action: NoteBannerAction) => (action.action.kind === "regenerate" ? run : action.action.kind === "reply" ? null : server);
  const label = (value: Label) => ("text" in value ? value.text : tm(value));
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
