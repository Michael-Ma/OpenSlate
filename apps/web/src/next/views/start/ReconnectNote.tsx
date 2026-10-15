import { useI18n } from "../../i18n/I18n.tsx";

/**
 * Start's part of reconnecting after the studio restarted (P5-DESIGN "Reconnect after a restart", GR-14):
 * the films are safe, and jobs that were mid-send are never resent by themselves. The shell's Connect
 * screen owns the screen, the `pnpm studio` link instructions and Try again; it mounts this under them
 * when the window lost its session ("expired" or "failed"). Reads only the language, like Connect.
 */
export function ReconnectNote() {
  const { t } = useI18n();
  return (
    <>
      <p className="connect-how" data-note="films-saved">{t("start.reconnect.saved")}</p>
      <p className="connect-how" data-note="no-answer">{t("start.reconnect.no_answer")}</p>
    </>
  );
}
