import { useMemo, useState } from "react";
import { ApiError } from "../../api/client.ts";
import { useI18n } from "../../i18n/I18n.tsx";
import { errorMsg } from "../../i18n/translate.ts";
import { checkOutcome, computerView } from "../../model/settings-computer.ts";
import type { DirectorSetup } from "../../model/settings-director.ts";
import { joinList, type ProviderCatalogView } from "../../model/settings.ts";
import { msg } from "../../model/types.ts";
import { useStore } from "../../store/react.tsx";
import type { Resource } from "../../store/useResource.ts";
import { CodeText, Panel, ReadState } from "./parts.tsx";

const codeOf = (error: unknown): string => (error instanceof ApiError ? error.code : "NETWORK_ERROR");

/**
 * This computer: Codex, FFmpeg and each key a model needs, for every film. "Check again" re-reads the catalog
 * and, inside a film, runs Codex's read-only setup check (GET /director/models); keys are explained, never
 * shown or set here. It says "Checked" only when every read succeeded.
 */
export function ComputerPanel({ providers, setup, hasFilm, offline }: { providers: Resource<ProviderCatalogView>; setup: Resource<DirectorSetup>; hasFilm: boolean; offline: string | null }) {
  const store = useStore();
  const { t, tm, locale } = useI18n();
  const [checking, setChecking] = useState(false);
  /** The code of the last Check again that could not check Codex; cleared by the next one. */
  const [checkFailed, setCheckFailed] = useState<string | null>(null);
  const view = useMemo(
    () => computerView(providers.data, hasFilm ? setup.data : null, hasFilm ? setup.error : null, { noFilm: !hasFilm, checkFailed }),
    [providers.data, setup.data, setup.error, hasFilm, checkFailed],
  );

  const recheck = async () => {
    setChecking(true);
    setCheckFailed(null);
    try {
      // The Codex check needs a film; it can be slow, busy or refused (no Codex Director on this server).
      const [codex, catalog] = await Promise.all([
        hasFilm
          ? store.read<DirectorSetup>("/director/models").then((result) => ({ ok: true as const, busy: result.busy }), (error: unknown) => ({ ok: false as const, code: codeOf(error) }))
          : Promise.resolve(null),
        store.read<ProviderCatalogView>("/api/providers").then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, code: codeOf(error) })),
      ]);
      const outcome = checkOutcome(codex, catalog);
      if (outcome.kind === "failed") {
        if (codex && !codex.ok) setCheckFailed(codex.code);
        store.dispatch({ type: "toast", message: errorMsg(outcome.code), tone: "error" });
      } else {
        store.dispatch({ type: "toast", message: msg(outcome.kind === "busy" ? "set.toast.check_busy" : "set.toast.checked"), tone: "info" });
      }
    } finally {
      setChecking(false);
      if (hasFilm) setup.reload();
      providers.reload();
    }
  };

  const check = (
    <button type="button" className="pill sm" data-act="recheck" aria-busy={checking || undefined} disabled={checking || !!offline} title={offline ?? undefined} onClick={() => void recheck()}>
      {checking ? t("set.computer.checking") : t("set.computer.check")}
    </button>
  );

  return (
    <Panel id="set-computer" title="set.section.computer" scope={t("set.scope.everywhere")} end={check}>
      {providers.data || (hasFilm && setup.data) ? (
        <>
          {view.rows.map((row) => (
            <div className="srow" key={row.id} data-row={row.id}>
              <div className="txt">
                <b>{tm(row.name)}</b>
                <span>{row.jobs.length ? t("set.computer.used_for", { jobs: joinList(row.jobs.map((job) => t(job)), locale) }) : tm(row.detail)}</span>
              </div>
              <span className={`ready ${row.tone === "ok" ? "y" : "n"}`} data-tone={row.tone}>{row.tone === "ok" && <span aria-hidden="true">✓ </span>}{tm(row.status)}</span>
            </div>
          ))}
          {view.demoOnly && <p className="lead">{t("set.computer.demo_only")}</p>}
          <div className="impact keys-note"><span className="ic" aria-hidden="true">i</span><span><CodeText text={t("set.computer.keys_note")} /></span></div>
        </>
      ) : <ReadState error={providers.error} onRetry={providers.reload} />}
    </Panel>
  );
}
