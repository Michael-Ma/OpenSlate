/**
 * Request identity for presses (plan items GR-8, WA-7).
 *
 * A press has a logical identity (what the person asked for, e.g. "make video for scene 2 from these
 * frames"). The first attempt mints an Idempotency-Key and remembers the exact body it sent. If the
 * reply is lost, pressing again resends the same body with the same key, so the server replays its
 * receipt instead of charging twice, even across a reload. The entry is dropped once the server has
 * answered definitely (success or a 4xx refusal).
 *
 * Presses are kept per film. While no film is open (a first run, or Start before a film is chosen) the
 * library-level presses (create a film, the demo) are kept in their own library namespace.
 */
export interface SavedPress {
  key: string;
  logical: string;
  body: unknown;
}

type KeyStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Where library-level presses are kept; a film's are under `openslate.next.presses.<projectId>`. */
export const LIBRARY_KEY = "openslate.next.library-presses";

/** Stable JSON with sorted object keys, so equal requests compare equal. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export class PressKeys {
  readonly #storage: KeyStorage | null;
  readonly #storageKey: string;
  readonly #newKey: () => string;
  #memory: Record<string, SavedPress>;

  /** `projectId` null: the library namespace, for presses made while no film is open. */
  constructor(projectId: string | null, storage: KeyStorage | null, newKey: () => string) {
    this.#storage = storage;
    this.#storageKey = projectId === null ? LIBRARY_KEY : `openslate.next.presses.${projectId}`;
    this.#newKey = newKey;
    this.#memory = this.#read();
  }

  #read(): Record<string, SavedPress> {
    try {
      const raw = this.#storage?.getItem(this.#storageKey);
      const value: unknown = raw ? JSON.parse(raw) : {};
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, SavedPress>) : {};
    } catch {
      return {};
    }
  }

  #write(): void {
    try {
      if (Object.keys(this.#memory).length) this.#storage?.setItem(this.#storageKey, JSON.stringify(this.#memory));
      else this.#storage?.removeItem(this.#storageKey);
    } catch { /* storage unavailable: memory still protects this tab */ }
  }

  /**
   * The key and body to send for this press. A saved press with the same logical identity is resent as it was;
   * a different logical identity replaces it with a fresh key and the new body.
   */
  begin(pressId: string, logical: unknown, body: unknown): SavedPress {
    const logicalJson = canonicalJson(logical);
    const saved = this.#memory[pressId];
    if (saved && saved.logical === logicalJson) return saved;
    const next = { key: this.#newKey(), logical: logicalJson, body };
    this.#memory = { ...this.#memory, [pressId]: next };
    this.#write();
    return next;
  }

  saved(pressId: string): SavedPress | undefined {
    return this.#memory[pressId];
  }

  /** The press ids sent with no definite answer yet (a lost reply, or still in flight). */
  ids(): string[] {
    return Object.keys(this.#memory);
  }

  /** The server answered definitely; the next press is a new request. */
  settle(pressId: string): void {
    if (!(pressId in this.#memory)) return;
    const { [pressId]: _dropped, ...rest } = this.#memory;
    this.#memory = rest;
    this.#write();
  }
}
