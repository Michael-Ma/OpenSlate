export interface TimelineMusicDraftBase {
  headVersion: number;
  audioId: string;
  savedValue: number;
}

export const validMusicGain = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= -60000 && (value as number) <= 0 && (value as number) % 1000 === 0;

export const validMusicStart = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10800;

export function musicDraftBase(value: unknown): TimelineMusicDraftBase | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return Number.isSafeInteger(row.headVersion) && (row.headVersion as number) >= 0 &&
    typeof row.audioId === "string" && row.audioId.length > 0 && row.audioId.length <= 160 &&
    Number.isSafeInteger(row.savedValue)
    ? { headVersion: row.headVersion as number, audioId: row.audioId, savedValue: row.savedValue as number }
    : null;
}

export function musicDraftStale(value: number, base: TimelineMusicDraftBase | null,
  savedValue: number, headVersion: number, audioId: string): boolean {
  return value !== savedValue && (!base || base.headVersion !== headVersion ||
    base.audioId !== audioId || base.savedValue !== savedValue);
}
