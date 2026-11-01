import type { CodePlanView } from "@openslate/core/public";
import { useEffect, useRef, useState } from "react";
import { useGuarded } from "../app/useWriteGuard.ts";
import { useI18n } from "../i18n/I18n.tsx";
import { numberLocale } from "../i18n/translate.ts";
import { CEILING_PRESS, limitDraft } from "../model/code-plan.ts";
import { formatMicros } from "../model/price.ts";
import { useStore, useStudio } from "../store/react.tsx";

/** The film's spend limit, changed in the run strip: higher or lower, never below what is spent or started. */
export function LimitEditor({ view, onClose }: { view: CodePlanView; onClose(): void }) {
  const { t, locale } = useI18n();
  const store = useStore();
  const guard = useGuarded("run");
  const saving = useStudio((s) => !!s.pending[CEILING_PRESS]);
  const [draft, setDraft] = useState(() => (Number(view.ceilingMicros) / 1_000_000).toFixed(2));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);

  const check = limitDraft(draft, view);
  const floor = formatMicros(String(BigInt(view.spentMicros) + BigInt(view.reservedMicros)), numberLocale(locale));
  const problem = check.problem === "invalid" ? t("codeplan.limit.invalid") : check.problem === "below" ? t("codeplan.limit.below", { floor }) : null;
  const ready = !!check.micros && !check.problem && check.changed && !saving && !guard.disabled;
  const save = async () => {
    if (!ready || !check.micros) return;
    const receipt = await store.setCodePlanCeiling(view, { ceilingMicros: check.micros });
    if (receipt) onClose();
  };
  return (
    <div className="cp-limit" data-act="code-plan-limit">
      <label htmlFor="cp-limit-input">{t("codeplan.limit.label")}</label>
      <input
        ref={input}
        id="cp-limit-input"
        inputMode="decimal"
        data-act="code-plan-limit-input"
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? "cp-limit-problem" : undefined}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); void save(); }
          if (event.key === "Escape") onClose();
        }}
      />
      <button type="button" className="pill sm primary" data-act="code-plan-limit-save" {...guard} disabled={!ready} aria-busy={saving || undefined} onClick={() => void save()}>{t("codeplan.limit.save")}</button>
      <button type="button" className="pill sm" data-act="code-plan-limit-cancel" onClick={onClose}>{t("codeplan.limit.cancel")}</button>
      {problem ? <p className="cp-limit-problem" id="cp-limit-problem" role="status">{problem}</p> : null}
    </div>
  );
}
