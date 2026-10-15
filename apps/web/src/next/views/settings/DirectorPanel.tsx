import { useId, useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { codexProgram, directorRequest, draftFrom, draftProblems, reviewRequest, reviewSwitch, type DirectorDraft, type DirectorReview, type DirectorSetup } from "../../model/settings-director.ts";
import { msg } from "../../model/types.ts";
import { useStore, useStudio } from "../../store/react.tsx";
import type { Resource } from "../../store/useResource.ts";
import { DIRECTOR_PRESS } from "./ModelsPanel.tsx";
import { Panel, ReadState } from "./parts.tsx";
import type { Read } from "./useRead.ts";

const REVIEW_PRESS = "settings:director-review";

/**
 * The film's Director: Codex (program, model, Codex home) with Change…, or the scripted demo with
 * "Set up Codex…". Saving checks that Codex runs. The review switch (D4) says what it costs in Codex use.
 */
export function DirectorPanel({ setup, review, film, offline }: { setup: Resource<DirectorSetup>; review: Read<DirectorReview>; film: string; offline: string | null }) {
  const store = useStore();
  const { t, tm } = useI18n();
  const presses = useStudio((s) => s.pending);
  const [draft, setDraft] = useState<DirectorDraft | null>(null);
  const data = setup.data;
  const native = data?.selection.mode === "native";
  const saving = !!presses[DIRECTOR_PRESS];
  const toggle = useMemo(() => reviewSwitch(review, data), [review, data]);
  const ids = useId();

  const edit = () => {
    if (!data) return;
    setDraft(draftFrom(data));
    requestAnimationFrame(() => document.getElementById(`${ids}-bin`)?.focus());
  };
  const cancel = () => {
    setDraft(null);
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-act='director-edit']")?.focus());
  };
  const problems = draft ? draftProblems(draft) : [];

  const save = async () => {
    if (!data || !draft || problems.length) return;
    const request = directorRequest(data, { mode: "native", binaryPath: draft.binaryPath, model: draft.model, codexHome: draft.codexHome });
    const result = await store.command<DirectorSetup>(DIRECTOR_PRESS, request.body, () => request, msg("set.toast.director_saved"));
    if (!result) return;
    setDraft(null);
    setup.reload();
    requestAnimationFrame(() => document.querySelector<HTMLElement>("[data-act='director-edit']")?.focus());
  };

  const flip = async () => {
    if (toggle.disabled) return;
    const next = !toggle.on;
    const head = store.getState().snapshot?.project.headVersion ?? 0;
    const request = reviewRequest(next, head);
    const result = await store.command<DirectorReview>(REVIEW_PRESS, request.body, () => request, msg(next ? "set.toast.review_on" : "set.toast.review_off"));
    if (result) review.reload();
  };

  const editButton = data && !draft && (
    <button type="button" className="pill sm" data-act="director-edit" disabled={!!offline || data.busy} title={offline ?? (data.busy ? t("set.director.busy") : undefined)} onClick={edit}>
      {t(native ? "set.director.change" : "set.director.setup_codex")}
    </button>
  );

  const body = () => {
    if (!data) {
      // An answered "no Director setup here" is a fact; any other failed read can be tried again.
      if (setup.error === "SERVICE_UNAVAILABLE" || setup.error === "NOT_FOUND") return <p className="lead">{t("set.director.unavailable")}</p>;
      return <ReadState error={setup.error} onRetry={setup.reload} />;
    }
    if (draft) {
      const fieldProblem = (field: keyof DirectorDraft) => problems.find((p) => p.field === field)?.problem;
      const hint = (field: keyof DirectorDraft) => `${ids}-${field}-why`;
      // Save names every reason it is off.
      const reasons = problems.map((p) => hint(p.field)).join(" ") || undefined;
      const choices = data.modelChoices.map((choice) => choice.id);
      if (draft.model && !choices.includes(draft.model)) choices.unshift(draft.model);
      return (
        <form className="inline-form" data-form="director" aria-label={t("set.director.form")} onSubmit={(event) => { event.preventDefault(); void save(); }}>
          <label className="field">
            <span className="label">{t("set.director.field.program")}</span>
            <input id={`${ids}-bin`} className="input mono" value={draft.binaryPath} spellCheck={false} autoComplete="off" aria-invalid={!!fieldProblem("binaryPath")} aria-describedby={fieldProblem("binaryPath") ? hint("binaryPath") : undefined} onChange={(e) => setDraft({ ...draft, binaryPath: e.target.value })} />
            {fieldProblem("binaryPath") && <span className="hint" id={hint("binaryPath")}>{tm(fieldProblem("binaryPath")!)}</span>}
          </label>
          <label className="field">
            <span className="label">{t("set.director.field.model")}</span>
            {choices.length ? (
              <select className="select" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })}>
                {choices.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            ) : (
              <input className="input mono" value={draft.model} spellCheck={false} autoComplete="off" aria-invalid={!!fieldProblem("model")} aria-describedby={fieldProblem("model") ? hint("model") : undefined} onChange={(e) => setDraft({ ...draft, model: e.target.value })} />
            )}
            {fieldProblem("model") && <span className="hint" id={hint("model")}>{tm(fieldProblem("model")!)}</span>}
          </label>
          <label className="field">
            <span className="label">{t("set.director.field.home")}</span>
            <input className="input mono" value={draft.codexHome} placeholder={t("set.director.home_placeholder")} spellCheck={false} autoComplete="off" aria-invalid={!!fieldProblem("codexHome")} aria-describedby={fieldProblem("codexHome") ? hint("codexHome") : undefined} onChange={(e) => setDraft({ ...draft, codexHome: e.target.value })} />
            {fieldProblem("codexHome") && <span className="hint" id={hint("codexHome")}>{tm(fieldProblem("codexHome")!)}</span>}
          </label>
          <div className="impact"><span className="ic" aria-hidden="true">i</span><span>{t("set.director.save_note")}</span></div>
          <div className="form-acts">
            <button type="submit" className="pill primary" data-act="director-save" disabled={!!offline || saving || problems.length > 0} aria-describedby={reasons} title={offline ?? undefined}>{saving ? t("set.saving") : t("set.save")}</button>
            <button type="button" className="pill" data-act="director-cancel" onClick={cancel}>{t("set.cancel")}</button>
          </div>
        </form>
      );
    }
    if (!native) return <p className="lead">{t("set.director.demo_lead")}</p>;
    const program = codexProgram(data);
    const model = data.selection.model ?? data.defaults.model;
    return (
      <dl className="kv">
        <dt>{t("set.director.program")}</dt>
        <dd className="mono">{program || t("set.director.no_program")}</dd>
        <dt>{t("set.director.model")}</dt>
        <dd>{model}</dd>
        <dt>{t("set.director.home")}</dt>
        <dd className="mono">{data.selection.codexHome ?? data.defaults.codexHome ?? t("set.director.home_default")}</dd>
      </dl>
    );
  };

  return (
    <Panel id="set-director" title="set.section.director" scope={t("set.scope.film", { film })} end={editButton}>
      {body()}
      <div className="srow review-row">
        <div className="txt">
          <b id={`${ids}-rv`}>{t("set.review.title")}</b>
          <span id={`${ids}-rv-d`}>{t("set.review.body")}</span>
          {toggle.reason && <span className="why" data-review-reason>{tm(toggle.reason)}</span>}
        </div>
        <button
          type="button"
          className="switch"
          role="switch"
          data-act="review-toggle"
          aria-checked={toggle.on}
          aria-labelledby={`${ids}-rv`}
          aria-describedby={`${ids}-rv-d`}
          disabled={toggle.disabled || !!offline || !!presses[REVIEW_PRESS]}
          title={offline ?? (toggle.reason ? tm(toggle.reason) : undefined)}
          onClick={() => void flip()}
        />
      </div>
    </Panel>
  );
}
