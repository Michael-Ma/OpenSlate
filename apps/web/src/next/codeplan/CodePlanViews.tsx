import type { CodePlanView } from "@openslate/core/public";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { numberLocale } from "../i18n/translate.ts";
import { Picture } from "../keyframes/parts.tsx";
import { useArtifactUrl } from "../media/useArtifactUrl.ts";
import { MediaViewer, type ViewerItem } from "../media/Viewer.tsx";
import { artifactRefOf, declaredPlan, latestRender, makingMsg, stepRow, stepRows, type DeclaredPlan, type DeclaredShot, type Making, type StepRow } from "../model/code-plan.ts";
import { CodePlanMedia, useMode } from "../store/react.tsx";
import { Thumb } from "../views/plan/ShotRow.tsx";
import { useCodePlan } from "./CodePlanContext.tsx";
import { useDeveloperMode } from "../app/useDeveloperMode.ts";
import { StepCard, StepProblemNote, StepStatus, ViewHead, ViewMessage, stepLabel, stepStatus } from "./parts.tsx";
import { msg } from "../model/types.ts";
import "../views/plan/plan.css";
import "./codeplan.css";

/**
 * The plan's run, before it has a version: reading, unreadable (with Read again), or no plan yet. Null once there is a
 * version to show.
 */
function useNotReady(): ReactNode | null {
  const { t } = useI18n();
  const { view, error, loading, reload } = useCodePlan();
  if (!view) {
    if (error) return <ViewMessage title={t("codeplan.run.unread", { code: error })}><button type="button" className="pill sm" data-act="code-plan-reload" onClick={reload}>{t("codeplan.run.retry")}</button></ViewMessage>;
    return <ViewMessage title={t(loading ? "codeplan.run.loading" : "codeplan.plan.empty_title")} />;
  }
  if (view.planVersion === null) return <ViewMessage title={t("codeplan.plan.empty_title")} body={t("codeplan.plan.empty_body")} />;
  return null;
}

// ---- Plan -------------------------------------------------------------------------------------

/** Plan in a code-plan film: the scenes and shots the latest pass declared (`ctx.scene`, `ctx.shot`), read only. */
export function CodePlanPlanView() {
  const { t } = useI18n();
  const developer = useDeveloperMode();
  const { view } = useCodePlan();
  const waiting = useNotReady();
  // Waiting minutes move on while something is being made, without a new view.
  const minute = useMinute(!!view?.steps.some((step) => step.reached && step.state === "in_flight"));
  const plan = useMemo(() => (view ? declaredPlan(view) : null), [view, minute]);
  // Each shot's frame and clip open in one viewer, in film order.
  const media = useMemo(() => (plan ? shotMedia(plan) : []), [plan]);
  const [viewing, setViewing] = useState<number | null>(null);
  const open = (key: string) => setViewing(Math.max(0, media.findIndex((item) => item.key === key)));
  const line = view && plan && view.planVersion !== null
    ? t("codeplan.plan.line", { scenes: plan.scenes.length, shots: plan.shotCount, version: view.planVersion }) : null;
  return (
    <main className="work plan cp-view cp-plan" data-view="plan" data-code-plan="true">
      <ViewHead title={t("plan.title")} line={line} />
      {waiting ?? (plan && (
        <CodePlanMedia>
          <p className="cp-lead">{t(developer ? "codeplan.plan.note" : "codeplan.plan.note_plain")}</p>
          {/* Before the first pass ends, an empty list only means the run has not reached the declarations yet. */}
          {!plan.scenes.length && !plan.loose.length ? <ViewMessage title={t(view?.lastPassAt ? "codeplan.plan.no_rows" : "codeplan.plan.first_pass")} /> : null}
          <div className="scenes">
            {plan.references.length ? (
              <section className="scene panel cp-refs" data-scene="references" aria-label={t("codeplan.plan.references")}>
                <div className="scene-top">
                  <h2>{t("codeplan.plan.references")}</h2>
                  <span className="meta">{t("codeplan.plan.references_note")}</span>
                </div>
                <div className="cp-ref-row">
                  {plan.references.map((ref, index) => ref.artifact
                    ? <Thumb key={ref.key} label={String(index + 1)} picture={ref.artifact} dimmed={false} empty={null} onOpen={() => open(`ref:${ref.key}`)} />
                    : ref.making ? <MakingThumb key={ref.key} label={String(index + 1)} making={ref.making} /> : null)}
                </div>
              </section>
            ) : null}
            {plan.scenes.map((scene) => (
              <section key={scene.key} className="scene panel" data-scene={scene.key} aria-label={scene.title || t("codeplan.plan.scene", { n: scene.ordinal })}>
                <div className="scene-top">
                  <span className="sno" aria-hidden="true">{scene.ordinal}</span>
                  <h2>{scene.title || t("codeplan.plan.scene", { n: scene.ordinal })}</h2>
                  {scene.purpose ? <span className="meta">{scene.purpose}</span> : null}
                </div>
                <ul className="shots">{scene.shots.map((shot) => <DeclaredShotRow key={shot.key} shot={shot} onOpen={open} />)}</ul>
              </section>
            ))}
            {plan.loose.length ? (
              <section className="scene panel" data-scene="loose" aria-label={t("codeplan.plan.loose")}>
                <div className="scene-top"><h2>{t("codeplan.plan.loose")}</h2></div>
                <ul className="shots">{plan.loose.map((shot) => <DeclaredShotRow key={shot.key} shot={shot} onOpen={open} />)}</ul>
              </section>
            ) : null}
          </div>
          {viewing !== null && media.length ? <MediaViewer items={media} start={viewing} onClose={() => setViewing(null)} /> : null}
        </CodePlanMedia>
      ))}
    </main>
  );
}

/** A minute counter that ticks only while `active`, so waiting times stay true on screen. */
function useMinute(active: boolean): number {
  const [minute, setMinute] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setMinute((value) => value + 1), 60000);
    return () => clearInterval(timer);
  }, [active]);
  return minute;
}

/** Where a picture or clip will appear: what the run is doing about it. */
function MakingThumb({ label, making }: { label: string; making: Making }) {
  const { tm } = useI18n();
  return (
    <div className="thumb empty cp-making" data-making={making.state} role="status" title={making.state === "unknown" ? tm(msg("codeplan.making.unknown_hint")) : undefined}>
      <span className="badge">{label}</span>
      {making.state === "making" ? <i className="cp-spin" aria-hidden="true" /> : null}
      <span>{tm(makingMsg(making))}</span>
    </div>
  );
}

/** Every shared picture, then every shot's keyframe and clip, for the viewer. */
function shotMedia(plan: DeclaredPlan): ViewerItem[] {
  const items: ViewerItem[] = plan.references.flatMap((ref) => (ref.artifact ? [{ key: `ref:${ref.key}`, artifact: ref.artifact, title: ref.label, ...(ref.stepKey ? { stepKey: ref.stepKey } : {}) }] : []));
  for (const shot of [...plan.scenes.flatMap((scene) => scene.shots), ...plan.loose]) {
    const title = shot.purpose || shot.label;
    if (shot.picture) items.push({ key: `${shot.key}:frame`, artifact: shot.picture, title, ...(shot.pictureStep ? { stepKey: shot.pictureStep } : {}) });
    if (shot.clip) items.push({ key: `${shot.key}:clip`, artifact: shot.clip.artifact, title, stepKey: shot.clip.stepKey, ...(shot.clip.poster ? { poster: shot.clip.poster } : {}) });
  }
  return items;
}

function DeclaredShotRow({ shot, onOpen }: { shot: DeclaredShot; onOpen(key: string): void }) {
  const { t, tm } = useI18n();
  const meta = [shot.framing, shot.seconds !== null ? t("codeplan.plan.seconds", { seconds: shot.seconds }) : "", shot.motion ? t("codeplan.plan.motion", { motion: shot.motion }) : ""].filter(Boolean).join(" · ");
  return (
    <li className="shot-row cp-shot-row" data-shot={shot.key}>
      <div className="cp-shot-media">
        {!shot.picture && shot.making.picture ? <MakingThumb label={shot.label} making={shot.making.picture} />
          : <Thumb label={shot.label} picture={shot.picture} dimmed={false} empty={{ id: "codeplan.plan.no_keyframe" }} onOpen={shot.picture ? () => onOpen(`${shot.key}:frame`) : undefined} />}
        {shot.clip?.poster ? <Thumb label="▶" picture={shot.clip.poster} dimmed={false} empty={null} onOpen={() => onOpen(`${shot.key}:clip`)} />
          : shot.making.clip ? <MakingThumb label="▶" making={shot.making.clip} /> : null}
      </div>
      <div className="shot-main">
        {/* A new take on its way, while the last one still shows. */}
        {shot.picture && shot.making.picture ? <div className="cp-shot-making" role="status">{t("codeplan.making.new_keyframe", { status: tm(makingMsg(shot.making.picture)) })}</div> : null}
        {shot.clip?.poster && shot.making.clip ? <div className="cp-shot-making" role="status">{t("codeplan.making.new_clip", { status: tm(makingMsg(shot.making.clip)) })}</div> : null}
        <b>{shot.purpose || <span className="muted">{t("plan.shot.no_purpose")}</span>}</b>
        {meta ? <div className="shot-meta">{meta}</div> : null}
        {shot.prompt ? <div className="shot-prompt">{t("plan.shot.picture", { prompt: shot.prompt })}</div> : null}
      </div>
      <div className="shot-say">
        {shot.narration ? <q>{shot.narration}</q> : <span className="none">{t("plan.narr.none")}</span>}
      </div>
    </li>
  );
}

/** Made steps with media, for the viewer: the label as its title, its model and status underneath. */
export function viewerItems(rows: StepRow[], t: ReturnType<typeof useI18n>["t"], tm: ReturnType<typeof useI18n>["tm"]): ViewerItem[] {
  return rows.flatMap((row) => (row.artifact ? [{ key: row.key, artifact: row.artifact, title: stepLabel(row, t), detail: [row.model, tm(row.status)].filter(Boolean).join(" · "), stepKey: row.key, ...(row.poster ? { poster: row.poster } : {}) }] : []));
}

// ---- Film -------------------------------------------------------------------------------------

/** Film in a code-plan film: the newest finished render in a player, then the render and clip steps. */
export function CodePlanFilmView() {
  const { t, tm, locale } = useI18n();
  const { view } = useCodePlan();
  const waiting = useNotReady();
  const film = useMemo(() => (view ? filmRows(view, numberLocale(locale)) : null), [view, locale]);
  // Every made clip and render opens in one viewer.
  const media = useMemo(() => (film ? viewerItems([...film.renders.current, ...film.renders.history, ...film.clips.current, ...film.clips.history], t, tm) : []), [film, t, tm]);
  const [viewing, setViewing] = useState<number | null>(null);
  const open = (key: string) => setViewing(Math.max(0, media.findIndex((item) => item.key === key)));
  return (
    <main className="work plan cp-view cp-film" data-view="film" data-code-plan="true">
      <ViewHead title={t("film.title")} line={film && !waiting ? t("codeplan.film.line", { clips: film.videoCount, renders: film.renderCount }) : null} />
      {waiting ?? (film && (
        <CodePlanMedia>
          <section className="cp-player" aria-label={t("codeplan.film.player")}>
            {film.latest ? <RenderPlayer row={film.latest} /> : <ViewMessage title={t("codeplan.film.none_title")} body={t("codeplan.film.none_body")} />}
            {film.latest?.fitWarning ? <p className="cp-fit-note" role="note">{t("codeplan.film.fit_warning", { clips: film.latest.fitWarning.clips, kept: film.latest.fitWarning.keptPercent })}</p> : null}
          </section>
          {film.renders.current.length || film.renders.history.length ? (
            <section className="cp-group" aria-label={t("codeplan.film.renders")}>
              <h2 className="cp-group-title">{t("codeplan.film.renders")}</h2>
              <StepList rows={[...film.renders.current, ...film.renders.history]} onOpen={open} />
            </section>
          ) : null}
          <section className="cp-group" aria-label={t("codeplan.film.clips")}>
            <h2 className="cp-group-title">{t("codeplan.film.clips")}</h2>
            {film.clipCount ? <StepList rows={[...film.clips.current, ...film.clips.history]} onOpen={open} /> : <p className="cp-hint">{t("codeplan.film.no_clips")}</p>}
          </section>
          {viewing !== null && media.length ? <MediaViewer items={media} start={viewing} onClose={() => setViewing(null)} /> : null}
        </CodePlanMedia>
      ))}
    </main>
  );
}

function filmRows(view: CodePlanView, locale: string) {
  const renders = stepRows(view, ["render"], locale);
  const clips = stepRows(view, ["video", "speech", "music"], locale);
  const latest = latestRender(view);
  return {
    renders, clips,
    latest: latest ? stepRow(latest, view, locale) : null,
    renderCount: renders.current.length + renders.history.length,
    clipCount: clips.current.length + clips.history.length,
    // The heading counts pictures; speech and music are listed with the clips but are not clips.
    videoCount: [...clips.current, ...clips.history].filter((row) => row.kind === "video").length,
  };
}

/** Steps as rows: the clip's still (it opens the clip), status, what it is, its model and price. */
function StepList({ rows, onOpen }: { rows: StepRow[]; onOpen(key: string): void }) {
  const { t, tm } = useI18n();
  return (
    <ul className="cp-rows">
      {rows.map((row) => (
        <li key={row.key} className={`cp-row${row.reached ? "" : " history"}${row.poster ? " with-poster" : ""}`} data-step={row.key} data-state={row.state} data-reached={row.reached ? "true" : "false"}>
          {row.poster ? (
            <button type="button" className="cp-row-poster" data-act="step-open" aria-label={t("viewer.open", { label: stepLabel(row, t) })} onClick={() => onOpen(row.key)}>
              <Picture artifact={row.poster} alt="" />
            </button>
          ) : null}
          <StepStatus status={stepStatus(row)} tone={row.tone} title={row.error ?? undefined} />
          <span className="cp-row-label" title={stepLabel(row, t)}>{stepLabel(row, t)}</span>
          {row.model ? <span className="cp-step-model">{row.model}</span> : null}
          {row.price ? <span className="cp-price">{tm(row.price)}</span> : null}
          <StepProblemNote row={row} />
        </li>
      ))}
    </ul>
  );
}

/**
 * The newest render, in the browser's own player (as the Keyframes preview plays a clip). The sample studio has no
 * video files, so there its first frame stands in and says so.
 */
function RenderPlayer({ row }: { row: StepRow }) {
  const { t } = useI18n();
  const live = useMode() === "live";
  const artifact = artifactRefOf(row.artifact);
  const source = useArtifactUrl(live ? artifact : null);
  if (!artifact) return null;
  if (!live) {
    return (
      <div className="cp-render sample">
        <Picture artifact={{ ...artifact, kind: "image" }} alt={t("codeplan.film.player")} />
        <p className="cp-hint" data-act="code-plan-sample">{t("codeplan.film.sample")}</p>
      </div>
    );
  }
  if (source.status === "failed") return <div className="cp-render"><div className="pic-note" role="status">{t("preview.clip.failed")}</div></div>;
  if (source.status !== "ready") return <div className="cp-render"><div className="pic-note pic-loading" role="status">{t("preview.clip.loading")}</div></div>;
  return (
    <div className="cp-render">
      <video className="cp-video" src={source.url} controls playsInline preload="metadata" aria-label={t("codeplan.film.player")} data-act="code-plan-player" />
    </div>
  );
}
