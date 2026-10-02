import type { AudioPlacement } from './timeline-playback-model';
export const audioKey = (placement: AudioPlacement) => `${placement.audioId}:${placement.sha256}`;
/** Hold at most eight verified current/upcoming sources, including music. Old blobs and in-flight reads are released on seek. */
export class TimelineAudioCache {
  private entries = new Map<string, { abort: AbortController; url: string | null; error: string | null }>();
  private closed = false;
  private readonly load: (placement: AudioPlacement, signal: AbortSignal) => Promise<string>;
  private readonly revoke: (url: string) => void;
  private readonly changed: (urls: Record<string, string>, error: string) => void;
  constructor(load: (placement: AudioPlacement, signal: AbortSignal) => Promise<string>, revoke: (url: string) => void, changed: (urls: Record<string, string>, error: string) => void) { this.load = load; this.revoke = revoke; this.changed = changed; }
  select(placements: AudioPlacement[]) {
    if (this.closed) return;
    const desired = new Map([...new Map(placements.map(placement => [audioKey(placement), placement])).entries()].slice(0, 8));
    for (const [key, entry] of this.entries) if (!desired.has(key)) { entry.abort.abort(); if (entry.url) this.revoke(entry.url); this.entries.delete(key); }
    for (const [key, placement] of desired) if (!this.entries.has(key)) {
      const entry = { abort: new AbortController(), url: null as string | null, error: null as string | null }; this.entries.set(key, entry);
      void this.load(placement, entry.abort.signal).then(url => {
        if (this.closed || entry.abort.signal.aborted || this.entries.get(key) !== entry) { this.revoke(url); return; }
        entry.url = url; this.emit();
      }).catch(cause => { if (this.closed || entry.abort.signal.aborted || this.entries.get(key) !== entry) return; entry.error = cause instanceof Error ? cause.message : 'Audio could not be loaded.'; this.emit(); });
    }
    this.emit();
  }
  retry() { for (const [key, entry] of this.entries) if (entry.error) { entry.abort.abort(); this.entries.delete(key); } }
  close() { this.closed = true; for (const entry of this.entries.values()) { entry.abort.abort(); if (entry.url) this.revoke(entry.url); } this.entries.clear(); }
  private emit() { if (!this.closed) this.changed(Object.fromEntries([...this.entries].flatMap(([key, entry]) => entry.url ? [[key, entry.url]] : [])), [...this.entries.values()].find(entry => entry.error)?.error ?? ''); }
}
export function audioWindow(placements: AudioPlacement[], position: number): AudioPlacement[] {
  const sample = Math.round(position * 48000), end = sample + 96000;
  const relevant = placements.filter(placement => placement.atSample <= end && placement.atSample + placement.durationSamples > sample)
    .sort((a, b) => (a.atSample <= sample ? 0 : 1) - (b.atSample <= sample ? 0 : 1) || a.atSample - b.atSample);
  const allowedSources = new Set([...new Set(relevant.map(audioKey))].slice(0, 8));
  return relevant.filter(placement => allowedSources.has(audioKey(placement)));
}
