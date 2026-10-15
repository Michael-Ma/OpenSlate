import type { StudioArtifactRef } from "@openslate/core/public";
import { useI18n } from "../../i18n/I18n.tsx";
import { Picture } from "../../keyframes/parts.tsx";
import type { NoteChip, ShotRowView, StatusPillView } from "../../model/plan.ts";
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

/** The Director's lettered notes, the same amber chips as on the Keyframes cards; settled ones turn grey. */
export function NoteChips({ notes }: { notes: NoteChip[] }) {
  const { t } = useI18n();
  return (
    <>
      {notes.map((note) => (
        <span key={note.noteId} className={`anno note-chip${note.done ? " done" : ""}`} title={note.text} data-note={note.noteId}>
          <span className="letter" aria-hidden="true">{note.letter}</span>
          <span className="sr">{t("plan.note.label", { letter: note.letter })}</span>
          <span className="txt">{note.text}</span>
        </span>
      ))}
    </>
  );
}

interface Props {
  row: ShotRowView;
  guard: string | undefined;
  busy: boolean;
  flash: boolean;
  onEdit(): void;
  onMove(direction: -1 | 1): void;
  onPoint(): void;
  onOpenKeyframes(): void;
  onDelete(): void;
}

/** One shot: thumbnail, purpose with framing · length · motion and the prompt, narration, status, Edit and •••. */
export function ShotRow({ row, guard, busy, flash, onEdit, onMove, onPoint, onOpenKeyframes, onDelete }: Props) {
  const { t, tm, locale } = useI18n();
  const off = !!guard || busy;
  const motion = row.motion ? row.motion.charAt(0).toLocaleLowerCase(locale) + row.motion.slice(1) : t("plan.shot.not_written");
  const items: MenuItem[] = [
    { act: "shot-earlier", label: t("plan.shot.earlier"), onSelect: () => onMove(-1), disabled: off || row.first, ...(guard ? { title: guard } : {}) },
    { act: "shot-later", label: t("plan.shot.later"), onSelect: () => onMove(1), disabled: off || row.last, ...(guard ? { title: guard } : {}) },
    { act: "point-shot", label: t("plan.shot.point", { shot: row.label }), onSelect: onPoint },
    { act: "open-keyframes", label: t("plan.shot.open_keyframes", { shot: row.label }), onSelect: onOpenKeyframes },
    { act: "delete-shot", label: t("plan.shot.delete", { shot: row.label }), onSelect: onDelete, disabled: off, separated: true, ...(guard ? { title: guard } : {}) },
  ];
  return (
    <li className={`shot-row${flash ? " flash" : ""}`} id={rowId(row.shotId)} data-shot={row.shotId}>
      <Thumb label={row.label} picture={row.picture} dimmed={row.pictureDimmed} empty={row.emptyThumb} />
      <div className="shot-main">
        <b>{row.purpose || <span className="muted">{t("plan.shot.no_purpose")}</span>}</b>
        <div className="shot-meta">{t("plan.shot.meta", { framing: row.framing || t("plan.shot.not_written"), seconds: row.seconds, motion })}</div>
        <div className="shot-prompt">{t("plan.shot.picture", { prompt: row.prompt || t("plan.shot.not_written") })}</div>
      </div>
      <div className="shot-say" data-narration={row.narration.kind}>
        {row.narration.kind === "line" ? (
          <>
            <q>{row.narration.text}</q>
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
    </li>
  );
}
