import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18n.tsx";
import { songAnalysisPath, songAnalysisView, type SongAnalysisState } from "../../model/song-analysis.ts";
import { useStore } from "../../store/react.tsx";

/**
 * A music recording's song analysis. Reading it is free; the press is paid and sends the song to Google, so the
 * button carries the price and the line under it says so. While Gemini listens, it reads again every few seconds.
 */
export function SongAnalysis({ audioId, sha256 }: { audioId: string; sha256: string }) {
  const { t, tm, locale } = useI18n();
  const store = useStore();
  const [answer, setAnswer] = useState<SongAnalysisState | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pressing, setPressing] = useState(false);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    store.read<SongAnalysisState>(songAnalysisPath(audioId), abort.signal)
      .then((value) => { setAnswer(value); setFailure(null); })
      .catch((error: { code?: string }) => { if (!abort.signal.aborted) setFailure(error.code ?? "NETWORK_ERROR"); });
    return () => abort.abort();
  }, [store, audioId, reads]);

  const view = answer ? songAnalysisView(answer, locale) : null;
  useEffect(() => {
    if (!view?.polling) return;
    const timer = setTimeout(() => setReads((n) => n + 1), 4000);
    return () => clearTimeout(timer);
  }, [view?.polling, answer]);

  const press = async () => {
    if (pressing) return;
    setPressing(true);
    try {
      const next = await store.command<SongAnalysisState>(`song:analyze:${audioId}`, { audioId, sha256 }, () => ({ path: songAnalysisPath(audioId), body: { expectedSha256: sha256 } }));
      if (next) setAnswer(next);
    } finally { setPressing(false); }
  };

  return (
    <section className="av-song" data-song-state={answer?.state ?? (failure ? "error" : "loading")} aria-live="polite">
      <h4>{t("assets.song.title")}</h4>
      {!view && <p className="hint">{failure ? t("assets.song.read_failed", { code: failure }) : t("assets.song.loading")}</p>}
      {view && <p>{tm(view.line)}</p>}
      {view?.note && <p className="hint">{tm(view.note)}</p>}
      {view?.action && <button type="button" className="pill" data-act="analyze-song" aria-busy={pressing || undefined} disabled={pressing} onClick={() => void press()}>{tm(view.action)}</button>}
    </section>
  );
}
