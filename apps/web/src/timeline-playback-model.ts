import type { ProjectSnapshot } from "./model";
export interface AudioPlacement { id: string; audioId: string; sha256: string; startSample: number; durationSamples: number; atSample: number; gainMilliDb: number; shotIds: string[] }
export interface TimelinePlayback { projectId: string; headVersion: number; revisionId: string; placements: AudioPlacement[]; soundtrack: AudioPlacement | null }
export interface PlayableMedia { currentTime: number; paused: boolean; volume: number; pause(): void; play(): Promise<void> }
/** Absolute film time maps to source-local samples. Clip audio is always muted. */
export function audioAt(placement: AudioPlacement, position: number) {
  const sample = Math.round(position * 48000), offset = sample - placement.atSample;
  return { active: offset >= 0 && offset < placement.durationSamples, sourceSeconds: (placement.startSample + Math.max(0, Math.min(offset, placement.durationSamples))) / 48000,
    volume: Math.min(1, Math.max(0, 10 ** (placement.gainMilliDb / 20000))) };
}
export function syncAudio(media: PlayableMedia, placement: AudioPlacement, position: number, playing: boolean): Promise<void> | null {
  const state = audioAt(placement, position); media.volume = state.volume;
  if (!state.active || !playing) { media.pause(); if (state.active && Math.abs(media.currentTime - state.sourceSeconds) > 0.12) media.currentTime = state.sourceSeconds; return null; }
  if (Math.abs(media.currentTime - state.sourceSeconds) > 0.12) media.currentTime = state.sourceSeconds;
  return media.paused ? media.play() : null;
}
export function currentPlayback(view: TimelinePlayback | null, project: { id: string; headVersion: number; revisionId: string }): boolean {
  return !!view && view.projectId === project.id && view.headVersion === project.headVersion && view.revisionId === project.revisionId;
}

export function timelineMediaIndex(snapshot: ProjectSnapshot) {
  const nodes = new Map(snapshot.plan?.nodes?.map(node => [node.id, node]) ?? []);
  const result = new Map<string, { image?: ProjectSnapshot["outputs"][number]; video?: ProjectSnapshot["outputs"][number] }>();
  for (const output of snapshot.outputs) {
    const node = nodes.get(output.nodeId); if (!node?.shotId || node.kind !== 'image' && node.kind !== 'video') continue;
    const entry = result.get(node.shotId) ?? {}; entry[node.kind] = output; result.set(node.shotId, entry);
  }
  return result;
}

export function upcomingAudioDelay(placement: AudioPlacement, position: number): number | null {
  const delay = (placement.atSample / 48000 - position) * 1000;
  return delay > 0 && delay <= 2000 ? delay : null;
}
/** Start an already verified upcoming recording at its first selected sample rather than skipping forward at the next UI tick. */
export function scheduleAudioStart(media: PlayableMedia, placement: AudioPlacement, position: number, current: () => boolean,
  failed: (cause: unknown) => void, timers: { set(callback: () => void, delay: number): unknown; clear(handle: unknown): void } = { set: (callback, delay) => setTimeout(callback, delay), clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }): () => void {
  const delay = upcomingAudioDelay(placement, position); if (delay === null) return () => {};
  const handle = timers.set(() => {
    if (!current()) return;
    media.currentTime = placement.startSample / 48000; media.volume = audioAt(placement, placement.atSample / 48000).volume;
    void media.play().catch(cause => { if (current()) failed(cause); });
  }, delay);
  return () => timers.clear(handle);
}
