import { useEffect, useRef, type KeyboardEvent } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import type { InspectorView } from "../model/inspector.ts";

interface Props {
  shotId: string;
  label: string;
  prompts: InspectorView["prompts"];
  onClose(): void;
  onEditInPlan(): void;
}

/**
 * The shot's full prompts as stored and sent to the paid models, read-only, in place of the inspector's rows: the
 * picture prompt and the video prompt. Both are edited in Plan (Edit 2.3 in Plan opens the shot's row there); Edit
 * prompt also edits the picture prompt here. The studio rewrites the video prompt's direction from the shot's
 * purpose, action, framing and motion when they change (storyboard.ts editedPrompt). Esc or Close goes back to
 * the rows.
 */
export function PromptsPanel({ shotId, label, prompts, onClose, onEditInPlan }: Props) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  // The panel takes focus when it opens, so a keyboard user lands on it.
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  const titleId = `prompts-title-${shotId}`;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };
  return (
    <section className="insp-prompts" aria-labelledby={titleId} data-shot={shotId} onKeyDown={onKeyDown}>
      <div className="takes-head">
        <h4 id={titleId} ref={heading} tabIndex={-1}>{t("inspector.prompts_title", { shot: label })}</h4>
        <button type="button" className="pill sm" data-act="prompts-close" onClick={onClose}>{t("inspector.close")}</button>
      </div>
      <dl className="prompt-list">
        <dt className="lbl">{t("inspector.prompt_image")}</dt>
        <dd className="prompt-text" data-prompt="image">{prompts.image}</dd>
        <dt className="lbl">{t("inspector.prompt_video")}</dt>
        <dd className="prompt-text" data-prompt="video">{prompts.video ?? t("inspector.prompt_video_missing")}</dd>
        <dd className="insp-note left" data-act="video-prompt-note">{t("inspector.prompt_video_note")}</dd>
      </dl>
      <p className="insp-note left">{t("inspector.prompts_note")}</p>
      {/* Kept in view at the foot while long prompts scroll above it. */}
      <div className="prompts-foot">
        <button type="button" className="pill sm" data-act="edit-in-plan" data-shot={shotId} onClick={onEditInPlan}>{t("inspector.edit_in_plan", { shot: label })}</button>
      </div>
    </section>
  );
}
