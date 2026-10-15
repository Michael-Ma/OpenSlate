/**
 * One clock for the whole film (SB-19): pictures, narration and music all read their position from it.
 * Browser preview only; the exported MP4 is exact. The frame source is injectable so tests drive time by hand.
 */
export interface FrameSource {
  now(): number;
  request(callback: (now: number) => void): number;
  cancel(handle: number): void;
}

export interface ClockState {
  /** Seconds into the film. */
  time: number;
  playing: boolean;
}

const browserFrames = (): FrameSource => ({
  now: () => performance.now(),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
});

export class FilmClock {
  #time = 0;
  #playing = false;
  #total = 0;
  #handle: number | null = null;
  #startedAt = 0;
  #startedFrom = 0;
  #state: ClockState = { time: 0, playing: false };
  readonly #frames: FrameSource;
  readonly #listeners = new Set<() => void>();

  constructor(frames: FrameSource = browserFrames()) {
    this.#frames = frames;
  }

  get time(): number { return this.#time; }
  get playing(): boolean { return this.#playing; }
  get total(): number { return this.#total; }

  /** A stable object between changes, for useSyncExternalStore. */
  getState = (): ClockState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  /** The film's length changed (an edit): keep the position inside it. */
  setTotal(total: number): void {
    this.#total = Math.max(0, total);
    if (this.#time > this.#total) this.seek(this.#total);
  }

  /** Play from here; at the end, play starts again from the beginning. */
  play(): void {
    if (this.#playing || this.#total <= 0) return;
    if (this.#time >= this.#total - 0.05) this.#time = 0;
    this.#playing = true;
    this.#startedAt = this.#frames.now();
    this.#startedFrom = this.#time;
    this.#emit();
    this.#schedule();
  }

  pause(): void {
    if (!this.#playing) return;
    this.#playing = false;
    if (this.#handle !== null) this.#frames.cancel(this.#handle);
    this.#handle = null;
    this.#emit();
  }

  toggle(): void {
    if (this.#playing) this.pause();
    else this.play();
  }

  seek(time: number): void {
    this.#time = Math.min(this.#total, Math.max(0, Number.isFinite(time) ? time : 0));
    if (this.#playing) { this.#startedAt = this.#frames.now(); this.#startedFrom = this.#time; }
    this.#emit();
  }

  dispose(): void {
    this.pause();
    this.#listeners.clear();
  }

  #schedule(): void {
    this.#handle = this.#frames.request((now) => {
      this.#handle = null;
      if (!this.#playing) return;
      this.#time = Math.min(this.#total, this.#startedFrom + (now - this.#startedAt) / 1000);
      if (this.#time >= this.#total) {
        this.#playing = false;
        this.#emit();
        return;
      }
      this.#emit();
      this.#schedule();
    });
  }

  #emit(): void {
    this.#state = { time: this.#time, playing: this.#playing };
    for (const listener of [...this.#listeners]) listener();
  }
}
