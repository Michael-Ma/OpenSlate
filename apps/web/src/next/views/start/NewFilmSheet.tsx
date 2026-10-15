import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { numberLocale } from "../../i18n/translate.ts";
import { FILM_NAME_MAX } from "../../model/start.ts";
import { runCreation, setUpDirector, type CreationResult, type Film } from "../../model/start-commands.ts";
import {
  afterFailure, createBody, createdOutcome, creationSteps, directorAfterOpen, effectiveStep, failedMsg, failureNeedsReason, sheetFootMsg, isPlanFileName, modelPlan, modelSummaryText,
  planFileName, planTextProblem, stepAvailable, JOB_LABEL, PLAN_TEXT_MAX, type Codex, type CreatedOutcome, type CreationStep, type FirstStep, type ProviderCatalog,
} from "../../model/start-new.ts";
import type { Msg } from "../../model/types.ts";
import { useStore } from "../../store/react.tsx";
import { Alert } from "./Alert.tsx";
import { Dialog } from "./Dialog.tsx";

const STEPS: readonly FirstStep[] = ["director", "plan", "empty"];
const STEP_TEXT: Record<FirstStep, { title: MessageId; body: MessageId }> = {
  director: { title: "start.step.director.title", body: "start.step.director.body" },
  plan: { title: "start.step.plan.title", body: "start.step.plan.body" },
  empty: { title: "start.step.empty.title", body: "start.step.empty.body" },
};
const PROGRESS: Record<CreationStep, MessageId> = { create: "start.new.step.create", director: "start.new.step.director", import: "start.new.step.import" };

type Phase =
  | { kind: "idle" }
  | { kind: "running"; first: FirstStep; step: CreationStep }
  /**
   * The film exists; a later step did not finish. `final`: trying again cannot work (no Codex here).
   * `reason`: the refusal's own words, when they add to the sheet's explanation.
   */
  | { kind: "failed"; first: FirstStep; step: Exclude<CreationStep, "create">; film: Film; code: string | null; final: boolean; reason: Msg | null };

/**
 * The New film sheet: a name and a first step (Talk to the Director, Bring a written plan, Start an
 * empty outline), this computer's models on request, and Create. Creating is free. A failed Codex
 * check or plan send leaves the film made (and listed at once) and offers Try again, which never makes
 * a second film; when Codex turns out to be missing, Open the film is the way on. Refusals are said
 * inside the sheet, never only in the toast behind its backdrop.
 */
export function NewFilmSheet({ initialStep, codex, providers, offline, onClose, onMade, onCreated, onModelsChanged }: {
  initialStep: FirstStep | null;
  codex: Codex;
  providers: ProviderCatalog | null | "failed";
  offline: string | null;
  onClose(): void;
  /** The film exists, whatever the later steps do: list it now. */
  onMade(film: Film): void;
  /** Open the film. */
  onCreated(film: Film, outcome: CreatedOutcome): void;
  /** Create was refused because this computer's models changed: read them again. */
  onModelsChanged(): void;
}) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const titleId = useId();
  const formId = useId();
  const stepLabel = useId();
  const modelsId = useId();
  const planId = useId();
  const planHint = useId();
  const stepHint = useId();
  const modelsHint = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stepRefs = useRef<Partial<Record<FirstStep, HTMLButtonElement | null>>>({});
  const nextRef = useRef<HTMLButtonElement>(null);

  const [name, setName] = useState("");
  const [chosen, setChosen] = useState<FirstStep | null>(initialStep);
  const [planText, setPlanText] = useState("");
  const [planFile, setPlanFile] = useState<string | null>(null);
  const [fileProblem, setFileProblem] = useState<MessageId | null>(null);
  const [showModels, setShowModels] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  /** Why the last Create made nothing; cleared by the next change or press. */
  const [refusal, setRefusal] = useState<Msg | null>(null);

  const plan = useMemo(() => (providers && providers !== "failed" ? modelPlan(providers, codex, locale) : null), [providers, codex, locale]);
  const running = phase.kind === "running";
  const failed = phase.kind === "failed" ? phase : null;
  // Create waits for this computer's models, so the film never gets the stand-ins only because the list was still being read.
  const modelsLoading = providers === null && !failed;
  // A run keeps the step it started with; otherwise the step follows the person's choice and what Codex allows.
  const step = phase.kind === "idle" ? effectiveStep(chosen, codex) : phase.first;
  const problem = step === "plan" ? planTextProblem(planText) : null;
  const untitled = t("start.new.untitled");
  const fmt = (n: number) => new Intl.NumberFormat(numberLocale(locale)).format(n);

  const finish = (first: FirstStep, result: CreationResult) => {
    const { film, failedAt, code } = result;
    // Creating failed: nothing was made, and the sheet says why.
    if (!film || failedAt === "create") {
      if (code === "PROVIDER_CATALOG_CHANGED") onModelsChanged();
      setRefusal(result.message);
      setPhase({ kind: "idle" });
      return;
    }
    if (failedAt === null) {
      onCreated(film, createdOutcome(first, planText, result));
      // An empty outline opened without waiting for the Codex check; it runs now, and says nothing (Settings shows it).
      if (directorAfterOpen(first, codex)) void setUpDirector(store, film, codex);
      return;
    }
    // A later step did not finish: the film exists (and is already listed).
    setPhase({ kind: "failed", first, step: failedAt, film, code, final: afterFailure(code) === "final", reason: failureNeedsReason(code) ? result.message : null });
  };

  const create = async () => {
    if (running || offline || problem || failed?.final || modelsLoading) return;
    const first = step;
    const filmName = failed?.film.name ?? (name.trim() || untitled);
    const input = {
      body: createBody(name, plan, untitled),
      steps: creationSteps(first, codex, planText),
      plan: first === "plan" && planText.trim() ? { fileName: planFileName(filmName, planFile), text: planText } : null,
      codex,
    };
    const resume = failed ? { film: failed.film, from: failed.step } : undefined;
    setRefusal(null);
    setPhase({ kind: "running", first, step: resume?.from ?? "create" });
    const result = await runCreation(store, input, { onStep: (current) => setPhase({ kind: "running", first, step: current }), onMade }, resume);
    finish(first, result);
  };

  const chooseStep = (next: FirstStep) => {
    if (!stepAvailable(next, codex) || failed || running) return;
    setChosen(next);
    setRefusal(null);
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

  // Once a step fails, focus goes to the way on: Try again, or Open the film when trying again cannot work.
  useEffect(() => { if (failed) nextRef.current?.focus(); }, [failed]);
  // A refusal is said at the end of the sheet's body; bring it into view (the body scrolls with a long plan).
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (failed || refusal) alertRef.current?.scrollIntoView({ block: "nearest" }); }, [failed, refusal]);

  const locked = running || !!failed;
  const summary = plan ? modelSummaryText(plan, tm) : null;
  const allReady = !!plan && plan.ready === plan.total;
  const createOff = running || !!offline || !!problem || modelsLoading;
  const createTitle = offline ?? (modelsLoading ? t("start.models.loading") : undefined);
  const codexHint = codex.state === "not_found" ? t("start.step.needs_codex") : codex.state === "unknown" && !failed ? t("start.step.codex_unknown") : null;

  return (
    <Dialog className="sheet start-sheet" labelledBy={titleId} onClose={onClose} locked={running} initialFocus={nameRef}>
      <div className="sheet-head">
        <h2 id={titleId}>{t("start.new.title")}</h2>
        <button type="button" className="pill sm" data-act="sheet-close" disabled={running} onClick={onClose}>{t("start.new.close")}</button>
      </div>
      <form id={formId} className="sheet-body" noValidate onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <label className="field">
          <span className="label">{t("start.new.name")}</span>
          <input
            ref={nameRef}
            className="input"
            data-act="film-name"
            value={failed?.film.name ?? name}
            maxLength={FILM_NAME_MAX}
            placeholder={untitled}
            disabled={locked}
            onChange={(event) => { setName(event.target.value); setRefusal(null); }}
          />
        </label>

        <div className="field">
          <span className="label" id={stepLabel}>{t("start.new.first_step")}</span>
          <div className="choice" role="radiogroup" aria-labelledby={stepLabel} onKeyDown={onStepKey}>
            {STEPS.map((option) => {
              const off = !stepAvailable(option, codex);
              return (
                <button
                  key={option}
                  ref={(element) => { stepRefs.current[option] = element; }}
                  type="button"
                  role="radio"
                  aria-checked={step === option}
                  aria-describedby={off && codexHint ? stepHint : undefined}
                  tabIndex={step === option ? 0 : -1}
                  disabled={off || locked}
                  data-act="step"
                  data-step={option}
                  onClick={() => chooseStep(option)}
                >
                  <b>{t(STEP_TEXT[option].title)}</b>
                  <span>{t(STEP_TEXT[option].body)}</span>
                </button>
              );
            })}
          </div>
          {/* Once a step failed, the check has answered and the alert below says what it found. */}
          {codexHint && <span className="hint" id={stepHint} data-hint={codex.state === "unknown" ? "codex-unknown" : "no-codex"}>{codexHint}</span>}
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
          {providers === null && <span className="hint" role="status" id={modelsHint}>{t("start.models.loading")}</span>}
          {providers === "failed" && <div className="impact"><span className="ic" aria-hidden="true">!</span><span>{t("start.models.unavailable")}</span></div>}
          {summary && (
            <div className={`impact${allReady ? " none" : ""}`}>
              <span className="ic" aria-hidden="true">{allReady ? "✓" : "!"}</span>
              <span>{summary}</span>
            </div>
          )}
          {plan && (
            <>
              <button type="button" className="pill sm ghost see-models" data-act="see-models" aria-expanded={showModels} aria-controls={showModels ? modelsId : undefined} onClick={() => setShowModels((v) => !v)}>
                {t(showModels ? "start.models.hide" : "start.models.see")}
              </button>
              {showModels && (
                <div id={modelsId} className="models">
                  <dl className="mlist">
                    {plan.rows.map((row) => (
                      <div key={row.job} className="mrow" data-job={row.job}>
                        <dt className="k">{t(JOB_LABEL[row.job])}</dt>
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

        <div ref={alertRef} className="sheet-alerts" data-alert={failed ? "step" : refusal ? "create" : undefined}>
          {failed && (
            <Alert>
              {tm(failedMsg(failed.first, failed.step, failed.code, failed.film.name))}
              {failed.reason && <> {tm(failed.reason)}</>}
            </Alert>
          )}
          {!failed && refusal && <Alert>{t("start.new.not_created")} {tm(refusal)}</Alert>}
        </div>
      </form>
      <div className="sheet-foot">
        <span className="grow" role="status">{running ? t(PROGRESS[phase.step]) : tm(sheetFootMsg(step, planText))}</span>
        {failed ? (
          <>
            <button
              ref={failed.final ? nextRef : undefined}
              type="button"
              className={`pill${failed.final ? " primary" : ""}`}
              data-act="open-created"
              onClick={() => onCreated(failed.film, createdOutcome(failed.first, planText, { failedAt: failed.step, code: failed.code }))}
            >
              {t("start.new.open_anyway")}
            </button>
            {!failed.final && (
              <button ref={nextRef} type="submit" form={formId} className="pill primary" data-act="create-film" disabled={!!offline || !!problem} title={offline ?? undefined}>{t("start.new.try_again")}</button>
            )}
          </>
        ) : (
          <>
            <button type="button" className="pill" data-act="sheet-cancel" disabled={running} onClick={onClose}>{t("start.new.cancel")}</button>
            <button
              type="submit"
              form={formId}
              className="pill primary"
              data-act="create-film"
              disabled={createOff}
              aria-busy={running || undefined}
              aria-describedby={modelsLoading ? modelsHint : undefined}
              title={createTitle}
            >
              {running ? t("start.busy") : t("start.new.create")}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
