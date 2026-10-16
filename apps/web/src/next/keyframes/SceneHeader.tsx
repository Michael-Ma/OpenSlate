import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { KeyframesView, ScenePill } from "../model/keyframes.ts";
import { revealScroll } from "../model/keyframes-layout.ts";
import type { Msg } from "../model/types.ts";

/** Scene title, status line and the scene pills. The selected pill is white. */
export function SceneHeader({ view, held, onScene }: { view: KeyframesView; held: Msg | null; onScene(sceneId: string): void }) {
  const { t, tm } = useI18n();
  const { header, pills } = view;
  const row = useRef<HTMLElement>(null);
  const selectedId = pills.find((pill) => pill.selected)?.sceneId;
  const words = pills.map((pill) => `${t("scene.pill.label", { scene: pill.ordinal, title: pill.title })}${pill.status ? ` · ${tm(pill.status)}` : ""}`);
  // Every pill's words: a new status, title or language moves the selected pill along its row.
  const labels = pills.map((pill, index) => `${pill.sceneId}:${words[index]}`).join("|");

  // On a phone the pills scroll sideways inside their row: the selected one is always shown whole, when the view
  // opens, when it is chosen, and whenever a pill or the row changes width (a status, the language, the font
  // arriving, the window). Only the row scrolls, never the page; a row the person scrolled stays put until then.
  useEffect(() => {
    const container = row.current;
    if (!container || !selectedId) return;
    const reveal = () => {
      const element = container.querySelector<HTMLElement>(`[data-scene="${CSS.escape(selectedId)}"]`);
      if (!element || container.scrollWidth <= container.clientWidth) return;
      container.scrollLeft = revealScroll(container.scrollLeft, container.getBoundingClientRect(), element.getBoundingClientRect());
    };
    reveal();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(reveal);
    observer.observe(container);
    for (const pill of container.children) observer.observe(pill);
    return () => observer.disconnect();
  }, [selectedId, labels]);

  return (
    <div className="scene-head">
      <h1>{header.title}</h1>
      <span className="line">{t("scene.header.status", { scene: header.ordinal, shots: header.shots, state: tm(header.status) })}</span>
      <nav className="scene-pills" ref={row} aria-label={t("scene.pills_label")}>
        {pills.map((pill, index) => (
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
            {words[index]}
          </button>
        ))}
      </nav>
    </div>
  );
}
