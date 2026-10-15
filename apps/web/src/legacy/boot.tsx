import { LocaleProvider, initializeLocale } from "./Locale";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initializeAppearance, StudioTheme } from "./Appearance";
// Register production CSS here, before App's module graph. Component-local
// duplicates support isolated previews without changing the first load order.
// Retained component layouts, followed by typography and the Radix foundation.
import "./style.css";
import "./precision.css";
import "./storyboard.css";
import "./workspace-layout.css";
import "./chat-markdown.css";
import "./providers.css";
import "./project-settings.css";
import "./media.css";
import "./audio-library.css";
import "./narration.css";
import "./shot-audio.css";
import "./recovery.css";
import "./generation-guide.css";
import "./typography.css";
import "@radix-ui/themes/styles.css";
// Production components retain their behavior; the final palette covers portals too.
import "./director-plan.css";
import "./workspace-light.css";
import "./conversation-media-tools.css";
import "./conversation-actions.css";
import "./conversation-workspace.css";
import "./frame-theme.css";
import "./frame-workspace.css";
import "./timeline-editor.css";
import "./reference-composer.css";
import "./frame-shell.css";
import "./locale.css";
import App from "./App";

/** The classic studio. Its stylesheets load only with this module. */
export function bootLegacy(root: HTMLElement) {
  const initialAppearance = initializeAppearance();
  const initialLocale = initializeLocale();
  createRoot(root).render(
    <StrictMode>
      <LocaleProvider initialLocale={initialLocale}>
        <StudioTheme initialAppearance={initialAppearance}>
          <App />
        </StudioTheme>
      </LocaleProvider>
    </StrictMode>,
  );
}
