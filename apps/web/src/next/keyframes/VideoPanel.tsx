import { useI18n } from "../i18n/I18n.tsx";
import type { VideoPanel as Panel } from "../model/keyframes.ts";
import { useGuarded } from "../app/useWriteGuard.ts";

interface Props {
  panel: Panel;
  sceneId: string;
  pending: boolean;
  playing: boolean;
  /** The button's paid press lost its reply: pressing again resends the same request and never charges twice. */
  unconfirmed: boolean;
  onConfirm(): void;
  onMakeKeyframes(): void;
  onPlay(): void;
  /** A stopped confirm's next step in another view: the shot's line in Plan, or the narrator voice in Settings. */
  onEditInPlan(shotId: string): void;
  onOpenSettings(): void;
}

const ACT = { confirm: "confirm-video", make_keyframes: "make-keyframes", play: "play-scene" } as const;

/**
 * SCENE n VIDEO: opened-frame segments, the count, the note and the one primary button.
 * The enabled button carries its price with the breakdown under it; a disabled one says what is missing.
 * Confirming and making keyframes start paid work, so they follow the shell's run guard (offline, expired,
 * stopped); playing the scene needs nothing.
 */
export function VideoPanel({ panel, sceneId, pending, playing, unconfirmed, onConfirm, onMakeKeyframes, onPlay, onEditInPlan, onOpenSettings }: Props) {
  const { t, tm } = useI18n();
  const why = `why-${sceneId}`;
  const run = useGuarded("run");
  const guarded = panel.action === "confirm" || panel.action === "make_keyframes";
  const enabled = panel.enabled && !pending && !(guarded && run.disabled);
  const primary = panel.enabled && panel.action !== null;
  const label = panel.action === "play" ? (playing ? t("panel.stop_scene") : `▶ ${tm(panel.label)}`) : tm(panel.label);
  const price = panel.enabled && panel.priceTotal && panel.action !== "play" ? ` · ${tm(panel.priceTotal)}` : "";
  const stop = panel.stopped;
  const lost = unconfirmed && panel.enabled && guarded;
  // A disabled button always says why; the model leaves out what a stopped confirm's message already says.
  const under = lost ? t("error.PAID_UNCONFIRMED") : panel.enabled ? (panel.priceEach ? tm(panel.priceEach) : "") : panel.reason ? tm(panel.reason) : "";
  const stopId = `stopped-${sceneId}`;
  const press = panel.action === "confirm" ? onConfirm : panel.action === "make_keyframes" ? onMakeKeyframes : panel.action === "play" ? onPlay : undefined;
  return (
    <section className="vpanel" aria-label={tm(panel.eyebrow)} data-scene={sceneId} data-action={panel.action ?? "none"} data-stopped={stop?.code}>
      {/* While stopped, the segments share the eyebrow's line so the stop, the button and its reason keep their room. */}
      <div className="vhead">
        <div className="eyebrow">{tm(panel.eyebrow)}</div>
        <div className="vsegs" aria-hidden="true">
          {panel.segments.map((segment) => <i key={segment.shotId} className={segment.opened ? "on" : undefined} />)}
        </div>
      </div>
      <div className="vcount"><b>{tm(panel.headline.value)}</b>{panel.headline.unit ? tm(panel.headline.unit) : null}</div>
      {stop ? (
        // The last confirm stopped partway (SceneOverview.confirmation "blocked"): why, where, and what to do next,
        // with the next step's view as a link right after it.
        <div className="vstop-box">
          <p className="vstop" id={stopId} role="status" data-shot={stop.shotId ?? undefined}>{tm(stop.reason)} {tm(stop.next)}</p>
          {stop.action === "settings" ? (
            <>{" "}<button type="button" className="vstop-act" data-act="stop-open-settings" onClick={onOpenSettings}>{t("panel.stopped.open_settings")}</button></>
          ) : stop.action === "plan" && stop.shotId && stop.label ? (
            <>{" "}<button
              type="button"
              className="vstop-act"
              data-act="stop-edit-in-plan"
              data-shot={stop.shotId}
              onClick={() => onEditInPlan(stop.shotId!)}
            >
              {t("panel.stopped.edit_in_plan", { shot: stop.label })}
            </button></>
          ) : null}
        </div>
      ) : panel.note ? <p>{tm(panel.note)}</p> : null}
      <button
        type="button"
        className={`pill go${primary ? " primary" : ""}`}
        data-act={panel.action ? ACT[panel.action] : "video-busy"}
        data-scene={sceneId}
        {...(guarded ? run : {})}
        disabled={!enabled || !press}
        aria-describedby={stop ? `${stopId} ${why}` : why}
        onClick={press}
      >
        {label}{price}
      </button>
      <div className={`why${lost ? " lost" : ""}`} id={why} data-unconfirmed={lost ? "true" : undefined}>{under}</div>
    </section>
  );
}
