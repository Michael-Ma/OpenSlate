import { useI18n } from "../i18n/I18n.tsx";
import { errorInThread, heldEdits, modeLine } from "../model/director.ts";
import { useMode, useStudio } from "../store/react.tsx";

/**
 * Under the header: the runtime mode line. Stopped and restart casualties are film-wide, so the shell's strip
 * at the top of the workspace says them once, with Continue, in every view. A failed turn is said once, by its
 * marker in the thread; only the sample film's scripted Director, with no held edit on screen, says nothing changes.
 */
export function DirectorNotices() {
  const { tm } = useI18n();
  const mode = useMode();
  const director = useStudio((s) => s.director);
  const snapshot = useStudio((s) => s.snapshot);
  const overview = useStudio((s) => s.overview);
  const loadError = useStudio((s) => s.loadErrors.director);
  const line = modeLine(director, loadError, {
    errorShown: errorInThread(snapshot, director),
    filmUnchanged: mode === "fixture" && heldEdits(overview, snapshot, director).length === 0,
  });
  if (!line) return null;
  return (
    <div className="dir-notices">
      <p className={`dir-mode ${line.tone}`} data-mode={director?.mode ?? "unknown"}>{tm(line.message)}</p>
    </div>
  );
}
