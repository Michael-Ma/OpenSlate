import type { CodePlanStepDetail } from "@openslate/core/public";
import { useEffect, useMemo, useState } from "react";
import { useDeveloperMode } from "../app/useDeveloperMode.ts";
import { useI18n } from "../i18n/I18n.tsx";
import { numberLocale } from "../i18n/translate.ts";
import { callFacts, stepFacts } from "../model/step-detail.ts";
import { useStore } from "../store/react.tsx";

type Read = { status: "loading" } | { status: "failed"; code: string } | { status: "ready"; detail: CodePlanStepDetail };

/** A step's whole prompt and facts, read when the viewer shows it. Developer mode adds what went to the provider. */
export function StepFacts({ stepKey }: { stepKey: string }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const developer = useDeveloperMode();
  const [read, setRead] = useState<Read>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ status: "loading" });
    setCopied(false);
    store.readCodePlanStep(stepKey, controller.signal).then(
      (detail) => setRead({ status: "ready", detail }),
      (error: { code?: string }) => { if (!controller.signal.aborted) setRead({ status: "failed", code: error.code ?? "UNKNOWN" }); },
    );
    return () => controller.abort();
  }, [stepKey, store]);

  const detail = read.status === "ready" ? read.detail : null;
  const facts = useMemo(() => (detail ? stepFacts(detail, new Date(), numberLocale(locale)) : []), [detail, locale]);
  const call = useMemo(() => (detail && developer ? callFacts(detail) : []), [detail, developer]);

  if (read.status === "loading") return <p className="mv-note" role="status">{t("viewer.prompt.loading")}</p>;
  if (read.status === "failed") return <p className="mv-note" role="alert">{t("viewer.prompt.failed", { code: read.code })}</p>;
  const prompt = read.detail.prompt;
  const copy = () => {
    if (!prompt) return;
    void navigator.clipboard?.writeText(prompt).then(() => setCopied(true), () => setCopied(false));
  };
  return (
    <div className="mv-facts" data-step={stepKey}>
      {prompt ? (
        <section className="mv-block">
          <div className="mv-block-head">
            <h3>{t("viewer.prompt")}</h3>
            <button type="button" className="pill sm" data-act="copy-prompt" onClick={copy}>{t(copied ? "viewer.prompt.copied" : "viewer.prompt.copy")}</button>
          </div>
          <p className="mv-prompt" data-field="prompt">{prompt}</p>
        </section>
      ) : null}
      <dl className="mv-rows">
        {facts.map((row) => <div key={row.label.id}><dt>{tm(row.label)}</dt><dd>{tm(row.value)}</dd></div>)}
      </dl>
      {call.length ? (
        <section className="mv-block" data-block="call">
          <h3>{t("viewer.call")}</h3>
          <dl className="mv-rows mv-call">
            {call.map((row, index) => <div key={`${index}:${row.label}`}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}
          </dl>
        </section>
      ) : null}
    </div>
  );
}
