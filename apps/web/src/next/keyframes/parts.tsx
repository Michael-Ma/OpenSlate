import type { StudioArtifactRef } from "@openslate/core/public";
import { useEffect, useState, type RefObject } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { artifactKey } from "../media/artifact-cache.ts";
import { useArtifactUrl } from "../media/useArtifactUrl.ts";
import type { CardTone } from "../model/keyframes.ts";
import type { Msg } from "../model/types.ts";

/** Status pill coloured by tone: green only for an opened frame (or saved clip). */
export function StatusPill({ status, tone }: { status: Msg; tone: CardTone }) {
  const { tm } = useI18n();
  const className = tone === "opened" ? "status ok" : tone === "working" ? "status busy" : tone === "attention" ? "status attn" : "status";
  return (
    <span className={className} data-tone={tone}>
      {tone === "opened" ? <span aria-hidden="true">✓</span> : null}
      {tm(status)}
    </span>
  );
}

/**
 * A verified picture from the shared artifact cache. Reports once the exact artifact has loaded and decoded,
 * which is what "Opened" is based on (plan item WA-9).
 */
export function Picture({ artifact, alt, onDecoded }: { artifact: StudioArtifactRef; alt: string; onDecoded?(key: string): void }) {
  const { t } = useI18n();
  const source = useArtifactUrl(artifact);
  const key = artifactKey(artifact);
  if (source.status === "failed") return <div className="pic-note" role="img" aria-label={alt}>{t("preview.failed")}</div>;
  if (source.status !== "ready") return <div className="pic-note pic-loading" role="img" aria-label={t("preview.loading")} />;
  return (
    <img
      key={key}
      className="pic-img"
      src={source.url}
      alt={alt}
      draggable={false}
      onLoad={(event) => {
        const image = event.currentTarget;
        const done = () => onDecoded?.(key);
        if (typeof image.decode === "function") image.decode().then(done, done);
        else done();
      }}
    />
  );
}

/** Follows prefers-reduced-motion. */
export function useReducedMotion(): boolean {
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

/** True while at least half of the element is on screen (treated as visible where IntersectionObserver is missing). */
export function useOnScreen(ref: RefObject<Element | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) setVisible(entry.isIntersecting && entry.intersectionRatio >= 0.5);
    }, { threshold: [0, 0.5, 1] });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return visible;
}
