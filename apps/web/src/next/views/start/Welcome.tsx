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

type Found = "found" | "not_found" | "unknown";
const CODEX_WORD: Record<Found, MessageId> = { found: "start.setup.found", not_found: "start.setup.not_found", unknown: "start.setup.unknown" };
const TOOLS_WORD: Record<Found, MessageId> = { found: "start.setup.found", not_found: "start.setup.not_found", unknown: "start.setup.tools_unknown" };

function SetupLine({ label, state, words }: { label: MessageId; state: Found; words: Record<Found, MessageId> }) {
  const { t } = useI18n();
  return (
    <div data-setup={label}>
      <span>{t(label)}</span>
      <span className={state === "found" ? "ok-text" : "dim"}>{state === "found" ? "✓ " : ""}{t(words[state])}</span>
    </div>
  );
}

/**
 * First run, nothing in the list: the demo (free, nothing sent, stamped Demo, stays a demo) beside
 * making your own film, with what this computer has (Codex, FFmpeg, keys) and how keys are set. Keys
 * are explained, not fixed. A written plan is off until Codex is found (`planWhy` says why).
 */
export function Welcome({ setup, offline, demoBusy, demoOff, planWhy, onDemo, onNew, onFromPlan }: {
  setup: SetupStatus;
  offline: string | null;
  demoBusy: boolean;
  /** Why the demo cannot work in this studio, or null. */
  demoOff: string | null;
  planWhy: MessageId | null;
  onDemo(): void;
  onNew(): void;
  onFromPlan(): void;
}) {
  const { t, tm } = useI18n();
  const demoId = useId();
  const ownId = useId();
  const planWhyId = useId();
  const demoWhyId = useId();
  const ready = setup.realReady;
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
          <button
            type="button"
            className={`pill${ready ? "" : " primary"}`}
            data-act="open-demo"
            disabled={demoBusy || !!offline || !!demoOff}
            aria-describedby={demoWhyId}
            title={offline ?? undefined}
            onClick={onDemo}
          >
            {demoBusy ? t("start.busy") : t("start.action.demo")}
          </button>
          <span className="why" id={demoWhyId}>{demoOff ?? t("start.demo.why")}</span>
        </div>
      </section>
      <section className="panel" aria-labelledby={ownId} data-card="own">
        <h2 id={ownId}>{t("start.own.title")}</h2>
        <p>{t(ready ? "start.own.body_ready" : "start.own.body")}</p>
        <div className="setup">
          <SetupLine label="start.setup.codex" state={setup.codex} words={CODEX_WORD} />
          <SetupLine label="start.setup.tools" state={setup.tools} words={TOOLS_WORD} />
          <div data-setup="start.setup.keys"><span>{t("start.setup.keys")}</span><span className={ready && setup.keys.set >= setup.keys.total ? "ok-text" : "dim"}>{tm(keysMsg(setup.keys))}</span></div>
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
          <button type="button" className="pill" data-act="new-from-plan" disabled={!!planWhy || !!offline} aria-describedby={planWhy ? planWhyId : undefined} title={offline ?? undefined} onClick={onFromPlan}>
            {t("start.own.from_plan")}
          </button>
          {planWhy && <span className="why" id={planWhyId}>{t(planWhy)}</span>}
        </div>
      </section>
    </div>
  );
}
