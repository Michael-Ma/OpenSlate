import { useMemo, useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { computerView } from "../../model/settings-computer.ts";
import type { DirectorSetup } from "../../model/settings-director.ts";
import { joinList, type ProviderCatalogView } from "../../model/settings.ts";
import { msg } from "../../model/types.ts";
import { useStore } from "../../store/react.tsx";
import type { Resource } from "../../store/useResource.ts";
import { CodeText, Panel, ReadState } from "./parts.tsx";

/**
 * This computer: Codex, FFmpeg and each key a model needs, for every film. "Check again" re-reads the catalog
 * and runs Codex's read-only setup check (GET /director/models); keys are explained, never shown or set here.
 */
export function ComputerPanel({ providers, setup, offline }: { providers: Resource<ProviderCatalogView>; setup: Resource<DirectorSetup>; offline: string | null }) {
  const store = useStore();
  const { t, tm, locale } = useI18n();
  const [checking, setChecking] = useState(false);
  const view = useMemo(() => computerView(providers.data, setup.data, setup.error), [providers.data, setup.data, setup.error]);

  const recheck = async () => {
    setChecking(true);
    try {
      // The Codex check can be slow or refused (no Codex Director on this server); the rows say what is known.
      await store.read<DirectorSetup>("/director/models").catch(() => null);
      store.dispatch({ type: "toast", message: msg("set.toast.checked"), tone: "info" });
    } finally {
      setChecking(false);
      setup.reload();
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
      {providers.data || setup.data ? (
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
