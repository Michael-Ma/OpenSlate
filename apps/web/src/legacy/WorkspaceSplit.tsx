import { useTranslation } from "./Locale";
import { workbenchCopy } from "./workbench-copy";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  clampDirectorWidth,
  directorWidthForKey,
  directorWidthLimit,
  DEFAULT_DIRECTOR_WIDTH,
  MIN_DIRECTOR_WIDTH,
} from "./workspace-layout-model";

const preferenceKey = "openslate.director-width.v1";
function savedWidth() {
  try {
    const value = localStorage.getItem(preferenceKey);
    return value === null
      ? DEFAULT_DIRECTOR_WIDTH
      : clampDirectorWidth(Number(value), 0);
  } catch {
    return DEFAULT_DIRECTOR_WIDTH;
  }
}
export function useWorkspaceSplit(active: boolean) {
  const { t, ui } = useTranslation();

  const grid = useRef<HTMLElement>(null),
    pointer = useRef<number | null>(null);
  const [preferred, setPreferred] = useState(savedWidth),
    latest = useRef(preferred);
  const [containerWidth, setContainerWidth] = useState(0),
    [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!active || !grid.current) return;
    const element = grid.current,
      measure = () => setContainerWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [active]);
  const width = clampDirectorWidth(preferred, containerWidth);
  const set = (value: number) => {
    latest.current = clampDirectorWidth(
      value,
      grid.current?.getBoundingClientRect().width ?? containerWidth,
    );
    setPreferred(latest.current);
  };
  const persist = () => {
    try {
      localStorage.setItem(preferenceKey, String(latest.current));
    } catch {
      /* Layout remains usable when browser storage is unavailable. */
    }
  };
  const finish = () => {
    pointer.current = null;
    setDragging(false);
    persist();
  };
  const separator = (
    <div
      className="workspace-separator"
      role="separator"
      tabIndex={0}
      aria-label={t("Resize Director panel", "调整导演面板宽度")}
      aria-orientation="vertical"
      aria-controls="director-pane production-pane"
      aria-valuemin={MIN_DIRECTOR_WIDTH}
      aria-valuemax={directorWidthLimit(containerWidth)}
      aria-valuenow={width}
      aria-valuetext={t(
        "Director width {v0} pixels",
        "导演面板宽度 {v0} 像素",
        { v0: width },
      )}
      title={t(
        "Drag to resize · Arrow keys adjust · Double-click to reset",
        "拖动调整宽度 · 方向键微调 · 双击重置",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        if (pointer.current === event.pointerId && grid.current)
          set(event.clientX - grid.current.getBoundingClientRect().left);
      }}
      onPointerUp={(event) => {
        if (pointer.current === event.pointerId) finish();
      }}
      onPointerCancel={finish}
      onLostPointerCapture={() => {
        if (pointer.current !== null) finish();
      }}
      onDoubleClick={() => {
        set(DEFAULT_DIRECTOR_WIDTH);
        persist();
      }}
      onKeyDown={(event) => {
        const next = directorWidthForKey(
          width,
          event.key,
          containerWidth,
          event.shiftKey,
        );
        if (next !== null) {
          event.preventDefault();
          set(next);
          persist();
        }
      }}
    />
  );
  return {
    grid,
    style: { "--director-width": `${width}px` } as CSSProperties,
    dragging,
    separator,
  };
}
