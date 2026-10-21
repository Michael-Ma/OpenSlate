import { parentPort, workerData } from "node:worker_threads";

// Only in-memory PDF data is passed to pdf.js. It never receives a URL, CMap,
// standard-font or WASM URL. Embedded PDF JavaScript and evaluation stay disabled.
globalThis.fetch = async () => { throw new Error("Document extraction cannot access the network"); };
interface TextItem { str?: string; hasEOL?: boolean }
interface PdfDocument {
  numPages: number;
  getPage(page: number): Promise<{ getTextContent(options: { disableNormalization: boolean }): Promise<{ items: TextItem[] }>; cleanup(): void }>;
  destroy(): Promise<void>;
}
let document: PdfDocument | undefined;
try {
  const entry = "pdfjs-dist/legacy/build/pdf.mjs";
  const pdfjs = await import(entry) as { version: string; getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> } };
  if (pdfjs.version !== "5.4.296") throw Object.assign(new Error("The pinned PDF extractor version is unavailable"), { code: "PDFJS_VERSION_MISMATCH" });
  document = await pdfjs.getDocument({
    data: workerData.bytes, isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    useWorkerFetch: false, disableAutoFetch: true, disableStream: true, isOffscreenCanvasSupported: false,
    isImageDecoderSupported: false, useWasm: false, stopAtErrors: true, verbosity: 0,
  }).promise;
  let text = "", truncated = false;
  outer: for (let index = 1; index <= document.numPages; index++) {
    const page = await document.getPage(index);
    try {
      const content = await page.getTextContent({ disableNormalization: false });
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        const addition = `${item.str}${item.hasEOL ? "\n" : " "}`;
        if (text.length + addition.length > workerData.maxCharacters) {
          text += addition.slice(0, workerData.maxCharacters - text.length); truncated = true; break outer;
        }
        text += addition;
      }
      if (index < document.numPages && text.length) {
        if (text.length >= workerData.maxCharacters) { truncated = true; break; }
        text += "\n";
      }
    } finally { page.cleanup(); }
  }
  parentPort!.postMessage({ ok: true, result: { text: text.trimEnd(), pages: document.numPages, truncated } });
} catch (error) {
  parentPort!.postMessage({ ok: false, code: ["ERR_MODULE_NOT_FOUND", "PDFJS_VERSION_MISMATCH"].includes((error as NodeJS.ErrnoException).code ?? "") ? "DOCUMENT_EXTRACTOR_UNAVAILABLE" : "DOCUMENT_INVALID" });
} finally { await document?.destroy(); }
