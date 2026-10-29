/** Text with **bold** runs (catalog messages mark the words the design draws in bold). Never HTML. */
export function Rich({ text }: { text: string }) {
  const parts = text.split("**");
  return <>{parts.map((part, index) => (index % 2 ? <b key={index}>{part}</b> : part))}</>;
}

/** The same text without its bold marks, for titles and labels. */
export const plain = (text: string) => text.replaceAll("**", "");
