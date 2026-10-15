import { useRef, useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { DEFAULT_IMPORT_NAME, IMPORT_MAX_CHARS, importProblem, type ImportReview, type ImportStage, type PendingImport, type RowTag } from "../../model/plan-import.ts";
import { msg, type Msg } from "../../model/types.ts";
import { Modal } from "./Modal.tsx";

interface Props {
  stage: ImportStage;
  pending: PendingImport | null;
  review: ImportReview | null;
  /** What the Director wrote while reading, listed apart from the outline. */
  notes: string[];
  busy: boolean;
  /** Why writing is off (offline). */
  guard: string | undefined;
  /** Why starting work is off (stopped). */
  runGuard: string | undefined;
  onClose(): void;
  onSend(name: string, text: string): void;
  onDiscard(): void;
  onConfirm(): void;
  onSettings(): void;
}

const TAG: Record<RowTag, "plan.import.tag.same" | "plan.import.tag.changed" | "plan.import.tag.new"> = {
  same: "plan.import.tag.same",
  changed: "plan.import.tag.changed",
  new: "plan.import.tag.new",
};

/**
 * Bring a written plan, in a right-hand sheet: paste or choose a .txt/.md file, the Director reads it, a review of
 * the proposed outline (Same / Changed / New, the Director's suggestions apart), then Confirm or Discard.
 */
export function ImportSheet(props: Props) {
  const { t } = useI18n();
  const { stage, pending, onClose } = props;
  const title = stage === "reading" || stage === "waiting" ? t("plan.import.reading_title")
    : stage === "review" ? t("plan.import.review_title")
    : stage === "stale" ? t("plan.import.stale_title")
    : t("plan.import.title");
  return (
    <Modal className="sheet plan-sheet" labelledBy="plan-import-title" step={stage} onClose={onClose}>
      <div className="sheet-head" data-modal-chrome>
        <h2 id="plan-import-title">{title}</h2>
        <button type="button" className="pill sm" data-act="import-close" onClick={onClose}>{t("plan.import.close")}</button>
      </div>
      {stage === "paste" ? <PasteStep {...props} />
        : stage === "nocodex" ? <NoCodexStep {...props} />
        : stage === "stale" ? <StaleStep {...props} />
        : stage === "review" && pending ? <ReviewStep {...props} pending={pending} />
        : <ReadingStep {...props} />}
    </Modal>
  );
}

function PasteStep({ busy, guard, runGuard, onClose, onSend }: Props) {
  const { t, tm, locale } = useI18n();
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [fileError, setFileError] = useState<Msg | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const problem = importProblem(name, text);
  const nameProblem = name.trim() && problem?.id === "plan.import.name_invalid" ? problem : null;
  const off = guard ?? runGuard;
  const count = new Intl.NumberFormat(locale).format(text.length);
  const max = new Intl.NumberFormat(locale).format(IMPORT_MAX_CHARS);

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    setFileError(null);
    try {
      const content = await picked.text();
      if (content.length > IMPORT_MAX_CHARS) { setFileError(msg("plan.import.too_long", { max: IMPORT_MAX_CHARS })); return; }
      setName(picked.name);
      setText(content);
    } catch {
      setFileError(msg("plan.import.file_unreadable"));
    }
  };

  return (
    <>
      <div className="sheet-body">
        <p className="hint intro">{t("plan.import.intro")}</p>
        <div className="drop">
          <button type="button" className="pill" data-act="import-file" onClick={() => file.current?.click()}>{t("plan.import.choose")}</button>
          <span>{t("plan.import.or_paste")}</span>
          <input ref={file} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
        {fileError ? <p className="edit-error" role="alert"><i className="ic" aria-hidden="true">!</i>{tm(fileError)}</p> : null}
        <div className="field">
          <label htmlFor="plan-import-name">{t("plan.import.name")}</label>
          <input id="plan-import-name" className="input" data-field="import-name" value={name} maxLength={160} placeholder={DEFAULT_IMPORT_NAME} aria-invalid={!!nameProblem} aria-describedby={nameProblem ? "plan-import-name-hint" : undefined} onChange={(event) => setName(event.target.value)} />
          {nameProblem ? <span className="hint" id="plan-import-name-hint">{tm(nameProblem)}</span> : null}
        </div>
        <div className="field">
          <label htmlFor="plan-import-text">{t("plan.import.text")}</label>
          {/* Most plans are pasted, so the sheet opens with focus here. */}
          <textarea id="plan-import-text" className="textarea" data-field="import-text" data-autofocus rows={11} maxLength={IMPORT_MAX_CHARS} value={text} aria-describedby="plan-import-count" onChange={(event) => setText(event.target.value)} />
          <span className="counter" id="plan-import-count">{t("plan.import.count", { count, max })}</span>
        </div>
      </div>
      <div className="sheet-foot">
        <span className="grow">{off ?? t("plan.import.uses")}</span>
        <button type="button" className="pill" data-act="import-cancel" onClick={onClose}>{t("plan.cancel")}</button>
        <button type="button" className="pill primary" data-act="import-send" disabled={!!problem || !!off || busy} title={off} onClick={() => onSend(name, text)}>{t("plan.import.send")}</button>
      </div>
    </>
  );
}

function NoCodexStep({ onClose, onSettings }: Props) {
  const { t } = useI18n();
  return (
    <>
      <div className="sheet-body" tabIndex={-1} data-autofocus>
        <div className="impact cost" role="status">
          <span className="ic" aria-hidden="true">!</span>
          <span><b>{t("plan.import.nocodex_title")}</b> {t("plan.import.nocodex")}</span>
        </div>
        <p className="hint">{t("plan.import.nocodex_hint")}</p>
      </div>
      <div className="sheet-foot">
        <span className="grow" />
        <button type="button" className="pill" data-act="import-cancel" onClick={onClose}>{t("plan.cancel")}</button>
        <button type="button" className="pill primary" data-act="import-settings" onClick={onSettings}>{t("plan.import.open_settings")}</button>
      </div>
    </>
  );
}

function ReadingStep({ stage, pending, busy, guard, onClose, onDiscard }: Props) {
  const { t } = useI18n();
  return (
    <>
      {/* Focus starts on what is happening; when the review arrives it moves there, unless a button was chosen. */}
      <div className="sheet-body" tabIndex={-1} data-autofocus>
        {stage === "waiting" ? (
          <p className="hint" role="status">{t("plan.import.waiting", { name: pending?.name ?? DEFAULT_IMPORT_NAME })}</p>
        ) : (
          <div className="working" role="status">{t("plan.import.reading", { name: pending?.name ?? DEFAULT_IMPORT_NAME })}<i /><i /><i /></div>
        )}
        {stage === "reading" ? <div className="progress indet" aria-hidden="true"><i /></div> : null}
        <p className="hint">{t("plan.import.reading_hint")}</p>
      </div>
      <div className="sheet-foot">
        <span className="grow" />
        <button type="button" className="pill" data-act="import-discard" disabled={!pending || busy || !!guard} title={guard} onClick={onDiscard}>{t("plan.import.discard")}</button>
        <button type="button" className="pill" data-act="import-cancel" onClick={onClose}>{t("plan.import.close")}</button>
      </div>
    </>
  );
}

function StaleStep({ busy, guard, onDiscard }: Props) {
  const { t } = useI18n();
  return (
    <>
      {/* Focus starts on the reason, not on Discard, so it is read before anything is pressed. */}
      <div className="sheet-body" tabIndex={-1} data-autofocus>
        <div className="impact cost" role="status">
          <span className="ic" aria-hidden="true">!</span>
          <span>{t("plan.import.stale")}</span>
        </div>
      </div>
      <div className="sheet-foot">
        <span className="grow" />
        <button type="button" className="pill primary" data-act="import-discard" disabled={busy || !!guard} title={guard} onClick={onDiscard}>{t("plan.import.discard")}</button>
      </div>
    </>
  );
}

function ReviewStep({ pending, review, notes, busy, guard, onDiscard, onConfirm }: Props & { pending: PendingImport }) {
  const { t, tm } = useI18n();
  if (!review) return null;
  const totals = (value: ImportReview["now"]) => t("plan.import.totals", { scenes: value.scenes, shots: value.shots, seconds: value.seconds });
  return (
    <>
      {/* Focus starts on the proposal itself (read from the top, scrolled with the arrow keys); Confirm and
          Discard follow it, so Enter alone never replaces the outline. */}
      <div className="sheet-body" tabIndex={-1} data-autofocus data-review="body">
        <div className="summary-row">
          <div><span className="muted">{t("plan.import.now")}</span><b>{totals(review.now)}</b></div>
          <div><span className="muted">{t("plan.import.from", { name: pending.name })}</span><b data-totals="proposed">{totals(review.proposed)}</b></div>
        </div>
        {review.scenes.map((scene) => (
          <div className="prop-scene" key={scene.sceneId} data-scene={scene.sceneId}>
            <h3><span className="sno" aria-hidden="true">{scene.ordinal}</span>{scene.title}{scene.isNew ? <span className="tag new">{t("plan.import.tag.new")}</span> : null}</h3>
            {scene.rows.length ? scene.rows.map((row) => (
              <div className="prop-row" key={row.shotId} data-row={row.label} data-tag={row.tag}>
                <b>{row.label}</b>
                <span>{row.purpose}{row.details.map((detail, index) => <small key={index}>{tm(detail)}</small>)}</span>
                <span className={`tag ${row.tag}`}>{t(TAG[row.tag])}</span>
              </div>
            )) : <div className="prop-row empty"><span /><span className="muted">{t("plan.import.no_shots")}</span><span /></div>}
          </div>
        ))}
        {review.removed.length ? (
          <section>
            <div className="eyebrow sub">{t("plan.import.removed")}</div>
            <ul className="sugg">{review.removed.map((row) => <li key={row.label}>{t("plan.import.removed_row", { label: row.label, purpose: row.purpose })}</li>)}</ul>
          </section>
        ) : null}
        <div className="impact cost">
          <span className="ic" aria-hidden="true">!</span>
          <span><b>{t("plan.import.replaces")}</b> {t("plan.import.effect")}</span>
        </div>
        {notes.length ? (
          <section>
            <div className="eyebrow sub">{t("plan.import.suggestions")}</div>
            <ul className="sugg">{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
          </section>
        ) : null}
      </div>
      <div className="sheet-foot">
        <span className="grow">{guard ?? t("plan.import.foot")}</span>
        <button type="button" className="pill" data-act="import-discard" disabled={busy || !!guard} title={guard} onClick={onDiscard}>{t("plan.import.discard")}</button>
        <button type="button" className="pill primary" data-act="import-confirm" disabled={busy || !!guard} title={guard} onClick={onConfirm}>{t("plan.import.confirm")}</button>
      </div>
    </>
  );
}
