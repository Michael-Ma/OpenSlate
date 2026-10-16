import type { ShotOverview, StudioArtifactRef } from "@openslate/core/public";
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { artifactKey } from "../media/artifact-cache.ts";
import { useArtifactUrl } from "../media/useArtifactUrl.ts";
import type { ShotCard } from "../model/keyframes.ts";
import { ARROW_OWNERS, shotClip, stageStep, type ShotPosition } from "../model/keyframes-stage.ts";
import { clock, motionKind, motionTransform } from "../model/motion.ts";
import { useMode, useStore, useStudio } from "../store/react.tsx";
import { Picture, StatusPill, useOnScreen, useReducedMotion } from "./parts.tsx";
import { useGuarded } from "../app/useWriteGuard.ts";

/** A request to record that the person opened a shot's frame: armed when they navigate to it. */
export interface OpenIntent {
  shotId: string;
  nonce: number;
}

interface Props {
  shot: ShotOverview;
  card: ShotCard;
  fps: number;
  playing: "motion" | "clip" | null;
  intent: OpenIntent | null;
  /** Where the shot sits in the whole film, with its neighbours across scenes. */
  position: ShotPosition | null;
  onTogglePlay(): void;
  onEnded(): void;
  onOpen(shotId: string): void;
  /** Go to another shot (the previous or next one in the film). */
  onStep(shotId: string): void;
}

const PlayIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>;
const StopIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="3" height="8" fill="currentColor" /><rect x="6" y="1" width="3" height="8" fill="currentColor" /></svg>;
const PrevIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M6.5 1.5L3 5l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const NextIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 1.5L7 5 3.5 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/**
 * The large keyframe with its motion preview (plan decision D17). Records "Opened" once the exact picture
 * the person navigated to has loaded, decoded and is on screen (plan item WA-9). A new take that lands
 * while they look is not opened by itself: they open it from its card or the Open button.
 */
export function Preview({ shot, card, fps, playing, intent, position, onTogglePlay, onEnded, onOpen, onStep }: Props) {
  const { t } = useI18n();
  const store = useStore();
  const live = useMode() === "live";
  const reduced = useReducedMotion();
  // Keyframe or Video: kept while moving between shots, so clips can be reviewed one after another.
  const [media, setMedia] = useState<"keyframe" | "video">("keyframe");
  const section = useRef<HTMLElement>(null);
  const anim = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLElement>(null);
  const time = useRef<HTMLSpanElement>(null);
  const visible = useOnScreen(section);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [consumed, setConsumed] = useState(0);
  const openPending = useStudio((s) => !!s.pending[`frame-view:${shot.shotId}`]);
  // Recording "Opened" writes; offline or expired the button is off and says why.
  const openGuard = useGuarded("server");
  // The run restarts only for a new shot, motion or mode, not when the parent re-renders.
  const ended = useRef(onEnded);
  ended.current = onEnded;

  const keyframe = shot.keyframe;
  const current = keyframe.state === "ready" && keyframe.artifact ? keyframe.artifact : null;
  const currentKey = current ? artifactKey(current) : null;
  const making = keyframe.state === "running";
  const durationSeconds = Math.round((shot.durationFrames / fps) * 10) / 10;
  const armed = !!intent && intent.shotId === shot.shotId && consumed !== intent.nonce;

  // Opened (WA-9): only for the frame the person navigated to, and only once it has really been shown.
  useEffect(() => {
    if (!intent || intent.shotId !== shot.shotId || consumed === intent.nonce) return;
    if (!current || keyframe.opened) { setConsumed(intent.nonce); return; }
    if (loaded !== currentKey || !visible) return;
    setConsumed(intent.nonce);
    void store.openFrame(shot.shotId);
  }, [intent, consumed, current, currentKey, keyframe.opened, loaded, visible, shot.shotId, store]);

  // Narrow layouts stack the cards below the preview: navigating to a shot brings its preview on screen.
  const nonce = intent?.shotId === shot.shotId ? intent.nonce : null;
  useEffect(() => {
    const element = section.current;
    if (nonce === null || !element) return;
    // Measured now: the observer may not have reported a scroll that happened a moment ago.
    const rect = element.getBoundingClientRect();
    const shown = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
    if (rect.height > 0 && shown / rect.height >= 0.5) return;
    element.scrollIntoView?.({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    // Only a new navigation scrolls; later visibility changes do not.
  }, [nonce]);

  // Motion preview: a transform guessed from the motion text; under reduced motion only the scrubber moves.
  useEffect(() => {
    const reset = () => {
      if (anim.current) anim.current.style.transform = "";
      if (bar.current) bar.current.style.width = "0%";
      if (time.current) time.current.textContent = clock(0);
    };
    if (playing !== "motion") { reset(); return; }
    const kind = motionKind(shot.motion);
    const total = Math.max(0.5, durationSeconds) * 1000;
    const started = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - started) / total);
      if (anim.current) anim.current.style.transform = reduced ? "none" : motionTransform(kind, p);
      if (bar.current) bar.current.style.width = `${p * 100}%`;
      if (time.current) time.current.textContent = clock(p * durationSeconds);
      if (p < 1) frame = requestAnimationFrame(step);
      else ended.current();
    };
    frame = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(frame); reset(); };
  }, [playing, shot.shotId, shot.motion, durationSeconds, reduced]);

  const picture = card.picture;
  const caption = t("preview.caption", { framing: shot.framing, prompt: shot.imagePrompt });
  const canOpen = !!current && !keyframe.opened && loaded === currentKey && !armed && !openPending;
  const clip = shotClip(shot);
  // A playback (motion preview or the scene's clips) shows the keyframe side; the Video side plays one clip.
  const showVideo = media === "video" && !!clip && !playing;
  // The live studio plays the clip with native controls; the sample film has no clip files, so the keyframe's
  // motion stands in (as in the Film view).
  const player = showVideo && live;

  /** ArrowLeft / ArrowRight move through the film while the stage has focus (never inside a field or a video). */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const inField = event.target instanceof Element && !!event.target.closest(ARROW_OWNERS);
    const step = stageStep(event.key, event, inField);
    const target = step === -1 ? position?.previous : step === 1 ? position?.next : null;
    if (!target) return;
    event.preventDefault();
    onStep(target.shotId);
  };
  /** A button that would turn off at the film's first or last shot hands focus to the stage, so the arrows keep working. */
  const step = (target: { shotId: string } | null | undefined, end: boolean) => {
    if (!target) return;
    onStep(target.shotId);
    if (end) section.current?.focus({ preventScroll: true });
  };

  return (
    <section
      ref={section}
      className="preview"
      tabIndex={0}
      aria-label={t("preview.label", { shot: shot.label })}
      aria-keyshortcuts="ArrowLeft ArrowRight"
      data-shot={shot.shotId}
      data-opened={keyframe.opened ? "true" : "false"}
      data-media={showVideo ? "video" : "keyframe"}
      onKeyDown={onKeyDown}
    >
      {player ? (
        <ClipPlayer key={artifactKey(clip.artifact)} artifact={clip.artifact} label={shot.label} />
      ) : picture ? (
        <div className={`pic${card.pictureDimmed && !showVideo ? " dim" : ""}`}>
          <div className="pv-anim" ref={anim}>
            <Picture artifact={picture} alt={caption} onDecoded={(key) => setLoaded(key)} />
          </div>
        </div>
      ) : !making ? (
        <div className="dashed-frame"><div><b>{t("preview.no_keyframe")}</b>{shot.imagePrompt}</div></div>
      ) : null}
      {playing === "clip" && shot.video.state === "ready" && shot.video.artifact ? <Clip shot={shot} onEnded={onEnded} bar={bar} time={time} /> : null}
      {making && !player ? (
        <div className={`making${picture ? " over" : ""}`}>
          <div>{t("preview.making", { shot: shot.label })}<div className="bar indeterminate" role="progressbar" aria-label={t("card.progress", { shot: shot.label })}><i /></div></div>
        </div>
      ) : null}
      <div className="pv-head">
        <div className="pv-top">
          <span className="badge">{shot.label}</span>
          {showVideo ? (
            <span className={clip.earlier ? "status" : "status ok"} data-clip={clip.earlier ? "earlier" : "current"}>
              {clip.earlier ? null : <span aria-hidden="true">✓</span>}
              {t(clip.earlier ? "preview.clip.earlier" : "preview.clip.current")}
            </span>
          ) : (
            <>
              {picture && !making ? <StatusPill status={card.status} tone={card.tone} /> : null}
              {card.pictureDimmed && !making ? <span className="status">{t("preview.earlier_take")}</span> : null}
              {canOpen ? <button type="button" className="pill sm" data-act="open-frame" data-shot={shot.shotId} {...openGuard} onClick={() => onOpen(shot.shotId)}>{t("preview.open", { shot: shot.label })}</button> : null}
            </>
          )}
        </div>
        <div className="pv-side">
          {clip ? (
            <div className="pv-media" role="group" aria-label={t("preview.media_label")}>
              <button type="button" aria-pressed={!showVideo} data-act="media-keyframe" onClick={() => setMedia("keyframe")}>{t("preview.media.keyframe")}</button>
              <button type="button" aria-pressed={showVideo} data-act="media-video" disabled={!!playing} onClick={() => setMedia("video")}>{t("preview.media.video")}</button>
            </div>
          ) : null}
          {position ? (
            <nav className="pv-nav" aria-label={t("preview.nav_label")}>
              <button
                type="button"
                className="pv-step"
                data-act="prev-shot"
                aria-label={position.previous ? t("preview.prev_shot", { shot: position.previous.label }) : t("preview.prev_none")}
                title={position.previous ? t("preview.prev_shot", { shot: position.previous.label }) : t("preview.prev_none")}
                disabled={!position.previous}
                onClick={() => step(position.previous, position.index === 2)}
              >
                <PrevIcon />
              </button>
              <span className="pv-pos" role="status" aria-label={t("preview.position_label", { index: position.index, total: position.total })} data-index={position.index} data-total={position.total}>
                {t("preview.position", { index: position.index, total: position.total })}
              </span>
              <button
                type="button"
                className="pv-step"
                data-act="next-shot"
                aria-label={position.next ? t("preview.next_shot", { shot: position.next.label }) : t("preview.next_none")}
                title={position.next ? t("preview.next_shot", { shot: position.next.label }) : t("preview.next_none")}
                disabled={!position.next}
                onClick={() => step(position.next, position.index === position.total - 1)}
              >
                <NextIcon />
              </button>
            </nav>
          ) : null}
        </div>
      </div>
      {player ? null : (
      <div className="pv-bottom">
        {picture && !making ? <p className="pv-caption">{caption}</p> : null}
        <div className="scrub">
          <button
            type="button"
            className="play"
            data-act="play"
            data-shot={shot.shotId}
            aria-label={playing ? t("preview.pause") : t("preview.play")}
            disabled={!picture || making}
            onClick={onTogglePlay}
          >
            {playing ? <StopIcon /> : <PlayIcon />}
          </button>
          <span ref={time}>{clock(0)}</span>
          <div className="track" role="progressbar" aria-label={t("preview.progress")} aria-valuemin={0} aria-valuemax={durationSeconds}><i ref={bar} /></div>
          <span>{clock(durationSeconds)}</span>
        </div>
        {showVideo && !live ? <p className="pv-sample" data-act="clip-stand-in">{t("preview.clip.sample")}</p> : null}
      </div>
      )}
    </section>
  );
}

/** One clip with the browser's own controls (seek, pause, volume), for the Video side of the preview. */
function ClipPlayer({ artifact, label }: { artifact: StudioArtifactRef; label: string }) {
  const { t } = useI18n();
  const source = useArtifactUrl(artifact);
  if (source.status === "failed") return <div className="pic-note" role="status" data-clip-state="failed">{t("preview.clip.failed")}</div>;
  if (source.status !== "ready") return <div className="pic-note pic-loading" role="status" data-clip-state="loading">{t("preview.clip.loading")}</div>;
  return <video className="pv-video" src={source.url} controls playsInline preload="metadata" aria-label={t("preview.clip.label", { shot: label })} data-act="clip-player" />;
}

/** A shot's finished clip, played over the keyframe (live studio only; fixture clips are not media). */
function Clip({ shot, onEnded, bar, time }: { shot: ShotOverview; onEnded(): void; bar: RefObject<HTMLElement | null>; time: RefObject<HTMLSpanElement | null> }) {
  const source = useArtifactUrl(shot.video.artifact ?? null);
  const { t } = useI18n();
  const ended = useRef(onEnded);
  ended.current = onEnded;
  // A clip that cannot be loaded ends at once, so a scene playback moves on.
  useEffect(() => { if (source.status === "failed") ended.current(); }, [source.status]);
  if (source.status !== "ready") return null;
  return (
    <video
      className="pv-clip"
      src={source.url}
      autoPlay
      playsInline
      aria-label={t("preview.play_clip")}
      onTimeUpdate={(event) => {
        const video = event.currentTarget;
        const p = video.duration ? video.currentTime / video.duration : 0;
        if (bar.current) bar.current.style.width = `${p * 100}%`;
        if (time.current) time.current.textContent = clock(video.currentTime);
      }}
      onEnded={onEnded}
      onError={onEnded}
    />
  );
}
