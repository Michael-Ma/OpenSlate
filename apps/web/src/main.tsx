import { bootNext } from "./next/boot.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing root element");
bootNext(root);
