import { useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { SceneChoice, ShotMoveTarget } from "../../model/plan.ts";
import type { Msg } from "../../model/types.ts";
import { Modal } from "./Modal.tsx";
import { SaveError } from "./TextPanel.tsx";

interface Props {
  /** "1.2" */
  label: string;
  /** The shot's scene now, so the first choice keeps the film's order where it can. */
  ordinal: number;
  choices: SceneChoice[];
  busy: boolean;
  guard: string | undefined;
  error: Msg | null;
  onCancel(): void;
  onMove(target: ShotMoveTarget): void;
}

/**
 * Move a shot to another scene (the row's ••• → Move to another scene…; dragging the thumbnail does the same). Pick
 * the scene, then its start or end; the dialog says the shot's new number before anything moves. Moving is free and
 * outdates nothing (the server's moveShot keeps every keyframe, clip and voice line), and it can be undone.
 */
export function MoveDialog({ label, ordinal, choices, busy, guard, error, onCancel, onMove }: Props) {
  const { t } = useI18n();
  // The next scene by default, at its start; when there is none, the previous one, at its end.
  const initial = choices.find((choice) => choice.ordinal > ordinal) ?? choices[choices.length - 1];
  const [sceneId, setSceneId] = useState(initial?.sceneId ?? "");
  const [where, setWhere] = useState<"first" | "last">(initial && initial.ordinal > ordinal ? "first" : "last");
  const choice = choices.find((item) => item.sceneId === sceneId) ?? initial;
  const target = choice ? choice[where] : null;
  return (
    <Modal className="dialog plan-dialog move-dialog" labelledBy="plan-move-title" onClose={onCancel}>
      <h2 id="plan-move-title">{t("plan.move.title", { shot: label })}</h2>
      <fieldset className="choices">
        <legend className="sr">{t("plan.move.scenes")}</legend>
        {choices.map((item) => (
          <label key={item.sceneId} className="choice" data-choice={item.sceneId}>
            <input type="radio" name="plan-move-scene" value={item.sceneId} checked={item.sceneId === choice?.sceneId} data-autofocus={item.sceneId === choice?.sceneId ? true : undefined} onChange={() => setSceneId(item.sceneId)} />
            <span>
              <b>{t("plan.move.scene_option", { scene: item.ordinal, title: item.title })}</b>
              <small>{t("plan.move.scene_meta", { shots: item.shots })}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field where">
        <span className="label" id="plan-move-where">{t("plan.move.where")}</span>
        <span className="segctl" role="radiogroup" aria-labelledby="plan-move-where">
          <button type="button" role="radio" aria-checked={where === "first"} data-act="move-first" onClick={() => setWhere("first")}>{t("plan.move.first")}</button>
          <button type="button" role="radio" aria-checked={where === "last"} data-act="move-last" onClick={() => setWhere("last")}>{t("plan.move.last")}</button>
        </span>
      </div>
      {target ? <p className="hint" role="status" data-move="becomes">{t("plan.move.becomes", { from: target.from, to: target.to })}</p> : null}
      <SaveError error={error} />
      <div className="foot">
        <button type="button" className="pill" data-act="move-cancel" onClick={onCancel}>{t("plan.cancel")}</button>
        <button type="button" className="pill primary" data-act="move-confirm" disabled={!target || busy || !!guard} title={guard} onClick={() => target && onMove(target)}>
          {t("plan.move.confirm", { shot: label })}
        </button>
      </div>
    </Modal>
  );
}
