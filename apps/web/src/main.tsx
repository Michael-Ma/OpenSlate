import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { APP_NAME } from "@openslate/core";
import "./style.css";

function App() {
  const [apiStatus, setApiStatus] = useState("Checking API…");

  useEffect(() => {
    const controller = new AbortController();
    async function checkHealth() {
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        if (!response.ok) throw new Error("API unavailable");
        setApiStatus("API connected");
      } catch {
        if (!controller.signal.aborted) setApiStatus("API unavailable — start the server to connect.");
      }
    }
    void checkHealth();
    return () => controller.abort();
  }, []);

  return (
    <main>
      <p className="eyebrow">OPEN-SOURCE VIDEO AGENT</p>
      <h1>{APP_NAME}</h1>
      <p className="intro">From a story to a finished film.</p>
      <p>Plan scenes and shots, create references, generate takes, and assemble an editable video.</p>
      <section aria-labelledby="status-title">
        <h2 id="status-title">Project skeleton</h2>
        <p>This is the starting workspace. Planning, generation, and editing are coming next.</p>
        <p role="status">{apiStatus}</p>
      </section>
      <a href="https://github.com/Michael-Ma/OpenSlate/tree/main/docs/design">Read the design and roadmap →</a>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
createRoot(root).render(<StrictMode><App /></StrictMode>);
