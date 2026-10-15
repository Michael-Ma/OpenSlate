import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

/** The Last Ferry studio. Built up in phase P2 of docs/ai/UIUX-IMPLEMENTATION-PLAN.md. */
export function bootNext(root: HTMLElement) {
  createRoot(root).render(
    <StrictMode>
      <main data-ui="next">
        <p>OpenSlate (next)</p>
        <a href="?ui=classic">Open the classic studio</a>
      </main>
    </StrictMode>,
  );
}
