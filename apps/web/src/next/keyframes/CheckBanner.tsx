import type { GenerationOverview } from "@openslate/core/public";
import { useI18n } from "../i18n/I18n.tsx";
import { checkActions, checkTimeline, checkTitle, settledTimeline, type AppCheck, type TimelineSegment } from "../model/checks.ts";
import { filmMeta } from "../model/keyframes.ts";
import { clock } from "../model/motion.ts";

/** A check the person just settled from the banner; shown until they move on, with Undo while it is allowed. */
export interface SettledCheck {
  kind: "extended" | "edited";
  sceneId: string;
  shotId: string;
  label: string;
  letter: string;
  /** extended: the new shot length; edited: the estimated length of the new line. */
  seconds: number;
  shotSeconds: number;
  hadClip: boolean;
  commandId: string | null;
}

const PX_PER_SECOND = 15;

function Segments({ segments }: { segments: TimelineSegment[] }) {
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

interface Props {
  overview: GenerationOverview;
  sceneId: string;
  checks: { letter: string; check: AppCheck }[];
  settled: SettledCheck | null;
  busy: boolean;
  onExtend(check: AppCheck): void;
  onEditNarration(check: AppCheck): void;
  onNext(): void;
  onUndo(commandId: string): void;
}

/**
 * App-computed checks (plan decision D4), one at a time. Drawn neutral, never in the Director's amber:
 * the app found these, the Director did not recommend them.
 */
export function CheckBanner({ overview, sceneId, checks, settled, busy, onExtend, onEditNarration, onNext, onUndo }: Props) {
  const { t, tm } = useI18n();

  if (settled && settled.sceneId === sceneId) {
    const title = settled.kind === "extended"
      ? t("check.done.extended.title", { label: settled.label, seconds: settled.seconds })
      : t("check.done.edited.title", { label: settled.label, seconds: settled.seconds, shot: settled.shotSeconds });
    const sub = settled.kind === "extended"
      ? `${t("check.done.film", { seconds: filmMeta(overview).seconds })} ${t(settled.hadClip ? "check.done.clip" : "check.done.free")}`
      : t("check.done.edited.sub");
    return (
      <section className="banner check done" aria-label={t("check.label")} data-check={settled.shotId} data-state="settled">
        <div className="banner-main">
          <div className="eyebrow"><span className="letter">{settled.letter}</span>{t("check.done.eyebrow")}</div>
          <h2>{title}</h2>
          <div className="sub">{sub}</div>
          {settled.kind === "extended" ? (
            <div className="tl" aria-label={t("check.timeline.label")}>
              <span className="k">{t("check.timeline.now")}</span>
              <Segments segments={settledTimeline(settled.shotId, overview, clock)} />
            </div>
          ) : null}
        </div>
        <div className="banner-actions">
          <button type="button" className="pill chosen" data-act="check-next" onClick={onNext}>{t(checks.length ? "check.done.next" : "check.done.done")}</button>
          {settled.commandId ? <button type="button" className="pill" data-act="undo" data-shot={settled.shotId} disabled={busy} onClick={() => onUndo(settled.commandId!)}>{t("check.undo")}</button> : null}
        </div>
      </section>
    );
  }

  const first = checks[0];
  if (!first) {
    return (
      <div className="quiet" role="status" data-check="none">
        <span className="ck" aria-hidden="true">✓</span>
        <span>{t("check.all_handled")}</span>
      </div>
    );
  }

  const { check, letter } = first;
  const timeline = checkTimeline(check, overview);
  const actions = checkActions(check, overview.fps);
  const keepWhy = `keep-why-${check.shotId}`;
  return (
    <section className="banner check" aria-label={t("check.label")} data-check={check.shotId} data-state="open">
      <div className="banner-main">
        <div className="eyebrow">
          <span className="letter">{letter}</span>
          {t("check.eyebrow")}
          {checks.length > 1 ? <span className="of">{t("check.of", { index: 1, total: checks.length })}</span> : null}
        </div>
        <h2>{tm(checkTitle(check))}</h2>
        <div className="sub">{t("check.narration.body", { label: check.label })}</div>
        <div className="tl" aria-label={t("check.timeline.label")}>
          <span className="k">{t("check.timeline.now")}</span>
          <Segments segments={timeline.now} />
          {actions.extend ? <><span className="k">{t("check.timeline.after")}</span><Segments segments={timeline.after} /></> : null}
        </div>
      </div>
      <div className="banner-actions">
        {actions.extend ? (
          <button type="button" className="pill chosen" data-act="make-fit" data-shot={check.shotId} disabled={busy} onClick={() => onExtend(check)}>
            {tm(actions.extend.label)}
          </button>
        ) : null}
        <button type="button" className="pill" data-act="keep-fit" data-shot={check.shotId} disabled aria-describedby={keepWhy}>{tm(actions.keep.label)}</button>
        <span className="why" id={keepWhy}>{tm(actions.keep.reason)}</span>
        <button type="button" className={`pill ${actions.extend ? "ghost" : "chosen"}`} data-act="edit-narration" data-shot={check.shotId} onClick={() => onEditNarration(check)}>{tm(actions.edit.label)}</button>
      </div>
    </section>
  );
}
