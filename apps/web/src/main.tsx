import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Theme } from "@radix-ui/themes";
// Register production CSS here, before App's module graph. Component-local
// duplicates support isolated previews without changing the first load order.
// Retained legacy layouts, followed by typography and the Radix foundation.
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
import "./owned-transcription.css";
import "./transcript-review.css";
import "./recovery.css";
import "./generation-guide.css";
import "./typography.css";
import "@radix-ui/themes/styles.css";
// Current OpenSlate components follow the shared theme; workspace layout is last.
import "./light-theme.css";
import "./director-plan.css";
import "./workspace-light.css";
import "./project-results.css";
import "./conversation-media-tools.css";
import "./conversation-actions.css";
import "./conversation-workspace.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(
  <StrictMode>
    <Theme
      appearance="light"
      accentColor="blue"
      grayColor="slate"
      radius="medium"
      scaling="100%"
      className="openslate-theme"
    >
      <App />
    </Theme>
  </StrictMode>,
);
