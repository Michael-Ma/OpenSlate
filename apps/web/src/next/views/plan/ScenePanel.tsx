import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { SceneView } from "../../model/plan.ts";
import type { Msg } from "../../model/types.ts";
import { Menu } from "./Menu.tsx";
import { NoteChips } from "./ShotRow.tsx";
import { NoneImpact, SaveError } from "./TextPanel.tsx";

export const sceneElementId = (sceneId: string) => `plan-scene-${sceneId}`;

interface Props {
  scene: SceneView;
  editing: "title" | "direction" | null;
  saving: boolean;
  guard: string | undefined;
  busy: boolean;
  error: Msg | null;
  flash: boolean;
  /** The scene's shot rows (the editor takes the place of the row it edits). */
  children: ReactNode;
  onMove(direction: -1 | 1): void;
  onPoint(): void;
  onRename(): void;
  onEditDirection(): void;
  onDelete(): void;
  onCancel(): void;
  onSaveTitle(value: string): void;
  onSaveDirection(value: string): void;
  onAddShot(): void;
}

/** One scene: number, title and meta line, ↑ ↓, @ Scene n and •••; its direction; its shots; Add shot. */
export function ScenePanel({ scene, editing, saving, guard, busy, error, flash, children, onMove, onPoint, onRename, onEditDirection, onDelete, onCancel, onSaveTitle, onSaveDirection, onAddShot }: Props) {
  const { t, tm } = useI18n();
  const off = !!guard || busy;
  const n = scene.ordinal;
  const offTitle = guard ? { title: guard } : {};
  return (
    <section className={`scene panel${flash ? " flash" : ""}`} id={sceneElementId(scene.sceneId)} data-scene={scene.sceneId} aria-label={t("plan.scene.aria", { scene: n, title: scene.title })}>
      <div className="scene-top">
        <span className="sno" aria-hidden="true">{n}</span>
        {editing === "title" ? (
          <InlineForm
            className="title-edit"
            form="title"
            label={t("plan.scene.title_label")}
            initial={scene.title}
            multiline={false}
            saving={saving}
            guard={guard}
            hint={<span className="hint">{t("plan.scene.rename_hint")}</span>}
            onCancel={onCancel}
            onSave={onSaveTitle}
          />
        ) : (
          <>
            <h2>{scene.title}</h2>
            <span className="meta">{t("plan.scene.meta", { shots: scene.shots.length, seconds: scene.seconds, state: tm(scene.state) })}</span>
          </>
        )}
        {editing === "title" ? null : (
          <span className="end">
            <button type="button" className="icon-btn" data-act="scene-up" data-scene={scene.sceneId} aria-label={t("plan.scene.up", { scene: n })} disabled={off || scene.first} title={guard} onClick={() => onMove(-1)}>
              <Arrow up />
            </button>
            <button type="button" className="icon-btn" data-act="scene-down" data-scene={scene.sceneId} aria-label={t("plan.scene.down", { scene: n })} disabled={off || scene.last} title={guard} onClick={() => onMove(1)}>
              <Arrow up={false} />
            </button>
            <button type="button" className="pill sm" data-act="point-scene" data-scene={scene.sceneId} aria-label={t("plan.scene.point_label", { scene: n })} onClick={onPoint}>
              {t("plan.scene.point", { scene: n })}
            </button>
            <Menu
              label={t("plan.scene.more", { scene: n })}
              act="scene-menu"
              data={{ "data-scene": scene.sceneId }}
              items={[
                { act: "rename-scene", label: t("plan.scene.rename"), onSelect: onRename, disabled: off, ...offTitle },
                { act: "edit-direction", label: t("plan.scene.edit_direction"), onSelect: onEditDirection, disabled: off, ...offTitle },
                { act: "delete-scene", label: t(scene.shots.length ? "plan.scene.delete" : "plan.scene.delete_empty", { scene: n }), onSelect: onDelete, disabled: off, separated: true, ...offTitle },
              ]}
            />
          </span>
        )}
      </div>
      {editing === "title" ? <div className="title-error"><SaveError error={error} /></div> : null}
      {editing === "direction" ? (
        <InlineForm
          className="dir-edit"
          form="direction"
          label={t("plan.scene.direction_label")}
          visibleLabel
          initial={scene.direction}
          multiline
          saving={saving}
          guard={guard}
          error={error}
          hint={<NoneImpact text="plan.scene.direction_impact" />}
          onCancel={onCancel}
          onSave={onSaveDirection}
        />
      ) : (
        <p className="direction">
          <span className="lbl">{t("plan.scene.direction")}</span>
          {scene.direction || <span className="muted">{t("plan.scene.direction_none")}</span>}
        </p>
      )}
      {scene.notes.length ? <div className="scene-notes"><NoteChips notes={scene.notes} /></div> : null}
      {scene.shots.length ? <ol className="shots">{children}</ol> : <div className="scene-empty">{t("plan.scene.empty")}</div>}
      <div className="add-row">
        <button type="button" className="pill sm ghost" data-act="add-shot" data-scene={scene.sceneId} disabled={off} title={guard} onClick={onAddShot}>
          <span aria-hidden="true">+</span> {t("plan.scene.add_shot")}
        </button>
      </div>
    </section>
  );
}

function Arrow({ up }: { up: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={up ? undefined : { transform: "rotate(180deg)" }}>
      <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface InlineProps {
  className: string;
  form: string;
  label: string;
  visibleLabel?: boolean;
  initial: string;
  multiline: boolean;
  saving: boolean;
  guard: string | undefined;
  error?: Msg | null;
  hint: ReactNode;
  onCancel(): void;
  onSave(value: string): void;
}

/** A title or direction edited in place, with Save and Cancel; Esc cancels. */
function InlineForm({ className, form, label, visibleLabel, initial, multiline, saving, guard, error, hint, onCancel, onSave }: InlineProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const id = `plan-${form}-input`;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() || saving || guard) return;
    if (draft.trim() === initial.trim()) onCancel();
    else onSave(draft.trim());
  };
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); onCancel(); } };
  const select = (element: HTMLInputElement | HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length);
  return (
    <form className={className} data-form={form} onSubmit={submit} onKeyDown={onKeyDown}>
      {multiline ? (
        <div className="field">
          <label className={visibleLabel ? undefined : "sr"} htmlFor={id}>{label}</label>
          <textarea id={id} className="textarea" rows={2} value={draft} autoFocus onFocus={(event) => select(event.currentTarget)} onChange={(event) => setDraft(event.target.value)} />
        </div>
      ) : (
        <>
          <label className="sr" htmlFor={id}>{label}</label>
          <input id={id} className="input" maxLength={160} value={draft} autoFocus onFocus={(event) => select(event.currentTarget)} onChange={(event) => setDraft(event.target.value)} />
        </>
      )}
      {multiline ? hint : null}
      {multiline && error !== undefined ? <SaveError error={error} /> : null}
      <span className={multiline ? "edit-foot" : "inline-acts"}>
        <button type="submit" className={`pill${multiline ? "" : " sm"} primary`} data-act={`save-${form}`} disabled={saving || !!guard || !draft.trim()} title={guard}>{t(saving ? "plan.saving" : "plan.save")}</button>
        <button type="button" className={`pill${multiline ? "" : " sm"}`} data-act="cancel-edit" onClick={onCancel}>{t("plan.cancel")}</button>
      </span>
      {multiline ? null : hint}
    </form>
  );
}
