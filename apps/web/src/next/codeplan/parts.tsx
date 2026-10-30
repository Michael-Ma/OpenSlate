import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { Picture } from "../keyframes/parts.tsx";
import type { RunTone, StepRow } from "../model/code-plan.ts";
import type { Msg } from "../model/types.ts";

/** A neutral status chip; busy work spins, a step that needs the person has the attention outline. Never green here. */
export function StepStatus({ status, tone }: { status: Msg; tone: RunTone }) {
  const { tm } = useI18n();
  return (
    <span className={tone === "busy" ? "status busy" : tone === "attention" ? "status attn" : "status"} data-tone={tone}>
      {tone === "busy" ? <i className="cp-spin" aria-hidden="true" /> : null}
      {tm(status)}
    </span>
  );
}

/** One media step as a card: its picture once made (the chosen one marked white), else what it is waiting for. */
export function StepCard({ row, still = true }: { row: StepRow; still?: boolean }) {
  const { t, tm } = useI18n();
  const label = row.label || t("codeplan.step.no_label");
  return (
    <li className={`cp-step${row.reached ? "" : " history"}${row.chosen ? " chosen" : ""}`} data-step={row.key} data-state={row.state} data-reached={row.reached ? "true" : "false"}>
      <div className="cp-step-pic">
        {row.artifact && still ? <Picture artifact={row.artifact} alt={t("codeplan.step.alt", { label })} /> : <span className="cp-step-wait" aria-hidden="true">{tm(row.status)}</span>}
        {row.chosen ? <span className="cp-chosen-mark">✓ {t("codeplan.step.chosen")}</span> : null}
      </div>
      <div className="cp-step-head">
        <StepStatus status={row.error ? { id: "codeplan.step.failed_code", values: { code: row.error } } : row.status} tone={row.tone} />
        {row.price ? <span className="cp-price">{tm(row.price)}</span> : null}
      </div>
      <p className="cp-step-label" title={label}>{label}</p>
      {row.model ? <span className="cp-step-model">{row.model}</span> : null}
    </li>
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
