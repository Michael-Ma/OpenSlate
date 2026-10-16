import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { Target } from "../model/types.ts";
import { useStudio } from "../store/react.tsx";
import { usePictureUrl } from "../views/assets/media.ts";
import { useOpenTarget } from "./useOpenTarget.ts";

/**
 * An @ chip in a message or the composer. When it names a scene or shot the film still has, it is a button that
 * opens it (selected and brought into view); otherwise it is plain chip words.
 */
export function RefChip({ label, target, children }: { label: string; target: Target | null; children?: ReactNode }) {
  const { t } = useI18n();
  const openTarget = useOpenTarget();
  const name = useStudio((s) => {
    if (!target || !s.overview) return null;
    if (target.kind === "shot") return s.overview.shots[target.id]?.label ?? null;
    return s.overview.scenes.find((scene) => scene.sceneId === target.id)?.ordinal ?? null;
  });
  if (!target || name === null) return <span className="atchip">@{label}{children}</span>;
  const aria = target.kind === "shot" ? t("director.ref.open_shot", { shot: name }) : t("director.ref.open_scene", { scene: name });
  return (
    <button type="button" className="atchip ref" data-act="open-target" data-target={`${target.kind}:${target.id}`} aria-label={aria} title={aria} onClick={() => openTarget(target)}>
      @{label}
    </button>
  );
}

/** A small verified thumbnail of a picture shown to the Director (the shared artifact cache; nothing remote). */
export function PictureThumb({ picture, alt }: { picture: { artifactId: string; sha256: string }; alt: string }) {
  const { t } = useI18n();
  const source = usePictureUrl({ artifactId: picture.artifactId, sha256: picture.sha256, kind: "image" });
  if (source.status === "ready") return <img className="pic-thumb" src={source.url} alt={alt} draggable={false} />;
  if (source.status === "failed") return <span className="pic-thumb failed" role="img" aria-label={alt} title={t("director.picture.failed", { code: source.code })} />;
  return <span className="pic-thumb loading" role="img" aria-label={alt} />;
}
