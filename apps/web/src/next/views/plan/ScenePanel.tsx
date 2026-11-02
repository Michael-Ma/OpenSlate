import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { SceneView } from "../../model/plan.ts";
import type { Msg } from "../../model/types.ts";
import { Menu } from "./Menu.tsx";
import type { Unconfirmed } from "./Notices.tsx";
import { NoteChips } from "./ShotRow.tsx";
import { FormNotices, NoneImpact, SaveError, useHeldText } from "./TextPanel.tsx";
import type { DraftSlot } from "./useHeld.ts";

export const sceneElementId = (sceneId: string) => `plan-scene-${sceneId}`;

interface Props {
  scene: SceneView;
  editing: "title" | "direction" | null;
  saving: boolean;
  guard: string | undefined;
  busy: boolean;
  error: Msg | null;
  /** The open title or direction save's reply was lost. */
  unconfirmed: Unconfirmed | null;
  /** Where the open title or direction draft is kept. */
  slot: DraftSlot;
  flash: boolean;
  /** A dragged shot would land at the end of this scene. */
  dropEnd: boolean;
  /** Drag-and-drop handlers for the scene as a drop target. */
  drop: HTMLAttributes<HTMLElement>;
  /** The scene's shot rows (the editor takes the place of the row it edits). */
  children: ReactNode;
  onRetry(): void;
  onDismiss(): void;
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
export function ScenePanel({ scene, editing, saving, guard, busy, error, unconfirmed, slot, flash, dropEnd, drop, children, onRetry, onDismiss, onMove, onPoint, onRename, onEditDirection, onDelete, onCancel, onSaveTitle, onSaveDirection, onAddShot }: Props) {
  const { t, tm } = useI18n();
  const off = !!guard || busy;
  const n = scene.ordinal;
  const offTitle = guard ? { title: guard } : {};
  return (
    <section className={`scene panel${flash ? " flash" : ""}${dropEnd ? " drop-end" : ""}`} id={sceneElementId(scene.sceneId)} data-scene={scene.sceneId} aria-label={t("plan.scene.aria", { scene: n, title: scene.title })} {...drop}>
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
            unconfirmed={unconfirmed}
            slot={slot}
            onRetry={onRetry}
            onDismiss={onDismiss}
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
      {editing === "title" && !unconfirmed ? <div className="title-error"><SaveError error={error} /></div> : null}
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
          unconfirmed={unconfirmed}
          slot={slot}
          onRetry={onRetry}
          onDismiss={onDismiss}
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
  unconfirmed: Unconfirmed | null;
  slot: DraftSlot;
  hint: ReactNode;
  onRetry(): void;
  onDismiss(): void;
  onCancel(): void;
  onSave(value: string): void;
}

/**
 * A title or direction edited in place, with Save and Cancel; Esc cancels. Held against the saved value like every
 * Plan editor: the saved film changing under the person's text waits for their choice.
 */
function InlineForm({ className, form, label, visibleLabel, initial, multiline, error, hint, ...state }: InlineProps) {
  const { t } = useI18n();
  const { held, value, stale, canSave, submit, hint: blocked, ids, keep, takeSaved, fieldAria } = useHeldText(initial, state);
  const id = ids.input;
  const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); state.onCancel(); } };
  const select = (element: HTMLInputElement | HTMLTextAreaElement) => element.setSelectionRange(element.value.length, element.value.length);
  const notices = <FormNotices conflictId={ids.conflict} stale={stale} unconfirmed={state.unconfirmed} saving={state.saving} onKeep={keep} onTakeSaved={takeSaved} onRetry={state.onRetry} onDismiss={state.onDismiss} />;
  return (
    <form className={className} data-form={form} onSubmit={submit} onKeyDown={onKeyDown}>
      {multiline ? (
        <div className="field">
          <label className={visibleLabel ? undefined : "sr"} htmlFor={id}>{label}</label>
          <textarea id={id} className="textarea" rows={2} value={value} autoFocus data-conflict={stale || undefined} {...fieldAria} onFocus={(event) => select(event.currentTarget)} onChange={(event) => held.set("text", event.target.value)} />
        </div>
      ) : (
        <>
          <label className="sr" htmlFor={id}>{label}</label>
          <input id={id} className="input" maxLength={160} value={value} autoFocus data-conflict={stale || undefined} {...fieldAria} onFocus={(event) => select(event.currentTarget)} onChange={(event) => held.set("text", event.target.value)} />
        </>
      )}
      {multiline ? hint : null}
      {multiline ? notices : null}
      {multiline && error !== undefined && !state.unconfirmed ? <SaveError error={error} /> : null}
      <span className={multiline ? "edit-foot" : "inline-acts"}>
        <button type="submit" className={`pill${multiline ? "" : " sm"} primary`} data-act={`save-${form}`} disabled={!canSave} title={state.guard ?? (blocked ? t(blocked) : undefined)} aria-describedby={blocked ? ids.hint : undefined}>{t(state.saving ? "plan.saving" : "plan.save")}</button>
        <button type="button" className={`pill${multiline ? "" : " sm"}`} data-act="cancel-edit" onClick={state.onCancel}>{t("plan.cancel")}</button>
        {multiline && blocked ? <span className="hint" id={ids.hint}>{t(blocked)}</span> : null}
      </span>
      {multiline ? null : hint}
      {/* The title form has no room for the hint by its buttons: it is said for the screen reader only. */}
      {!multiline && blocked ? <span className="sr" id={ids.hint}>{t(blocked)}</span> : null}
      {multiline ? null : notices}
    </form>
  );
}
