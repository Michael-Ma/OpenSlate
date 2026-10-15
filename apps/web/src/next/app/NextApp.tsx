import { useEffect } from "react";
import { useI18n } from "../i18n/I18n.tsx";
import { useStore, useStudio } from "../store/react.tsx";
import { ClassicView } from "./ClassicView.tsx";
import { Connect } from "./Connect.tsx";
import { TopBar } from "./TopBar.tsx";
import { Toast } from "./Toast.tsx";
import { DirectorColumn } from "../director/DirectorColumn.tsx";
import { KeyframesView } from "../keyframes/KeyframesView.tsx";

/** The shell from the chosen design: 52 px top bar, 392 px Director column, workspace. */
export function NextApp({ onReconnect }: { onReconnect(): void }) {
  const store = useStore();
  const { locale } = useI18n();
  const connection = useStudio((s) => s.connection);
  const view = useStudio((s) => s.view);
  const directorOpen = useStudio((s) => s.directorOpen);
  const hasProject = useStudio((s) => !!s.projectId);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => () => store.stop(), [store]);
  if (connection === "expired" || connection === "failed" || (connection === "connecting" && !hasProject))
    return <Connect state={connection === "connecting" ? "connecting" : connection} onRetry={onReconnect} />;
  return (
    <div className={`app${directorOpen ? " dir-open" : ""}`} data-ui="next">
      <TopBar />
      <DirectorColumn />
      {view === "keyframes" ? <KeyframesView /> : <ClassicView view={view} />}
      <Toast />
    </div>
  );
}
