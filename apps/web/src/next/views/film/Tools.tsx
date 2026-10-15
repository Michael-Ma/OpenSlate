import type { ShotOverview } from "@openslate/core/public";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { lengthLimits, shotSeconds, type FilmMusic, type FilmShot } from "../../model/film.ts";
import { clock as formatClock } from "../../model/motion.ts";

interface ShotToolsProps {
  shot: FilmShot;
  overview: ShotOverview;
  fps: number;
  writable: boolean;
  onLength(step: -1 | 1): void;
  onMove(direction: -1 | 1): void;
  onOpen(): void;
}

/** A selected shot: its length (with the voice floor) and its place in the scene. Free, with Undo. */
export function ShotTools({ shot, overview, fps, writable, onLength, onMove, onOpen }: ShotToolsProps) {
  const { t } = useI18n();
  const limits = lengthLimits(overview, fps);
  const seconds = shotSeconds(overview, fps);
  // Buttons stay enabled while an edit saves, so keyboard focus stays on them; a press during a save is ignored.
  const off = !writable;
  const offline = writable ? undefined : t("film.offline");
  const notes = [
    limits.voiceFloor ? t("film.tools.voice_floor", { seconds: limits.voiceFloor }) : null,
    shot.picture === "clip" ? t("film.tools.outdates_clip") : null,
  ].filter(Boolean).join(" · ");
  const first = shot.index === 0;
  const last = shot.index === shot.sceneSize - 1;
  return (
    <>
      <b data-act="tools-shot">{t("film.tools.shot", { shot: shot.label, framing: shot.framing })}</b>
      <span className="sep" aria-hidden="true" />
      <span>{t("film.tools.length")}</span>
      <span className="stepper" role="group" aria-label={t("film.tools.length_group")}>
        <button
          type="button"
          data-act="len"
          data-d="-1"
          aria-label={t("film.tools.shorter")}
          disabled={off || seconds <= limits.min}
          title={offline ?? (limits.voiceFloor && seconds <= limits.min ? t("film.tools.floor_title", { seconds: limits.voiceFloor }) : undefined)}
          onClick={() => onLength(-1)}
        >−</button>
        <output aria-live="polite">{t("film.tools.seconds", { seconds })}</output>
        <button type="button" data-act="len" data-d="1" aria-label={t("film.tools.longer")} disabled={off || seconds >= limits.max} title={offline} onClick={() => onLength(1)}>+</button>
      </span>
      {notes ? <span className="hint">{notes}</span> : null}
      <span className="sep" aria-hidden="true" />
      <button type="button" className="pill sm" data-act="move" data-d="-1" disabled={off || first} title={offline ?? (first ? t("film.tools.first") : undefined)} onClick={() => onMove(-1)}>{t("film.tools.earlier")}</button>
      <button type="button" className="pill sm" data-act="move" data-d="1" disabled={off || last} title={offline ?? (last ? t("film.tools.last") : undefined)} onClick={() => onMove(1)}>{t("film.tools.later")}</button>
      <button type="button" className="pill sm ghost" data-act="open-keyframes" onClick={onOpen}>{t("film.tools.open")}</button>
    </>
  );
}

interface MusicToolsProps {
  music: FilmMusic;
  total: number;
  writable: boolean;
  onStart(step: -1 | 1): void;
  onGain(db: number): void;
  onMute(): void;
  onChange(anchor: HTMLElement): void;
}

/** The music track: start, volume (−60 to 0 dB), mute, and Change music (music-role audio only, SB-24). */
export function MusicTools({ music, total, writable, onStart, onGain, onMute, onChange }: MusicToolsProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(music.gainDb);
  const slider = useRef<HTMLInputElement>(null);
  const commit = useRef(onGain);
  commit.current = onGain;
  const offline = writable ? undefined : t("film.offline");
  useEffect(() => { setDraft(music.gainDb); }, [music.gainDb]);
  // The level is saved when the slider is let go (the change event), not on every step of a drag.
  useEffect(() => {
    const input = slider.current;
    if (!input) return;
    const onCommit = () => commit.current(Number(input.value));
    input.addEventListener("change", onCommit);
    return () => input.removeEventListener("change", onCommit);
  }, []);
  const name = music.label ?? t("film.music.unnamed");
  return (
    <>
      <b data-act="tools-music">{t("film.tools.music", { name })}</b>
      <span className="sep" aria-hidden="true" />
      <span>{t("film.tools.starts")}</span>
      <span className="stepper" role="group" aria-label={t("film.tools.start_group")}>
        <button type="button" data-act="mstart" data-d="-1" aria-label={t("film.tools.start_earlier")} disabled={!writable || music.start <= 0} title={offline} onClick={() => onStart(-1)}>−</button>
        <output aria-live="polite">{formatClock(music.start)}</output>
        <button type="button" data-act="mstart" data-d="1" aria-label={t("film.tools.start_later")} disabled={!writable || music.start >= total - 1} title={offline} onClick={() => onStart(1)}>+</button>
      </span>
      <label className="inline">
        {t("film.tools.volume")}
        <input
          ref={slider}
          type="range"
          className="range"
          data-act="gain"
          min={-60}
          max={0}
          step={1}
          value={draft}
          disabled={!writable}
          title={offline}
          aria-label={t("film.tools.volume_label")}
          aria-valuetext={t("film.tools.db", { db: draft })}
          onChange={(event) => setDraft(Number(event.target.value))}
        />
        <output className="num">{t("film.tools.db", { db: draft })}</output>
      </label>
      <span className="inline">
        <span id="fv-mute-label">{t("film.tools.mute")}</span>
        <button type="button" className="switch" role="switch" data-act="mute-switch" aria-checked={music.muted} aria-labelledby="fv-mute-label" disabled={!writable} title={offline} onClick={onMute} />
      </span>
      <button type="button" className="pill sm" data-act="music-menu" aria-haspopup="menu" disabled={!writable} title={offline} onClick={(event) => onChange(event.currentTarget)}>{t("film.tools.change_music")}</button>
    </>
  );
}
