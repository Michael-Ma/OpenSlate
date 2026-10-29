const TERMINAL_PUNCTUATION = /[.!?…。！？]$/u;

/** Join direction parts without adding punctuation after the final part. */
export function joinPromptParts(parts: readonly string[]): string {
  const text = parts.map(part => part.trim()).filter(Boolean);
  return text.map((part, index) =>
    index === text.length - 1 || TERMINAL_PUNCTUATION.test(part) ? part : `${part}.`,
  ).join(" ");
}
