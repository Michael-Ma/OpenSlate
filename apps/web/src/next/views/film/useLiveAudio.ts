import { useEffect, useRef } from "react";
import type { FilmClock } from "../../model/film-clock.ts";
import { audioAt, syncMedia, type AudioPlacement } from "../../model/film-audio.ts";

const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
const LIMIT = 80 * 1024 * 1024;

/**
 * Download one recording through the narration audio route (a cookie-authenticated GET), check its SHA-256
 * and return an object URL. The shared media source covers artifacts only, so recordings load here.
 */
async function recordingUrl(projectId: string, placement: AudioPlacement, signal: AbortSignal): Promise<string> {
  // A kept clip's sound is derived from the clip; recordings come from the narration audio route.
  const route = placement.kind === "clip" ? "clip-audio" : "narration/audio";
  const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/${route}/${encodeURIComponent(placement.audioId)}/content`, { credentials: "same-origin", redirect: "error", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > LIMIT) throw new Error("too large");
  if (hex(await crypto.subtle.digest("SHA-256", bytes)) !== placement.sha256) throw new Error("changed");
  return URL.createObjectURL(new Blob([bytes], { type: response.headers.get("content-type")?.split(";")[0] ?? "audio/wav" }));
}

interface Voice {
  placement: AudioPlacement;
  audio: HTMLAudioElement | null;
  url: string | null;
}

/**
 * Narration and music on the film clock (live studio only; the sample film has no sound). Each recording is
 * loaded once and kept in step with the clock; a recording that cannot load stays silent and the picture plays on.
 */
export function useLiveAudio(clock: FilmClock, projectId: string | null, placements: readonly AudioPlacement[], enabled: boolean): void {
  const voices = useRef(new Map<string, Voice>());
  const key = placements.map((p) => `${p.id}:${p.kind ?? ""}:${p.sha256}:${p.atSample}:${p.durationSamples}:${p.gainMilliDb}:${(p.gainSteps ?? []).map((step) => `${step.atSample}/${step.gainMilliDb}`).join(",")}`).join("|");

  useEffect(() => {
    if (!enabled || !projectId) return;
    const controller = new AbortController();
    const current = voices.current;
    const started: Voice[] = [];
    const wanted = new Set(placements.map((p) => p.id));
    for (const [id, voice] of current) {
      if (wanted.has(id)) continue;
      voice.audio?.pause();
      if (voice.url) URL.revokeObjectURL(voice.url);
      current.delete(id);
    }
    for (const placement of placements) {
      const existing = current.get(placement.id);
      if (existing && existing.placement.sha256 === placement.sha256) { existing.placement = placement; continue; }
      if (existing) { existing.audio?.pause(); if (existing.url) URL.revokeObjectURL(existing.url); }
      const voice: Voice = { placement, audio: null, url: null };
      current.set(placement.id, voice);
      started.push(voice);
      recordingUrl(projectId, placement, controller.signal).then((url) => {
        if (current.get(placement.id) !== voice) { URL.revokeObjectURL(url); return; }
        voice.url = url;
        const audio = new Audio(url);
        audio.preload = "auto";
        voice.audio = audio;
      }, () => { /* silent: the picture still plays */ });
    }
    return () => {
      controller.abort();
      // Loads cut short here start again on the next run.
      for (const voice of started) if (!voice.audio && current.get(voice.placement.id) === voice) current.delete(voice.placement.id);
    };
    // The key covers every placement field that matters.
  }, [enabled, projectId, key]);

  useEffect(() => {
    if (!enabled) return;
    const sync = () => {
      const { time, playing } = clock.getState();
      for (const voice of voices.current.values()) if (voice.audio) syncMedia(voice.audio, audioAt(voice.placement, time), playing);
    };
    sync();
    return clock.subscribe(sync);
  }, [clock, enabled]);

  useEffect(() => () => {
    for (const voice of voices.current.values()) { voice.audio?.pause(); if (voice.url) URL.revokeObjectURL(voice.url); }
    voices.current.clear();
  }, []);
}
