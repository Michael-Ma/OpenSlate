import type { StudioArtifactRef } from "@openslate/core/public";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { Picture } from "../keyframes/parts.tsx";
import { Modal } from "../views/plan/Modal.tsx";
import { useMode } from "../store/react.tsx";
import { useArtifactUrl } from "./useArtifactUrl.ts";
import "./viewer.css";

export interface ViewerItem {
  key: string;
  artifact: StudioArtifactRef;
  title: string;
  /** A line under the picture: its model, status or price. */
  detail?: string;
}

/** Thumbnail boxes follow the picture's own shape, within these bounds, so nothing is cropped away. */
export const ASPECT_BOUNDS = { min: 9 / 21, max: 21 / 9 } as const;
export const boundedAspect = (aspect: number | null): number | null =>
  aspect && Number.isFinite(aspect) && aspect > 0 ? Math.min(ASPECT_BOUNDS.max, Math.max(ASPECT_BOUNDS.min, aspect)) : null;

/** The decoded picture's shape for its box (`style`), from Picture's onDecoded; null until it has loaded. */
export function useNaturalAspect(): { aspect: number | null; onDecoded(key: string, aspect: number | null): void; style: { aspectRatio: string } | undefined } {
  const [aspect, setAspect] = useState<number | null>(null);
  const bounded = boundedAspect(aspect);
  return { aspect: bounded, onDecoded: (_key, value) => setAspect(value), style: bounded ? { aspectRatio: String(bounded) } : undefined };
}

/**
 * One picture or clip at full size, among its siblings: ← and → step through them, Esc or Close leaves (focus goes
 * back to what opened it). Shared by every view whose thumbnails open larger.
 */
export function MediaViewer({ items, start, onClose }: { items: ViewerItem[]; start: number; onClose(): void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(() => Math.max(0, Math.min(start, items.length - 1)));
  const count = items.length, many = count > 1;
  const step = (delta: number) => setIndex((current) => (current + delta + count) % count);
  // On the window while open: focus may sit on the dialog itself (a click on its frame), not inside it. A clip's own
  // controls keep their arrow keys.
  useEffect(() => {
    if (count < 2) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === "VIDEO") return;
      if (event.key === "ArrowLeft") { event.preventDefault(); setIndex((current) => (current - 1 + count) % count); }
      else if (event.key === "ArrowRight") { event.preventDefault(); setIndex((current) => (current + 1) % count); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);
  const item = items[index];
  if (!item) return null;
  return (
    <Modal className="media-viewer" labelledBy="media-viewer-title" onClose={onClose}>
      <div className="mv-body" data-index={index}>
        <div className="mv-head" data-modal-chrome>
          <h2 id="media-viewer-title" title={item.title}>{item.title}</h2>
          {many ? <span className="mv-count">{t("viewer.count", { n: index + 1, total: items.length })}</span> : null}
          <button type="button" className="pill sm" data-act="viewer-close" data-autofocus onClick={onClose}>{t("viewer.close")}</button>
        </div>
        <div className="mv-stage" key={item.key}>
          {item.artifact.kind === "video" ? <ViewerClip artifact={item.artifact} title={item.title} /> : <Picture artifact={item.artifact} alt={item.title} />}
        </div>
        <div className="mv-foot">
          {item.detail ? <p className="mv-detail">{item.detail}</p> : <span />}
          {many ? (
            <div className="mv-nav">
              <button type="button" className="pill sm" data-act="viewer-prev" aria-label={t("viewer.prev")} onClick={() => step(-1)}>←</button>
              <button type="button" className="pill sm" data-act="viewer-next" aria-label={t("viewer.next")} onClick={() => step(1)}>→</button>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

function ViewerClip({ artifact, title }: { artifact: StudioArtifactRef; title: string }) {
  const { t } = useI18n();
  // The sample studio has no video files: the clip's first frame stands in, as in Film's player.
  const live = useMode() === "live";
  const source = useArtifactUrl(live ? artifact : null);
  if (!live) return <Picture artifact={{ ...artifact, kind: "image" }} alt={title} />;
  if (source.status === "failed") return <div className="pic-note" role="status">{t("preview.clip.failed")}</div>;
  if (source.status !== "ready") return <div className="pic-note pic-loading" role="status">{t("preview.clip.loading")}</div>;
  return <video className="mv-video" src={source.url} controls autoPlay playsInline aria-label={title} />;
}
