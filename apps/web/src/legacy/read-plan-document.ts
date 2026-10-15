export async function readPlanDocument(file: File) {
  if (!/\.(txt|md)$/i.test(file.name) || file.size > 64 * 1024)
    throw new Error(
      "Choose a UTF-8 .txt or .md file, up to 64 KB. Paste text from a PDF or Word document for now.",
    );
  const text = new TextDecoder("utf-8", { fatal: true }).decode(
    await file.arrayBuffer(),
  );
  if (!text.trim() || text.length > 12000 || text.includes("\0"))
    throw new Error("Use non-empty text, up to 12,000 characters.");
  return { name: file.name.slice(0, 160), text };
}
