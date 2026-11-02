import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FilmClock } from "../../model/film-clock.ts";

/**
 * A value derived from the film clock that re-renders only when it changes (the shot on screen, playing,
 * the spoken line), never on every frame. Select a primitive.
 */
export function useClockValue<T extends string | number | boolean>(clock: FilmClock, select: (time: number, playing: boolean) => T): T {
  const selectRef = useRef(select);
  selectRef.current = select;
  const get = useCallback(() => {
    const state = clock.getState();
    return selectRef.current(state.time, state.playing);
  }, [clock]);
  return useSyncExternalStore(clock.subscribe, get);
}

/** Run `paint` on every clock change (and once now), for per-frame work done through refs. */
export function useClockPaint(clock: FilmClock, paint: (time: number, playing: boolean) => void): void {
  const paintRef = useRef(paint);
  paintRef.current = paint;
  useEffect(() => {
    const run = () => { const state = clock.getState(); paintRef.current(state.time, state.playing); };
    run();
    return clock.subscribe(run);
  }, [clock]);
  // A new paint function (new timeline, new shot) paints at once, even while paused.
  useEffect(() => { const state = clock.getState(); paint(state.time, state.playing); });
}

/** Follows prefers-reduced-motion. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const list = window.matchMedia?.(query);
    if (!list) return;
    const update = () => setReduced(list.matches);
    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Re-render every second while `on` (elapsed time on a running export). */
export function useNow(on: boolean, everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [on, everyMs]);
  return now;
}
