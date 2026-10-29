import type { ReactNode } from "react";

/**
 * A refusal said inside a modal dialog (the New film sheet, the archive dialog): the dialog's backdrop
 * covers the toast and makes it inert, so the dialog says it itself. Neutral, with an icon and words.
 */
export function Alert({ children }: { children: ReactNode }) {
  return (
    <div className="impact cost" role="alert">
      <span className="ic" aria-hidden="true">!</span>
      <span>{children}</span>
    </div>
  );
}
