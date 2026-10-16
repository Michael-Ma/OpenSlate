import { useI18n } from "../i18n/I18n.tsx";
import type { KeyframesView } from "../model/keyframes.ts";
import type { Msg } from "../model/types.ts";

/** Scene title, status line and the scene pills. The selected pill is white. */
export function SceneHeader({ view, held, onScene }: { view: KeyframesView; held: Msg | null; onScene(sceneId: string): void }) {
  const { t, tm } = useI18n();
  const { header, pills } = view;
  return (
    <div className="scene-head">
      <h1>{header.title}</h1>
      <span className="line">{t("scene.header.status", { scene: header.ordinal, shots: header.shots, state: tm(header.status) })}</span>
      <nav className="scene-pills" aria-label={t("scene.pills_label")}>
        {pills.map((pill) => (
          <button
            key={pill.sceneId}
            type="button"
            className="pill"
            aria-pressed={pill.selected}
            data-act="scene"
            data-scene={pill.sceneId}
            disabled={!!held && !pill.selected}
            title={held && !pill.selected ? tm(held) : undefined}
            onClick={() => onScene(pill.sceneId)}
          >
            {t("scene.pill.label", { scene: pill.ordinal, title: pill.title })}
            {pill.status ? ` · ${tm(pill.status)}` : ""}
          </button>
        ))}
      </nav>
    </div>
  );
}
