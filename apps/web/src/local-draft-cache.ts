/** Browser-only recovery for unsaved UI text. The server remains authoritative. */
export interface LocalDraft<T> {
  value: T;
  base: unknown;
  revision: string;
}

interface Envelope {
  version: 1;
  updatedAt: number;
  expiresAt: number;
  writerId: string;
  revision: string;
  base: unknown;
  value: unknown;
}

export type DraftResult = "saved" | "conflict" | "unavailable";
export interface DraftWriteResult { status: DraftResult; revision?: string }
const prefix = "openslate:local:v1:";
const ttl = 30 * 24 * 60 * 60 * 1000;
const maxRecord = 128 * 1024;
const maxTotal = 1024 * 1024;
const maxRecords = 128;
const writerId = globalThis.crypto?.randomUUID?.() ?? String(Math.random());
const seen = new Map<string, string>();
const unreadable = new Set<string>();
const listeners = new Set<() => void>();
let notice = "";
let listening = false;

function warn(message: string) {
  if (notice === message) return;
  notice = message;
  for (const listener of listeners) listener();
}

export function localDraftNotice() {
  return notice;
}

export function subscribeLocalDraftNotice(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function key(namespace: string, projectId: string, field: string) {
  if (!namespace || !projectId || !field) return null;
  return `${prefix}${encodeURIComponent(namespace)}:${encodeURIComponent(projectId)}:${encodeURIComponent(field)}`;
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    if (!listening) {
      listening = true;
      window.addEventListener("storage", (event) => {
        if (event.key?.startsWith(prefix) && event.newValue !== event.oldValue)
          warn("A draft changed in another tab. Save or copy your current work before reloading to inspect it.");
      });
    }
    return window.localStorage;
  } catch {
    warn("Local draft recovery is unavailable in this browser. Keep this tab open until you save.");
    return null;
  }
}

function envelope(raw: string | null): Envelope | null {
  if (!raw || raw.length > maxRecord) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const item = data as Record<string, unknown>;
    if (
      item.version !== 1 ||
      typeof item.updatedAt !== "number" ||
      !Number.isFinite(item.updatedAt) ||
      typeof item.expiresAt !== "number" ||
      !Number.isFinite(item.expiresAt) ||
      typeof item.writerId !== "string" ||
      typeof item.revision !== "string" ||
      !item.revision ||
      item.updatedAt > Date.now() + 60_000
    ) return null;
    return item as unknown as Envelope;
  } catch {
    return null;
  }
}

function current(area: Storage, id: string) {
  const raw = area.getItem(id);
  const item = envelope(raw);
  if (item && item.expiresAt < Date.now()) {
    area.removeItem(id);
    seen.delete(id);
    unreadable.delete(id);
    return { raw: null, item: null };
  }
  return { raw, item };
}

/** Reads never establish authority; callers must validate the field shape and server base. */
export function readLocalDraft<T>(
  namespace: string | undefined,
  projectId: string,
  field: string,
  valid: (value: unknown) => value is T,
): LocalDraft<T> | null {
  const id = key(namespace ?? "", projectId, field);
  if (!id) {
    if (typeof window !== "undefined" && !namespace)
      warn("Local draft recovery is unavailable until the studio identity is ready.");
    return null;
  }
  const area = storage();
  if (!area) return null;
  try {
    const { raw, item } = current(area, id);
    if (!item || !valid(item.value)) {
      if (raw) {
        unreadable.add(id);
        warn("A local draft could not be restored. The saved project was not changed.");
      }
      return null;
    }
    unreadable.delete(id);
    seen.set(id, item.revision);
    return { value: item.value, base: item.base, revision: item.revision };
  } catch {
    warn("Local draft recovery is unavailable in this browser. Keep this tab open until you save.");
    return null;
  }
}

export function writeLocalDraft<T>(
  namespace: string | undefined,
  projectId: string,
  field: string,
  value: T,
  base: unknown,
  expectedRevision?: string | null,
  valid?: (value: unknown) => value is T,
): DraftWriteResult {
  if (valid && !valid(value)) {
    warn("This draft exceeds local recovery limits. Save or shorten it before reloading.");
    return { status: "unavailable" };
  }
  const id = key(namespace ?? "", projectId, field);
  if (!id) {
    if (typeof window !== "undefined" && !namespace)
      warn("Local draft recovery is unavailable until the studio identity is ready.");
    return { status: "unavailable" };
  }
  const area = storage();
  if (!area) return { status: "unavailable" };
  try {
    const { raw: existingRaw, item: existing } = current(area, id);
    if (existingRaw && !existing) {
      unreadable.add(id);
      warn("A local draft could not be read. Review this field before replacing it.");
      return { status: "conflict" };
    }
    if ((expectedRevision !== undefined && (existing?.revision ?? null) !== expectedRevision) ||
      (expectedRevision === undefined && existing && existing.writerId !== writerId && seen.get(id) !== existing.revision)) {
      warn("A newer local draft exists in another tab. Save or copy your current work before reloading to inspect it.");
      return { status: "conflict" };
    }
    const now = Date.now();
    const item: Envelope = {
      version: 1,
      updatedAt: now,
      expiresAt: now + ttl,
      writerId,
      revision: `${now}:${globalThis.crypto?.randomUUID?.() ?? Math.random()}`,
      base,
      value,
    };
    const raw = JSON.stringify(item);
    if (raw.length > maxRecord) {
      warn("This draft is too large for local recovery. Save it to the project.");
      return { status: "unavailable" };
    }
    const scope = `${prefix}${encodeURIComponent(namespace!)}:`;
    let count = 0, bytes = 0;
    for (let index = 0; index < area.length; index++) {
      const otherKey = area.key(index);
      if (!otherKey?.startsWith(scope) || otherKey === id) continue;
      const other = current(area, otherKey);
      if (!other.raw) {
        index--;
        continue;
      }
      count++;
      bytes += other.raw.length + otherKey.length;
    }
    if (count >= maxRecords || bytes + raw.length + id.length > maxTotal) {
      warn("Local draft recovery is full. Save or remove older drafts before continuing.");
      return { status: "unavailable" };
    }
    area.setItem(id, raw);
    unreadable.delete(id);
    seen.set(id, item.revision);
    return { status: "saved", revision: item.revision };
  } catch {
    warn("Local draft recovery is unavailable in this browser. Keep this tab open until you save.");
    return { status: "unavailable" };
  }
}

/** Remove only the revision this UI observed, so a later edit in another tab survives. */
export function clearLocalDraft(
  namespace: string | undefined,
  projectId: string,
  field: string,
  revision?: string,
): DraftResult {
  const id = key(namespace ?? "", projectId, field);
  if (!id) return "unavailable";
  const area = storage();
  if (!area) return "unavailable";
  try {
    const { item: existing } = current(area, id);
    if (existing && revision && existing.revision !== revision) return "conflict";
    if (existing && existing.writerId !== writerId && seen.get(id) !== existing.revision)
      return "conflict";
    area.removeItem(id);
    unreadable.delete(id);
    seen.delete(id);
    return "saved";
  } catch {
    warn("Local draft recovery is unavailable in this browser. Keep this tab open until you save.");
    return "unavailable";
  }
}

/** Explicit user recovery for unreadable records; all valid drafts remain intact. */
export function discardUnreadableLocalDrafts(namespace: string | undefined) {
  if (!namespace) return;
  const area = storage();
  if (!area) return;
  try {
    const scope = `${prefix}${encodeURIComponent(namespace)}:`;
    for (let index = area.length - 1; index >= 0; index--) {
      const id = area.key(index);
      if (!id?.startsWith(scope)) continue;
      const raw = area.getItem(id);
      if (raw && (!envelope(raw) || unreadable.has(id))) {
        area.removeItem(id);
        unreadable.delete(id);
        seen.delete(id);
      }
    }
    warn("");
  } catch {
    warn("Local draft recovery is unavailable in this browser. Keep this tab open until you save.");
  }
}

export const isDraftText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 16_000;
/** Storyboard fields have no composer character cap; the envelope size is their bound. */
export const isLocalFieldText = (value: unknown): value is string =>
  typeof value === "string" && value.length <= maxRecord;
