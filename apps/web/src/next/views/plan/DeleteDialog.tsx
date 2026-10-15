import { useI18n } from "../../i18n/I18n.tsx";
import { listLabels } from "../../model/keyframes.ts";
import type { DeleteFacts } from "../../model/plan.ts";
import type { Msg } from "../../model/types.ts";
import { Modal } from "./Modal.tsx";
import { SaveError } from "./TextPanel.tsx";

interface Props {
  kind: "scene" | "shot";
  /** "1" for Scene 1, "2.2" for a shot. */
  name: string;
  title: string;
  facts: DeleteFacts;
  busy: boolean;
  guard: string | undefined;
  /** Why the server refused the delete (the confirm stays open to say so). */
  error: Msg | null;
  onCancel(): void;
  onConfirm(): void;
}

/**
 * Delete a scene with its shots, or one shot, after a confirm that lists what stays in Assets, the film's new
 * length and the renumbering. The action is white even though it deletes; the title and the list say what happens.
 */
export function DeleteDialog({ kind, name, title, facts, busy, guard, error, onCancel, onConfirm }: Props) {
  const { t, tm, locale } = useI18n();
  const media = facts.media.map((item) => tm(item));
  const heading = kind === "scene"
    ? (facts.shots ? t("plan.delete_scene.title", { scene: name, title, shots: facts.shots }) : t("plan.delete_scene.title_empty", { scene: name, title }))
    : t("plan.delete_shot.title", { shot: name });
  return (
    <Modal className="dialog plan-dialog" labelledBy="plan-delete-title" onClose={onCancel}>
      <h2 id="plan-delete-title">{heading}</h2>
      <ul>
        <li>{media.length ? t("plan.delete.media", { list: listLabels(media, locale) }) : t(kind === "scene" ? "plan.delete.nothing_scene" : "plan.delete.nothing_shot")}</li>
        <li>{kind === "scene"
          ? t(facts.renumbers ? "plan.delete.length_scene" : "plan.delete.length_scene_last", { seconds: facts.seconds })
          : t(facts.renumbers ? "plan.delete.length_shot" : "plan.delete.length_shot_last", { seconds: facts.seconds })}</li>
        <li>{t("plan.delete.undo_note")}</li>
      </ul>
      <SaveError error={error} lead="plan.delete.not_deleted" />
      <div className="foot">
        <button type="button" className="pill" data-act="delete-cancel" data-autofocus onClick={onCancel}>{t("plan.cancel")}</button>
        <button type="button" className="pill primary" data-act={kind === "scene" ? "delete-scene-confirm" : "delete-shot-confirm"} disabled={busy || !!guard} title={guard} onClick={onConfirm}>
          {kind === "scene" ? (facts.shots ? t("plan.delete_scene.confirm", { shots: facts.shots }) : t("plan.delete_scene.confirm_empty")) : t("plan.delete_shot.confirm", { shot: name })}
        </button>
      </div>
    </Modal>
  );
}
