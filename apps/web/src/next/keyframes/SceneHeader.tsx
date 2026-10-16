import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { KeyframesView } from "../model/keyframes.ts";
import { revealScroll } from "../model/keyframes-layout.ts";
import type { Msg } from "../model/types.ts";

/** Scene title, status line and the scene pills. The selected pill is white. */
export function SceneHeader({ view, held, onScene }: { view: KeyframesView; held: Msg | null; onScene(sceneId: string): void }) {
  const { t, tm } = useI18n();
  const { header, pills } = view;
  const row = useRef<HTMLElement>(null);
  const selected = pills.find((pill) => pill.selected);
  const selectedId = selected?.sceneId;
  const selectedText = selected?.status ? tm(selected.status) : "";

  // On a phone the pills scroll sideways inside their row: the selected one is always shown whole. Its text changes
  // as it is chosen (its status drops), so this runs after that render; only the row scrolls, never the page.
  useEffect(() => {
    const container = row.current;
    const element = selectedId ? container?.querySelector<HTMLElement>(`[data-scene="${CSS.escape(selectedId)}"]`) : null;
    if (!container || !element || container.scrollWidth <= container.clientWidth) return;
    container.scrollLeft = revealScroll(container.scrollLeft, container.getBoundingClientRect(), element.getBoundingClientRect());
  }, [selectedId, selectedText]);

  return (
    <div className="scene-head">
      <h1>{header.title}</h1>
      <span className="line">{t("scene.header.status", { scene: header.ordinal, shots: header.shots, state: tm(header.status) })}</span>
      <nav className="scene-pills" ref={row} aria-label={t("scene.pills_label")}>
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
