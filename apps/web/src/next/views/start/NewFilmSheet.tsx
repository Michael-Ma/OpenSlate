import { useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { numberLocale } from "../../i18n/translate.ts";
import { FILM_NAME_MAX } from "../../model/start.ts";
import { runCreation, type Film } from "../../model/start-commands.ts";
import {
  createBody, createdOutcome, creationSteps, defaultStep, sheetFootMsg, isPlanFileName, modelPlan, modelSummary, planFileName, planTextProblem, stepAvailable, stepNeedsCodex,
  PLAN_TEXT_MAX, type Codex, type CreatedOutcome, type CreationStep, type FirstStep, type Job, type ProviderCatalog,
} from "../../model/start-new.ts";
import { useStore } from "../../store/react.tsx";
import { Dialog } from "./Dialog.tsx";

const STEPS: readonly FirstStep[] = ["director", "plan", "empty"];
const STEP_TEXT: Record<FirstStep, { title: MessageId; body: MessageId }> = {
  director: { title: "start.step.director.title", body: "start.step.director.body" },
  plan: { title: "start.step.plan.title", body: "start.step.plan.body" },
  empty: { title: "start.step.empty.title", body: "start.step.empty.body" },
};
const PROGRESS: Record<CreationStep, MessageId> = { create: "start.new.step.create", director: "start.new.step.director", import: "start.new.step.import" };
const FAILED: Record<Exclude<CreationStep, "create">, MessageId> = { director: "start.new.failed.director", import: "start.new.failed.import" };
const JOB: Record<Job, MessageId> = {
  director: "start.job.director", keyframes: "start.job.keyframes", video: "start.job.video", narration: "start.job.narration", transcription: "start.job.transcription",
};

type Phase = { kind: "idle" } | { kind: "running"; step: CreationStep } | { kind: "failed"; step: Exclude<CreationStep, "create">; film: Film };

/**
 * The New film sheet: a name and a first step (Talk to the Director, Bring a written plan, Start an
 * empty outline), this computer's models on request, and Create. Creating is free. A failed Codex
 * check or plan send leaves the film made and offers Try again, which never makes a second film.
 */
export function NewFilmSheet({ initialStep, codex, providers, offline, onClose, onCreated }: {
  initialStep: FirstStep | null;
  codex: Codex;
  providers: ProviderCatalog | null | "failed";
  offline: string | null;
  onClose(): void;
  onCreated(film: Film, outcome: CreatedOutcome): void;
}) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const titleId = useId();
  const formId = useId();
  const stepLabel = useId();
  const modelsId = useId();
  const planId = useId();
  const planHint = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stepRefs = useRef<Partial<Record<FirstStep, HTMLButtonElement | null>>>({});

  const [name, setName] = useState("");
  const [step, setStep] = useState<FirstStep>(() => (initialStep && stepAvailable(initialStep, codex) ? initialStep : defaultStep(codex)));
  const [planText, setPlanText] = useState("");
  const [planFile, setPlanFile] = useState<string | null>(null);
  const [fileProblem, setFileProblem] = useState<MessageId | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const plan = useMemo(() => (providers && providers !== "failed" ? modelPlan(providers, codex, locale) : null), [providers, codex, locale]);
  const running = phase.kind === "running";
  const failed = phase.kind === "failed" ? phase : null;
  const problem = step === "plan" ? planTextProblem(planText) : null;
  const untitled = t("start.new.untitled");
  const fmt = (n: number) => new Intl.NumberFormat(numberLocale(locale)).format(n);

  const create = async () => {
    if (running || offline || problem) return;
    const filmName = failed?.film.name ?? (name.trim() || untitled);
    const input = {
      body: createBody(name, plan, untitled),
      steps: creationSteps(step, codex, planText),
      requireDirector: stepNeedsCodex(step),
      plan: step === "plan" && planText.trim() ? { fileName: planFileName(filmName, planFile), text: planText } : null,
    };
    const resume = failed ? { film: failed.film, from: failed.step } : undefined;
    setPhase({ kind: "running", step: resume?.from ?? "create" });
    const result = await runCreation(store, input, (current) => setPhase({ kind: "running", step: current }), resume);
    if (result.film && result.failedAt === null) { onCreated(result.film, createdOutcome(step, planText, true)); return; }
    // Creating failed: the toast says why, and nothing was made. A later step failed: the film exists.
    if (!result.film || result.failedAt === null || result.failedAt === "create") { setPhase({ kind: "idle" }); return; }
    setPhase({ kind: "failed", step: result.failedAt, film: result.film });
  };

  const chooseStep = (next: FirstStep) => {
    if (!stepAvailable(next, codex) || failed || running) return;
    setStep(next);
  };

  const onStepKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const dir = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    event.preventDefault();
    const usable = STEPS.filter((s) => stepAvailable(s, codex));
    const next = usable[(usable.indexOf(step) + dir + usable.length) % usable.length];
    if (!next) return;
    chooseStep(next);
    stepRefs.current[next]?.focus();
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!isPlanFileName(file.name)) { setFileProblem("start.plan.wrong_type"); return; }
    const text = await file.text();
    if (planTextProblem(text) === "not_text") { setFileProblem("start.plan.not_text"); return; }
    setFileProblem(null);
    setPlanFile(file.name);
    setPlanText(text);
  };

  const locked = running || !!failed;
  const summary = plan ? modelSummary(plan) : null;
  const allReady = !!plan && plan.ready === plan.total;

  return (
    <Dialog className="sheet start-sheet" labelledBy={titleId} onClose={onClose} locked={running} initialFocus={nameRef}>
      <div className="sheet-head">
        <h2 id={titleId}>{t("start.new.title")}</h2>
        <button type="button" className="pill sm" data-act="sheet-close" disabled={running} onClick={onClose}>{t("start.new.close")}</button>
      </div>
      <form id={formId} className="sheet-body" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label className="field">
          <span className="label">{t("start.new.name")}</span>
          <input ref={nameRef} className="input" data-act="film-name" value={failed?.film.name ?? name} maxLength={FILM_NAME_MAX} placeholder={untitled} disabled={locked} onChange={(event) => setName(event.target.value)} />
        </label>

        <div className="field">
          <span className="label" id={stepLabel}>{t("start.new.first_step")}</span>
          <div className="choice" role="radiogroup" aria-labelledby={stepLabel} onKeyDown={onStepKey}>
            {STEPS.map((option) => (
              <button
                key={option}
                ref={(element) => { stepRefs.current[option] = element; }}
                type="button"
                role="radio"
                aria-checked={step === option}
                tabIndex={step === option ? 0 : -1}
                disabled={!stepAvailable(option, codex) || locked}
                data-act="step"
                data-step={option}
                onClick={() => chooseStep(option)}
              >
                <b>{t(STEP_TEXT[option].title)}</b>
                <span>{t(STEP_TEXT[option].body)}</span>
              </button>
            ))}
          </div>
          {codex.state === "not_found" && <span className="hint">{t("start.step.needs_codex")}</span>}
        </div>

        {step === "plan" && (
          <div className="field plan-field">
            <label className="label" htmlFor={planId}>{t("start.plan.label")}</label>
            <textarea
              id={planId}
              className="textarea"
              data-act="plan-text"
              rows={7}
              value={planText}
              placeholder={t("start.plan.placeholder")}
              aria-describedby={planHint}
              aria-invalid={problem ? true : undefined}
              disabled={running}
              onChange={(event) => { setPlanText(event.target.value); setFileProblem(null); }}
            />
            <div className="plan-row">
              <button type="button" className="pill sm" data-act="plan-file" disabled={running} onClick={() => fileRef.current?.click()}>{t("start.plan.choose")}</button>
              <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" hidden onChange={(event) => void onFile(event)} />
              {planFile && <span className="file">{t("start.plan.from_file", { file: planFile })}</span>}
              <span className={`count${problem === "too_long" ? " over" : ""}`}>{t("start.plan.count", { count: fmt(planText.length), max: fmt(PLAN_TEXT_MAX) })}</span>
            </div>
            <span className="hint" id={planHint} role={problem || fileProblem ? "alert" : undefined}>
              {fileProblem ? t(fileProblem)
                : problem === "too_long" ? t("start.plan.too_long", { max: fmt(PLAN_TEXT_MAX) })
                : problem === "not_text" ? t("start.plan.not_text")
                : t("start.plan.optional")}
            </span>
          </div>
        )}

        <div className="field">
          <span className="label">{t("start.models.label")}</span>
          {providers === null && <span className="hint" role="status">{t("start.models.loading")}</span>}
          {providers === "failed" && <div className="impact"><span className="ic" aria-hidden="true">!</span><span>{t("start.models.unavailable")}</span></div>}
          {summary && (
            <div className={`impact${allReady ? " none" : ""}`}>
              <span className="ic" aria-hidden="true">{allReady ? "✓" : "!"}</span>
              <span>{tm(summary)}</span>
            </div>
          )}
          {plan && (
            <>
              <button type="button" className="pill sm ghost see-models" data-act="see-models" aria-expanded={showModels} aria-controls={modelsId} onClick={() => setShowModels((v) => !v)}>
                {t(showModels ? "start.models.hide" : "start.models.see")}
              </button>
              {showModels && (
                <div id={modelsId} className="models">
                  <dl className="mlist">
                    {plan.rows.map((row) => (
                      <div key={row.job} className="mrow" data-job={row.job}>
                        <dt className="k">{t(JOB[row.job])}</dt>
                        <dd className="m"><span className="name">{row.model ?? t("start.model.stand_in")}</span><span className="price">{tm(row.price)}</span></dd>
                        <dd className={`s${row.ok ? " ok-text" : " dim"}`}>{row.ok ? "✓ " : ""}{tm(row.status)}</dd>
                      </div>
                    ))}
                  </dl>
                  <span className="hint">{t("start.models.later")}</span>
                </div>
              )}
            </>
          )}
        </div>

        {failed && (
          <div className="impact cost" role="alert">
            <span className="ic" aria-hidden="true">!</span>
            <span>{t(FAILED[failed.step], { name: failed.film.name })}</span>
          </div>
        )}
      </form>
      <div className="sheet-foot">
        <span className="grow" role="status">{running ? t(PROGRESS[phase.step]) : tm(sheetFootMsg(step, planText))}</span>
        {failed ? (
          <>
            <button type="button" className="pill" data-act="open-created" onClick={() => onCreated(failed.film, createdOutcome(step, planText, false))}>{t("start.new.open_anyway")}</button>
            <button type="submit" form={formId} className="pill primary" data-act="create-film" disabled={!!offline || !!problem} title={offline ?? undefined}>{t("start.new.try_again")}</button>
          </>
        ) : (
          <>
            <button type="button" className="pill" data-act="sheet-cancel" disabled={running} onClick={onClose}>{t("start.new.cancel")}</button>
            <button type="submit" form={formId} className="pill primary" data-act="create-film" disabled={running || !!offline || !!problem} aria-busy={running || undefined} title={offline ?? undefined}>
              {running ? t("start.busy") : t("start.new.create")}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
