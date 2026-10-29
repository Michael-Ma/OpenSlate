import { useEffect, useState } from "react";

/**
 * True once `on` has held for `ms` without a break. The snapshot and the overview refresh one after the other, so
 * "the film is updating" lasts a moment on every change during generation: a note for it shows only when the
 * wait is real, instead of flashing and moving the layout each time.
 */
export function useSustained(on: boolean, ms = 1200): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!on) { setHeld(false); return; }
    const timer = setTimeout(() => setHeld(true), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on && held;
}
