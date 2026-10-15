import { resolveUiMode } from "./shared/ui-mode.ts";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
// Each tree loads its own stylesheets, so the classic CSS never reaches the next UI.
if (resolveUiMode(window.location.search, storage) === "next") {
  void import("./next/boot.tsx").then(({ bootNext }) => bootNext(root));
} else {
  void import("./legacy/boot.tsx").then(({ bootLegacy }) => bootLegacy(root));
}
