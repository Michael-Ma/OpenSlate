import { clipFit, type ClipFit, type StudioArtifactRef } from "@openslate/core/public";
import { useEffect, useRef, useState, type ChangeEvent, type RefObject } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { useArtifactUrl } from "../../media/useArtifactUrl.ts";
import { clipTarget, syncMedia } from "../../model/film-audio.ts";
import type { FilmClock } from "../../model/film-clock.ts";
import type { FilmFrame } from "../../model/film-export.ts";
import { lineAt, musicLostAt, musicOn, nextTime, previousTime, shotAt, type FilmMusic, type FilmShot, type FilmTimeline } from "../../model/film.ts";
import { clock as formatClock, motionKind, motionTransform } from "../../model/motion.ts";
import { useClockPaint, useClockValue, useReducedMotion } from "./clock-hooks.ts";

interface Props {
  timeline: FilmTimeline;
  clock: FilmClock;
  music: FilmMusic | null;
  demo: boolean;
  /** Live: finished clips play as video. Fixture: their keyframes play with the motion preview. */
  live: boolean;
  /** The film's frame; a chosen format crops near-shape clips to fill it, as the export does (clip-fit.ts). */
  frame?: FilmFrame;
}

const PlayIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>;
const PauseIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="3" height="8" fill="currentColor" /><rect x="6" y="1" width="3" height="8" fill="currentColor" /></svg>;
const PrevIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1v10M11 1 4 6l7 5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" /></svg>;
const NextIcon = () => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M10 1v10M1 1l7 5-7 5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" /></svg>;

/** A verified keyframe from the shared artifact cache. */
export function Still({ artifact, alt }: { artifact: StudioArtifactRef; alt: string }) {
  const source = useArtifactUrl(artifact);
  if (source.status !== "ready") return <div className="fv-still-wait" role="img" aria-label={alt} />;
  return <img className="fv-still" src={source.url} alt={alt} draggable={false} />;
}

/**
 * The film on one clock (SB-19): the picture of the shot at the playhead, its narration as a subtitle and the
 * music indicator, with a scrubber. Keyframe-only shots show a dimmed still; shots with nothing made show
 * their prompt in a dashed frame.
 */
export function Player({ timeline, clock, music, demo, live, frame }: Props) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const index = useClockValue(clock, (time) => shotAt(timeline, time)?.index ?? -1);
  const playing = useClockValue(clock, (_time, isPlaying) => isPlaying);
  const lineShot = useClockValue(clock, (time) => lineAt(timeline, time)?.shotId ?? "");
  const musicHeard = useClockValue(clock, (time) => musicOn(music, time, timeline.total));
  // Music that is missing is never heard: where it would play, the player says it is unavailable instead.
  const musicLost = useClockValue(clock, (time) => musicLostAt(music, time, timeline.total));
  const shot = index >= 0 ? timeline.shots[index] ?? null : null;
  const line = lineShot ? timeline.shots.find((s) => s.shotId === lineShot)?.line ?? null : null;

  const timeText = useRef<HTMLSpanElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const anim = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const dragging = useRef(false);
  const lastLabel = useRef("");
  const [clipFailed, setClipFailed] = useState<string | null>(null);
  const playClip = live && shot?.picture === "clip" && clipFailed !== shot.shotId;
  // The next shot's clip loads while this one plays, so the cut does not wait for it.
  const nextClip = index >= 0 ? timeline.shots[index + 1]?.clip ?? null : null;

  useClockPaint(clock, (time, isPlaying) => {
    const text = formatClock(time);
    if (timeText.current && timeText.current.textContent !== text) timeText.current.textContent = text;
    const input = range.current;
    if (input && !dragging.current) input.value = String(Math.round(time * 10) / 10);
    // The spoken position changes once a second, so screen readers are not flooded.
    if (input && lastLabel.current !== text) { lastLabel.current = text; input.setAttribute("aria-valuetext", t("film.player.position_text", { time: text, total: formatClock(timeline.total) })); }
    const at = shotAt(timeline, time);
    if (!at) return;
    // A clip's stand-in (its keyframe) moves with the shot's motion; a keyframe-only shot stays still.
    if (anim.current) anim.current.style.transform = !reduced && at.shot.picture === "clip" && !playClip ? motionTransform(motionKind(at.shot.motion), at.local / Math.max(0.5, at.shot.seconds)) : "none";
    if (video.current) syncMedia(video.current, clipTarget(at.local, at.shot.shotId === shot?.shotId), isPlaying, 0.3);
  });

  const onScrub = (event: ChangeEvent<HTMLInputElement>) => clock.seek(Number(event.target.value));
  const prev = () => clock.seek(previousTime(timeline, clock.time));
  const next = () => clock.seek(nextTime(timeline, clock.time));

  const status = !shot ? null
    : shot.picture === "clip" ? <span className="status ok" data-picture="clip"><span aria-hidden="true">✓</span>{t(demo ? "film.player.demo_clip" : "film.player.clip")}</span>
    : shot.picture === "keyframe" ? <span className="status" data-picture="keyframe">{t("film.player.keyframe_only")}</span>
    : <span className="status" data-picture="none">{t("film.player.nothing")}</span>;

  return (
    <section className="preview player" aria-label={t("film.player.label")} data-shot={shot?.shotId ?? ""}>
      {shot && shot.keyframe ? (
        <div className={`pic${shot.picture === "keyframe" ? " dim" : ""}`}>
          <div className="pv-anim" ref={anim}>
            <Still key={shot.keyframe.artifactId + shot.keyframe.sha256} artifact={shot.keyframe} alt={t("film.player.alt", { shot: shot.label, framing: shot.framing, prompt: shot.prompt })} />
          </div>
        </div>
      ) : shot ? (
        <div className="dashed-frame"><div><b>{t("film.player.no_keyframe")}</b>{shot.prompt}</div></div>
      ) : null}
      {shot && playClip && shot.clip ? <Clip key={shot.shotId} shot={shot} frame={frame} videoRef={video} onFailed={() => setClipFailed(shot.shotId)} /> : null}
      {live && nextClip ? <Prefetch artifact={nextClip} /> : null}
      <div className="pv-top">
        {shot ? <span className="badge">{shot.label}</span> : null}
        {status}
        <span className="end">
          {demo ? <span className="demo-mark" title={t("film.player.demo_title")} data-act="demo-mark">{t("film.player.demo_mark")}</span> : null}
          {musicLost ? <span className="music-on lost" data-act="music-missing">{t("film.player.music_missing")}</span> : null}
          {musicHeard && music ? (
            <span className="music-on" data-act="music-on">
              {playing && !reduced ? <span className="meter" aria-hidden="true"><i /><i /><i /></span> : <span aria-hidden="true">♪</span>}
              {t("film.player.music", { name: music.label ?? t("film.music.unnamed"), gain: music.gainDb })}
            </span>
          ) : null}
        </span>
      </div>
      <div className="pv-bottom">
        <p className="subtitle" data-shot={line?.shotId ?? ""}>
          {line ? <><small>{t("film.player.narration")}</small>{t("film.player.quote", { text: line.text })}</> : null}
        </p>
        <div className="scrub">
          <button type="button" className="skip" data-act="prev" aria-label={t("film.player.prev")} onClick={prev}><PrevIcon /></button>
          <button type="button" className="play" data-act="play" aria-label={playing ? t("film.player.pause") : t("film.player.play")} onClick={() => clock.toggle()} disabled={!timeline.total}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" className="skip" data-act="next" aria-label={t("film.player.next")} onClick={next}><NextIcon /></button>
          <span ref={timeText} className="num">{formatClock(0)}</span>
          <input
            ref={range}
            type="range"
            className="scrubber"
            data-act="scrub"
            min={0}
            max={timeline.total}
            step={0.1}
            defaultValue={0}
            aria-label={t("film.player.position")}
            onChange={onScrub}
            onPointerDown={() => { dragging.current = true; }}
            onPointerUp={() => { dragging.current = false; }}
            onPointerCancel={() => { dragging.current = false; }}
          />
          <span className="num">{formatClock(timeline.total)}</span>
          <span className="approx">{t("film.player.approx")}</span>
        </div>
      </div>
    </section>
  );
}

/** A finished clip (live studio), muted: the film's sound is the narration and the music. */
function Clip({ shot, frame, videoRef, onFailed }: { shot: FilmShot; frame: FilmFrame | undefined; videoRef: RefObject<HTMLVideoElement | null>; onFailed(): void }) {
  const source = useArtifactUrl(shot.clip);
  // The export's rule, decided from the clip's own size once it is known: "cover" shows the film frame filled.
  const [fit, setFit] = useState<ClipFit>("contain");
  const failed = useRef(onFailed);
  failed.current = onFailed;
  // A clip that cannot be loaded falls back to its keyframe with the motion preview.
  useEffect(() => { if (source.status === "failed") failed.current(); }, [source.status]);
  // Until it plays, a clip shows its keyframe (a clip's first frame can be black, and a loading one is empty).
  const poster = useArtifactUrl(shot.keyframe);
  if (source.status !== "ready") return null;
  return <video ref={videoRef} className="fv-clip" data-fit={fit} src={source.url} poster={poster.status === "ready" ? poster.url : undefined} muted playsInline preload="auto" aria-hidden="true" onError={onFailed}
    style={fit === "cover" && frame ? { aspectRatio: `${frame.width} / ${frame.height}` } : undefined}
    onLoadedMetadata={(event) => setFit(frame ? clipFit(event.currentTarget.videoWidth, event.currentTarget.videoHeight, frame.width, frame.height, frame.chosen) : "contain")} />;
}

/** Loads an artifact into the shared cache and shows nothing. */
function Prefetch({ artifact }: { artifact: StudioArtifactRef }) {
  useArtifactUrl(artifact);
  return null;
}
