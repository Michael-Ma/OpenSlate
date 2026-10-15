import type { StudioArtifactRef } from "@openslate/core/public";
import { memo, useMemo } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { useArtifactUrl } from "../../media/useArtifactUrl.ts";
import { waveHeights, type AssetTile } from "../../model/assets.ts";

/** A verified picture from the shared artifact cache (the same cache the Keyframes view uses). */
export function AssetPicture({ artifact, alt }: { artifact: StudioArtifactRef | null; alt: string }) {
  const { t } = useI18n();
  const source = useArtifactUrl(artifact);
  if (!artifact) return <span className="av-pic-note">{t("assets.picture.none")}</span>;
  if (source.status === "failed") return <span className="av-pic-note" role="img" aria-label={alt}>{t("assets.picture.failed", { code: source.code })}</span>;
  if (source.status !== "ready") return <span className="av-pic-note av-pic-loading" role="img" aria-label={t("assets.picture.loading")} />;
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
export function AssetFace({ tile, alt, bars }: { tile: AssetTile; alt: string; bars: number }) {
  if (tile.item.artifact.kind === "audio") return <Wave seed={tile.item.artifact.artifactId} bars={bars} />;
  if (tile.item.artifact.kind === "video" && !tile.picture) return <span className="av-pic-note av-video-face" aria-hidden="true"><PlayGlyph /></span>;
  return <AssetPicture artifact={tile.picture} alt={alt} />;
}

/** One asset: picture, kind and length, label, ✓ Current / Earlier and its source. A real toggle button. */
export const AssetTileButton = memo(function AssetTileButton({ tile, selected, onSelect }: { tile: AssetTile; selected: boolean; onSelect(key: string): void }) {
  const { tm } = useI18n();
  const title = tm(tile.title);
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
      <span className="tile-pic">
        <AssetFace tile={tile} alt={title} bars={28} />
        {tile.tag && <span className="kind">{tile.tag.glyph === "play" ? <PlayGlyph /> : <NoteGlyph />} {tm(tile.tag.label)}</span>}
        {tile.duration && <span className="dur">{tm(tile.duration)}</span>}
      </span>
      <b>{title}</b>
      <span className="sub">
        {tile.use.on ? <span className="cur"><span aria-hidden="true">✓ </span>{tm(tile.use.label)}</span> : <span>{tm(tile.use.label)}</span>}
        <span>· {tm(tile.source)}</span>
      </span>
    </button>
  );
});
