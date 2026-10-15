import { useI18n } from "../i18n/I18n.tsx";
import type { VideoPanel as Panel } from "../model/keyframes.ts";

interface Props {
  panel: Panel;
  sceneId: string;
  pending: boolean;
  playing: boolean;
  onConfirm(): void;
  onMakeKeyframes(): void;
  onPlay(): void;
}

const ACT = { confirm: "confirm-video", make_keyframes: "make-keyframes", play: "play-scene" } as const;

/**
 * SCENE n VIDEO: opened-frame segments, the count, the note and the one primary button.
 * The enabled button carries its price with the breakdown under it; a disabled one says what is missing.
 */
export function VideoPanel({ panel, sceneId, pending, playing, onConfirm, onMakeKeyframes, onPlay }: Props) {
  const { t, tm } = useI18n();
  const why = `why-${sceneId}`;
  const enabled = panel.enabled && !pending;
  const primary = panel.enabled && panel.action !== null;
  const label = panel.action === "play" ? (playing ? t("panel.stop_scene") : `▶ ${tm(panel.label)}`) : tm(panel.label);
  const price = panel.enabled && panel.priceTotal && panel.action !== "play" ? ` · ${tm(panel.priceTotal)}` : "";
  const under = panel.enabled ? (panel.priceEach ? tm(panel.priceEach) : "") : panel.reason ? tm(panel.reason) : "";
  const press = panel.action === "confirm" ? onConfirm : panel.action === "make_keyframes" ? onMakeKeyframes : panel.action === "play" ? onPlay : undefined;
  return (
    <section className="vpanel" aria-label={tm(panel.eyebrow)} data-scene={sceneId} data-action={panel.action ?? "none"}>
      <div className="eyebrow">{tm(panel.eyebrow)}</div>
      <div className="vsegs" aria-hidden="true">
        {panel.segments.map((segment) => <i key={segment.shotId} className={segment.opened ? "on" : undefined} />)}
      </div>
      <div className="vcount"><b>{tm(panel.headline.value)}</b>{panel.headline.unit ? tm(panel.headline.unit) : null}</div>
      {panel.note ? <p>{tm(panel.note)}</p> : null}
      <button
        type="button"
        className={`pill go${primary ? " primary" : ""}`}
        data-act={panel.action ? ACT[panel.action] : "video-busy"}
        data-scene={sceneId}
        disabled={!enabled || !press}
        aria-describedby={why}
        onClick={press}
      >
        {label}{price}
      </button>
      <div className="why" id={why}>{under}</div>
    </section>
  );
}
