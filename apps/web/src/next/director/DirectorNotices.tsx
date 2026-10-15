import { useI18n } from "../i18n/I18n.tsx";
import { modeLine } from "../model/director.ts";
import { useStudio } from "../store/react.tsx";

/**
 * Under the header: the runtime mode line. Stopped and restart casualties are film-wide, so the shell's strip
 * at the top of the workspace says them once, with Continue, in every view.
 */
export function DirectorNotices() {
  const { tm } = useI18n();
  const director = useStudio((s) => s.director);
  const loadError = useStudio((s) => s.loadErrors.director);
  const line = modeLine(director, loadError);
  if (!line) return null;
  return (
    <div className="dir-notices">
      <p className={`dir-mode ${line.tone}`} data-mode={director?.mode ?? "unknown"}>{tm(line.message)}</p>
    </div>
  );
}
