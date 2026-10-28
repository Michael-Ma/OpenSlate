import { useEffect, useId, useRef, useState } from "react";
import { useRecoveryLock } from "../../app/useWriteGuard.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import { CLIP_SOUND_MAX_DB, CLIP_SOUND_MIN_DB, clipSoundGainEdit, clipSoundKeepEdit, clipSoundToast, type ClipSound, type ClipSoundEdit } from "../../model/clip-sound.ts";
import type { MessageId } from "../../i18n/messages.ts";
import type { Msg } from "../../model/types.ts";

/** A level is saved this long after the last arrow key or release, so a run of steps is one edit and one Undo. */
const SETTLE_MS = 400;

const DEFAULT_WORDS: Record<ClipSound["reason"], MessageId> = {
  social: "film.clip_sound.default_social",
  comedy: "film.clip_sound.default_comedy",
  music_video: "film.clip_sound.default_music_video",
  none: "film.clip_sound.default_none",
};

interface Props {
  shotId: string;
  label: string;
  sound: ClipSound;
  writable: boolean;
  /** An edit is being saved: a new level waits for it. */
  saving: boolean;
  onEdit(edit: ClipSoundEdit, toast: Msg): void;
}

/**
 * "Keep clip sound" for the selected shot: a switch and, while kept, its level (-60 to 0 dB, like the music's).
 * Self-contained so it can sit in any shot inspector; each change is one storyboard command with Undo.
 */
export function ClipSoundControl({ shotId, label, sound, writable, saving, onEdit }: Props) {
  const { t } = useI18n();
  const id = useId();
  const locked = useRecoveryLock();
  const offline = writable ? undefined : locked ?? t("film.offline");
  const [draft, setDraft] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A new shot or a saved level replaces the draft.
  useEffect(() => { setDraft(null); }, [shotId, sound.gainDb]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const level = draft ?? sound.gainDb;
  const save = (db: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!writable || saving || db === sound.gainDb) return;
    const edit = clipSoundGainEdit(shotId, db);
    onEdit(edit, clipSoundToast(label, edit));
  };
  const schedule = (db: number) => {
    setDraft(db);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(db), SETTLE_MS);
  };
  const toggle = () => {
    if (!writable || saving) return;
    const edit = clipSoundKeepEdit(shotId, !sound.keep);
    onEdit(edit, clipSoundToast(label, edit));
  };
  const note = sound.source === "default" ? t(DEFAULT_WORDS[sound.reason]) : null;
  return (
    <span className="inline clip-sound" data-act="clip-sound" data-keep={sound.keep ? "true" : "false"} data-source={sound.source}>
      <span id={`${id}-label`}>{t("film.clip_sound.keep")}</span>
      <button type="button" className="switch" role="switch" data-act="clip-sound-switch" aria-checked={sound.keep} aria-labelledby={`${id}-label`}
        disabled={!writable} title={offline} onClick={toggle} />
      {sound.keep ? (
        <label className="inline">
          {t("film.clip_sound.level")}
          <input
            type="range"
            className="range"
            data-act="clip-sound-gain"
            min={CLIP_SOUND_MIN_DB}
            max={CLIP_SOUND_MAX_DB}
            step={1}
            value={level}
            disabled={!writable}
            title={offline}
            aria-label={t("film.clip_sound.level_label")}
            aria-valuetext={t("film.tools.db", { db: level })}
            onChange={(event) => schedule(Number(event.target.value))}
            onBlur={() => { if (draft !== null) save(draft); }}
          />
          <output className="num">{t("film.tools.db", { db: level })}</output>
        </label>
      ) : null}
      {/* Left out while the studio takes no edits, like the length notes: nothing promises a change that cannot be made. */}
      {writable && (note || sound.keep) ? <span className="hint">{[note, sound.keep ? t("film.clip_sound.ducked") : null].filter(Boolean).join(" · ")}</span> : null}
    </span>
  );
}
