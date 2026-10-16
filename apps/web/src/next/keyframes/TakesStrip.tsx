import type { ShotOverview, ShotTakes, UseTakeReceipt } from "@openslate/core/public";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { useGuarded } from "../app/useWriteGuard.ts";
import { useI18n } from "../i18n/I18n.tsx";
import { artifactKey } from "../media/artifact-cache.ts";
import { takesPath, takesStrip, takeUsedToast, useTakeCommand, type TakeItem } from "../model/keyframes-takes.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { useResource } from "../store/useResource.ts";
import { Picture } from "./parts.tsx";

/**
 * Every keyframe this shot ever had, newest first (card B8), in place of the inspector's rows. The take in use is
 * marked; each earlier one has "Use this take" (free; it outdates the clip, which the note says before pressing).
 * The toast after a switch offers Undo with the studio's storyboard command. Esc or Close goes back to the rows.
 */
export function TakesStrip({ shot, onClose }: { shot: ShotOverview; onClose(): void }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const overview = useStudio((s) => s.overview);
  const pending = useStudio((s) => !!s.pending[`take:${shot.shotId}`]);
  const server = useGuarded("server");
  const takes = useResource<ShotTakes>(takesPath(shot.shotId));
  const heading = useRef<HTMLHeadingElement>(null);
  const titleId = `takes-title-${shot.shotId}`;

  // The strip takes focus when it opens, so a keyboard user lands on it (Esc goes back).
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);

  const view = useMemo(
    () => (takes.data && takes.data.shotId === shot.shotId && overview ? takesStrip(takes.data, overview, shot, new Date(), locale) : null),
    [takes.data, overview, shot, locale],
  );

  const use = async (item: TakeItem) => {
    const command = useTakeCommand(shot.shotId, item.artifact.artifactId);
    const receipt = await store.command<UseTakeReceipt>(command.pressId, command.logical, () => ({ path: command.path, body: command.body }));
    if (!receipt) return;
    const toast = takeUsedToast(shot, item, receipt);
    store.dispatch({ type: "toast", message: toast.message, tone: "info", undoCommandId: toast.undoCommandId });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <section className="takes" aria-labelledby={titleId} data-shot={shot.shotId} onKeyDown={onKeyDown}>
      <div className="takes-head">
        <h4 id={titleId} ref={heading} tabIndex={-1}>{t("takes.title", { shot: shot.label })}</h4>
        <button type="button" className="pill sm" data-act="takes-close" onClick={onClose}>{t("inspector.close")}</button>
      </div>
      {view ? <p className="insp-note left" data-act="takes-impact">{tm(view.impact)}</p> : null}
      {view?.blocked ? <p className="insp-note left" role="status">{tm(view.blocked)}</p> : null}
      {!view && takes.error ? (
        <div className="insp-alert" role="alert">
          <p>{t("takes.failed", { code: takes.error })}</p>
          <button type="button" className="pill sm" data-act="takes-retry" onClick={takes.reload}>{t("takes.retry")}</button>
        </div>
      ) : !view ? (
        <p className="stale" role="status">{t("takes.loading")}</p>
      ) : (
        <ul className="takes-list" aria-label={t("takes.list_label", { shot: shot.label })}>
          {view.items.map((item) => (
            <li key={artifactKey(item.artifact)} className={`take${item.current ? " current" : ""}`} data-take={item.take} data-current={item.current ? "true" : "false"}>
              <div className="take-pic"><Picture artifact={item.artifact} alt={`${shot.label} · ${tm(item.label)}`} /></div>
              <div className="take-meta">
                <b>{tm(item.label)}</b>
                {item.made ? <span>{tm(item.made)}</span> : null}
              </div>
              {item.current ? (
                <span className="status ok"><span aria-hidden="true">✓</span>{t("takes.current")}</span>
              ) : (
                <button
                  type="button"
                  className="pill sm"
                  data-act="use-take"
                  data-take={item.take}
                  data-artifact={item.artifact.artifactId}
                  {...server}
                  disabled={pending || !!view.blocked || server.disabled}
                  aria-label={t("takes.use_label", { take: item.take, shot: shot.label })}
                  onClick={() => void use(item)}
                >
                  {t(pending ? "takes.using" : "takes.use")}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
