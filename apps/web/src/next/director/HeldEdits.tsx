import { useId } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { labelList, type HeldEdit } from "../model/director.ts";
import { msg } from "../model/types.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { useGuarded } from "../app/useWriteGuard.ts";

/**
 * An unfinished Director edit that holds shots (overview waiting `edit_pending`, card B13), in the thread with a
 * short explanation and "Let it go" (POST .../requests/:requestId/release-holds, no body, an Idempotency-Key).
 * Neutral, not amber: this is the studio's fact about the film, not the Director's recommendation. While the
 * Director still works on that edit the server refuses, so the button is off and says to wait or Stop first.
 */
export function HeldEdits({ held }: { held: HeldEdit }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const pressId = `release-holds:${held.requestId}`;
  const pending = useStudio((s) => !!s.pending[pressId]);
  const guard = useGuarded("server");
  const reasonId = useId();
  const shots = labelList(held.labels, locale);
  const off = guard.disabled || !!held.blocked || pending;

  const release = () => {
    if (off) return;
    void store.command(pressId, { requestId: held.requestId }, () => ({ path: `/requests/${encodeURIComponent(held.requestId)}/release-holds`, body: undefined }), msg("director.held.released", { shots }));
  };

  return (
    <section className="dir-held" aria-labelledby={`${reasonId}-title`} data-entry="held" data-request={held.requestId}>
      <b id={`${reasonId}-title`}>{t("director.held.title", { shots })}</b>
      <p>{t("director.held.body")}</p>
      <div className="row">
        {held.blocked && <span className="why" id={reasonId}>{tm(held.blocked)}</span>}
        <button type="button" className="pill sm" data-act="release-holds" {...guard} disabled={off} aria-busy={pending || undefined} aria-describedby={held.blocked ? reasonId : undefined} onClick={release}>
          {t("director.held.release")}
        </button>
      </div>
    </section>
  );
}
