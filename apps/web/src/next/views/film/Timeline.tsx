import { useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { FilmClock } from "../../model/film-clock.ts";
import { musicSpan, rulerTicks, type FilmMusic, type FilmShot, type FilmTimeline } from "../../model/film.ts";
import { clock as formatClock } from "../../model/motion.ts";
import { useClockPaint } from "./clock-hooks.ts";
import { Still } from "./Player.tsx";

export type Selection = { kind: "shot"; id: string } | { kind: "music" } | null;

interface Props {
  timeline: FilmTimeline;
  music: FilmMusic | null;
  clock: FilmClock;
  selection: Selection;
  /** Phone width: 14 px a second, scrolling sideways inside the timeline. Otherwise the lanes fit the width. */
  pixelsPerSecond: number | null;
  writable: boolean;
  /** An edit is being saved: the tool row says so to assistive tech. */
  saving: boolean;
  onSelectShot(shotId: string): void;
  onSelectMusic(): void;
  onToggleMute(): void;
  onChooseMusic(anchor: HTMLElement): void;
  children: ReactNode;
}

const KEY_WIDTH = { wide: 92, narrow: 70 };

/** Deterministic waveform bars for a recording (a picture of "audio", not its real envelope). */
function waveBars(seed: string, count: number): number[] {
  let x = 0;
  for (const c of seed) x = (x * 31 + c.charCodeAt(0)) % 997;
  const bars: number[] = [];
  for (let i = 0; i < count; i++) { x = (x * 73 + 41) % 997; bars.push(18 + (x % 70)); }
  return bars;
}

const MuteIcon = ({ muted }: { muted: boolean }) => (
  <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
    <path d="M1 4h2.5L7 1v10L3.5 8H1z" fill="currentColor" />
    {muted ? <path d="M8.5 4l3 4m0-4-3 4" stroke="currentColor" strokeWidth="1.3" /> : <path d="M9 3.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" strokeWidth="1.3" fill="none" />}
  </svg>
);

/**
 * The timeline (SB-19): scenes, picture blocks sized by length with what each shot lacks and the Director's
 * letter, the narration lane (a line too long for its shot is not placed), and the one music track. Selecting
 * a block or the music changes the tool row below.
 */
export function Timeline({ timeline, music, clock, selection, pixelsPerSecond: pps, writable, saving, onSelectShot, onSelectMusic, onToggleMute, onChooseMusic, children }: Props) {
  const { t, tm } = useI18n();
  const total = Math.max(timeline.total, 0.001);
  const head = useRef<HTMLSpanElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const X = (s: number) => (pps ? `${s * pps}px` : `${(s / total) * 100}%`);
  const W = (d: number, gap = 3) => `calc(${pps ? `${d * pps}px` : `${(d / total) * 100}%`} - ${gap}px)`;
  const ticks = useMemo(() => rulerTicks(timeline.total, pps), [timeline.total, pps]);
  const bars = useMemo(() => waveBars(music?.audioId ?? "", 90), [music?.audioId]);

  useClockPaint(clock, (time) => { if (head.current) head.current.style.left = X(Math.min(time, timeline.total)); });

  // On a phone the lanes scroll sideways: bring a newly selected shot into view.
  const selectedShot = selection?.kind === "shot" ? selection.id : null;
  useEffect(() => {
    if (!pps || !selectedShot) return;
    scroller.current?.querySelector(`[data-shot="${CSS.escape(selectedShot)}"]`)?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [pps, selectedShot]);

  const seekOnRuler = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    clock.seek(pps ? x / pps : (x / rect.width) * timeline.total);
  };

  // The label replaces the block's contents for assistive tech, so it carries the Director's note letter too.
  const blockLabel = (shot: FilmShot, lack: string | null) => {
    const base = { shot: shot.label, framing: shot.framing, seconds: shot.seconds };
    if (shot.letter) return lack ? t("film.block.label_lack_note", { ...base, lack, letter: shot.letter }) : t("film.block.label_note", { ...base, letter: shot.letter });
    return lack ? t("film.block.label_lack", { ...base, lack }) : t("film.block.label", base);
  };

  const block = (shot: FilmShot) => {
    const selected = selectedShot === shot.shotId;
    const lack = shot.lack ? tm(shot.lack) : null;
    const kind = shot.picture === "clip" ? "" : shot.picture === "keyframe" ? " kfonly" : " empty";
    return (
      <button
        key={shot.shotId}
        type="button"
        className={`blk${kind}${selected ? " sel" : ""}`}
        style={{ left: X(shot.start), width: W(shot.seconds) }}
        data-act="sel-shot"
        data-shot={shot.shotId}
        aria-pressed={selected}
        aria-label={blockLabel(shot, lack)}
        onClick={() => onSelectShot(shot.shotId)}
      >
        {shot.keyframe ? <span className="blk-pic"><Still artifact={shot.keyframe} alt="" /></span> : null}
        <span className="badge">{shot.label}</span>
        {shot.letter ? <span className="letter" title={t("film.block.note", { letter: shot.letter })}>{shot.letter}</span> : null}
        {lack && shot.seconds >= 4 ? <span className="lack">{lack}</span> : null}
        <span className="dur">{t("film.block.seconds", { seconds: shot.seconds })}</span>
      </button>
    );
  };

  const lines = timeline.shots.flatMap((shot) => {
    const line = shot.line;
    if (!line) return [];
    const text = line.state === "placed" ? t("film.player.quote", { text: line.text })
      : line.state === "too_long" ? t("film.line.too_long", { seconds: line.lineSeconds ?? 0 })
      : line.state === "making" ? t("film.line.making")
      : line.state === "failed" ? t("film.line.failed")
      : line.state === "no_answer" ? t("film.line.no_answer")
      : t("film.line.no_voice");
    const title = line.lineSeconds !== null ? t("film.line.title", { text: line.text, seconds: line.lineSeconds }) : t("film.player.quote", { text: line.text });
    return [(
      <span key={shot.shotId} className={`vblk${line.state === "placed" ? "" : " loose"}`} data-state={line.state} data-shot={shot.shotId} style={{ left: X(line.start), width: W(line.laneSeconds) }} title={title}>
        <b>{line.label}</b> {text}
      </span>
    )];
  });

  const span = music ? musicSpan(music, timeline.total) : null;
  const musicName = music ? music.label ?? t("film.music.unnamed") : "";
  const keyWidth = pps ? KEY_WIDTH.narrow : KEY_WIDTH.wide;
  const offline = writable ? undefined : t("film.offline");

  return (
    <section className="panel timeline" aria-label={t("film.timeline.eyebrow")}>
      <div className="panel-head">
        <span className="eyebrow">{t("film.timeline.eyebrow")}</span>
        <span className="dim tl-note">{t("film.timeline.note")}</span>
      </div>
      <div className="tl-scroll" ref={scroller}>
        <div className="tl-grid" style={pps ? { width: `${timeline.total * pps + keyWidth + 12}px` } : undefined}>
          <span className="lane-k" />
          <div className="lane ruler" aria-hidden="true" onClick={seekOnRuler}>
            {ticks.map((s) => <span key={s} className="tick" style={{ left: X(s) }}><i />{formatClock(s)}</span>)}
          </div>
          <span className="lane-k">{t("film.lane.scenes")}</span>
          <div className="lane bands">
            {timeline.scenes.map((scene) => (
              <span key={scene.sceneId} className="band" style={{ left: X(scene.start), width: W(scene.seconds) }} title={scene.title} data-scene={scene.sceneId}>
                {t("film.band", { scene: scene.ordinal, title: scene.title })}
              </span>
            ))}
          </div>
          <span className="lane-k">{t("film.lane.picture")}</span>
          <div className="lane pics">
            {timeline.shots.map(block)}
            <span className="head-sel" ref={head} aria-hidden="true" />
          </div>
          <span className="lane-k">{t("film.lane.narration")}</span>
          <div className="lane voices">{lines}</div>
          <span className="lane-k">
            {t("film.lane.music")}
            {music ? (
              <button
                type="button"
                className="icon-btn mute-btn"
                data-act="mute"
                aria-pressed={music.muted}
                aria-label={music.muted ? t("film.music.unmute") : t("film.music.mute")}
                title={offline ?? (music.muted ? t("film.music.unmute") : t("film.music.mute"))}
                disabled={!writable}
                onClick={onToggleMute}
              >
                <MuteIcon muted={music.muted} />
              </button>
            ) : null}
          </span>
          <div className="lane musicl">
            {music && span ? (
              <button
                type="button"
                className={`mblk${music.muted ? " muted" : ""}${selection?.kind === "music" ? " sel" : ""}`}
                style={{ left: X(span.start), width: W(Math.max(span.seconds, 0.5), 2) }}
                data-act="sel-music"
                aria-pressed={selection?.kind === "music"}
                aria-label={t("film.music.label", { name: musicName })}
                onClick={onSelectMusic}
              >
                <span className="wave" aria-hidden="true">{bars.map((h, i) => <i key={i} style={{ height: `${h}%` }} />)}</span>
                <span className="mname">{music.muted ? t("film.music.block_muted", { name: musicName }) : t("film.music.block", { name: musicName, gain: music.gainDb })}</span>
              </button>
            ) : (
              <span className="none-music">
                {t("film.music.none")}{" "}
                <button type="button" className="pill sm" data-act="choose-music" aria-haspopup="menu" disabled={!writable} title={offline} onClick={(event) => onChooseMusic(event.currentTarget)}>{t("film.music.choose")}</button>
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="tl-tools" data-act="tools" aria-busy={saving}>{children}</div>
    </section>
  );
}
