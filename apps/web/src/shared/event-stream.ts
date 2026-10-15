/** Small SSE decoder. It stores at most one bounded frame and never evaluates event data. */
export interface StreamEvent { event: string; id: string | null; data: string }
export class EventStreamParser {
  readonly #decoder = new TextDecoder("utf-8", { fatal: true });
  #line = ""; #data: string[] = []; #event = ""; #id: string | null = null; #size = 0; #cr = false; #first = true;
  readonly emit: (event: StreamEvent) => void; readonly maxBytes: number;
  constructor(emit: (event: StreamEvent) => void, maxBytes = 65536) { this.emit = emit; this.maxBytes = maxBytes; }
  push(bytes: Uint8Array): void {
    if (bytes.byteLength > 256 * 1024) throw new Error("EVENT_STREAM_LIMIT");
    this.#text(this.#decoder.decode(bytes, { stream: true }));
  }
  finish(): void { this.#text(this.#decoder.decode()); /* Incomplete final frames are deliberately discarded. */ }
  #text(text: string): void {
    for (const character of text) {
      if (this.#first) { this.#first = false; if (character === "\ufeff") continue; }
      if (this.#cr) { this.#cr = false; if (character === "\n") continue; }
      if (character === "\r" || character === "\n") {
        this.#consume(); this.#cr = character === "\r"; continue;
      }
      this.#size += character.length === 2 ? 4 : character.charCodeAt(0) < 128 ? 1 : character.charCodeAt(0) < 2048 ? 2 : 3;
      if (this.#size > this.maxBytes) throw new Error("EVENT_STREAM_LIMIT");
      this.#line += character;
    }
  }
  #consume(): void {
    const line = this.#line; this.#line = "";
    if (!line) {
      if (this.#data.length) this.emit({ event: this.#event || "message", id: this.#id, data: this.#data.join("\n") });
      this.#event = ""; this.#id = null; this.#data = []; this.#size = 0; return;
    }
    if (line.startsWith(":")) { this.#size -= new TextEncoder().encode(line).byteLength; return; }
    const colon = line.indexOf(":"), field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1); if (value.startsWith(" ")) value = value.slice(1);
    if (field === "data") this.#data.push(value);
    else if (field === "event") this.#event = value;
    else if (field === "id" && !value.includes("\0")) this.#id = value;
  }
}
