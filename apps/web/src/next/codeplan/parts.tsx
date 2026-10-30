import { useState, type ReactNode } from "react";
import { useGuarded } from "../app/useWriteGuard.ts";
import { useI18n } from "../i18n/I18n.tsx";
import { Picture } from "../keyframes/parts.tsx";
import { useNaturalAspect } from "../media/Viewer.tsx";
import { retryPress, type RunTone, type StepRow } from "../model/code-plan.ts";
import type { Msg } from "../model/types.ts";
import { useStore, useStudio } from "../store/react.tsx";
import { Modal } from "../views/plan/Modal.tsx";

/** A neutral status chip; busy work spins, a step that needs the person has the attention outline. Never green here. */
export function StepStatus({ status, tone, title }: { status: Msg; tone: RunTone; title?: string | undefined }) {
  const { tm } = useI18n();
  return (
    <span className={tone === "busy" ? "status busy" : tone === "attention" ? "status attn" : "status"} data-tone={tone} title={title}>
      {tone === "busy" ? <i className="cp-spin" aria-hidden="true" /> : null}
      {tm(status)}
    </span>
  );
}

/** A step's words: its prompt. A render has none of its own, so it is named for what it makes. */
export const stepLabel = (row: StepRow, t: ReturnType<typeof useI18n>["t"]): string =>
  row.label || t(row.kind === "render" ? "codeplan.step.render_label" : "codeplan.step.no_label");

/**
 * One media step as a card: its picture once made (the chosen one marked white), else what it is waiting for. The
 * box takes the picture's own shape, so a portrait frame is shown whole; with `onOpen` the picture opens larger.
 */
export function StepCard({ row, still = true, onOpen }: { row: StepRow; still?: boolean; onOpen?: (() => void) | undefined }) {
  const { t, tm } = useI18n();
  const label = stepLabel(row, t);
  const shape = useNaturalAspect();
  const picture = row.artifact && still ? <Picture artifact={row.artifact} alt={t("codeplan.step.alt", { label })} onDecoded={shape.onDecoded} /> : null;
  const mark = row.chosen ? <span className="cp-chosen-mark">✓ {t("codeplan.step.chosen")}</span> : null;
  return (
    <li className={`cp-step${row.reached ? "" : " history"}${row.chosen ? " chosen" : ""}`} data-step={row.key} data-state={row.state} data-reached={row.reached ? "true" : "false"}>
      {picture && onOpen ? (
        <button type="button" className="cp-step-pic open" style={shape.style} data-act="step-open" aria-label={t("viewer.open", { label })} onClick={onOpen}>{picture}{mark}</button>
      ) : (
        <div className="cp-step-pic" style={picture ? shape.style : undefined}>
          {picture ?? <span className="cp-step-wait" aria-hidden="true">{tm(row.status)}</span>}
          {mark}
        </div>
      )}
      <div className="cp-step-head">
        <StepStatus status={stepStatus(row)} tone={row.tone} title={row.error ?? undefined} />
        {row.price ? <span className="cp-price">{tm(row.price)}</span> : null}
      </div>
      <p className="cp-step-label" title={label}>{label}</p>
      {row.model ? <span className="cp-step-model">{row.model}</span> : null}
      <StepProblemNote row={row} />
    </li>
  );
}

/** The chip's words: a failure explained underneath says just "Failed" (its code in the tooltip); older ones keep the code. */
export const stepStatus = (row: StepRow): Msg =>
  row.error && !row.problem ? { id: "codeplan.step.failed_code", values: { code: row.error } } : row.status;

/**
 * A failed step's account in plain words: what happened, whether money may already be spent, what a retry means, and
 * Retry when it can help. A retry that may charge again asks first.
 */
export function StepProblemNote({ row }: { row: StepRow }) {
  const { t, tm } = useI18n();
  const store = useStore();
  const guard = useGuarded("server");
  const [asking, setAsking] = useState(false);
  const sending = useStudio((s) => !!s.pending[retryPress(row).pressId]);
  const problem = row.problem;
  if (!problem) return null;
  const retry = () => { setAsking(false); void store.retryCodePlanStep(row); };
  const label = stepLabel(row, t);
  return (
    <div className="cp-problem" data-cause={problem.cause} data-retry={problem.retry}>
      <p>{tm(problem.what)}{problem.cost ? <> {tm(problem.cost)}</> : null}</p>
      <p className="cp-problem-retry">{tm(problem.retryNote)}</p>
      {problem.retry !== "none" ? (
        <button type="button" className="pill sm" data-act="code-plan-retry" data-step={row.key} aria-busy={sending || undefined}
          disabled={sending || guard.disabled} title={guard.disabled ? guard.title : undefined}
          onClick={() => (problem.retry === "consent" ? setAsking(true) : retry())}>
          {t(sending ? "codeplan.retry.sending" : "codeplan.retry.button")}
        </button>
      ) : null}
      {asking ? (
        <Modal className="shell-dialog cp-retry-dialog" labelledBy={`cp-retry-${row.key}`} onClose={() => setAsking(false)}>
          <h2 id={`cp-retry-${row.key}`}>{t("codeplan.retry.confirm_title", { label })}</h2>
          <p>{problem.price ? t("codeplan.retry.confirm_body", { price: problem.price }) : t("codeplan.retry.confirm_body_free")}</p>
          <div className="foot">
            <button type="button" className="pill" data-act="code-plan-retry-cancel" data-autofocus onClick={() => setAsking(false)}>{t("codeplan.retry.cancel")}</button>
            <button type="button" className="pill primary" data-act="code-plan-retry-confirm" onClick={retry}>{t("codeplan.retry.confirm")}</button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** A view's head row, in the Plan view's style: the title, a line, and anything at its end. */
export function ViewHead({ title, line, children }: { title: string; line?: string | null; children?: ReactNode }) {
  return (
    <div className="view-head">
      <h1 tabIndex={-1}>{title}</h1>
      {line ? <span className="line">{line}</span> : null}
      {children ? <div className="actions">{children}</div> : null}
    </div>
  );
}

/** While the plan is read, could not be read, or has nothing yet: one quiet box in the middle of the view. */
export function ViewMessage({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="cp-message" role="status">
      <b>{title}</b>
      {body ? <span>{body}</span> : null}
      {children}
    </div>
  );
}
