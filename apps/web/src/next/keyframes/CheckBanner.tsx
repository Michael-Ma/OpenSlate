import type { GenerationOverview } from "@openslate/core/public";
import { useI18n } from "../i18n/I18n.tsx";
import { checkActions, checkBody, checkTimeline, checkTitle, settledTimeline, type AppCheck } from "../model/checks.ts";
import { filmMeta, seconds } from "../model/keyframes.ts";
import { clock } from "../model/motion.ts";
import type { Msg } from "../model/types.ts";
import { BannerFrame } from "./BannerFrame.tsx";
import { useGuarded } from "../app/useWriteGuard.ts";

/** A check the person just settled from the banner; shown until they move on, with Undo while it is allowed. */
export interface SettledCheck {
  /** extended: the shot was lengthened; cut: the line is cut at the shot's end; edited: a new line was written. */
  kind: "extended" | "cut" | "edited";
  sceneId: string;
  shotId: string;
  label: string;
  letter: string;
  /** edited: the estimated length of the new line; cut: the seconds of the line that will not be heard. */
  seconds: number;
  shotSeconds: number;
  hadClip: boolean;
  /** edited: the saved line, so the view can tell when it was undone elsewhere. */
  text?: string;
  commandId: string | null;
  /** The overview cursor when it was settled; only later overviews can contradict it. */
  cursor: number;
}

interface Props {
  overview: GenerationOverview;
  sceneId: string;
  checks: { letter: string; check: AppCheck }[];
  settled: SettledCheck | null;
  busy: boolean;
  /** The quiet line when nothing is left to check (e.g. "Every Director note in this scene is settled."). */
  quiet?: Msg | null;
  onExtend(check: AppCheck): void;
  onKeep(check: AppCheck): void;
  onEditNarration(check: AppCheck): void;
  onNext(): void;
  onUndo(commandId: string): void;
}

/**
 * App-computed checks (plan decision D4), one at a time. Drawn neutral, never in the Director's amber:
 * the app found these, the Director did not recommend them. Each option is one free, undoable command, so each
 * follows the shell's server guard (off while offline or expired, with the reason).
 */
export function CheckBanner({ overview, sceneId, checks, settled, busy, quiet, onExtend, onKeep, onEditNarration, onNext, onUndo }: Props) {
  const { t, tm } = useI18n();
  const server = useGuarded("server");

  if (settled && settled.sceneId === sceneId) {
    const shot = overview.shots[settled.shotId];
    // The shot's length as the server settled it, once the overview has caught up.
    const shotSeconds = shot ? seconds(shot.durationFrames, overview.fps) : settled.shotSeconds;
    const title = settled.kind === "extended" ? t("check.done.extended.title", { label: settled.label, seconds: shotSeconds })
      : settled.kind === "cut" ? t("check.done.cut.title", { label: settled.label, seconds: shotSeconds })
      : t("check.done.edited.title", { label: settled.label, seconds: settled.seconds, shot: settled.shotSeconds });
    const sub = settled.kind === "extended"
      ? `${t("check.done.film", { seconds: filmMeta(overview).seconds })} ${t(settled.hadClip ? "check.done.clip" : "check.done.free")}`
      : settled.kind === "cut" ? t("check.done.cut.sub", { seconds: settled.seconds })
      : t("check.done.edited.sub");
    return (
      <BannerFrame
        tone="check"
        state="settled"
        letter={settled.letter}
        eyebrow={t("check.done.eyebrow")}
        title={title}
        sub={sub}
        timeline={settled.kind === "extended" ? { now: settledTimeline(settled.shotId, overview, clock) } : null}
        anchor={{ attribute: "data-check", value: settled.shotId }}
        actions={
          <>
            <button type="button" className="pill chosen" data-act="check-next" onClick={onNext}>{t(checks.length ? "check.done.next" : "check.done.done")}</button>
            {settled.commandId ? <button type="button" className="pill" data-act="undo" data-shot={settled.shotId} {...server} disabled={busy || server.disabled} onClick={() => onUndo(settled.commandId!)}>{t("check.undo")}</button> : null}
          </>
        }
      />
    );
  }

  const first = checks[0];
  if (!first) {
    return (
      <div className="quiet" role="status" data-check="none">
        <span className="ck" aria-hidden="true">✓</span>
        <span>{quiet ? tm(quiet) : t("check.all_handled")}</span>
      </div>
    );
  }

  const { check, letter } = first;
  const timeline = checkTimeline(check, overview);
  const actions = checkActions(check, overview.fps);
  return (
    <BannerFrame
      tone="check"
      state="open"
      letter={letter}
      eyebrow={checks.length > 1 ? `${t("check.eyebrow")} · ${t("check.of", { index: 1, total: checks.length })}` : t("check.eyebrow")}
      title={tm(checkTitle(check))}
      sub={tm(checkBody(check))}
      timeline={{ now: timeline.now, after: actions.extend ? timeline.after : null }}
      anchor={{ attribute: "data-check", value: check.shotId }}
      actions={
        <>
          {actions.extend ? (
            <button type="button" className="pill chosen" data-act="make-fit" data-shot={check.shotId} {...server} disabled={busy || server.disabled} onClick={() => onExtend(check)}>
              {tm(actions.extend.label)}
            </button>
          ) : null}
          <button type="button" className={`pill${actions.extend ? "" : " chosen"}`} data-act="keep-fit" data-shot={check.shotId} {...server} disabled={busy || server.disabled} onClick={() => onKeep(check)}>{tm(actions.keep.label)}</button>
          <button type="button" className="pill ghost" data-act="edit-narration" data-shot={check.shotId} {...server} onClick={() => onEditNarration(check)}>{tm(actions.edit.label)}</button>
        </>
      }
    />
  );
}
