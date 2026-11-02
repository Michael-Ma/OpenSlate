import { useMemo, useState } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { numberLocale } from "../i18n/translate.ts";
import { bylineTime } from "../model/director.ts";
import { changeBlocks, diffCounts, lineDiff, previousVersion, versionRows, type DiffLine, type VersionRow } from "../model/code-plan.ts";
import { useCodePlan, useVersionSource } from "./CodePlanContext.tsx";
import { ViewHead, ViewMessage } from "./parts.tsx";
import "../views/plan/plan.css";
import "./codeplan.css";

/**
 * Code in a code-plan film: the plan's versions, newest first, each with what its dry run found (steps reused, new
 * steps and their prices, unsent steps cancelled, the cost certain now, findings), and the selected version's program,
 * read only, with line numbers and its changes against the version before it.
 */
export function CodePlanCodeView() {
  const { t, tm, locale } = useI18n();
  const { view, error, loading, reload } = useCodePlan();
  const rows = useMemo(() => (view ? versionRows(view, numberLocale(locale)) : []), [view, locale]);
  const [picked, setPicked] = useState<number | null>(null);
  const selected = rows.find((row) => row.version === picked) ?? rows.find((row) => row.current) ?? rows[0] ?? null;
  const now = new Date();
  const line = selected ? t("codeplan.code.line", { version: selected.version, author: tm(selected.author), time: bylineTime(selected.createdAt, locale, now) ?? "" }) : null;
  return (
    <main className="work plan cp-view cp-code" data-view="code" data-code-plan="true">
      <ViewHead title={t("codeplan.code.title")} line={line} />
      {!view ? (
        error
          ? <ViewMessage title={t("codeplan.run.unread", { code: error })}><button type="button" className="pill sm" data-act="code-plan-reload" onClick={reload}>{t("codeplan.run.retry")}</button></ViewMessage>
          : <ViewMessage title={t(loading ? "codeplan.run.loading" : "codeplan.code.empty")} />
      ) : !rows.length || !selected ? (
        <ViewMessage title={t("codeplan.code.empty")} />
      ) : (
        <div className="cp-code-grid">
          <section className="cp-versions" aria-label={t("codeplan.code.versions")}>
            <h2 className="cp-group-title">{t("codeplan.code.versions")}</h2>
            <ol>
              {rows.map((row) => (
                <li key={row.version}>
                  <VersionCard row={row} selected={row.version === selected.version} onSelect={() => setPicked(row.version)} />
                </li>
              ))}
            </ol>
          </section>
          <SourcePane version={selected.version} before={previousVersion(view.versions, selected.version)} />
        </div>
      )}
    </main>
  );
}

function VersionCard({ row, selected, onSelect }: { row: VersionRow; selected: boolean; onSelect(): void }) {
  const { t, tm, locale } = useI18n();
  const time = bylineTime(row.createdAt, locale, new Date());
  return (
    <div className={`cp-version${selected ? " selected" : ""}`} data-version={row.version}>
      <button type="button" className="cp-version-hit" data-act="code-plan-version" data-version={row.version} aria-pressed={selected} onClick={onSelect}>
        <b>{t("codeplan.code.version", { version: row.version })}</b>
        <span className="cp-version-meta">{tm(row.author)}{time ? ` · ${time}` : ""}</span>
        {row.current ? <span className="status" data-act="code-plan-in-use">{t("codeplan.code.in_use")}</span> : null}
      </button>
      <ul className="cp-facts">
        <li data-fact="reused"><i aria-hidden="true">↺</i>{tm(row.reused)}</li>
        {row.newCost ? <li data-fact="new" data-tone="cost"><i aria-hidden="true">+</i>{tm(row.newCost)}</li> : null}
        {row.cancelled ? <li data-fact="cancelled"><i aria-hidden="true">−</i>{tm(row.cancelled)}</li> : null}
        <li data-fact="certain" data-tone="cost"><i aria-hidden="true">$</i>{tm(row.certain)}</li>
        {row.findings.map((finding, index) => (
          <li key={index} data-fact="finding" data-code={finding.code}><i aria-hidden="true">!</i><span>{tm(finding.text)} <code>{finding.code}</code>{finding.detail ? <small>{finding.detail}</small> : null}</span></li>
        ))}
      </ul>
      {row.newSteps.length ? (
        <details className="cp-new-steps">
          <summary>{t("codeplan.code.new_steps")}</summary>
          <ul>
            {row.newSteps.map((step, index) => (
              <li key={index}><b>{tm(step.kind)}</b><span title={step.label}>{step.label}</span>{step.price ? <span className="cp-price">{tm(step.price)}</span> : null}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SourcePane({ version, before }: { version: number; before: number | null }) {
  const { t } = useI18n();
  const source = useVersionSource(version);
  const earlier = useVersionSource(before);
  const [mode, setMode] = useState<"changes" | "program">("changes");
  const ready = source.status === "ready" && (before === null || earlier.status === "ready" || earlier.status === "failed");
  const lines = useMemo(() => (source.status === "ready" && ready
    ? lineDiff(before !== null && earlier.status === "ready" ? earlier.source.source : null, source.source.source) : null),
  [source, earlier, before, ready]);
  const comparable = before !== null && earlier.status === "ready";
  const shown = comparable ? mode : "program";
  const counts = lines ? diffCounts(lines) : { added: 0, removed: 0 };
  return (
    <section className="cp-source" aria-label={t("codeplan.code.source", { version })}>
      <div className="cp-source-head">
        <div className="segctl" role="radiogroup" aria-label={t("codeplan.code.show")}>
          {(["changes", "program"] as const).map((option) => (
            <button key={option} type="button" role="radio" aria-checked={shown === option} data-act="code-plan-mode" data-mode={option}
              disabled={option === "changes" && !comparable} onClick={() => setMode(option)}>
              {t(option === "changes" ? "codeplan.code.changes" : "codeplan.code.program")}
            </button>
          ))}
        </div>
        <span className="cp-hint" data-act="code-plan-against">
          {before === null ? t("codeplan.code.first")
            : !comparable ? null
            : counts.added || counts.removed ? t("codeplan.code.against", { version: before, added: counts.added, removed: counts.removed })
            : t("codeplan.code.same", { version: before })}
        </span>
      </div>
      <p className="cp-hint">{t("codeplan.code.read_only")}</p>
      {source.status === "failed" ? <ViewMessage title={t("codeplan.code.failed", { version, code: source.code })} />
        : before !== null && earlier.status === "failed" && source.status === "ready" ? <p className="cp-hint">{t("codeplan.code.failed", { version: before, code: earlier.code })}</p> : null}
      {!lines ? (source.status !== "failed" ? <ViewMessage title={t("codeplan.code.loading", { version })} /> : null) : (
        <SourceLines lines={lines} mode={shown} comparable={comparable} />
      )}
    </section>
  );
}

/** Monospace lines with both line numbers; in Changes, unchanged runs beyond three lines of context fold away. */
function SourceLines({ lines, mode, comparable }: { lines: DiffLine[]; mode: "changes" | "program"; comparable: boolean }) {
  const { t } = useI18n();
  const program = useMemo(() => lines.filter((line) => line.kind !== "removed"), [lines]);
  const blocks = useMemo(() => (mode === "changes" ? changeBlocks(lines) : [{ kind: "lines" as const, lines: program }]), [mode, lines, program]);
  return (
    <div className="cp-lines" data-mode={mode} role="region" aria-label={t("codeplan.code.program")} tabIndex={0}>
      <table>
        <tbody>
          {blocks.map((block, index) => block.kind === "skip" ? (
            <tr key={index} className="skip"><td colSpan={comparable && mode === "changes" ? 4 : 2}>{t("codeplan.code.unchanged", { count: block.count })}</td></tr>
          ) : block.lines.map((line, at) => (
            <tr key={`${index}:${at}`} className={mode === "changes" ? line.kind : "same"} data-line={line.kind}>
              {comparable && mode === "changes" ? <td className="no" aria-hidden="true">{line.before ?? ""}</td> : null}
              <td className="no" aria-hidden="true">{line.after ?? ""}</td>
              {comparable && mode === "changes" ? (
                <td className="mark">{line.kind === "added" ? <><span aria-hidden="true">+</span><span className="sr">{t("codeplan.code.added")}</span></> : line.kind === "removed" ? <><span aria-hidden="true">−</span><span className="sr">{t("codeplan.code.removed")}</span></> : null}</td>
              ) : null}
              <td className="code"><code>{line.text || " "}</code></td>
            </tr>
          )))}
        </tbody>
      </table>
    </div>
  );
}
