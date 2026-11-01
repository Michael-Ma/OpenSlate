import type { StudioArtifactRef } from "@openslate/core/public";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { Picture } from "../keyframes/parts.tsx";
import { boundedAspect } from "../model/aspect.ts";
import { Modal } from "../views/plan/Modal.tsx";
import { useMode } from "../store/react.tsx";
import { StepFacts } from "./StepFacts.tsx";
import { useArtifactUrl } from "./useArtifactUrl.ts";
import "./viewer.css";

export interface ViewerItem {
  key: string;
  artifact: StudioArtifactRef;
  title: string;
  /** A line under the picture: its model, status or price. */
  detail?: string;
  /** The code-plan step that made it: its prompt shows beside it. */
  stepKey?: string;
  /** A clip's still, which stands in for it in the sample film. */
  poster?: StudioArtifactRef;
}

/** The decoded picture's shape for its box (`style`), from Picture's onDecoded; null until it has loaded. */
export function useNaturalAspect(): { aspect: number | null; onDecoded(key: string, aspect: number | null): void; style: { aspectRatio: string } | undefined } {
  const [aspect, setAspect] = useState<number | null>(null);
  const bounded = boundedAspect(aspect);
  return { aspect: bounded, onDecoded: (_key, value) => setAspect(value), style: bounded ? { aspectRatio: String(bounded) } : undefined };
}

/**
 * One picture or clip at full size, among its siblings: ← and → step through them, Esc or Close leaves (focus goes
 * back to what opened it). Shared by every view whose thumbnails open larger. `stage` replaces the picture for an item
 * it answers (audio has none), and `side` replaces the step's facts beside it.
 */
export function MediaViewer({ items, start, onClose, stage, side }: { items: ViewerItem[]; start: number; onClose(): void; stage?: (item: ViewerItem) => ReactNode; side?: (item: ViewerItem) => ReactNode }) {
  const { t } = useI18n();
  // By key, not place: a list that refreshes behind the viewer must not change what is on screen.
  const [shown, setShown] = useState(() => items[Math.max(0, Math.min(start, items.length - 1))]?.key);
  const found = items.findIndex((candidate) => candidate.key === shown);
  const index = found >= 0 ? found : Math.max(0, Math.min(start, items.length - 1));
  const count = items.length, many = count > 1;
  const step = useCallback((delta: number) => setShown(items[(index + delta + count) % count]?.key), [items, index, count]);
  // On the window while open: focus may sit on the dialog itself (a click on its frame), not inside it. A clip's own
  // controls keep their arrow keys.
  useEffect(() => {
    if (count < 2) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (["VIDEO", "AUDIO"].includes((event.target as HTMLElement | null)?.tagName ?? "")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
      else if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, step]);
  const item = items[index];
  if (!item) return null;
  const aside = side ? side(item) : item.stepKey ? <StepFacts stepKey={item.stepKey} /> : null;
  return (
    <Modal className="media-viewer" labelledBy="media-viewer-title" onClose={onClose}>
      <div className="mv-body" data-index={index}>
        <div className="mv-head" data-modal-chrome>
          <h2 id="media-viewer-title" title={item.title}>{item.title}</h2>
          {many ? <span className="mv-count">{t("viewer.count", { n: index + 1, total: items.length })}</span> : null}
          <button type="button" className="pill sm" data-act="viewer-close" data-autofocus onClick={onClose}>{t("viewer.close")}</button>
        </div>
        <div className="mv-main" data-sided={aside ? "true" : undefined}>
          <div className="mv-stage" key={item.key}>
            {stage?.(item) ?? (item.artifact.kind === "video" ? <ViewerClip artifact={item.artifact} poster={item.poster} title={item.title} /> : <Picture artifact={item.artifact} alt={item.title} />)}
          </div>
          {aside ? <aside className="mv-side" key={`${item.key}:side`} aria-label={t("viewer.details")}>{aside}</aside> : null}
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

export function ViewerClip({ artifact, poster, title, onShape }: { artifact: StudioArtifactRef; poster: StudioArtifactRef | undefined; title: string; onShape?: (aspect: number) => void }) {
  const { t } = useI18n();
  // The sample studio has no video files: the clip's first frame stands in, as in Film's player.
  const live = useMode() === "live";
  const source = useArtifactUrl(live ? artifact : null);
  if (!live) return <Picture artifact={poster ?? { ...artifact, kind: "image" }} alt={title} />;
  if (source.status === "failed") return <div className="pic-note" role="status">{t("preview.clip.failed")}</div>;
  if (source.status !== "ready") return <div className="pic-note pic-loading" role="status">{t("preview.clip.loading")}</div>;
  return <video className="mv-video" src={source.url} controls autoPlay playsInline aria-label={title} onLoadedMetadata={(event) => { const { videoWidth: width, videoHeight: height } = event.currentTarget; if (width && height) onShape?.(width / height); }} />;
}
