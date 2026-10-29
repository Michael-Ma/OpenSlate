import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { downloadName, type AssetDetailView, type AssetTile } from "../../model/assets.ts";
import { clock, motionKind, motionTransform } from "../../model/motion.ts";
import { msg } from "../../model/types.ts";
import { useMode, useStore, useStudio } from "../../store/react.tsx";
import { pictureFromAsset } from "../../model/director.ts";
import { useShowToDirector } from "../../director/ShowDirector.tsx";
import { AssetFace, AssetPicture, Wave } from "./AssetTile.tsx";
import { useAssetFile } from "./media.ts";
import { SongAnalysis } from "./SongAnalysis.tsx";

/** Follows prefers-reduced-motion: the picture stays still and only the scrubber moves. */
function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setReduced(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return reduced;
}

const PlayIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>;
const PauseIcon = () => <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1h2.2v8H2zM5.8 1H8v8H5.8z" fill="currentColor" /></svg>;

/** Why a file could not be loaded, in words; a file over the studio's 256 MB limit says so. */
function fileFailure(t: ReturnType<typeof useI18n>["t"], code: string): string {
  return code === "ARTIFACT_TOO_LARGE" ? t("assets.download.too_large") : t("assets.download.failed", { code });
}

/**
 * The picture, or a player for clips and audio. In the studio the verified file plays; it is loaded when Play is
 * first pressed (a clip or an export can be up to 256 MB), and until then a clip shows its keyframe. The sample
 * film has no video or audio files, so its clips play the keyframe's motion and its audio plays silently.
 */
function AssetPreview({ detail, tile, title }: { detail: AssetDetailView; tile: AssetTile; title: string }) {
  const { t } = useI18n();
  const mode = useMode();
  const reduced = useReducedMotion();
  const kind = detail.item.artifact.kind;
  const simulated = mode === "fixture" && kind !== "image" && kind !== "document";
  // Pictures show through AssetPicture; clips and audio load their file once Play is pressed.
  const [wanted, setWanted] = useState(false);
  const file = useAssetFile(kind === "image" || kind === "document" ? null : detail.item, wanted);
  const autoplay = useRef(false);
  const media = useRef<HTMLMediaElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const at = useRef(0);
  const [length, setLength] = useState(detail.item.durationSeconds ?? 0);

  // The sample film's clock: one frame at a time from where it stopped.
  useEffect(() => {
    if (!simulated || !playing || length <= 0) return;
    const start = performance.now() - at.current * 1000;
    let frame = 0;
    const step = (now: number) => {
      const seconds = (now - start) / 1000;
      if (seconds >= length) { at.current = length; setPosition(length); setPlaying(false); return; }
      at.current = seconds;
      setPosition(seconds);
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [simulated, playing, length]);

  // The file arrived after Play was pressed: play it now.
  useEffect(() => {
    if (file.status !== "ready" || !autoplay.current) return;
    autoplay.current = false;
    void media.current?.play().catch(() => setPlaying(false));
  }, [file.status]);

  const toggle = () => {
    if (simulated) {
      if (playing) { setPlaying(false); return; }
      if (at.current >= length) { at.current = 0; setPosition(0); }
      setPlaying(true);
      return;
    }
    if (file.status !== "ready") {
      autoplay.current = true;
      setWanted(true);
      return;
    }
    const element = media.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  };

  const events = {
    onTimeUpdate: () => setPosition(media.current?.currentTime ?? 0),
    onPlay: () => setPlaying(true),
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
    onLoadedMetadata: () => { const d = media.current?.duration; if (d && Number.isFinite(d)) setLength(d); },
  };
  const fraction = length > 0 ? Math.min(1, position / length) : 0;
  const loading = !simulated && wanted && file.status === "loading";
  const failed = !simulated && file.status === "failed";

  let face;
  if (kind === "image") face = <AssetPicture artifact={detail.picture} alt={title} />;
  else if (kind === "video" && !simulated && file.status === "ready")
    face = <video ref={(el) => { media.current = el; }} className="av-video" src={file.url} playsInline preload="metadata" aria-label={title} {...events} />;
  else if (kind === "video")
    face = <span className="av-anim" style={{ transform: simulated && !reduced && detail.motion ? motionTransform(motionKind(detail.motion), fraction) : "none" }}><AssetFace tile={tile} alt={title} bars={60} /></span>;
  else if (kind === "document") face = <AssetFace tile={tile} alt={title} bars={60} />;
  else face = <Wave seed={detail.item.artifact.artifactId} bars={60} />;

  let note = null;
  if (simulated) note = t(kind === "audio" ? "assets.player.no_sound" : "assets.player.motion_only");
  else if (kind !== "image" && kind !== "document" && file.status === "failed") note = fileFailure(t, file.code);
  else if (kind !== "image" && loading) note = t("assets.player.loading");

  return (
    <>
      <div className="big-pic" data-kind={kind}>
        {face}
        {kind === "audio" && (playing || position > 0) && <span className="ph" style={{ left: `${fraction * 100}%` }} aria-hidden="true" />}
        {kind === "audio" && !simulated && file.status === "ready" && <audio ref={(el) => { media.current = el; }} src={file.url} preload="metadata" {...events} />}
      </div>
      {detail.playable && (
        <div className="playrow">
          <button type="button" className="play" data-act="play-asset" aria-label={t(playing ? "assets.pause" : "assets.play")} aria-busy={loading || undefined} disabled={failed} onClick={() => { if (!loading) toggle(); }}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span>{clock(position)}</span>
          <span className="track" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(position)}><i style={{ width: `${fraction * 100}%` }} /></span>
          <span>{clock(length)}</span>
        </div>
      )}
      {note && <span className="hint av-note" role={loading || failed ? "status" : undefined}>{note}</span>}
    </>
  );
}

/**
 * Download the verified file. It is loaded and checked when Download is pressed (not when the asset is
 * selected), then saved; the button keeps focus throughout. The sample film has no files, so it says what the
 * studio would do.
 */
function DownloadAction({ detail, title }: { detail: AssetDetailView; title: string }) {
  const { t } = useI18n();
  const mode = useMode();
  const store = useStore();
  const [wanted, setWanted] = useState(false);
  const file = useAssetFile(mode === "fixture" ? null : detail.item, wanted);
  const link = useRef<HTMLAnchorElement>(null);
  const pending = useRef(false);
  const why = useId();
  const name = downloadName(title, detail.item.artifact.kind);

  // Pressed before the file was ready: save it as soon as it is.
  useEffect(() => {
    if (file.status !== "ready" || !pending.current) return;
    pending.current = false;
    link.current?.click();
  }, [file.status]);

  if (mode === "fixture")
    return <button type="button" className="pill primary" data-act="download" onClick={() => store.dispatch({ type: "toast", message: msg("assets.download.fixture", { name }), tone: "info" })}>{t("assets.download")}</button>;
  const loading = wanted && file.status === "loading";
  const failed = file.status === "failed";
  const press = () => {
    if (loading || failed) return;
    if (file.status === "ready") { link.current?.click(); return; }
    pending.current = true;
    setWanted(true);
  };
  return (
    <>
      <button type="button" className="pill primary" data-act="download" data-state={file.status} aria-busy={loading || undefined} aria-disabled={loading || failed || undefined}
        aria-describedby={loading || failed ? why : undefined} onClick={press}>{t("assets.download")}</button>
      {file.status === "ready" && <a ref={link} className="av-save" href={file.url} download={name} hidden tabIndex={-1} aria-hidden="true" data-act="download-file" />}
      {(loading || failed) && <span className="hint av-why" id={why} role="status">{failed ? fileFailure(t, file.code) : t("assets.download.preparing")}</span>}
    </>
  );
}

/** The detail panel: preview, Kind / Shot / Take / In use / Source / Made / Length, and the actions. */
export function AssetDetail({ detail, tile, headingId, onPoint, onOpen, onShown }: { detail: AssetDetailView; tile: AssetTile; headingId: string; onPoint(): void; onOpen(): void; onShown?(): void }) {
  const { t, tm } = useI18n();
  const title = tm(detail.title);
  // A picture (an imported one, or a shot's keyframe) can be shown to the Director in the next message.
  const overview = useStudio((s) => s.overview);
  const picture = pictureFromAsset(detail.item, overview);
  const show = useShowToDirector();
  return (
    <>
      <AssetPreview key={detail.key} detail={detail} tile={tile} title={title} />
      <h3 id={headingId}>{title}</h3>
      <dl className="rows">
        {detail.rows.map((row) => (
          <div key={row.label.id} className="av-row">
            <dt>{tm(row.label)}</dt>
            <dd>{tm(row.value)}{row.sub && <small>{tm(row.sub)}</small>}</dd>
          </div>
        ))}
      </dl>
      {detail.item.role === "music" && detail.item.artifact.kind === "audio" && (
        <SongAnalysis key={detail.key} audioId={detail.item.artifact.artifactId} sha256={detail.item.artifact.sha256} />
      )}
      <div className="acts">
        <DownloadAction key={detail.key} detail={detail} title={title} />
        {/* Two Director actions, each naming what it acts on: the picture joins the message; Point adds its shot. */}
        {picture && <button type="button" className="pill" data-act="show-director" onClick={() => { if (show(picture)) onShown?.(); }}>{t("assets.show_director")}</button>}
        {detail.point && <button type="button" className="pill" data-act="point-director" onClick={onPoint}>{t("assets.point", { target: tm(detail.point.name) })}</button>}
        {detail.open && <button type="button" className="pill" data-act="open-in" data-target-view={detail.open.view} onClick={onOpen}>{tm(detail.open.label)}</button>}
      </div>
    </>
  );
}
