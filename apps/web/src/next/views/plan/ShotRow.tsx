import type { StudioArtifactRef } from "@openslate/core/public";
import { useId, useState, type DragEvent, type HTMLAttributes } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { Picture } from "../../keyframes/parts.tsx";
import { actionLine, type NoteChip, type ShotRowView, type StatusPillView } from "../../model/plan.ts";
import type { Msg } from "../../model/types.ts";
import { Menu, type MenuItem } from "./Menu.tsx";

export const rowId = (shotId: string) => `plan-row-${shotId}`;

/** The 16:9 thumbnail with its label: the keyframe, the earlier one dimmed, or a dashed box saying what is missing. */
export function Thumb({ label, picture, dimmed, empty }: { label: string; picture: StudioArtifactRef | null; dimmed: boolean; empty: Msg | null }) {
  const { t, tm } = useI18n();
  if (!picture)
    return (
      <div className="thumb empty">
        <span className="badge">{label}</span>
        {empty ? tm(empty) : null}
      </div>
    );
  return (
    <div className={`thumb${dimmed ? " dim" : ""}`}>
      <Picture artifact={picture} alt={t(dimmed ? "plan.thumb.alt_earlier" : "plan.thumb.alt", { shot: label })} />
      <span className="badge">{label}</span>
    </div>
  );
}

export function Pill({ pill }: { pill: StatusPillView }) {
  const { tm } = useI18n();
  const className = pill.tone === "ok" ? "status ok" : pill.tone === "fail" ? "status fail" : pill.tone === "busy" ? "status busy" : "status";
  return (
    <span className={className} data-tone={pill.tone}>
      {pill.icon === "✓" ? <span aria-hidden="true">✓</span> : pill.icon ? <i className="ic" aria-hidden="true">{pill.icon}</i> : null}
      {tm(pill.text)}
    </span>
  );
}

/**
 * The Director's lettered notes, the same amber chips as on the Keyframes cards; settled ones turn grey. A row has
 * room, so a chip shows the note's first clause whole, wrapping if it must; the full note is its tooltip.
 */
export function NoteChips({ notes }: { notes: NoteChip[] }) {
  const { t } = useI18n();
  return (
    <>
      {notes.map((note) => (
        <span key={note.noteId} className={`anno note-chip${note.done ? " done" : ""}`} title={note.full} data-note={note.noteId}>
          <span className="letter" aria-hidden="true">{note.letter}</span>
          <span className="sr">{t("plan.note.label", { letter: note.letter })}</span>
          <span className="txt">{note.text}</span>
        </span>
      ))}
    </>
  );
}

/** The shot id a drag carries (a type of its own, so text dragged from elsewhere is never taken for a shot). */
export const SHOT_DRAG_TYPE = "application/x-openslate-shot";

/** The full prompts of a shot, as saved: what the picture and video models are sent. */
export function FullPrompts({ id, prompts }: { id?: string; prompts: ShotRowView["fullPrompts"] }) {
  const { t } = useI18n();
  return (
    <div className="full-prompts" id={id} data-prompts="full">
      <p className="hint">{t("plan.prompts.sent")}</p>
      <dl>
        <dt>{t("plan.field.prompt")}</dt>
        <dd data-prompt="image">{prompts.image || <span className="muted">{t("plan.text.empty")}</span>}</dd>
        <dt>{t("plan.field.video_prompt")}</dt>
        <dd data-prompt="video">{prompts.video || <span className="muted">{t("plan.text.empty")}</span>}</dd>
      </dl>
    </div>
  );
}

interface Props {
  row: ShotRowView;
  guard: string | undefined;
  busy: boolean;
  flash: boolean;
  /** Another scene exists to move this shot to. */
  canMoveScene: boolean;
  /** A dragged shot would land just before this row. */
  dropBefore: boolean;
  /** Drag-and-drop handlers for the row as a drop target (set while a shot is dragged). */
  drop: HTMLAttributes<HTMLLIElement>;
  onEdit(): void;
  onMove(direction: -1 | 1): void;
  onMoveScene(): void;
  onDragStart(): void;
  onDragEnd(): void;
  onPoint(): void;
  onOpenKeyframes(): void;
  onDelete(): void;
}

/**
 * One shot: thumbnail (a drag handle: drop it on another row or scene to move it), purpose with framing · length ·
 * motion, the action and the prompt (the full prompts open below), narration, status, Edit and •••.
 */
export function ShotRow({ row, guard, busy, flash, canMoveScene, dropBefore, drop, onEdit, onMove, onMoveScene, onDragStart, onDragEnd, onPoint, onOpenKeyframes, onDelete }: Props) {
  const { t, tm, locale } = useI18n();
  const promptsId = useId();
  const [promptsOpen, setPromptsOpen] = useState(false);
  const off = !!guard || busy;
  // An unwritten framing or motion says which one is missing: the meta line has no labels.
  const motion = row.motion ? row.motion.charAt(0).toLocaleLowerCase(locale) + row.motion.slice(1) : t("plan.shot.no_motion");
  const offTitle = guard ? { title: guard } : {};
  const items: MenuItem[] = [
    { act: "shot-earlier", label: t("plan.shot.earlier"), onSelect: () => onMove(-1), disabled: off || row.first, ...offTitle },
    { act: "shot-later", label: t("plan.shot.later"), onSelect: () => onMove(1), disabled: off || row.last, ...offTitle },
    { act: "shot-move-scene", label: t("plan.shot.move_scene"), onSelect: onMoveScene, disabled: off || !canMoveScene, ...(guard ? offTitle : canMoveScene ? {} : { title: t("plan.move.only_scene") }) },
    { act: "point-shot", label: t("plan.shot.point", { shot: row.label }), onSelect: onPoint },
    { act: "open-keyframes", label: t("plan.shot.open_keyframes", { shot: row.label }), onSelect: onOpenKeyframes },
    { act: "delete-shot", label: t("plan.shot.delete", { shot: row.label }), onSelect: onDelete, disabled: off, separated: true, ...(guard ? { title: guard } : {}) },
  ];
  return (
    <li className={`shot-row${flash ? " flash" : ""}${dropBefore ? " drop-before" : ""}`} id={rowId(row.shotId)} data-shot={row.shotId} {...drop}>
      <div
        className="drag-handle"
        draggable={!off}
        data-act="drag-shot"
        data-shot={row.shotId}
        title={off ? guard : t("plan.move.drag", { shot: row.label })}
        onDragStart={(event: DragEvent) => {
          event.dataTransfer.setData(SHOT_DRAG_TYPE, row.shotId);
          event.dataTransfer.effectAllowed = "move";
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        <Thumb label={row.label} picture={row.picture} dimmed={row.pictureDimmed} empty={row.emptyThumb} />
      </div>
      <div className="shot-main">
        <b>{row.purpose || <span className="muted">{t("plan.shot.no_purpose")}</span>}</b>
        <div className="shot-meta">{t("plan.shot.meta", { framing: row.framing || t("plan.shot.no_framing"), seconds: row.seconds, motion })}</div>
        {/* Said only when it adds to the purpose: many films store the same sentence in both. */}
        {actionLine(row) ? <div className="shot-action" data-field="action">{t("plan.shot.action", { action: actionLine(row) })}</div> : null}
        <div className="shot-prompt">{t("plan.shot.picture", { prompt: row.prompt || t("plan.shot.not_written") })}</div>
        <button type="button" className="link-btn" data-act="toggle-prompts" data-shot={row.shotId} aria-expanded={promptsOpen} aria-controls={promptsOpen ? promptsId : undefined} onClick={() => setPromptsOpen((open) => !open)}>
          {t(promptsOpen ? "plan.shot.prompts_hide" : "plan.shot.prompts")}<span className="sr"> · {row.label}</span>
        </button>
      </div>
      <div className="shot-say" data-narration={row.narration.kind}>
        {row.narration.kind === "line" ? (
          <>
            {row.narration.text ? <q>{row.narration.text}</q> : null}
            {row.narration.detail ? <small>{tm(row.narration.detail)}</small> : null}
          </>
        ) : (
          <span className="none">{t(row.narration.kind === "undecided" ? "plan.narr.undecided" : "plan.narr.none")}</span>
        )}
      </div>
      <div className="shot-state">
        {row.pills.map((pill, index) => <Pill key={index} pill={pill} />)}
        {row.check ? <span className="check" data-check="narration"><i className="ic" aria-hidden="true">!</i>{tm(row.check)}</span> : null}
        <NoteChips notes={row.notes} />
      </div>
      <div className="shot-acts">
        <button type="button" className="pill sm" data-act="edit-shot" data-shot={row.shotId} aria-label={t("plan.shot.edit_label", { shot: row.label })} disabled={off} title={guard} onClick={onEdit}>
          {t("plan.edit")}
        </button>
        <Menu label={t("plan.shot.more", { shot: row.label })} act="shot-menu" data={{ "data-shot": row.shotId }} items={items} />
      </div>
      {/* Under the row, across its columns: prompts are long, and the text column is narrow. */}
      {promptsOpen ? <FullPrompts id={promptsId} prompts={row.fullPrompts} /> : null}
    </li>
  );
}
