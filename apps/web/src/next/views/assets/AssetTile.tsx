import type { StudioArtifactRef } from "@openslate/core/public";
import { memo, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { artifactKey } from "../../media/artifact-cache.ts";
import { PICTURE_LOADS_AT_ONCE, SlotQueue, waveHeights, type AssetTile } from "../../model/assets.ts";
import { usePictureUrl } from "./media.ts";

/** Tile pictures load a few at a time, so a large library does not fetch and check every picture at once. */
const pictureLoads = new SlotQueue(PICTURE_LOADS_AT_ONCE);

/** True once the element is within a screen of being seen in its scrolling list (and from then on). */
function useNearScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (near) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const scroller = element.closest<HTMLElement>(".groups");
    const root = scroller && /(auto|scroll)/.test(getComputedStyle(scroller).overflowY) ? scroller : null;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { root, rootMargin: "400px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref]);
  return near;
}

/**
 * A verified picture from the shared artifact cache (the same cache the Keyframes view uses). An empty `alt`
 * makes it decorative, as inside a tile, whose button is already named. `lazy` pictures wait until they are
 * `near` the screen and then take their turn in the load queue.
 */
export function AssetPicture({ artifact, alt, lazy = false, near = true }: { artifact: StudioArtifactRef | null; alt: string; lazy?: boolean; near?: boolean }) {
  const { t } = useI18n();
  const [granted, setGranted] = useState(!lazy);
  const source = usePictureUrl(granted ? artifact : null);
  const settled = source.status === "ready" || source.status === "failed";
  const key = artifact ? artifactKey(artifact) : null;
  useEffect(() => {
    if (!lazy || !near || !key || settled) return;
    let live = true;
    const release = pictureLoads.take(() => { if (live) setGranted(true); });
    return () => { live = false; release(); };
  }, [lazy, near, key, settled]);

  const decorative = alt === "";
  if (!artifact) return <span className="av-pic-note" aria-hidden={decorative || undefined}>{t("assets.picture.none")}</span>;
  if (source.status === "failed")
    return decorative
      ? <span className="av-pic-note" aria-hidden="true">{t("assets.picture.failed", { code: source.code })}</span>
      : <span className="av-pic-note" role="img" aria-label={alt}>{t("assets.picture.failed", { code: source.code })}</span>;
  if (source.status !== "ready")
    return decorative
      ? <span className="av-pic-note av-pic-loading" aria-hidden="true" />
      : <span className="av-pic-note av-pic-loading" role="img" aria-label={t("assets.picture.loading")} />;
  return <img className="av-img" src={source.url} alt={alt} draggable={false} />;
}

/** A decorative waveform: the library does not decode audio just to draw it. */
export function Wave({ seed, bars }: { seed: string; bars: number }) {
  const heights = useMemo(() => waveHeights(seed, bars), [seed, bars]);
  return (
    <span className="wave" aria-hidden="true">
      {heights.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
    </span>
  );
}

const PlayGlyph = () => <svg width="8" height="8" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>;
const NoteGlyph = () => <span aria-hidden="true">♪</span>;

/** What a tile or the detail shows for an asset: the picture, a clip's keyframe, or a waveform. */
export function AssetFace({ tile, alt, bars, lazy = false, near = true }: { tile: AssetTile; alt: string; bars: number; lazy?: boolean; near?: boolean }) {
  if (tile.item.artifact.kind === "audio") return <Wave seed={tile.item.artifact.artifactId} bars={bars} />;
  if (tile.item.artifact.kind === "video" && !tile.picture) return <span className="av-pic-note av-video-face" aria-hidden="true"><PlayGlyph /></span>;
  return <AssetPicture artifact={tile.picture} alt={alt} lazy={lazy} near={near} />;
}

/**
 * One asset: picture, kind and length, label, ✓ Current / Earlier and its source. A real toggle button, named
 * by its label, kind tag and status; the picture inside is decorative (the detail panel describes it).
 */
export const AssetTileButton = memo(function AssetTileButton({ tile, selected, onSelect }: { tile: AssetTile; selected: boolean; onSelect(key: string): void }) {
  const { tm } = useI18n();
  const picture = useRef<HTMLSpanElement>(null);
  const near = useNearScreen(picture);
  return (
    <button
      type="button"
      className="tile"
      aria-pressed={selected}
      data-act="select-asset"
      data-asset={tile.key}
      data-role={tile.item.role}
      data-current={tile.item.current ? "true" : "false"}
      onClick={() => onSelect(tile.key)}
    >
      <span className="tile-pic" ref={picture}>
        <AssetFace tile={tile} alt="" bars={28} lazy near={near} />
        {tile.tag && <span className="kind">{tile.tag.glyph === "play" ? <PlayGlyph /> : <NoteGlyph />} {tm(tile.tag.label)}</span>}
        {tile.duration && <span className="dur">{tm(tile.duration)}</span>}
      </span>
      <b>{tm(tile.title)}</b>
      <span className="sub">
        {tile.use.on ? <span className="cur"><span aria-hidden="true">✓ </span>{tm(tile.use.label)}</span> : <span>{tm(tile.use.label)}</span>}
        <span>· {tm(tile.source)}</span>
      </span>
    </button>
  );
});
