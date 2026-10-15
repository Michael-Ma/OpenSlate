import { useEffect } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { PickerItem } from "../model/director.ts";

export const pickerOptionId = (listId: string, item: PickerItem) => `${listId}-${item.key.replace(/[^\w-]/g, "_")}`;

/**
 * The @ picker: a listbox of scenes and shots above the composer. Focus stays in the textarea
 * (aria-activedescendant); arrow keys, Enter and Esc are handled there. Options are buttons for the mouse.
 */
export function AtPicker({ listId, items, active, query, onPick, onActive }: {
  listId: string;
  items: PickerItem[];
  active: number;
  query: string;
  onPick(item: PickerItem): void;
  onActive(index: number): void;
}) {
  const { t, tm } = useI18n();
  const activeItem = items[active];
  const activeId = activeItem ? pickerOptionId(listId, activeItem) : null;
  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  if (!items.length) return <div className="picker"><p className="picker-empty" role="status">{t("director.picker.empty", { query })}</p></div>;
  const option = (item: PickerItem) => {
    const index = items.indexOf(item);
    return (
      <button
        type="button"
        role="option"
        key={item.key}
        id={pickerOptionId(listId, item)}
        tabIndex={-1}
        aria-selected={index === active}
        data-act="pick"
        data-target={item.key}
        // Keep focus (and the caret) in the textarea.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => { if (index !== active) onActive(index); }}
        onClick={() => onPick(item)}
      >
        {tm(item.label)}
        {item.detail && <span>{item.detail}</span>}
      </button>
    );
  };
  const scenes = items.filter((item) => item.group === "scene");
  const shots = items.filter((item) => item.group === "shot");
  return (
    <div className="picker">
      <div role="listbox" id={listId} aria-label={t("director.composer.pick")}>
        {scenes.length > 0 && (
          <div role="group" aria-label={t("director.picker.scenes")}>
            <h4 aria-hidden="true">{t("director.picker.scenes")}</h4>
            {scenes.map(option)}
          </div>
        )}
        {shots.length > 0 && (
          <div role="group" aria-label={t("director.picker.shots")}>
            <h4 aria-hidden="true">{t("director.picker.shots")}</h4>
            {shots.map(option)}
          </div>
        )}
      </div>
    </div>
  );
}
