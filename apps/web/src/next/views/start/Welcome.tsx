import { useId } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import type { MessageId } from "../../i18n/messages.ts";
import { codeSegments } from "../../model/shell.ts";
import { keysMsg, type SetupStatus } from "../../model/start-new.ts";

/** A flat, wordless still for the demo card (the demo's own pictures exist only once it is made). */
function DemoStill() {
  return (
    <svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect className="sky" width="320" height="180" />
      <rect className="sea" y="96" width="320" height="84" />
      <rect className="fog" x="-10" y="90" width="340" height="8" rx="4" />
      <path className="pier" d="M90 180 L136 98 H184 L230 180z" />
      <path className="plank" d="M126 116 H194 M116 134 H204 M104 156 H216" />
      <rect className="figure" x="150" y="140" width="7" height="26" />
      <rect className="figure" x="163" y="140" width="7" height="26" />
      <path className="coat" d="M146 82 H174 L184 146 H136z" />
      <circle className="face" cx="160" cy="70" r="11" />
    </svg>
  );
}

const setupWord = (state: "found" | "not_found" | "unknown"): MessageId =>
  state === "found" ? "start.setup.found" : state === "not_found" ? "start.setup.not_found" : "start.setup.unknown";

/**
 * First run, nothing in the list: the demo (free, nothing sent, stamped Demo, stays a demo) beside
 * making your own film, with what this computer has and how keys are set. Keys are explained, not fixed.
 */
export function Welcome({ setup, offline, demoBusy, onDemo, onNew, onFromPlan }: {
  setup: SetupStatus;
  offline: string | null;
  demoBusy: boolean;
  onDemo(): void;
  onNew(): void;
  onFromPlan(): void;
}) {
  const { t, tm } = useI18n();
  const demoId = useId();
  const ownId = useId();
  const planWhy = useId();
  const ready = setup.realReady;
  const noCodex = setup.codex === "not_found";
  return (
    <div className="welcome">
      <section className="panel" aria-labelledby={demoId} data-card="demo">
        <div className="demo-pic">
          <DemoStill />
          <span className="demo-mark" aria-hidden="true">{t("start.demo.mark")}</span>
        </div>
        <h2 id={demoId}>{t("start.demo.title")}</h2>
        <p>{t("start.demo.body")}</p>
        <div className="acts">
          <button type="button" className={`pill${ready ? "" : " primary"}`} data-act="open-demo" disabled={demoBusy || !!offline} title={offline ?? undefined} onClick={onDemo}>
            {demoBusy ? t("start.busy") : t("start.action.demo")}
          </button>
          <span className="why">{t("start.demo.why")}</span>
        </div>
      </section>
      <section className="panel" aria-labelledby={ownId} data-card="own">
        <h2 id={ownId}>{t("start.own.title")}</h2>
        <p>{t(ready ? "start.own.body_ready" : "start.own.body")}</p>
        <div className="setup">
          <div><span>{t("start.setup.codex")}</span><span className={setup.codex === "found" ? "ok-text" : "dim"}>{setup.codex === "found" ? "✓ " : ""}{t(setupWord(setup.codex))}</span></div>
          {setup.tools && (
            <div><span>{t("start.setup.tools")}</span><span className={setup.tools === "found" ? "ok-text" : "dim"}>{setup.tools === "found" ? "✓ " : ""}{t(setupWord(setup.tools))}</span></div>
          )}
          <div><span>{t("start.setup.keys")}</span><span className={ready && setup.keys.set >= setup.keys.total ? "ok-text" : "dim"}>{tm(keysMsg(setup.keys))}</span></div>
        </div>
        {!ready && (
          <p className="hint">
            {codeSegments(t("start.setup.how")).map((part, index) => (part.code ? <b key={index} className="cmd">{part.text}</b> : <span key={index}>{part.text}</span>))}
          </p>
        )}
        <div className="acts">
          <button type="button" className={`pill${ready ? " primary" : ""}`} data-act="new-film" disabled={!!offline} title={offline ?? undefined} onClick={onNew}>
            {t(ready ? "start.action.new" : "start.own.new_anyway")}
          </button>
          {!ready && <span className="why">{t("start.own.new_anyway_why")}</span>}
          <button type="button" className="pill" data-act="new-from-plan" disabled={noCodex || !!offline} aria-describedby={noCodex ? planWhy : undefined} title={offline ?? undefined} onClick={onFromPlan}>
            {t("start.own.from_plan")}
          </button>
          {noCodex && <span className="why" id={planWhy}>{t("start.own.needs_codex")}</span>}
        </div>
      </section>
    </div>
  );
}
