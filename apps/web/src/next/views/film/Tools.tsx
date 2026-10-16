import type { ShotOverview } from "@openslate/core/public";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRecoveryLock } from "../../app/useWriteGuard.ts";
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
  const earlier = useRef<HTMLButtonElement>(null);
  const later = useRef<HTMLButtonElement>(null);
  const pressed = useRef<{ shotId: string; direction: -1 | 1 } | null>(null);
  const limits = lengthLimits(overview, fps);
  const seconds = shotSeconds(overview, fps);
  // Buttons stay enabled while an edit saves, so keyboard focus stays on them; a press during a save is ignored.
  const off = !writable;
  const locked = useRecoveryLock();
  const offline = writable ? undefined : locked ?? t("film.offline");
  const notes = [
    limits.voiceFloor ? t("film.tools.voice_floor", { seconds: limits.voiceFloor }) : null,
    shot.picture === "clip" ? t("film.tools.outdates_clip") : null,
  ].filter(Boolean).join(" · ");
  const first = shot.index === 0;
  const last = shot.index === shot.sceneSize - 1;
  // A move that makes the shot first or last turns off the pressed button: focus goes to the other one, or to the
  // shot's block when both are off, instead of falling back to the page.
  useEffect(() => {
    const move = pressed.current;
    if (!move || move.shotId !== shot.shotId) return;
    const button = move.direction === -1 ? earlier.current : later.current;
    if (!button?.disabled) return;
    pressed.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active !== button && active.isConnected) return;
    const other = move.direction === -1 ? later.current : earlier.current;
    if (other && !other.disabled) other.focus();
    else button.closest(".timeline")?.querySelector<HTMLElement>(".blk.sel")?.focus();
  }, [first, last, shot.shotId]);
  const press = (direction: -1 | 1) => {
    pressed.current = { shotId: shot.shotId, direction };
    onMove(direction);
  };
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
      <button ref={earlier} type="button" className="pill sm" data-act="move" data-d="-1" disabled={off || first} title={offline ?? (first ? t("film.tools.first") : undefined)} onClick={() => press(-1)}>{t("film.tools.earlier")}</button>
      <button ref={later} type="button" className="pill sm" data-act="move" data-d="1" disabled={off || last} title={offline ?? (last ? t("film.tools.last") : undefined)} onClick={() => press(1)}>{t("film.tools.later")}</button>
      <button type="button" className="pill sm ghost" data-act="open-keyframes" onClick={onOpen}>{t("film.tools.open")}</button>
    </>
  );
}

interface MusicToolsProps {
  music: FilmMusic;
  total: number;
  writable: boolean;
  /** An edit is being saved: a new volume waits for it. */
  saving: boolean;
  onStart(step: -1 | 1): void;
  /** Saves the volume; false when it was not saved. */
  onGain(db: number): Promise<boolean>;
  onMute(): void;
  onChange(anchor: HTMLElement): void;
}

/** A volume is saved this long after the last arrow key or release, so a run of steps is one edit and one Undo. */
export const GAIN_SETTLE_MS = 400;

/** The music track: start, volume (−60 to 0 dB), mute, and Change music (music-role audio only, SB-24). */
export function MusicTools({ music, total, writable, saving, onStart, onGain, onMute, onChange }: MusicToolsProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(music.gainDb);
  // A level let go of (the change event: a release, or an arrow key) and not saved yet.
  const [unsaved, setUnsaved] = useState<number | null>(null);
  const unsavedRef = useRef<number | null>(null);
  unsavedRef.current = unsaved;
  const slider = useRef<HTMLInputElement>(null);
  const commit = useRef(onGain);
  commit.current = onGain;
  const locked = useRecoveryLock();
  const offline = writable ? undefined : locked ?? t("film.offline");
  // The saved level shows unless a newer one waits to be saved.
  useEffect(() => { if (unsavedRef.current === null) setDraft(music.gainDb); }, [music.gainDb]);
  const save = useCallback((db: number) => {
    setUnsaved(null);
    void commit.current(db).then((saved) => { if (!saved && unsavedRef.current === null) setDraft(music.gainDb); });
  }, [music.gainDb]);
  // Not on every step of a drag: once the slider is let go, or the arrow keys rest, and never during a save.
  useEffect(() => {
    if (unsaved === null || saving) return;
    const timer = setTimeout(() => save(unsaved), GAIN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [unsaved, saving, save]);
  useEffect(() => {
    const input = slider.current;
    if (!input) return;
    const onChangeDone = () => setUnsaved(Number(input.value));
    input.addEventListener("change", onChangeDone);
    return () => input.removeEventListener("change", onChangeDone);
  }, []);
  // Closing the tools (Esc, another selection) saves a level that was still waiting.
  useEffect(() => () => { if (unsavedRef.current !== null) void commit.current(unsavedRef.current); }, []);
  // Leaving the slider saves at once (unless a save is running; then the timer above saves after it).
  const onBlur = () => { if (unsaved !== null && !saving) save(unsaved); };
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
          onBlur={onBlur}
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
